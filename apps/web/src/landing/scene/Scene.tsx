import { Environment, Float, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Device } from "./Device";
import { FOCUS, current, poseAt, type Pose } from "./pose";
import { live, ui } from "./store";

const damp = THREE.MathUtils.damp;

/** Adapts authored desktop poses to the actual viewport. */
function responsive(target: Pose, width: number, aspect: number): Pose {
  if (width < 768) {
    // Phones: device floats above the copy, smaller and centred.
    return { ...target, px: target.px * 0.08, py: target.py * 0.5 + 1.05, pz: Math.min(target.pz, 0.6), s: target.s * 0.58 };
  }
  const squeeze = Math.min(1, aspect / 1.78);
  return { ...target, px: target.px * squeeze, s: target.s * (0.82 + 0.18 * squeeze) };
}

function Rig({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null!);
  const rim = useRef<THREE.PointLight>(null!);
  const size = useThree((s) => s.size);

  useFrame((state, delta) => {
    const focus = ui.get().focus;
    const stage = live.reduced ? 0 : live.stage;
    const target = responsive(focus ? FOCUS[focus] : poseAt(stage), size.width, size.width / size.height);
    const lambda = live.reduced ? 50 : focus ? 3 : 3.6;
    for (const key of Object.keys(target) as (keyof Pose)[]) {
      current[key] = damp(current[key], target[key], lambda, delta);
    }

    // Drag to inspect: inertia while released, then ease back to the authored pose.
    if (!live.dragging) {
      live.dragYaw += live.dragVelocity;
      live.dragVelocity *= Math.pow(0.04, delta);
      if (Math.abs(live.dragVelocity) < 0.0005) {
        live.dragYaw = damp(live.dragYaw, Math.round(live.dragYaw / (Math.PI * 2)) * Math.PI * 2, 1.1, delta);
      }
      live.dragPitch = damp(live.dragPitch, 0, 1.6, delta);
    }

    const t = state.clock.elapsedTime;
    const idle = live.reduced ? 0 : Math.sin(t * 0.34) * (focus ? 0.05 : 0.2);
    const px = live.pointer.x;
    const py = live.pointer.y;
    group.current.position.set(current.px + px * 0.1, current.py + py * 0.06, current.pz);
    group.current.rotation.set(current.rx + live.dragPitch - py * 0.05, current.ry + idle + live.dragYaw + px * 0.1, current.rz);
    group.current.scale.setScalar(current.s);

    state.camera.position.x = damp(state.camera.position.x, px * 0.22, 2, delta);
    state.camera.position.y = damp(state.camera.position.y, py * 0.14, 2, delta);
    state.camera.lookAt(0, 0, 0);

    rim.current.intensity = damp(rim.current.intensity, live.hovered ? 26 : 14, 4, delta);
  });

  return (
    <>
      <pointLight ref={rim} position={[-3.5, 1.5, -2]} intensity={14} color="#8fd8ff" distance={12} decay={1.6} />
      <group ref={group}>{children}</group>
    </>
  );
}

export default function Scene({ reduced }: { reduced: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null);

  // Pointer parallax across the whole page, and drag-to-rotate on the canvas.
  useEffect(() => {
    live.reduced = reduced;
    const onMove = (e: PointerEvent) => {
      live.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      live.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      live.dragging = true;
      live.dragVelocity = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      document.body.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!live.dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      live.dragYaw += dx * 0.009;
      live.dragVelocity = dx * 0.009;
      live.dragPitch = Math.max(-0.5, Math.min(0.5, live.dragPitch + dy * 0.004));
    };
    const up = (e: PointerEvent) => {
      live.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      document.body.style.cursor = live.hovered ? "grab" : "";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <div ref={wrapper} className="absolute inset-0 touch-pan-y">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 7.6], fov: 30, near: 0.1, far: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          requestAnimationFrame(() => ui.set({ ready: true }));
        }}
      >
        <ambientLight intensity={0.12} />
        <directionalLight position={[3, 4, 5]} intensity={1.8} color="#e3ecff" />
        <directionalLight position={[-4, -2, 3]} intensity={0.35} color="#8fd8ff" />
        {/* Studio reflections built from light panels: no HDR download needed. */}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={5} position={[0, 4.5, 2]} rotation-x={Math.PI / 2.3} scale={[9, 1.6, 1]} />
          <Lightformer form="rect" intensity={1.3} position={[2.5, 1.5, 6]} scale={[5, 3, 1]} />
          <Lightformer form="rect" intensity={2.6} color="#8fd8ff" position={[-5, 0.5, 1.5]} rotation-y={Math.PI / 2} scale={[1.1, 7, 1]} />
          <Lightformer form="rect" intensity={2} position={[5, -0.5, 1]} rotation-y={-Math.PI / 2} scale={[1.1, 6, 1]} />
          <Lightformer form="ring" intensity={0.8} color="#3a9bff" position={[0, -3.5, -4]} scale={4} />
        </Environment>
        <Rig>
          <Float enabled={!reduced} speed={1.2} rotationIntensity={0.12} floatIntensity={0.35} floatingRange={[-0.05, 0.05]}>
            <Device />
          </Float>
        </Rig>
      </Canvas>
    </div>
  );
}
