import type { HotspotId } from "./store";

/** Where the device sits for each scroll stage: position, rotation (radians), scale, exploded faceplate. */
export interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
  explode: number;
}

const p = (px: number, py: number, pz: number, rx: number, ry: number, rz: number, s: number, explode = 0): Pose => ({ px, py, pz, rx, ry, rz, s, explode });

/** One keyframe per landing section, in order. */
export const KEYFRAMES: Pose[] = [
  p(1.6, -0.08, 0, 0.06, -0.52, 0.03, 0.84), // hero: three-quarter view, right of the headline
  p(1.9, -0.05, 0, 0.02, -1.38, 0, 0.82), // teach: side profile, machined edge
  p(-1.6, -1.08, 1.2, 0.12, 0.42, 0, 1.5), // privacy: close on the lens, device on the left
  p(-1.6, 0.02, 0.35, 0.16, 0.72, 0.02, 1.0, 1), // proof: faceplate lifts, core revealed
  p(-2.0, 0, -0.3, 0.04, 0.38, 0, 0.86), // verify: reassembled, calm, still left
  p(-4.1, 1.9, -3.4, 0.25, 1.1, 0.08, 0.7), // telemetry: drifts out of frame, top-left, clearing the chart
  p(-2.45, 0.1, -1.1, 0.12, 0.72, -0.03, 0.84), // stack: returns on the left
  p(0, 0.84, 0, 0.04, 0, 0, 0.52), // finale: centred above the closing line, front-on
];

/** Close-ups when a hotspot is selected in the hero. */
export const FOCUS: Record<HotspotId, Pose> = {
  lens: p(1.15, -1.3, 2.2, 0.08, -0.2, 0, 1.75),
  motion: p(1.15, -0.62, 2.25, 0.05, -0.24, 0, 1.75),
  light: p(1.15, 1.32, 2.0, -0.12, -0.26, 0, 1.6),
  core: p(1.3, 0.1, 0.9, 0.1, -1.05, 0, 1.15, 0.85),
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export function poseAt(stage: number): Pose {
  const max = KEYFRAMES.length - 1;
  const clamped = Math.min(max, Math.max(0, stage));
  const i = Math.floor(clamped);
  const a = KEYFRAMES[i]!;
  const b = KEYFRAMES[Math.min(max, i + 1)]!;
  const t = smooth(clamped - i);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    px: mix(a.px, b.px),
    py: mix(a.py, b.py),
    pz: mix(a.pz, b.pz),
    rx: mix(a.rx, b.rx),
    ry: mix(a.ry, b.ry),
    rz: mix(a.rz, b.rz),
    s: mix(a.s, b.s),
    explode: mix(a.explode, b.explode),
  };
}

/** The pose actually rendered this frame (damped towards the target). */
export const current: Pose = { ...KEYFRAMES[0]! };
