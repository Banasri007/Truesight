import { motion } from "framer-motion";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { del, errorMessage, get, post } from "../api";
import { EASE, Empty, ErrorText, PageHeader, Stat, StatePill, short, timeAgo, useTicker } from "../console/ui";
import { useEvent } from "../events";
import type { Device, Notification, PrivacyReceipt, RingEventRecord, Sensor, Status } from "../types";

interface FeedItem {
  id: string;
  at: string;
  text: string;
  kind: "alert" | "resolved" | "ring" | "info" | "error";
}

const FEED_TONE: Record<FeedItem["kind"], string> = {
  alert: "bg-ember",
  resolved: "bg-verdant",
  ring: "bg-signal",
  info: "bg-mist",
  error: "bg-amber",
};

const LINE_COLORS = ["#8fd8ff", "#ff7a59", "#6fe3a1", "#f3c46b", "#c8a2ff", "#ffffff"];

export function Dashboard({ status }: { status: Status | null }) {
  useTicker();
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [receipts, setReceipts] = useState<PrivacyReceipt[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Sensor[]>("/api/sensors").then(setSensors, (e) => setError(errorMessage(e)));
    get<Device[]>("/api/devices").then(setDevices, () => undefined);
    get<PrivacyReceipt[]>("/api/receipts?limit=120").then(setReceipts, () => undefined);
    get<RingEventRecord[]>("/api/ring-events?limit=15").then((events) => setFeed(events.map(ringItem)), () => undefined);
  }, []);

  useEvent<Sensor>("sensor", (s) => setSensors((list) => (list ? (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]) : [s])));
  useEvent<{ id: string }>("sensor-deleted", ({ id }) => setSensors((list) => list?.filter((s) => s.id !== id) ?? null));
  useEvent<PrivacyReceipt>("receipt", (r) => setReceipts((list) => [r, ...list].slice(0, 120)));
  useEvent<RingEventRecord>("ring-event", (e) => setFeed((f) => [ringItem(e), ...f].slice(0, 40)));
  useEvent<Notification>("notification", (n) => {
    const item: FeedItem = { id: n.id, at: n.at, text: `${n.title}. ${n.body}`, kind: n.level };
    setFeed((f) => [item, ...f].slice(0, 40));
  });

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? id;

  const checkNow = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await post(`/api/sensors/${id}/check`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (sensor: Sensor) => {
    if (!confirm(`Delete "${sensor.name}"? Its history stays in the ledger.`)) return;
    await del(`/api/sensors/${sensor.id}`).catch((e: unknown) => setError(errorMessage(e)));
  };

  // Real telemetry: confidence of each check, per sensor, from privacy receipts.
  const chart = useMemo(() => {
    const ids = [...new Set(receipts.map((r) => r.sensorId))].slice(0, LINE_COLORS.length);
    const rows = [...receipts].reverse().map((r) => ({ t: Date.parse(r.at), [r.sensorId]: Math.round(r.confidence * 100) / 100 }));
    return { ids, rows };
  }, [receipts]);

  return (
    <>
      <PageHeader
        index="01"
        eyebrow="Sensors"
        title={<>Virtual <span className="italic text-signal">sensors</span></>}
        description="Each sensor is a question you taught one of your cameras. Answers are debounced, and every state change is signed into the ledger."
        actions={
          <a className="btn btn-primary" href="#/teach">
            <Plus className="size-4" /> Teach a sensor
          </a>
        }
      />

      {status && (
        <div className="mb-10 grid grid-cols-2 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
          <Stat label="Ring" value={status.ringMode === "simulator" ? "Simulator" : status.ring.linked ? "Linked" : "Not linked"} tone={status.ringMode === "api" && !status.ring.linked ? "warn" : undefined} />
          <Stat label="Perception" value={`${status.vision.provider} · ${status.vision.model}`} tone={status.vision.provider === "mock" ? "warn" : undefined} />
          <Stat label="Faces" value={status.faceDetector === "none" ? "zones only" : status.faceDetector} />
          <Stat label="Signer" value={short(status.signer.kid, 20)} />
          <Stat label="Ledger head" value={`#${status.ledger.headSeq} · ${short(status.ledger.headHash, 8)}`} />
        </div>
      )}

      {status?.ringMode === "api" && !status.ring.linked && (
        <div className="mb-8 rounded-xl border border-amber/30 bg-amber/[0.06] px-4 py-3 text-[14px] text-amber">
          No Ring account is linked yet.{" "}
          <a href="/auth/ring/start" className="underline">
            Connect Ring
          </a>{" "}
          (partner-initiated), or start the link from the Ring app (one-way linking).
        </div>
      )}
      <ErrorText error={error} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {sensors === null ? (
            <div className="grid gap-5 md:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="panel h-80 animate-pulse" />
              ))}
            </div>
          ) : sensors.length === 0 ? (
            <Empty
              title="Teach your first sensor"
              body={`Pick a camera, draw a box around something you care about, and ask a question in plain words, like "Is the side gate latched?"`}
              action={
                <a className="btn btn-primary" href="#/teach">
                  Start teaching
                </a>
              }
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {sensors.map((sensor, i) => {
                const alerting = !!sensor.current && sensor.alertStates.includes(sensor.current.state);
                return (
                  <motion.article
                    key={sensor.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: i * 0.06, ease: EASE }}
                    className={`panel overflow-hidden transition-[border-color,box-shadow] duration-500 ${alerting ? "border-ember/50 shadow-[0_24px_70px_-30px_rgb(255_122_89/0.55)]" : ""}`}
                  >
                    <div className="relative aspect-[16/9] bg-ink-850">
                      {sensor.last && (
                        <img
                          className="absolute inset-0 h-full w-full object-cover"
                          alt={`What the AI saw for ${sensor.name}`}
                          src={`/api/sensors/${sensor.id}/ai-view?t=${encodeURIComponent(sensor.last.checkedAt)}`}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-transparent to-transparent" />
                      <span className="absolute left-3 top-3 rounded-md bg-ink-950/70 px-2 py-1 font-mono text-[10px] tracking-[0.16em] text-mist backdrop-blur">AI VIEW</span>
                      <div className="absolute right-3 top-3">
                        <StatePill sensor={sensor} />
                      </div>
                    </div>
                    <div className="space-y-3 p-5">
                      <div>
                        <h3 className="text-[16px] font-medium text-snow">{sensor.name}</h3>
                        <p className="mt-1 text-[13px] leading-snug text-fog">
                          {deviceName(sensor.deviceId)} · “{sensor.question}”
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-fog">
                        {sensor.current && <span>since {timeAgo(sensor.current.since)}</span>}
                        {sensor.last && (
                          <span>
                            checked {timeAgo(sensor.last.checkedAt)} · {Math.round(sensor.last.confidence * 100)}%
                          </span>
                        )}
                        {!sensor.enabled && <span className="text-amber">paused</span>}
                      </div>
                      {sensor.pending && (
                        <span className="state state-pending">
                          confirming “{sensor.pending.state}” {sensor.pending.count}/{sensor.debounce}
                        </span>
                      )}
                      {sensor.last && <p className="text-[13px] leading-relaxed text-mist">{sensor.last.observation}</p>}
                      {sensor.lastError && <ErrorText error={sensor.lastError} />}
                      <div className="flex items-center gap-1.5 border-t border-line pt-3">
                        <button className="btn btn-sm" onClick={() => checkNow(sensor.id)} disabled={busy === sensor.id}>
                          <RefreshCw className={`size-3.5 ${busy === sensor.id ? "animate-spin" : ""}`} />
                          {busy === sensor.id ? "Checking" : "Check now"}
                        </button>
                        <a className="btn btn-ghost btn-sm" href={`#/teach/${sensor.id}`}>
                          <Pencil className="size-3.5" /> Edit
                        </a>
                        <button className="btn btn-ghost btn-sm ml-auto hover:!text-ember" onClick={() => remove(sensor)} aria-label={`Delete ${sensor.name}`}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          )}

          {chart.rows.length > 1 && (
            <section className="panel p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="eyebrow">Perception telemetry</p>
                  <h2 className="mt-1 text-[15px] font-medium">Confidence of every check</h2>
                </div>
                <div className="flex flex-wrap gap-3 font-mono text-[11px] text-fog">
                  {chart.ids.map((id, i) => (
                    <span key={id} className="flex items-center gap-1.5">
                      <span className="h-px w-4" style={{ background: LINE_COLORS[i] }} />
                      {sensors?.find((s) => s.id === id)?.name ?? receipts.find((r) => r.sensorId === id)?.sensorName ?? id}
                    </span>
                  ))}
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart.rows} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="rgba(150,180,225,0.08)" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="#7d8799" fontSize={11} tickLine={false} axisLine={{ stroke: "rgba(150,180,225,0.15)" }} minTickGap={40} />
                    <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} stroke="#7d8799" fontSize={11} tickLine={false} axisLine={false} />
                    <ReferenceLine y={0.6} stroke="#f3c46b" strokeDasharray="4 4" strokeOpacity={0.5} />
                    <Tooltip
                      contentStyle={{ background: "#0b0f17", border: "1px solid rgba(150,180,225,0.2)", borderRadius: 10, fontFamily: "Geist Mono, monospace", fontSize: 12 }}
                      labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString()}
                    />
                    {chart.ids.map((id, i) => (
                      <Line key={id} type="monotone" dataKey={id} name={sensors?.find((s) => s.id === id)?.name ?? id} stroke={LINE_COLORS[i]} strokeWidth={1.75} dot={{ r: 2.5, strokeWidth: 0, fill: LINE_COLORS[i] }} connectNulls isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>

        <aside className="panel h-fit xl:sticky xl:top-8">
          <div className="panel-head">
            <h2 className="text-[14px] font-medium">Live activity</h2>
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-verdant">
              <span className="size-1.5 animate-pulse rounded-full bg-verdant" /> live
            </span>
          </div>
          <ol className="scrollbar-thin max-h-[70vh] divide-y divide-line overflow-auto">
            {feed.length === 0 && <li className="px-5 py-6 text-[13px] text-fog">Waiting for Ring events…</li>}
            {feed.map((item) => (
              <motion.li key={item.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex gap-3 px-5 py-3.5">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${FEED_TONE[item.kind]}`} />
                <div className="min-w-0">
                  <p className="text-[13px] leading-snug text-mist">{item.text}</p>
                  <p className="mt-1 font-mono text-[10.5px] text-fog">{timeAgo(item.at)}</p>
                </div>
              </motion.li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}

function ringItem(e: RingEventRecord): FeedItem {
  return {
    id: e.id,
    at: e.receivedAt,
    kind: "ring",
    text: `${e.type.replace(/_/g, " ")}${e.subType ? ` (${e.subType})` : ""} · ${e.deviceId ?? "account"} · ledger #${e.ledgerSeq}`,
  };
}
