import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canonicalize } from "witness-verify";
import {
  SensorDefinitionSchema,
  type PrivacyReceipt,
  type Sensor,
  type SensorDefinition,
  type SensorReading,
  type Trigger,
} from "../domain.js";
import type { Notifier } from "../notify/notifier.js";
import type { SseHub } from "../notify/sse.js";
import type { FaceDetector } from "../privacy/faces.js";
import { preparePerception } from "../privacy/perception.js";
import type { EvidenceService } from "../proof/evidence.js";
import type { Ledger } from "../proof/ledger.js";
import type { RingClient, RingDevice } from "../ring/types.js";
import type { StateStore } from "../storage/state.js";
import { UNKNOWN, type VisionAnswer, type VisionProvider } from "../vision/types.js";

export interface EngineDeps {
  state: StateStore;
  ledger: Ledger;
  ring: RingClient;
  vision: VisionProvider;
  faces: FaceDetector;
  evidence: EvidenceService;
  notifier: Notifier;
  sse: SseHub;
  /** Delay before reading a snapshot after a camera event (real Ring recordings need a few seconds). */
  eventSnapshotDelayMs: number;
  confirmDelayMs: number;
}

export interface CheckResult {
  sensor: Sensor;
  answer: VisionAnswer;
  receipt: PrivacyReceipt;
  transition: { from: string; to: string; seq: number } | null;
  evidenceId: string | null;
}

const definitionHash = (def: SensorDefinition) => createHash("sha256").update(canonicalize(def)).digest("hex");

/**
 * Runs virtual sensors: grabs a frame, applies privacy, asks the vision model,
 * debounces the answer, and on a state change writes the ledger, captures
 * evidence for alert states, and fires actions.
 */
export class SensorEngine {
  private readonly inFlight = new Map<string, Promise<CheckResult | null>>();
  private readonly confirmTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastAttempt = new Map<string, number>();
  private readonly aiViews = new Map<string, { jpeg: Buffer; at: string }>();
  private readonly delayed = new Set<NodeJS.Timeout>();
  private ticker: NodeJS.Timeout | null = null;
  private stopped = false;
  private deviceCache: { at: number; devices: RingDevice[] } | null = null;

  constructor(private readonly deps: EngineDeps) {}

  start(): void {
    this.ticker = setInterval(() => void this.tick(), 20_000);
    this.ticker.unref();
  }

  /** Stop scheduling work and wait for checks that are already running. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    for (const timer of [...this.confirmTimers.values(), ...this.delayed]) clearTimeout(timer);
    this.confirmTimers.clear();
    this.delayed.clear();
    await Promise.all(this.inFlight.values());
  }

  private later(ms: number, run: () => void): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.delayed.delete(timer);
      run();
    }, ms);
    this.delayed.add(timer);
  }

  list(): Sensor[] {
    return this.deps.state.data.sensors;
  }

  get(id: string): Sensor | undefined {
    return this.deps.state.data.sensors.find((s) => s.id === id);
  }

  aiView(id: string) {
    return this.aiViews.get(id);
  }

  // ---- Definitions -----------------------------------------------------------------------

  async create(input: unknown): Promise<Sensor> {
    const def = SensorDefinitionSchema.parse(input);
    const id = `sen_${randomBytes(5).toString("hex")}`;
    const entry = await this.deps.ledger.append("sensor.created", { sensorId: id, definition: def, definitionHash: definitionHash(def) });
    const now = new Date().toISOString();
    const sensor: Sensor = { ...def, id, createdAt: now, updatedAt: now, definitionSeq: entry.seq, current: null, last: null, pending: null, lastError: null };
    this.deps.state.update((s) => s.sensors.push(sensor));
    this.deps.sse.send("sensor", sensor);
    void this.check(id, "manual");
    return sensor;
  }

  async update(id: string, input: unknown): Promise<Sensor> {
    const sensor = this.require(id);
    const def = SensorDefinitionSchema.parse(input);
    const entry = await this.deps.ledger.append("sensor.updated", { sensorId: id, definition: def, definitionHash: definitionHash(def) });
    const questionChanged = def.question !== sensor.question || JSON.stringify(def.states) !== JSON.stringify(sensor.states) || def.deviceId !== sensor.deviceId;
    this.deps.state.update(() => {
      Object.assign(sensor, def, { updatedAt: new Date().toISOString(), definitionSeq: entry.seq, pending: null });
      if (questionChanged) sensor.current = null; // new question => new baseline
    });
    this.deps.sse.send("sensor", sensor);
    return sensor;
  }

  async remove(id: string): Promise<void> {
    this.require(id);
    await this.deps.ledger.append("sensor.deleted", { sensorId: id });
    this.deps.state.update((s) => {
      s.sensors = s.sensors.filter((x) => x.id !== id);
    });
    this.aiViews.delete(id);
    this.deps.sse.send("sensor-deleted", { id });
  }

  private require(id: string): Sensor {
    const sensor = this.get(id);
    if (!sensor) throw Object.assign(new Error(`Sensor ${id} not found`), { status: 404 });
    return sensor;
  }

  /** Try a definition without saving it (the "Test" button while teaching). */
  async test(input: unknown): Promise<{ answer: VisionAnswer; aiView: string; facesBlurred: number; privacyZonesApplied: number; regionAreaPct: number }> {
    const def = SensorDefinitionSchema.parse(input);
    const frame = await this.deps.ring.getSnapshot(def.deviceId);
    const zones = this.deps.state.data.privacyZones[def.deviceId] ?? [];
    const perception = await preparePerception(frame, def.region, zones, this.deps.faces);
    const answer = await this.deps.vision.ask({ image: perception.aiView, mediaType: "image/jpeg", question: def.question, states: def.states, simTruth: frame.simTruth });
    return {
      answer,
      aiView: `data:image/jpeg;base64,${perception.aiView.toString("base64")}`,
      facesBlurred: perception.facesBlurred,
      privacyZonesApplied: perception.privacyZonesApplied,
      regionAreaPct: perception.regionAreaPct,
    };
  }

  // ---- Triggers --------------------------------------------------------------------------

  /** motion_detected / button_press on a camera. */
  onCameraActivity(deviceId: string, type: "motion_detected" | "button_press"): void {
    const trigger: Trigger = type === "button_press" ? "button_press" : "motion";
    for (const sensor of this.list()) {
      if (sensor.enabled && sensor.onMotion && sensor.deviceId === deviceId) {
        this.later(this.deps.eventSnapshotDelayMs, () => void this.check(sensor.id, trigger));
      }
    }
  }

  /** A real Ring sensor (contact, flood, ...) fired; re-check virtual sensors that it corroborates. */
  onSensorEvent(deviceId: string): void {
    for (const sensor of this.list()) {
      if (sensor.enabled && sensor.corroboratingDeviceIds.includes(deviceId)) {
        this.later(this.deps.eventSnapshotDelayMs, () => void this.check(sensor.id, "corroboration"));
      }
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const sensor of this.list()) {
      if (!sensor.enabled || sensor.intervalMinutes <= 0) continue;
      const last = Math.max(Date.parse(sensor.last?.checkedAt ?? "") || 0, this.lastAttempt.get(sensor.id) ?? 0);
      if (now - last >= sensor.intervalMinutes * 60_000) void this.check(sensor.id, "interval");
    }
  }

  private async deviceName(deviceId: string): Promise<string> {
    if (!this.deviceCache || Date.now() - this.deviceCache.at > 60_000) {
      try {
        this.deviceCache = { at: Date.now(), devices: await this.deps.ring.listDevices() };
      } catch {
        return deviceId;
      }
    }
    return this.deviceCache.devices.find((d) => d.id === deviceId)?.name ?? deviceId;
  }

  /** Run one check. Overlapping requests for the same sensor share the in-flight run. */
  check(id: string, trigger: Trigger): Promise<CheckResult | null> {
    if (this.stopped) return Promise.resolve(null);
    const running = this.inFlight.get(id);
    if (running) return running;
    const run = this.runCheck(id, trigger)
      .catch((error: unknown) => {
        const sensor = this.get(id);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[engine] ${sensor?.name ?? id}: ${message}`);
        if (sensor) {
          this.deps.state.update(() => {
            sensor.lastError = message;
          });
          this.deps.sse.send("sensor", sensor);
        }
        return null;
      })
      .finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, run);
    return run;
  }

  private async runCheck(id: string, trigger: Trigger): Promise<CheckResult | null> {
    const sensor = this.get(id);
    if (!sensor || !sensor.enabled) return null;
    this.lastAttempt.set(id, Date.now());
    const { ring, vision, faces, ledger, state, sse } = this.deps;

    const eventDriven = trigger === "motion" || trigger === "button_press" || trigger === "corroboration";
    const frame = await ring.getSnapshot(sensor.deviceId, eventDriven ? { withinMs: 120_000 } : {});
    const perception = await preparePerception(frame, sensor.region, state.data.privacyZones[sensor.deviceId] ?? [], faces);
    const answer = await vision.ask({
      image: perception.aiView,
      mediaType: "image/jpeg",
      question: sensor.question,
      states: sensor.states,
      simTruth: frame.simTruth,
    });
    const checkedAt = new Date().toISOString();
    this.aiViews.set(id, { jpeg: perception.aiView, at: checkedAt });
    const reading: SensorReading = { state: answer.state, confidence: answer.confidence, observation: answer.observation, checkedAt };

    // Debounce: a new state must be seen `debounce` times in a row with enough confidence.
    let transition: { from: string; to: string } | null = null;
    const usable = answer.state !== UNKNOWN && answer.confidence >= sensor.minConfidence;
    state.update(() => {
      sensor.last = reading;
      sensor.lastError = null;
      if (!usable) return;
      if (!sensor.current) {
        transition = { from: UNKNOWN, to: answer.state }; // first reading becomes the baseline
      } else if (answer.state === sensor.current.state) {
        sensor.pending = null;
      } else {
        const count = sensor.pending?.state === answer.state ? sensor.pending.count + 1 : 1;
        sensor.pending = { state: answer.state, count };
        if (count >= sensor.debounce) transition = { from: sensor.current.state, to: answer.state };
      }
    });

    const receipt: PrivacyReceipt = {
      id: randomUUID(),
      at: checkedAt,
      sensorId: id,
      sensorName: sensor.name,
      deviceId: sensor.deviceId,
      trigger,
      frameSha256: perception.frameSha256,
      aiViewSha256: perception.aiViewSha256,
      frameSize: perception.frameSize,
      regionAreaPct: perception.regionAreaPct,
      privacyZonesApplied: perception.privacyZonesApplied,
      facesBlurred: perception.facesBlurred,
      faceDetector: faces.name,
      provider: answer.provider,
      model: answer.model,
      state: answer.state,
      confidence: answer.confidence,
      guardrail: answer.guardrail,
      retainedAsEvidence: null,
    };

    let result: CheckResult["transition"] = null;
    let evidenceId: string | null = null;
    const change = transition as { from: string; to: string } | null;
    if (change) {
      const entry = await ledger.append("sensor.state_changed", {
        sensorId: id,
        sensorName: sensor.name,
        deviceId: sensor.deviceId,
        from: change.from,
        to: change.to,
        confidence: answer.confidence,
        observation: answer.observation,
        trigger,
        frameSha256: perception.frameSha256,
        aiViewSha256: perception.aiViewSha256,
        provider: answer.provider,
        model: answer.model,
        definitionSeq: sensor.definitionSeq,
      });
      result = { ...change, seq: entry.seq };
      state.update(() => {
        sensor.current = { ...reading, since: checkedAt };
        sensor.pending = null;
      });

      const deviceName = await this.deviceName(sensor.deviceId);
      if (sensor.alertStates.includes(change.to)) {
        const record = await this.deps.evidence.capture(frame, { sensor, deviceName, triggerSeq: entry.seq, state: change.to });
        evidenceId = record.id;
        receipt.retainedAsEvidence = record.id;
        await this.fireActions(sensor, change.to, deviceName, record.id);
      } else if (sensor.alertStates.includes(change.from)) {
        if (sensor.actions.notify) {
          await this.deps.notifier.send({ level: "resolved", title: `${sensor.name}: ${change.to}`, body: `Back to normal on ${deviceName}. ${answer.observation}`, sensorId: id });
        }
      }
    } else if (sensor.pending && usable) {
      this.scheduleConfirm(id);
    }

    state.update((s) => s.receipts.push(receipt));
    sse.send("receipt", receipt);
    sse.send("sensor", sensor);
    return { sensor, answer, receipt, transition: result, evidenceId };
  }

  /** While a new state is pending, look again shortly instead of waiting for the next interval. */
  private scheduleConfirm(id: string): void {
    if (this.stopped || this.confirmTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.confirmTimers.delete(id);
      void this.check(id, "confirm");
    }, this.deps.confirmDelayMs);
    timer.unref();
    this.confirmTimers.set(id, timer);
  }

  private async fireActions(sensor: Sensor, state: string, deviceName: string, evidenceId: string): Promise<void> {
    const message = `${sensor.name} is ${state}`;
    if (sensor.actions.notify) {
      await this.deps.notifier.send({
        level: "alert",
        title: message,
        body: `${deviceName}: ${sensor.last?.observation ?? ""} Evidence ${evidenceId} was signed and redacted.`,
        sensorId: sensor.id,
        evidenceId,
      });
    }
    if (sensor.actions.chime) {
      try {
        await this.deps.ring.playChime(sensor.actions.chime.deviceId, sensor.actions.chime.slotEvent, message);
      } catch (error) {
        await this.deps.notifier.send({ level: "error", title: "Chime failed", body: (error as Error).message, sensorId: sensor.id });
      }
    }
  }
}
