import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { current } from "./pose";
import { HOTSPOTS, live, ui, type HotspotId } from "./store";

/**
 * A technical annotation pinned to a point on the device. It fades out when
 * that surface turns away from the camera, and selecting it flies the camera in.
 */
export function Hotspot({ id, position, normal, side }: { id: HotspotId; position: [number, number, number]; normal: [number, number, number]; side: "left" | "right" }) {
  const anchor = useRef<THREE.Group>(null!);
  const button = useRef<HTMLButtonElement>(null);
  const n = useMemo(() => new THREE.Vector3(...normal).normalize(), [normal]);
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), quat: new THREE.Quaternion(), toCam: new THREE.Vector3() }), []);
  const info = HOTSPOTS[id];

  useFrame(({ camera }) => {
    const el = button.current;
    if (!el) return;
    anchor.current.getWorldPosition(tmp.pos);
    anchor.current.getWorldQuaternion(tmp.quat);
    tmp.dir.copy(n).applyQuaternion(tmp.quat);
    tmp.toCam.copy(camera.position).sub(tmp.pos).normalize();
    const facing = Math.min(1, Math.max(0, (tmp.dir.dot(tmp.toCam) - 0.25) * 3));
    const inStage = id === "core" ? Math.min(1, Math.max(0, (current.explode - 0.55) * 3)) : Math.max(0, 1 - live.stage * 2.4);
    const focus = ui.get().focus;
    const opacity = facing * inStage * (focus && focus !== id ? 0.2 : 1);
    el.style.opacity = opacity.toFixed(3);
    el.style.pointerEvents = opacity > 0.35 ? "auto" : "none";
  });

  const dotOffset = 7; // half of the 14px dot, so the dot centre sits on the anchor
  return (
    <group ref={anchor} position={position}>
      <Html zIndexRange={[30, 10]} style={{ pointerEvents: "none" }}>
        <button
          ref={button}
          type="button"
          onClick={() => ui.set({ focus: ui.get().focus === id ? null : id })}
          aria-label={`${info.title}: show details`}
          className={`group absolute left-0 top-0 flex items-center gap-2.5 whitespace-nowrap opacity-0 ${side === "left" ? "flex-row-reverse" : ""}`}
          style={{ transform: side === "left" ? `translate(calc(-100% + ${dotOffset}px), -50%)` : `translate(-${dotOffset}px, -50%)` }}
        >
          <span className="relative grid size-3.5 place-items-center">
            <span className="absolute inset-0 rounded-full border border-signal/50 transition duration-500 group-hover:scale-150 group-hover:border-signal" />
            <span className="size-1.5 rounded-full bg-signal shadow-[0_0_12px_rgb(143_216_255/0.9)]" />
          </span>
          <span className={`h-px w-9 ${side === "left" ? "bg-gradient-to-l" : "bg-gradient-to-r"} from-signal/70 to-signal/0`} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-mist transition-colors group-hover:text-snow">
            <span className="text-signal">{info.index}</span> {info.label}
          </span>
        </button>
      </Html>
    </group>
  );
}
