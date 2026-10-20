import type { Config } from "../config.js";
import type { RingAuth } from "./oauth.js";
import { RingApiError, type ChimeSlot, type DeviceKind, type Frame, type HistoryEvent, type RingClient, type RingDevice } from "./types.js";

interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | null } | undefined>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NO_MEDIA_HELP =
  "Ring only returns images the camera already recorded, after you linked TrueSight. Trigger motion in front of the camera or open Live View in the Ring app, then try again.";

const SENSOR_STATUS_KEYS = [
  "contact_detection",
  "flood_detection",
  "freeze_detection",
  "temperature",
  "humidity",
  "pm2_5",
  "sensor_reporting_state",
];

/**
 * Client for the Ring Partner API (https://api.amazonvision.com).
 * Covers device discovery, snapshots, media clips, event history and chime playback.
 */
export class RingApiClient implements RingClient {
  readonly mode = "api" as const;
  private deviceCache: { at: number; devices: RingDevice[] } | null = null;
  /**
   * Learned lower bound for media requests. Ring only serves media after the customer's
   * consent date (not exposed by the API); a start time Ring accepted stays valid forever.
   */
  private earliestStart = 0;
  /** Local clock minus Ring's clock (from response Date headers). Ring rejects timestamps in its future. */
  private clockSkewMs = 0;

  private trackClock(response: Response): void {
    const server = Date.parse(response.headers.get("Date") ?? "");
    if (!Number.isFinite(server)) return;
    const skew = Date.now() - server;
    // Date headers have 1s resolution; ignore jitter, follow real drift.
    if (Math.abs(skew - this.clockSkewMs) > 1500) this.clockSkewMs = skew;
  }

  /** "Now" on Ring's clock, minus a small margin so a timestamp is never in Ring's future. */
  private ringNow(): number {
    return Date.now() - Math.max(0, this.clockSkewMs) - 2000;
  }

  constructor(
    private readonly cfg: Config,
    private readonly auth: RingAuth,
    private readonly kindOverrides: () => Record<string, DeviceKind>,
  ) {}

  /** Authenticated request with one refresh on 401 and backoff on 429 / transient 5xx. */
  private async request(
    method: string,
    path: string,
    options: { json?: unknown; redirect?: RequestRedirect; accept?: string } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.accessToken();
      const response = await fetch(`${this.cfg.RING_API_BASE}${path}`, {
        method,
        redirect: options.redirect ?? "follow",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: options.accept ?? "application/json",
          ...(options.json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      });
      this.trackClock(response);
      if (response.status === 401 && attempt === 0) {
        await this.auth.forceRefresh();
        continue;
      }
      if (response.status === 429 && attempt < 4) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if ((response.status === 500 || response.status === 503) && method === "GET" && attempt < 2) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return response;
    }
  }

  private async fail(response: Response, what: string): Promise<never> {
    const text = await response.text().catch(() => "");
    try {
      const body = JSON.parse(text) as { errors?: { title?: string; detail?: string; code?: string }[] };
      const first = body.errors?.[0];
      throw new RingApiError(response.status, first?.title ?? what, first?.detail ?? "", first?.code);
    } catch (error) {
      if (error instanceof RingApiError) throw error;
      throw new RingApiError(response.status, what, text.slice(0, 200));
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request("GET", path);
    if (!response.ok) await this.fail(response, `GET ${path}`);
    return (await response.json()) as T;
  }

  async listDevices(): Promise<RingDevice[]> {
    if (this.deviceCache && Date.now() - this.deviceCache.at < 60_000) return this.applyOverrides(this.deviceCache.devices);
    const body = await this.getJson<{ data: JsonApiResource[]; included?: JsonApiResource[] }>("/v1/devices?include=status,capabilities");
    const included = new Map((body.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
    const related = (device: JsonApiResource, type: string) => {
      for (const rel of Object.values(device.relationships ?? {})) {
        if (rel?.data?.type === type) return included.get(`${type}:${rel.data.id}`);
      }
      return undefined;
    };

    const devices = body.data.map((device): RingDevice => {
      const status = related(device, "device-status")?.attributes ?? {};
      const caps = related(device, "device-capabilities")?.attributes ?? {};
      const audio = caps.audio as { customizable_slots?: unknown } | undefined;
      const slots = audio?.customizable_slots;
      const hasChimeSlots = (typeof slots === "number" && slots > 0) || (Array.isArray(slots) && slots.length > 0);
      const isSensor = SENSOR_STATUS_KEYS.some((key) => key in status);
      const kind: DeviceKind = caps.video ? "camera" : hasChimeSlots ? "chime" : isSensor ? "sensor" : "unknown";
      const components = Array.isArray(caps.components)
        ? (caps.components as { component_id?: unknown; id?: unknown }[]).map((c) => String(c.component_id ?? c.id))
        : [];
      return {
        id: device.id,
        name: String(device.attributes?.name ?? device.id),
        kind,
        online: typeof status.online === "boolean" ? status.online : null,
        components,
        ...(kind === "sensor"
          ? { sensorReadings: Object.fromEntries(Object.entries(status).filter(([key]) => SENSOR_STATUS_KEYS.includes(key) || key === "battery_status")) }
          : {}),
      };
    });
    this.deviceCache = { at: Date.now(), devices };
    return this.applyOverrides(devices);
  }

  private applyOverrides(devices: RingDevice[]): RingDevice[] {
    const overrides = this.kindOverrides();
    return devices.map((d) => (overrides[d.id] ? { ...d, kind: overrides[d.id]! } : d));
  }

  async getSnapshot(deviceId: string, options: { atTimestamp?: number; withinMs?: number } = {}): Promise<Frame> {
    const now = this.ringNow();
    const maxWindow = 24 * 3_600_000 - 60_000; // latest_in_range windows cannot exceed 24h
    let start = Math.max(now - Math.min(options.withinMs ?? maxWindow, maxWindow), this.earliestStart);
    let shrunk = false;

    for (let attempt = 0; ; attempt++) {
      const body = options.atTimestamp
        ? { type: "at_timestamp", timestamp: options.atTimestamp }
        : { type: "latest_in_range", start_timestamp: start }; // end defaults to Ring's own "now"
      const response = await this.request("POST", `/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
        json: body,
        redirect: "manual",
        accept: "image/jpeg, image/png, application/json",
      });
      // 425 RECORDING_NOT_READY / 416 MEDIA_NOT_FOUND right after an event: the recording is still processing.
      if ((response.status === 425 || response.status === 416) && options.atTimestamp && attempt < 6) {
        await sleep(4000);
        continue;
      }
      if (response.status === 403 && !options.atTimestamp) {
        const text = await response.text();
        if (text.includes("TIME_RANGE_NOT_AUTHORIZED") && now - start > 60_000 && attempt < 6) {
          start = now - Math.max(60_000, Math.floor((now - start) / 8)); // shrink the window and retry
          shrunk = true;
          continue;
        }
        if (text.includes("TIME_RANGE_NOT_AUTHORIZED")) {
          throw new RingApiError(403, "No media since linking", NO_MEDIA_HELP, "TIME_RANGE_NOT_AUTHORIZED");
        }
        await this.fail(new Response(text, { status: 403 }), "Snapshot download failed");
      }
      // Ring accepted this range, so it starts after consent: remember it for every later request.
      if (shrunk) this.earliestStart = Math.max(this.earliestStart, start);
      if (response.status === 416) throw new RingApiError(416, "No recording in range", NO_MEDIA_HELP, "MEDIA_NOT_FOUND");
      if (response.status === 503) throw new RingApiError(503, "Device offline", "Ring reports this device as offline, so it has no new images.");
      let media = response;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("Location");
        if (!location) await this.fail(response, "Snapshot redirect without Location");
        // Pre-signed, time-limited URL: no Authorization header.
        media = await fetch(new URL(location!, this.cfg.RING_API_BASE));
      }
      if (!media.ok) await this.fail(media, "Snapshot download failed");
      const contentType = media.headers.get("Content-Type") ?? "image/jpeg";
      const origin = (response.headers.get("X-Media-Origin") ?? media.headers.get("X-Media-Origin")) === "snapshot" ? "snapshot" : "recording";
      const timestamp = Number(response.headers.get("X-Media-Timestamp") ?? media.headers.get("X-Media-Timestamp"));
      return {
        deviceId,
        bytes: Buffer.from(await media.arrayBuffer()),
        mediaType: contentType.includes("png") ? "image/png" : "image/jpeg",
        capturedAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : now,
        origin,
      };
    }
  }

  async getClip(deviceId: string, startMs: number, durationMs: number): Promise<Buffer | null> {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const response = await this.request("POST", `/v1/devices/${encodeURIComponent(deviceId)}/media/video/download`, {
        json: { timestamp: startMs, duration: Math.min(durationMs, 900_000), audio_options: { audio_enabled: false } },
        accept: "video/mp4, application/json",
      });
      if (response.status === 200 || response.status === 206) return Buffer.from(await response.arrayBuffer());
      if ((response.status === 416 || response.status === 425) && Date.now() < deadline) {
        await sleep(5000);
        continue;
      }
      if (response.status === 416) return null;
      await this.fail(response, "Clip download failed");
    }
  }

  private async chimeConfig(chimeId: string) {
    const body = await this.getJson<{
      data?: { attributes?: { audio?: { customizable_slots?: { event: string; disabled?: boolean; audio_ref: string; audio_name?: string }[] } } };
    }>(`/v1/devices/${encodeURIComponent(chimeId)}/configurations`);
    return body.data?.attributes?.audio?.customizable_slots ?? [];
  }

  async listChimeSlots(chimeId: string): Promise<ChimeSlot[]> {
    return (await this.chimeConfig(chimeId)).map((slot) => ({ event: slot.event, name: slot.audio_name ?? null, disabled: !!slot.disabled }));
  }

  /** Plays the slot's sound. Ring chimes play pre-configured audio, so `message` is only used by the simulator. */
  async playChime(chimeId: string, slotEvent: string): Promise<void> {
    const status = await this.getJson<{ data?: { attributes?: { online?: boolean; audio?: { snooze?: { active?: boolean } } } } }>(
      `/v1/devices/${encodeURIComponent(chimeId)}/status`,
    );
    if (status.data?.attributes?.online === false) throw new RingApiError(503, "Chime offline", chimeId);
    if (status.data?.attributes?.audio?.snooze?.active) return; // respect the customer's snooze
    // audio_ref values can go stale, so look the slot up by event name every time.
    const slot = (await this.chimeConfig(chimeId)).find((s) => s.event === slotEvent && !s.disabled);
    if (!slot) throw new RingApiError(404, "Chime slot not found", `No enabled slot for event "${slotEvent}"`);
    const response = await this.request("POST", `/v1/devices/${encodeURIComponent(chimeId)}/media/audio/playback`, {
      json: { data: { type: "audio", attributes: { audio_ref: slot.audio_ref } } },
    });
    if (!response.ok) await this.fail(response, "Chime playback failed");
  }

  async getEventHistory(deviceId: string, limit = 20): Promise<HistoryEvent[]> {
    const events: HistoryEvent[] = [];
    let path: string | null = `/v1/history/devices/${encodeURIComponent(deviceId)}/events`;
    while (path && events.length < limit) {
      const body: { data?: JsonApiResource[]; links?: { next?: string | null } } = await this.getJson(path);
      for (const item of body.data ?? []) {
        const a = item.attributes ?? {};
        events.push({ id: item.id, eventType: String(a.event_type ?? "unknown"), start: Number(a.start), end: a.end == null ? null : Number(a.end) });
      }
      const next = body.links?.next;
      path = next ? (next.startsWith("http") ? next.slice(this.cfg.RING_API_BASE.length) : next) : null;
    }
    return events.slice(0, limit);
  }
}
