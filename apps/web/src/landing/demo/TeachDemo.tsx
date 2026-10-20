import { AnimatePresence, motion } from "framer-motion";
import { BellRing, DoorOpen, DoorClosed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FRAME, REGION, regionAreaPct, svgUrl, yardSvg } from "./yard";

type Tone = "event" | "pending" | "alert" | "ok";
interface Line {
  id: number;
  tone: Tone;
  text: string;
}

const TONE: Record<Tone, string> = {
  event: "text-signal",
  pending: "text-amber",
  alert: "text-ember",
  ok: "text-verdant",
};

/** A miniature of the real teach-and-alert loop: region, question, debounce, evidence. */
export function TeachDemo() {
  const [gate, setGate] = useState<"closed" | "open">("closed");
  const [state, setState] = useState<"latched" | "open">("latched");
  const [pending, setPending] = useState<string | null>(null);
  const [log, setLog] = useState<Line[]>([{ id: 0, tone: "ok", text: "baseline · latched · 94%" }]);
  const timers = useRef<number[]>([]);
  const seq = useRef(1);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const frame = useMemo(() => svgUrl(yardSvg({ gate })), [gate]);
  const aiView = useMemo(() => svgUrl(yardSvg({ gate, viewBox: `${REGION.x} ${REGION.y} ${REGION.w} ${REGION.h}` })), [gate]);

  const push = (tone: Tone, text: string) => setLog((l) => [...l.slice(-4), { id: seq.current++, tone, text }]);
  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  const toggle = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const next = gate === "closed" ? "open" : "closed";
    const answer = next === "open" ? "open" : "latched";
    setGate(next);
    at(150, () => push("event", `ring.event · contact_sensor_${next === "open" ? "faulted" : "cleared"} · HMAC ✓`));
    at(700, () => {
      setPending(answer);
      push("pending", `answer “${answer}” · 93% · confirming 1/2`);
    });
    at(1600, () => {
      setPending(null);
      setState(answer);
      push(answer === "open" ? "alert" : "ok", `state_changed · ${answer === "open" ? "latched → open" : "open → latched"} · signed`);
      if (answer === "open") at(350, () => push("alert", "evidence.captured · sealed before redaction · chime"));
    });
  };

  const alert = state === "open";
  return (
    <div className="panel overflow-hidden backdrop-blur-md">
      <div className="relative" style={{ aspectRatio: `${FRAME.w} / ${FRAME.h}` }}>
        <img src={frame} alt="Side yard camera frame" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        <svg viewBox={`0 0 ${FRAME.w} ${FRAME.h}`} className="absolute inset-0 h-full w-full">
          <motion.rect
            x={REGION.x}
            y={REGION.y}
            width={REGION.w}
            height={REGION.h}
            fill="rgb(143 216 255 / 0.08)"
            stroke="#8fd8ff"
            strokeWidth={2}
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
          <text x={REGION.x} y={REGION.y - 8} fill="#8fd8ff" fontFamily="Geist Mono, monospace" fontSize="10" letterSpacing="1.5">
            REGION · {regionAreaPct}% OF FRAME
          </text>
        </svg>
        <div className="absolute left-3 top-3 rounded-md bg-ink-950/70 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-mist">SIDE YARD · LIVE</div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-[112px_1fr]">
        <div>
          <img src={aiView} alt="What the AI sees" className="aspect-square w-28 rounded-lg border border-line object-cover" draggable={false} />
          <p className="eyebrow mt-2 !text-[9.5px]">What the AI sees</p>
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-[15px] leading-snug text-snow">“Is the side gate latched shut, or is it open?”</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">latched</span>
            <span className="chip border-ember/40 text-ember">
              <BellRing className="size-3" /> open
            </span>
            <span className="mx-1 h-4 w-px bg-line" />
            <AnimatePresence mode="wait">
              <motion.span
                key={pending ? `p-${pending}` : state}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className={`state ${pending ? "state-pending" : alert ? "state-alert" : "state-ok"}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {pending ? `confirming ${pending}` : state}
              </motion.span>
            </AnimatePresence>
          </div>
          <ul className="space-y-1 font-mono text-[11.5px] text-fog">
            <AnimatePresence initial={false}>
              {log.map((line) => (
                <motion.li key={line.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="truncate">
                  <span className={TONE[line.tone]}>›</span> {line.text}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
        <span className="text-[12.5px] text-fog">Debounce: two matching answers in a row.</span>
        <button type="button" onClick={toggle} className="btn btn-sm">
          {gate === "closed" ? <DoorOpen className="size-3.5" /> : <DoorClosed className="size-3.5" />}
          {gate === "closed" ? "Open the gate" : "Close the gate"}
        </button>
      </div>
    </div>
  );
}
