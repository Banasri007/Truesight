export type DeviceKind = "camera" | "chime" | "sensor" | "unknown";

export interface RingDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  online: boolean | null;
  /** Multi-camera devices expose component ids; empty for single-camera devices. */
  components: string[];
  /** Sensors only: which detections it reports (contact, flood, freeze, temperature, ...). */
  sensorReadings?: Record<string, unknown>;
}

export interface Frame {
  deviceId: string;
  bytes: Buffer;
  mediaType: "image/jpeg" | "image/png";
  capturedAt: number;
  origin: "recording" | "snapshot" | "simulator" | "upload";
  /** Simulator only: ground truth of the rendered scene, used by the mock vision provider. */
  simTruth?: Record<string, string | boolean>;
}

export interface ChimeSlot {
  event: string;
  name: string | null;
  disabled: boolean;
}

export interface HistoryEvent {
  id: string;
  eventType: string;
  start: number;
  end: number | null;
}

/** Everything TrueSight needs from Ring, implemented by the real API client and by the simulator. */
export interface RingClient {
  readonly mode: "api" | "simulator";
  listDevices(): Promise<RingDevice[]>;
  getSnapshot(deviceId: string, options?: { atTimestamp?: number; withinMs?: number }): Promise<Frame>;
  /** Download an already-recorded clip; null when nothing was recorded for that range. */
  getClip(deviceId: string, startMs: number, durationMs: number): Promise<Buffer | null>;
  listChimeSlots(chimeId: string): Promise<ChimeSlot[]>;
  playChime(chimeId: string, slotEvent: string, message: string): Promise<void>;
  getEventHistory(deviceId: string, limit?: number): Promise<HistoryEvent[]>;
}

export class RingApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    readonly code?: string,
  ) {
    super(`Ring API ${status}${code ? ` ${code}` : ""}: ${title}${detail ? ` - ${detail}` : ""}`);
  }
}
