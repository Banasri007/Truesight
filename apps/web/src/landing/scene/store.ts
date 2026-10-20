import { useSyncExternalStore } from "react";

export type HotspotId = "lens" | "motion" | "light" | "core";
export type FinishId = "graphite" | "satin" | "pearl";

/**
 * Per-frame values written by scroll / pointer handlers and read inside
 * useFrame. Kept outside React so scrolling never re-renders the scene.
 */
export const live = {
  /** Continuous section index driven by ScrollTrigger (0 = hero). */
  stage: 0,
  pointer: { x: 0, y: 0 },
  dragging: false,
  dragVelocity: 0,
  dragYaw: 0,
  dragPitch: 0,
  reduced: false,
  mobile: false,
  hovered: false,
};

/** UI state shared by the DOM overlay and the 3D scene. */
interface UiState {
  focus: HotspotId | null;
  finish: FinishId;
  ready: boolean;
}

let state: UiState = { focus: null, finish: "graphite", ready: false };
const listeners = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UiState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(state), () => select(state));
}

export const FINISHES: Record<FinishId, { label: string; color: string; metalness: number; roughness: number; clearcoat: number }> = {
  graphite: { label: "Graphite", color: "#3c4450", metalness: 0.7, roughness: 0.3, clearcoat: 0.7 },
  satin: { label: "Satin nickel", color: "#aab2bd", metalness: 1, roughness: 0.28, clearcoat: 0.25 },
  pearl: { label: "Pearl", color: "#ebe7e0", metalness: 0.05, roughness: 0.32, clearcoat: 1 },
};

export const HOTSPOTS: Record<HotspotId, { index: string; title: string; label: string; body: string; spec: string }> = {
  lens: {
    index: "01",
    title: "Perception",
    label: "Lens · perception",
    body: "A vision model answers your question from the box you drew, and only that box. It never sees the full frame. Answers are limited to your own labels, plus \"unknown\".",
    spec: "Vision AI · strict JSON · guardrails",
  },
  motion: {
    index: "02",
    title: "Events",
    label: "Motion · events",
    body: "Ring motion, doorbell and contact-sensor webhooks wake your sensors. Each one is verified with HMAC-SHA256 and written to the ledger before anything acts on it.",
    spec: "HMAC-SHA256 · deduped on request_id",
  },
  light: {
    index: "03",
    title: "Actions",
    label: "Light ring · actions",
    body: "When an answer turns into an alert, after the debounce confirms it, TrueSight plays a sound on your Ring Chime and notifies you.",
    spec: "Debounced · Chime playback · SNS",
  },
  core: {
    index: "04",
    title: "Proof",
    label: "Core · proof",
    body: "Every state change is hashed, chained to the entry before it, and signed. Evidence frames are sealed before they are redacted, so anyone can verify them later.",
    spec: "SHA-256 chain · ES256 · AWS KMS",
  },
};
