import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { JsonFile } from "../../storage/json-file.js";
import { RingApiError, type ChimeSlot, type Frame, type HistoryEvent, type RingClient, type RingDevice } from "../types.js";
import { signWebhookBody } from "../webhook.js";
import {
  renderDriveway,
  renderFrontDoor,
  renderSideYard,
  type DrivewayScene,
  type FrontDoorScene,
  type SideYardScene,
} from "./scenes.js";

export const SIM = {
  front: "sim-cam-front",
  side: "sim-cam-side",
  driveway: "sim-cam-driveway",
  chime: "sim-chime-hall",
  gateContact: "sim-contact-gate",
} as const;

interface SimState {
  scenes: {
    [SIM.front]: FrontDoorScene;
    [SIM.side]: SideYardScene;
    [SIM.driveway]: DrivewayScene;
  };
  customFrames: Record<string, "image/jpeg" | "image/png">;
}

const DEVICES: Omit<RingDevice, "online">[] = [
  { id: SIM.front, name: "Front Door", kind: "camera", components: [] },
  { id: SIM.side, name: "Side Yard", kind: "camera", components: [] },
  { id: SIM.driveway, name: "Driveway", kind: "camera", components: [] },
  { id: SIM.chime, name: "Hallway Chime", kind: "chime", components: [] },
  { id: SIM.gateContact, name: "Side Gate Contact Sensor", kind: "sensor", components: [] },
];

const CHIME_SLOTS: ChimeSlot[] = [
  { event: "ding", name: "Doorbell ding", disabled: false },
  { event: "motion", name: "Motion tone", disabled: false },
  { event: "truesight_alert", name: "TrueSight alert", disabled: false },
];

export interface SimulatorHooks {
  /** Where to POST signed webhooks (normally this server's own /webhooks/ring). */
  webhookUrl: string;
  hmacKey: string;
  onChime: (chimeId: string, slotEvent: string, message: string) => void;
  onChange: () => void;
}

/**
 * A fake Ring account: three cameras with drawable scenes, a chime and a
 * contact sensor. Changes to a scene emit HMAC-signed webhooks in Ring's
 * envelope format, so the server handles them exactly like real ones.
 */
export class Simulator implements RingClient {
  readonly mode = "simulator" as const;
  private readonly history: (HistoryEvent & { deviceId: string })[] = [];

  private constructor(
    private readonly file: JsonFile<SimState>,
    private readonly framesDir: string,
    private readonly hooks: SimulatorHooks,
  ) {}

  static async open(dataDir: string, hooks: SimulatorHooks): Promise<Simulator> {
    const file = await JsonFile.open<SimState>(join(dataDir, "simulator.json"), () => ({
      scenes: {
        [SIM.front]: { package: false, person: false, night: false },
        [SIM.side]: { gate: "closed", bins: "yard", night: false },
        [SIM.driveway]: { garageDoor: "closed", car: true, night: false },
      },
      customFrames: {},
    }));
    const framesDir = join(dataDir, "sim-frames");
    await mkdir(framesDir, { recursive: true });
    return new Simulator(file, framesDir, hooks);
  }

  state() {
    return { scenes: this.file.data.scenes, customFrames: Object.keys(this.file.data.customFrames), chimeSlots: CHIME_SLOTS };
  }

  flush(): Promise<void> {
    return this.file.flush();
  }

  // ---- RingClient ------------------------------------------------------------------------

  async listDevices(): Promise<RingDevice[]> {
    const gateOpen = this.file.data.scenes[SIM.side].gate === "open";
    return DEVICES.map((d) =>
      d.id === SIM.gateContact
        ? { ...d, online: true, sensorReadings: { contact_detection: { faulted: gateOpen }, battery_status: { percentage: 87 } } }
        : { ...d, online: true },
    );
  }

  private deviceName(deviceId: string): string {
    const device = DEVICES.find((d) => d.id === deviceId);
    if (!device) throw new RingApiError(404, "Not Found", `Unknown simulated device ${deviceId}`, "DEVICE_NOT_FOUND");
    return device.name;
  }

  async getSnapshot(deviceId: string): Promise<Frame> {
    const name = this.deviceName(deviceId);
    const custom = this.file.data.customFrames[deviceId];
    if (custom) {
      return { deviceId, bytes: await readFile(join(this.framesDir, deviceId)), mediaType: custom, capturedAt: Date.now(), origin: "upload" };
    }
    const now = new Date();
    const scenes = this.file.data.scenes;
    let svg: string;
    let truth: Record<string, string | boolean>;
    if (deviceId === SIM.front) {
      svg = renderFrontDoor(scenes[SIM.front], name, now);
      truth = { ...scenes[SIM.front] };
    } else if (deviceId === SIM.side) {
      svg = renderSideYard(scenes[SIM.side], name, now);
      truth = { ...scenes[SIM.side] };
    } else if (deviceId === SIM.driveway) {
      svg = renderDriveway(scenes[SIM.driveway], name, now);
      truth = { ...scenes[SIM.driveway] };
    } else {
      throw new RingApiError(400, "Not a camera", `${name} has no camera`, "INVALID_PAYLOAD");
    }
    const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
    return { deviceId, bytes, mediaType: "image/jpeg", capturedAt: now.getTime(), origin: "simulator", simTruth: truth };
  }

  async getClip(): Promise<Buffer | null> {
    return null; // The simulator has no video; evidence falls back to the still frame.
  }

  async listChimeSlots(chimeId: string): Promise<ChimeSlot[]> {
    this.deviceName(chimeId);
    return CHIME_SLOTS;
  }

  async playChime(chimeId: string, slotEvent: string, message: string): Promise<void> {
    this.deviceName(chimeId);
    this.hooks.onChime(chimeId, slotEvent, message);
  }

  async getEventHistory(deviceId: string, limit = 20): Promise<HistoryEvent[]> {
    return this.history
      .filter((e) => e.deviceId === deviceId)
      .slice(-limit)
      .reverse()
      .map(({ deviceId: _deviceId, ...event }) => event);
  }

  // ---- Controls used by the Simulator page ---------------------------------------------

  async updateScene(deviceId: string, patch: Record<string, unknown>, autoMotion: boolean): Promise<void> {
    const scenes = this.file.data.scenes as unknown as Record<string, Record<string, unknown>>;
    const scene = scenes[deviceId];
    if (!scene) throw new RingApiError(404, "Not Found", `No scene for ${deviceId}`);
    const before = { ...scene };
    for (const [key, value] of Object.entries(patch)) {
      if (key in scene && typeof value === typeof scene[key]) scene[key] = value;
    }
    this.file.save();
    this.hooks.onChange();

    if (deviceId === SIM.side && before.gate !== scene.gate) {
      await this.emit(scene.gate === "open" ? "contact_sensor_faulted" : "contact_sensor_cleared", SIM.gateContact);
    }
    if (autoMotion && JSON.stringify(before) !== JSON.stringify(scene)) {
      const subType = patch.person === true ? "human" : patch.car === true ? "vehicle" : patch.package === true ? "package_delivery" : "other_motion";
      await this.emit("motion_detected", deviceId, { sub_type: subType });
    }
  }

  async trigger(deviceId: string, type: "motion_detected" | "button_press"): Promise<void> {
    this.deviceName(deviceId);
    await this.emit(type, deviceId, type === "motion_detected" ? { sub_type: "human" } : {});
  }

  async setCustomFrame(deviceId: string, bytes: Buffer, mediaType: "image/jpeg" | "image/png"): Promise<void> {
    this.deviceName(deviceId);
    await sharp(bytes).metadata(); // reject anything that is not a decodable image
    await writeFile(join(this.framesDir, deviceId), bytes);
    this.file.data.customFrames[deviceId] = mediaType;
    this.file.save();
    this.hooks.onChange();
  }

  async clearCustomFrame(deviceId: string): Promise<void> {
    delete this.file.data.customFrames[deviceId];
    await rm(join(this.framesDir, deviceId), { force: true });
    this.file.save();
    this.hooks.onChange();
  }

  /** Build a Ring-format webhook, sign it like Ring does, and deliver it. */
  private async emit(type: string, deviceId: string, extra: Record<string, unknown> = {}): Promise<void> {
    const timestamp = Date.now();
    const body = JSON.stringify({
      meta: { version: "1.1", time: new Date(timestamp).toISOString(), request_id: randomUUID(), account_id: "sim-account" },
      data: {
        id: `evt-${randomUUID()}`,
        type,
        attributes: { source: deviceId, source_type: "devices", timestamp, ...extra },
        relationships: { devices: { data: { type: "devices", id: deviceId } } },
      },
    });
    if (type === "motion_detected" || type === "button_press") {
      const eventType = type === "button_press" ? "ding" : `motion.${String(extra.sub_type ?? "other_motion")}`;
      this.history.push({ deviceId, id: randomUUID(), eventType, start: timestamp, end: timestamp + 20_000 });
      this.history.splice(0, Math.max(0, this.history.length - 200));
    }
    const response = await fetch(this.hooks.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": signWebhookBody(body, this.hooks.hmacKey) },
      body,
    });
    if (!response.ok) throw new Error(`Simulated webhook was rejected: ${response.status} ${await response.text()}`);
  }
}
