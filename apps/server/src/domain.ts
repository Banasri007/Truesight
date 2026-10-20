import { z } from "zod";

/** Rectangle in normalized frame coordinates (0..1, origin top-left), like Ring's zone vertices. */
export const NormRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});
export type NormRect = z.infer<typeof NormRectSchema>;

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const label = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((s) => s.toLowerCase());

/** What the owner teaches: a camera, a region, a question, and the answers that count. */
export const SensorDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    deviceId: z.string().min(1),
    question: z.string().trim().min(5).max(300),
    region: NormRectSchema,
    states: z.array(label).min(2).max(6),
    alertStates: z.array(label).default([]),
    intervalMinutes: z.number().int().min(0).max(1440).default(15),
    onMotion: z.boolean().default(true),
    debounce: z.number().int().min(1).max(5).default(2),
    minConfidence: z.number().min(0).max(1).default(0.6),
    actions: z
      .object({
        notify: z.boolean().default(true),
        chime: z.object({ deviceId: z.string().min(1), slotEvent: z.string().min(1) }).nullable().default(null),
      })
      .default({ notify: true, chime: null }),
    corroboratingDeviceIds: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((def, ctx) => {
    if (new Set(def.states).size !== def.states.length) ctx.addIssue({ code: "custom", path: ["states"], message: "States must be unique" });
    if (def.states.includes("unknown")) ctx.addIssue({ code: "custom", path: ["states"], message: '"unknown" is reserved' });
    for (const s of def.alertStates) {
      if (!def.states.includes(s)) ctx.addIssue({ code: "custom", path: ["alertStates"], message: `Alert state "${s}" is not one of the states` });
    }
    if (def.region.x + def.region.w > 1.0001 || def.region.y + def.region.h > 1.0001) {
      ctx.addIssue({ code: "custom", path: ["region"], message: "Region must stay inside the frame" });
    }
  });
export type SensorDefinition = z.infer<typeof SensorDefinitionSchema>;

export interface SensorReading {
  state: string;
  confidence: number;
  observation: string;
  checkedAt: string;
}

export interface Sensor extends SensorDefinition {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Ledger entry that recorded the current definition (question, region, labels). */
  definitionSeq: number;
  /** Debounced state; only changes after `debounce` agreeing observations. */
  current: (SensorReading & { since: string }) | null;
  /** Most recent raw observation, debounced or not. */
  last: SensorReading | null;
  pending: { state: string; count: number } | null;
  lastError: string | null;
}

export type Trigger = "interval" | "motion" | "manual" | "confirm" | "corroboration" | "button_press";

/** What happened to one frame on its way to the AI. Shown to the owner as a "privacy receipt". */
export interface PrivacyReceipt {
  id: string;
  at: string;
  sensorId: string;
  sensorName: string;
  deviceId: string;
  trigger: Trigger;
  frameSha256: string;
  aiViewSha256: string;
  frameSize: { width: number; height: number };
  regionAreaPct: number;
  privacyZonesApplied: number;
  facesBlurred: number;
  faceDetector: string;
  provider: string;
  model: string;
  state: string;
  confidence: number;
  guardrail: string | null;
  retainedAsEvidence: string | null;
}

export interface EvidenceRecord {
  id: string;
  sensorId: string;
  sensorName: string;
  deviceId: string;
  deviceName: string;
  state: string;
  question: string;
  capturedAt: string;
  originalKey: string | null;
  redactedKey: string;
  originalSha256: string;
  redactedSha256: string;
  width: number;
  height: number;
  regions: (PixelRect & { kind: "face" | "privacy_zone" })[];
  capturedSeq: number;
  redactedSeq: number;
  triggerSeq: number;
  definitionSeq: number;
  clip: { key: string; sha256: string; seq: number } | null;
  purgedAt: string | null;
}

export interface RingEventRecord {
  id: string;
  requestId: string;
  type: string;
  deviceId: string | null;
  subType: string | null;
  timestamp: number;
  receivedAt: string;
  ledgerSeq: number;
  attributes: Record<string, unknown>;
}
