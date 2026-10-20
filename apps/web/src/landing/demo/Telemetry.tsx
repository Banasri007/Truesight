import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";

/** Simulated readings: the gate is really open from minute 22 to 41, with two noisy frames. */
const OPEN_FROM = 22;
const OPEN_TO = 41;
const GLITCHES: Record<number, number> = { 9: 0.74, 33: 0.38 };

function readings() {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 61 }, (_, t) => {
    const open = t >= OPEN_FROM && t < OPEN_TO;
    const base = open ? 0.9 : 0.07;
    const p = GLITCHES[t] ?? Math.min(0.99, Math.max(0.01, base + (rand() - 0.5) * 0.1));
    return { t, p: Math.round(p * 100) / 100 };
  });
}

/** Same rule as the engine: a new state needs `k` agreeing, confident answers in a row. */
function debounce(data: { t: number; p: number }[], k: number, min = 0.6) {
  let state: "latched" | "open" = "latched";
  let pending: { s: string; n: number } | null = null;
  let alerts = 0;
  let falseAlerts = 0;
  let confirmDelay: number | null = null;
  const series = data.map(({ t, p }) => {
    const answer = p >= min ? "open" : 1 - p >= min ? "latched" : null;
    if (answer && answer !== state) {
      pending = pending?.s === answer ? { s: answer, n: pending.n + 1 } : { s: answer, n: 1 };
      if (pending.n >= k) {
        state = answer as typeof state;
        pending = null;
        if (state === "open") {
          alerts++;
          if (t < OPEN_FROM || t >= OPEN_TO) falseAlerts++;
          else if (confirmDelay === null) confirmDelay = t - OPEN_FROM;
        }
      }
    } else if (answer) pending = null;
    return { t, p, state: state === "open" ? 0.97 : 0.03 };
  });
  return { series, alerts, falseAlerts, confirmDelay };
}

export function Telemetry() {
  const data = useMemo(readings, []);
  const [k, setK] = useState(2);
  const result = useMemo(() => debounce(data, k), [data, k]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="panel relative p-4 pt-5 backdrop-blur-md">
        <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-fog">
          <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-signal" /> P(open) per frame</span>
          <span className="flex items-center gap-2"><span className="h-px w-4 bg-ember" /> Debounced state</span>
          <span className="flex items-center gap-2"><span className="h-2 w-4 rounded-sm bg-white/10" /> Gate actually open</span>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={result.series} margin={{ top: 10, right: 12, bottom: 4, left: -18 }}>
              <CartesianGrid stroke="rgba(150,180,225,0.08)" vertical={false} />
              <ReferenceArea x1={OPEN_FROM} x2={OPEN_TO - 1} fill="rgba(255,255,255,0.05)" />
              <XAxis dataKey="t" type="number" domain={[0, 60]} ticks={[0, 10, 20, 30, 40, 50, 60]} tickFormatter={(v: number) => `${v}m`} stroke="#7d8799" fontSize={11} tickLine={false} axisLine={{ stroke: "rgba(150,180,225,0.15)" }} />
              <YAxis domain={[0, 1]} ticks={[0, 0.6, 1]} stroke="#7d8799" fontSize={11} tickLine={false} axisLine={false} />
              <ReferenceLine y={0.6} stroke="#f3c46b" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "min confidence", fill: "#f3c46b", fontSize: 10, position: "insideTopRight" }} />
              <Tooltip
                cursor={{ stroke: "rgba(143,216,255,0.3)" }}
                contentStyle={{ background: "#0b0f17", border: "1px solid rgba(150,180,225,0.2)", borderRadius: 10, fontFamily: "Geist Mono, monospace", fontSize: 12 }}
                labelFormatter={(v) => `minute ${String(v)}`}
                formatter={(value, name) => (name === "state" ? [Number(value) > 0.5 ? "open" : "latched", "state"] : [String(value), "P(open)"])}
              />
              <Line type="stepAfter" dataKey="state" stroke="#ff7a59" strokeWidth={2} dot={false} isAnimationActive animationDuration={700} />
              <Scatter dataKey="p" fill="#8fd8ff" shape="circle" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="px-2 pt-1 font-mono text-[10.5px] text-fog">Simulated readings, illustrative only.</p>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <div className="eyebrow mb-2">Confirmations required</div>
          <div className="flex gap-1 rounded-full border border-line p-1">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" onClick={() => setK(n)} className={`flex-1 rounded-full py-1.5 text-[13px] font-medium transition ${k === n ? "bg-snow text-ink-950" : "text-mist hover:text-snow"}`}>
                {n}×
              </button>
            ))}
          </div>
        </div>
        <dl className="divide-y divide-line border-y border-line text-[13px]">
          <div className="flex justify-between py-3"><dt className="text-fog">Alerts fired</dt><dd className="font-mono text-snow">{result.alerts}</dd></div>
          <div className="flex justify-between py-3"><dt className="text-fog">False alerts</dt><dd className={`font-mono ${result.falseAlerts ? "text-ember" : "text-verdant"}`}>{result.falseAlerts}</dd></div>
          <div className="flex justify-between py-3"><dt className="text-fog">Time to confirm</dt><dd className="font-mono text-snow">{result.confirmDelay === null ? "—" : `${result.confirmDelay} min`}</dd></div>
        </dl>
        <p className="text-[12.5px] leading-relaxed text-fog">With one confirmation, the noisy frame at minute 9 raises a false alarm. Two confirmations catch it, at the cost of one extra check.</p>
      </div>
    </div>
  );
}
