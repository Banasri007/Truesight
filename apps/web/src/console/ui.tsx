import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BellRing, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useEvent } from "../events";
import type { NormRect, Notification, Sensor } from "../types";

export const EASE = [0.22, 1, 0.36, 1] as const;

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

export function PageHeader({ index, eyebrow, title, description, actions }: { index: string; eyebrow: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl">
        <p className="eyebrow mb-4 flex items-center gap-3">
          <span className="text-signal">{index}</span>
          <span className="h-px w-6 bg-line-strong" />
          {eyebrow}
        </p>
        <h1 className="display text-[clamp(2.2rem,3.6vw,3.4rem)] leading-[1.02]">{title}</h1>
        {description && <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mist">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-0 border-l border-line pl-4">
      <div className="eyebrow !text-[10px]">{label}</div>
      <div className={`mt-1.5 truncate font-mono text-[13px] ${tone === "warn" ? "text-amber" : tone === "ok" ? "text-verdant" : "text-snow"}`} title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
    </div>
  );
}

export function StatePill({ sensor }: { sensor: Sensor }) {
  const current = sensor.current;
  if (!current) {
    return (
      <span className="state state-idle">
        <span className="size-1.5 rounded-full bg-current" />
        {sensor.last ? sensor.last.state : "waiting"}
      </span>
    );
  }
  const alert = sensor.alertStates.includes(current.state);
  return (
    <span className={`state ${alert ? "state-alert" : "state-ok"}`}>
      <span className={`size-1.5 rounded-full bg-current ${alert ? "animate-pulse" : ""}`} />
      {current.state}
    </span>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="panel grid place-items-center px-6 py-20 text-center">
      <div className="mb-6 grid size-14 place-items-center rounded-full border border-line">
        <span className="size-2 rounded-full bg-signal shadow-[0_0_20px_rgb(143_216_255/0.8)]" />
      </div>
      <h2 className="display text-3xl">{title}</h2>
      <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-fog">{body}</p>
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="flex items-start gap-2 text-[13px] text-ember">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      {error}
    </p>
  ) : null;
}

/**
 * Load a camera snapshot as a blob URL, keeping the server's reason when it
 * fails (for example: Ring has no recording yet), instead of a broken <img>.
 */
export function useSnapshot(deviceId: string | null | undefined, nonce: number) {
  const [state, setState] = useState<{ url: string | null; error: string | null; loading: boolean }>({ url: null, error: null, loading: true });
  useEffect(() => {
    if (!deviceId) return;
    let url: string | null = null;
    let cancelled = false;
    setState({ url: null, error: null, loading: true });
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/snapshot?t=${nonce}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Snapshot failed (${response.status})`);
        }
        url = URL.createObjectURL(await response.blob());
        if (!cancelled) setState({ url, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ url: null, error: error instanceof Error ? error.message : String(error), loading: false });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [deviceId, nonce]);
  return state;
}

/** Placeholder shown while a snapshot loads, or with the reason it is unavailable. */
export function SnapshotUnavailable({ error, loading, compact = false }: { error: string | null; loading: boolean; compact?: boolean }) {
  const message = error?.replace(/^Ring API \d+(\s+[A-Z_]+)?:\s*/, "");
  return (
    <div className={`grid aspect-video w-full place-items-center bg-ink-850 ${compact ? "p-4" : "rounded-xl border border-line p-8"}`}>
      {loading ? (
        <span className="eyebrow">Loading snapshot…</span>
      ) : (
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto mb-3 size-5 text-amber" />
          <p className={`${compact ? "text-[12px]" : "text-[13.5px]"} leading-relaxed text-mist`}>{message ?? "Snapshot unavailable."}</p>
        </div>
      )}
    </div>
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
  zones?: NormRect[];
  hint?: string;
  color?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const editable = !!props.onChange;
  const color = props.color ?? "#8fd8ff";

  const point = (event: ReactPointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };
  const toRect = (d: NonNullable<typeof draft>): NormRect => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });

  return (
    <div className="relative select-none overflow-hidden rounded-xl border border-line bg-black" style={{ touchAction: "none" }}>
      <img src={props.src} alt="Camera frame" draggable={false} className="pointer-events-none block h-auto w-full" />
      <svg
        ref={svgRef}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
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
          <pattern id="hatch" width="0.016" height="0.016" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.006" height="0.016" fill="rgba(255,255,255,0.4)" />
          </pattern>
        </defs>
        {(props.zones ?? []).map((z, i) => (
          <rect key={`z${i}`} x={z.x} y={z.y} width={z.w} height={z.h} fill="url(#hatch)" stroke="#fff" strokeDasharray="4 3" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        ))}
        {props.rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={`${color}22`} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
        {draft &&
          (() => {
            const r = toRect(draft);
            return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={`${color}18`} stroke={color} strokeDasharray="6 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
          })()}
      </svg>
      {props.hint && <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-ink-950/75 px-2.5 py-1 font-mono text-[11px] text-mist backdrop-blur">{props.hint}</div>}
    </div>
  );
}

const TOAST_ICON = { alert: BellRing, resolved: CheckCircle2, info: Info, error: AlertTriangle } as const;
const TOAST_TONE = { alert: "text-ember", resolved: "text-verdant", info: "text-signal", error: "text-amber" } as const;

/** Alerts as toasts, plus the simulated Ring Chime: a tone and a spoken message. */
export function Toasts() {
  const [items, setItems] = useState<Notification[]>([]);
  const dismiss = (id: string) => setItems((list) => list.filter((x) => x.id !== id));

  useEvent<Notification>("notification", (n) => {
    setItems((list) => [...list.slice(-3), n]);
    setTimeout(() => dismiss(n.id), n.level === "alert" ? 12_000 : 7000);
  });

  useEvent<{ message: string }>("chime", (c) => {
    playChime();
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(c.message);
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    }
    const id = `chime-${Date.now()}`;
    setItems((list) => [...list.slice(-3), { id, at: new Date().toISOString(), level: "info", title: "Chime", body: c.message }]);
    setTimeout(() => dismiss(id), 6000);
  });

  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[min(380px,calc(100vw-40px))] flex-col gap-2.5" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((n) => {
          const Icon = TOAST_ICON[n.level];
          return (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="panel flex gap-3 bg-ink-850/95 p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${TOAST_TONE[n.level]}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-snow">{n.title}</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-fog">{n.body}</div>
                {n.evidenceId && (
                  <a href="#/evidence" className="mt-2 inline-block text-[12.5px] text-signal hover:underline">
                    View evidence →
                  </a>
                )}
              </div>
              <button type="button" onClick={() => dismiss(n.id)} className="h-fit text-fog hover:text-snow" aria-label="Dismiss">
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
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
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}
