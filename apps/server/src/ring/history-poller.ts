import type { RingEventRecord } from "../domain.js";
import type { SseHub } from "../notify/sse.js";
import type { Ledger } from "../proof/ledger.js";
import type { SensorEngine } from "../sensors/engine.js";
import type { StateStore } from "../storage/state.js";
import type { HistoryEvent, RingClient } from "./types.js";

/**
 * Webhook substitute for setups that cannot receive webhooks (a Ring Developer
 * Playground token has no app integration). Polls each camera's event history
 * and treats every newly finished event (motion, ding, on-demand live view) like
 * the matching webhook: it is signed into the ledger and wakes the sensors.
 */
export class HistoryPoller {
  private readonly seen = new Set<string>();
  private readonly primed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly deps: { ring: RingClient; state: StateStore; ledger: Ledger; sse: SseHub; engine: SensorEngine; intervalMs: number },
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.poll();
    } catch (error) {
      console.warn(`[history] poll failed: ${(error as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** One pass over all cameras. The first pass per camera only records what already exists. */
  async poll(): Promise<number> {
    let triggered = 0;
    const cameras = (await this.deps.ring.listDevices()).filter((d) => d.kind === "camera");
    for (const camera of cameras) {
      const finished = (await this.deps.ring.getEventHistory(camera.id, 10)).filter((e) => e.end !== null).sort((a, b) => a.start - b.start);
      if (!this.primed.has(camera.id)) {
        for (const event of finished) this.seen.add(event.id);
        this.primed.add(camera.id);
        continue;
      }
      for (const event of finished) {
        if (this.seen.has(event.id)) continue;
        this.seen.add(event.id);
        await this.record(camera.id, event);
        triggered++;
      }
    }
    return triggered;
  }

  private async record(deviceId: string, event: HistoryEvent): Promise<void> {
    const entry = await this.deps.ledger.append("ring.event", {
      source: "event-history",
      historyEventId: event.id,
      type: event.eventType,
      deviceId,
      timestamp: event.start,
      end: event.end,
    });
    const record: RingEventRecord = {
      id: event.id,
      requestId: event.id,
      type: `history.${event.eventType}`,
      deviceId,
      subType: event.eventType.includes(".") ? event.eventType.slice(event.eventType.indexOf(".") + 1) : null,
      timestamp: event.start,
      receivedAt: new Date().toISOString(),
      ledgerSeq: entry.seq,
      attributes: { source: "event-history", start: event.start, end: event.end },
    };
    this.deps.state.update((s) => s.ringEvents.push(record));
    this.deps.sse.send("ring-event", record);
    // Look at the middle of the recording, where the action is.
    const at = Math.round((event.start + (event.end ?? event.start)) / 2);
    this.deps.engine.onCameraActivity(deviceId, event.eventType === "ding" ? "button_press" : "motion_detected", at);
  }
}
