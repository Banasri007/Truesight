import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEvent } from "./events";
import type { NormRect, Notification, Sensor } from "./types";

export function short(hash: string | null | undefined, n = 10) {
  return hash ? `${hash.slice(0, n)}…` : "—";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Re-render every few seconds so relative times stay fresh. */
export function useTicker(ms = 5000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function StatePill({ sensor }: { sensor: Sensor }) {
  const current = sensor.current;
  if (!current) return <span className="pill unknown"><span className="dot" />{sensor.last ? sensor.last.state : "waiting"}</span>;
  const alert = sensor.alertStates.includes(current.state);
  return (
    <span className={`pill ${alert ? "alert" : "ok"}`}>
      <span className="dot" />
      {current.state}
    </span>
  );
}

/**
 * Draw rectangles on a camera frame. Coordinates are normalized (0..1), the
 * same convention Ring uses for motion and privacy zones.
 */
export function RegionCanvas(props: {
  src: string;
  rects: NormRect[];
  onChange?: (rects: NormRect[]) => void;
  multiple?: boolean;
  /** Read-only overlays, e.g. privacy zones while drawing a sensor region. */
  zones?: NormRect[];
  hint?: string;
  color?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const editable = !!props.onChange;
  const color = props.color ?? "#1463ff";

  const point = (event: ReactPointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  const toRect = (d: NonNullable<typeof draft>): NormRect => ({
    x: Math.min(d.x0, d.x1),
    y: Math.min(d.y0, d.y1),
    w: Math.abs(d.x1 - d.x0),
    h: Math.abs(d.y1 - d.y0),
  });

  return (
    <div className="canvas">
      <img src={props.src} alt="Camera frame" draggable={false} />
      <svg
        ref={svgRef}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ cursor: editable ? "crosshair" : "default" }}
        onPointerDown={(e) => {
          if (!editable) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const p = point(e);
          setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!draft) return;
          const p = point(e);
          setDraft({ ...draft, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (!draft) return;
          const rect = toRect(draft);
          setDraft(null);
          if (rect.w < 0.02 || rect.h < 0.02) return;
          props.onChange?.(props.multiple ? [...props.rects, rect] : [rect]);
        }}
      >
        <defs>
          <pattern id="hatch" width="0.02" height="0.02" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.01" height="0.02" fill="rgba(255,255,255,0.45)" />
          </pattern>
        </defs>
        {(props.zones ?? []).map((z, i) => (
          <rect key={`z${i}`} x={z.x} y={z.y} width={z.w} height={z.h} fill="url(#hatch)" stroke="#fff" strokeDasharray="4 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {props.rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={`${color}33`} stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" />
        ))}
        {draft && (() => {
          const r = toRect(draft);
          return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`${color}22`} stroke={color} strokeDasharray="6 4" strokeWidth={2} vectorEffect="non-scaling-stroke" />;
        })()}
      </svg>
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

/** Toasts for alerts, plus the simulated chime: a tone and a spoken message. */
export function Toasts() {
  const [items, setItems] = useState<Notification[]>([]);

  useEvent<Notification>("notification", (n) => {
    setItems((list) => [...list.slice(-3), n]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== n.id)), n.level === "alert" ? 12_000 : 7000);
  });

  useEvent<{ message: string; slotEvent: string }>("chime", (c) => {
    playChime();
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(c.message);
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    }
    const id = `chime-${Date.now()}`;
    setItems((list) => [...list.slice(-3), { id, at: new Date().toISOString(), level: "info", title: "🔔 Chime", body: c.message }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), 6000);
  });

  return (
    <div className="toasts" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} className={`toast ${n.level}`}>
          <strong>{n.title}</strong>
          <span className="small muted">{n.body}</span>
          {n.evidenceId && (
            <div style={{ marginTop: 6 }}>
              <a href="#/evidence">View evidence →</a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function playChime() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain).connect(ctx.destination);
      const start = ctx.currentTime + i * 0.35;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="error-text">{error}</p> : null;
}
