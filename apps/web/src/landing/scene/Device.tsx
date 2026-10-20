import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Hotspot } from "./Hotspots";
import { current } from "./pose";
import { FINISHES, live, ui } from "./store";

const SIGNAL = new THREE.Color("#8fd8ff");

// Body: 1.12 x 2.72 x 0.46, front face at z = 0.23.
const BODY = { w: 1.12, h: 2.72, d: 0.46, r: 0.12 };
const FACE_Z = 0.232;
const LENS_Y = 0.82;
const MOTION_Y = 0.36;
const LIGHT_Y = -0.82;

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function plateGeometry(w: number, h: number, r: number, depth: number) {
  const geometry = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 3,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Seeded random so the circuit layout is identical on every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** The internal "proof core": a circuit board whose chips are TrueSight's pipeline stages. */
function makeBoardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 1420;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050c0b";
  g.fillRect(0, 0, c.width, c.height);

  const rand = rng(7);
  g.lineCap = "round";
  for (let i = 0; i < 70; i++) {
    let x = 30 + rand() * 452;
    let y = 30 + rand() * 1360;
    g.strokeStyle = `rgba(143,216,255,${0.16 + rand() * 0.32})`;
    g.lineWidth = rand() > 0.8 ? 3 : 1.6;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if (k % 2 === 0) x = Math.min(490, Math.max(22, x + (rand() - 0.5) * 220));
      else y = Math.min(1400, Math.max(20, y + (rand() - 0.5) * 260));
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = "rgba(143,216,255,0.7)";
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }

  const chips = [
    { y: 170, label: "PERCEPTION", sub: "region only · claude" },
    { y: 510, label: "PRIVACY", sub: "zones · faces · mosaic" },
    { y: 850, label: "LEDGER", sub: "sha-256 chain · es256" },
    { y: 1190, label: "EVENTS", sub: "hmac-sha256 · webhooks" },
  ];
  for (const chip of chips) {
    g.fillStyle = "#0b1317";
    g.fillRect(96, chip.y - 70, 320, 150);
    g.strokeStyle = "rgba(143,216,255,0.85)";
    g.lineWidth = 2;
    g.strokeRect(96, chip.y - 70, 320, 150);
    g.fillStyle = "rgba(143,216,255,0.75)";
    for (let k = 0; k < 9; k++) {
      g.fillRect(110 + k * 34, chip.y - 84, 12, 12);
      g.fillRect(110 + k * 34, chip.y + 82, 12, 12);
    }
    g.fillStyle = "#d8f2ff";
    g.font = "600 34px ui-monospace, Menlo, Consolas, monospace";
    g.fillText(chip.label, 118, chip.y + 4);
    g.fillStyle = "rgba(184,194,209,0.8)";
    g.font = "22px ui-monospace, Menlo, Consolas, monospace";
    g.fillText(chip.sub, 118, chip.y + 42);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.28, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function Device() {
  const bodyMat = useRef<THREE.MeshPhysicalMaterial>(null!);
  const face = useRef<THREE.Group>(null!);
  const board = useRef<THREE.Group>(null!);
  const ringMat = useRef<THREE.MeshStandardMaterial>(null!);
  const irisMat = useRef<THREE.MeshStandardMaterial>(null!);
  const halo = useRef<THREE.MeshBasicMaterial>(null!);

  const faceGeometry = useMemo(() => plateGeometry(0.94, 2.54, 0.17, 0.02), []);
  const backGeometry = useMemo(() => plateGeometry(0.7, 1.9, 0.14, 0.02), []);
  const boardTexture = useMemo(makeBoardTexture, []);
  const glowTexture = useMemo(makeGlowTexture, []);
  const target = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const finish = FINISHES[ui.get().finish];
    const k = 1 - Math.exp(-delta * 4);
    const m = bodyMat.current;
    target.set(finish.color);
    m.color.lerp(target, k);
    m.metalness += (finish.metalness - m.metalness) * k;
    m.roughness += (finish.roughness - m.roughness) * k;
    m.clearcoat += (finish.clearcoat - m.clearcoat) * k;

    const e = current.explode;
    face.current.position.z = FACE_Z + e * 0.62;
    board.current.visible = e > 0.01;
    board.current.position.z = 0.236 + e * 0.12;

    const t = state.clock.elapsedTime;
    const pulse = live.reduced ? 0.85 : 0.7 + Math.sin(t * 1.7) * 0.22;
    const boost = live.hovered ? 1.55 : 1;
    ringMat.current.emissiveIntensity = 2.4 * pulse * boost;
    halo.current.opacity = 0.32 * pulse * boost;
    irisMat.current.emissiveIntensity = 0.9 + (live.hovered ? 0.8 : 0) + Math.sin(t * 0.9) * 0.15;
  });

  return (
    <group
      onPointerOver={() => {
        live.hovered = true;
        document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        live.hovered = false;
        document.body.style.cursor = "";
      }}
    >
      {/* Machined body */}
      <RoundedBox args={[BODY.w, BODY.h, BODY.d]} radius={BODY.r} smoothness={8}>
        <meshPhysicalMaterial ref={bodyMat} color="#3c4450" metalness={0.7} roughness={0.3} clearcoat={0.7} clearcoatRoughness={0.22} envMapIntensity={1.5} />
      </RoundedBox>

      {/* Back mounting plate (visible when you spin it around) */}
      <mesh geometry={backGeometry} position={[0, 0, -0.235]}>
        <meshStandardMaterial color="#14181f" metalness={0.4} roughness={0.6} />
      </mesh>
      {[0.7, -0.7].map((y) => (
        <mesh key={y} position={[0, y, -0.248]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.045, 0.045, 0.01, 24]} />
          <meshStandardMaterial color="#05070a" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}

      {/* Proof core, revealed by the exploded view */}
      <group ref={board} visible={false}>
        <mesh>
          <planeGeometry args={[0.88, 2.42]} />
          <meshStandardMaterial map={boardTexture} emissiveMap={boardTexture} emissive={SIGNAL} emissiveIntensity={0.85} roughness={0.55} metalness={0.2} />
        </mesh>
        {[0.83, 0.25, -0.33, -0.91].map((y) => (
          <mesh key={y} position={[0, y, 0.022]}>
            <boxGeometry args={[0.5, 0.2, 0.035]} />
            <meshPhysicalMaterial color="#0c1218" metalness={0.6} roughness={0.35} transparent opacity={0.55} clearcoat={1} />
          </mesh>
        ))}
        <Hotspot id="core" position={[0.46, -0.04, 0.03]} normal={[0.4, 0, 1]} side="right" />
      </group>

      {/* Glass faceplate with lens, motion sensor and light ring */}
      <group ref={face} position={[0, 0, FACE_Z]}>
        <mesh geometry={faceGeometry}>
          <meshPhysicalMaterial color="#07090e" metalness={0.2} roughness={0.1} clearcoat={1} clearcoatRoughness={0.03} reflectivity={0.7} envMapIntensity={1.8} />
        </mesh>

        {/* Lens */}
        <group position={[0, LENS_Y, 0.012]}>
          <mesh>
            <torusGeometry args={[0.225, 0.028, 24, 96]} />
            <meshStandardMaterial color="#1a1f28" metalness={0.95} roughness={0.22} />
          </mesh>
          <mesh rotation-x={Math.PI / 2} scale={[1, 0.5, 1]}>
            <sphereGeometry args={[0.2, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial
              color="#03050a"
              metalness={0.1}
              roughness={0.03}
              clearcoat={1}
              iridescence={1}
              iridescenceIOR={1.6}
              iridescenceThicknessRange={[120, 520]}
            />
          </mesh>
          <mesh position-z={0.045}>
            <torusGeometry args={[0.075, 0.01, 16, 64]} />
            <meshStandardMaterial ref={irisMat} color="#0a1520" emissive={SIGNAL} emissiveIntensity={0.9} />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.004]}>
                <sphereGeometry args={[0.011, 12, 12]} />
                <meshStandardMaterial color="#1a0606" emissive="#ff3b3b" emissiveIntensity={0.35} />
              </mesh>
            );
          })}
          <Hotspot id="lens" position={[-0.26, 0, 0.06]} normal={[0, 0, 1]} side="left" />
        </group>

        {/* Motion sensor */}
        <group position={[0, MOTION_Y, 0.012]}>
          <mesh scale={[1, 1, 0.55]}>
            <sphereGeometry args={[0.07, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial color="#0b0d12" roughness={0.18} clearcoat={1} transmission={0} />
          </mesh>
          <Hotspot id="motion" position={[0.08, 0, 0.04]} normal={[0, 0, 1]} side="right" />
        </group>

        {/* Speaker grille */}
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[(i - 4) * 0.055, -0.22, 0.012]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.009, 0.009, 0.01, 10]} />
            <meshStandardMaterial color="#000" roughness={1} />
          </mesh>
        ))}

        {/* Light ring + button */}
        <group position={[0, LIGHT_Y, 0.012]}>
          <mesh>
            <torusGeometry args={[0.245, 0.02, 24, 120]} />
            <meshStandardMaterial ref={ringMat} color="#0b1a24" emissive={SIGNAL} emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.212, 0.212, 0.026, 64]} />
            <meshPhysicalMaterial color="#090c11" metalness={0.3} roughness={0.25} clearcoat={1} />
          </mesh>
          <mesh position-z={0.02}>
            <planeGeometry args={[1.25, 1.25]} />
            <meshBasicMaterial ref={halo} map={glowTexture} color={SIGNAL} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <Hotspot id="light" position={[-0.27, 0, 0.04]} normal={[0, 0, 1]} side="left" />
        </group>
      </group>
    </group>
  );
}
