import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ring signs every webhook with HMAC-SHA256 over the raw body bytes and sends
 * `X-Signature: sha256=<hex digest>`. Verify before parsing; re-serialized JSON
 * would not match.
 */
export function signWebhookBody(rawBody: Buffer | string, hmacKey: string): string {
  return `sha256=${createHmac("sha256", hmacKey).update(rawBody).digest("hex")}`;
}

export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, hmacKey: string): boolean {
  if (!header) return false;
  const received = header.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", hmacKey).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex"));
}

/** Envelope shared by every Ring webhook (meta + JSON:API-style data). */
export interface RingWebhook {
  meta: { version?: string; time?: string; request_id: string; account_id?: string };
  data: {
    id: string;
    type: string;
    attributes: {
      source?: string;
      source_type?: string;
      timestamp?: number;
      sub_type?: string;
      component_ids?: string[];
      [key: string]: unknown;
    };
    relationships?: Record<string, unknown>;
  };
}

export function parseWebhook(rawBody: Buffer): RingWebhook {
  const body = JSON.parse(rawBody.toString("utf8")) as Partial<RingWebhook>;
  if (!body?.meta?.request_id || !body.data?.type || !body.data.id) {
    throw new Error("Webhook is missing meta.request_id, data.id or data.type");
  }
  return { meta: body.meta, data: { ...body.data, attributes: body.data.attributes ?? {} } } as RingWebhook;
}

/** Webhook types that mean "something moved or happened in front of a camera". */
export const CAMERA_ACTIVITY_EVENTS = new Set(["motion_detected", "button_press"]);

/** Sensor detections that can corroborate a virtual sensor. */
export const SENSOR_EVENTS = new Set([
  "contact_sensor_faulted",
  "contact_sensor_cleared",
  "tamper_detected",
  "tamper_cleared",
  "flood_detected",
  "flood_cleared",
  "freeze_detected",
  "freeze_cleared",
  "temperature_exceeded",
  "temperature_cleared",
  "humidity_exceeded",
  "humidity_cleared",
  "pm25_exceeded",
  "pm25_cleared",
  "co_exceeded",
  "co_cleared",
]);
