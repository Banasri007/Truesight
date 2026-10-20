import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { FACE, FRAME, REGION, ZONE, mosaic, rasterize, regionAreaPct, yardSvg } from "./yard";

type Mode = "camera" | "ai" | "evidence";

const MODES: { id: Mode; label: string }[] = [
  { id: "camera", label: "Camera frame" },
  { id: "ai", label: "What the AI sees" },
  { id: "evidence", label: "Evidence copy" },
];

const FACE_BOX = { x: FACE.x - 8, y: FACE.y - 8, w: FACE.w + 16, h: FACE.h + 16 };

const CAPTION: Record<Mode, string> = {
  camera: "What your camera records: the whole scene, including a visitor and the neighbor's window.",
  ai: `What the AI receives: ${regionAreaPct}% of the frame. The visitor's face is pixelated, and the neighbor's window is never sent.`,
  evidence: "Evidence copy: the full frame with 2 regions pixelated. Every other pixel is provably unchanged.",
};

/** Real pixel work on a rasterized frame: crop, mosaic, mask. */
export function PrivacyDemo() {
  const [mode, setMode] = useState<Mode>("ai");
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<{ width: number; height: number; rgba: Uint8Array } | null>(null);

  const draw = (m: Mode) => {
    const ctx = canvas.current?.getContext("2d");
    const img = source.current;
    if (!ctx || !img) return;
    const toImage = (rgba: Uint8Array) => new ImageData(new Uint8ClampedArray(rgba), img.width, img.height);
    if (m === "camera") {
      ctx.putImageData(toImage(img.rgba), 0, 0);
    } else if (m === "evidence") {
      ctx.putImageData(toImage(mosaic(img, [ZONE, FACE_BOX])), 0, 0);
    } else {
      ctx.fillStyle = "#030508";
      ctx.fillRect(0, 0, FRAME.w, FRAME.h);
      ctx.strokeStyle = "rgba(150,180,225,0.07)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= FRAME.w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, FRAME.h);
        ctx.stroke();
      }
      for (let y = 0; y <= FRAME.h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(FRAME.w, y + 0.5);
        ctx.stroke();
      }
      ctx.putImageData(toImage(mosaic(img, [FACE_BOX])), 0, 0, REGION.x, REGION.y, REGION.w, REGION.h);
    }
  };

  useEffect(() => {
    let alive = true;
    rasterize(yardSvg({ gate: "open", person: true })).then((img) => {
      if (!alive) return;
      source.current = img;
      draw(mode);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => draw(mode), [mode]);

  return (
    <div className="panel overflow-hidden backdrop-blur-md">
      <div className="flex gap-1 border-b border-line p-1.5" role="tablist" aria-label="Privacy views">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`relative flex-1 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${mode === m.id ? "text-snow" : "text-fog hover:text-mist"}`}
          >
            {mode === m.id && <motion.span layoutId="privacy-tab" className="absolute inset-0 rounded-lg bg-white/[0.06]" transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />}
            <span className="relative">{m.label}</span>
          </button>
        ))}
      </div>
      <div className="relative" style={{ aspectRatio: `${FRAME.w} / ${FRAME.h}` }}>
        <motion.canvas key={mode} ref={canvas} width={FRAME.w} height={FRAME.h} className="absolute inset-0 h-full w-full" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
        <svg viewBox={`0 0 ${FRAME.w} ${FRAME.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
          {mode !== "camera" && (
            <>
              {mode === "evidence" && <rect x={ZONE.x} y={ZONE.y} width={ZONE.w} height={ZONE.h} fill="none" stroke="#fff" strokeDasharray="5 4" strokeWidth={1.5} />}
              <rect x={FACE_BOX.x} y={FACE_BOX.y} width={FACE_BOX.w} height={FACE_BOX.h} fill="none" stroke="#f3c46b" strokeDasharray="5 4" strokeWidth={1.5} />
            </>
          )}
          {mode === "ai" && (
            <>
              <rect x={REGION.x} y={REGION.y} width={REGION.w} height={REGION.h} fill="none" stroke="#8fd8ff" strokeWidth={1.5} />
              <text x={REGION.x} y={REGION.y - 8} fill="#8fd8ff" fontFamily="Geist Mono, monospace" fontSize="10" letterSpacing="1.5">
                SENT TO THE AI · {regionAreaPct}%
              </text>
            </>
          )}
          {mode === "camera" && <rect x={ZONE.x} y={ZONE.y} width={ZONE.w} height={ZONE.h} fill="none" stroke="#ff7a59" strokeDasharray="4 4" strokeWidth={1.5} />}
        </svg>
      </div>
      <p className="border-t border-line px-5 py-3.5 text-[13px] leading-relaxed text-mist">{CAPTION[mode]}</p>
    </div>
  );
}
