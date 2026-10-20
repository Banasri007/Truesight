export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DeviceKind = "camera" | "chime" | "sensor" | "unknown";

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  online: boolean | null;
  components: string[];
  sensorReadings?: Record<string, unknown>;
  privacyZones: NormRect[];
}

export interface SensorReading {
  state: string;
  confidence: number;
  observation: string;
  checkedAt: string;
}

export interface SensorDefinition {
  name: string;
  deviceId: string;
  question: string;
  region: NormRect;
  states: string[];
  alertStates: string[];
  intervalMinutes: number;
  onMotion: boolean;
  debounce: number;
  minConfidence: number;
  actions: { notify: boolean; chime: { deviceId: string; slotEvent: string } | null };
  corroboratingDeviceIds: string[];
  enabled: boolean;
}

export interface Sensor extends SensorDefinition {
  id: string;
  createdAt: string;
  updatedAt: string;
  definitionSeq: number;
  current: (SensorReading & { since: string }) | null;
  last: SensorReading | null;
  pending: { state: string; count: number } | null;
  lastError: string | null;
}

export interface PrivacyReceipt {
  id: string;
  at: string;
  sensorId: string;
  sensorName: string;
  deviceId: string;
  trigger: string;
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
  originalSha256: string;
  redactedSha256: string;
  width: number;
  height: number;
  regions: (NormRect & { kind: "face" | "privacy_zone" })[];
  capturedSeq: number;
  redactedSeq: number;
  triggerSeq: number;
  clip: { key: string; sha256: string; seq: number } | null;
  purgedAt: string | null;
}

export interface RingEventRecord {
  id: string;
  type: string;
  deviceId: string | null;
  subType: string | null;
  timestamp: number;
  receivedAt: string;
  ledgerSeq: number;
}

export interface Notification {
  id: string;
  at: string;
  level: "alert" | "resolved" | "info" | "error";
  title: string;
  body: string;
  sensorId?: string;
  evidenceId?: string;
}

export interface Status {
  version: string;
  ringMode: "simulator" | "api";
  ring: { linked: boolean; accountId: string | null; simulated?: boolean };
  vision: { provider: string; model: string; effort: string };
  faceDetector: string;
  signer: { kid: string; description: string };
  ledger: { store: string; headSeq: number; headHash: string };
  blobs: string;
  notifier: string;
  retentionDays: number;
  counts: { sensors: number; evidence: number };
}

export interface ChimeSlot {
  event: string;
  name: string | null;
  disabled: boolean;
}

export interface SimState {
  scenes: Record<string, Record<string, string | boolean>>;
  customFrames: string[];
  chimeSlots: ChimeSlot[];
}
