import { createHash, randomBytes } from "node:crypto";
import { decodePngRgba, preservedPixelsDigest } from "truesight-verify";
import type { EvidenceRecord, PixelRect, Sensor } from "../domain.js";
import type { SseHub } from "../notify/sse.js";
import type { FaceDetector } from "../privacy/faces.js";
import { decodeRgba, encodePng, expand, mosaic, normToPixel } from "../privacy/redact.js";
import type { Frame, RingClient } from "../ring/types.js";
import type { BlobStore } from "../storage/blobs.js";
import type { StateStore } from "../storage/state.js";
import type { Ledger } from "./ledger.js";

const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export interface EvidenceDeps {
  state: StateStore;
  ledger: Ledger;
  blobs: BlobStore;
  faces: FaceDetector;
  ring: RingClient;
  sse: SseHub;
  retentionDays: number;
}

/**
 * Turns the frame that triggered an alert into evidence:
 *  1. hash the original and sign that hash into the ledger (before any edit),
 *  2. redact faces and privacy zones with a mosaic,
 *  3. sign the redaction as an edit, including a digest of every untouched pixel,
 *  4. store the original under retention and the redacted copy for sharing.
 */
export class EvidenceService {
  constructor(private readonly deps: EvidenceDeps) {}

  async capture(frame: Frame, ctx: { sensor: Sensor; deviceName: string; triggerSeq: number; state: string }): Promise<EvidenceRecord> {
    const { ledger, blobs, state, faces } = this.deps;
    const id = `ev_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
    const originalSha256 = sha256(frame.bytes);
    const capturedAt = new Date(frame.capturedAt).toISOString();
    const retainUntil = new Date(Date.now() + this.deps.retentionDays * 86_400_000);

    const captured = await ledger.append("evidence.captured", {
      evidenceId: id,
      sensorId: ctx.sensor.id,
      sensorName: ctx.sensor.name,
      deviceId: frame.deviceId,
      capturedAt,
      origin: frame.origin,
      mediaType: frame.mediaType,
      originalSha256,
      triggerSeq: ctx.triggerSeq,
      definitionSeq: ctx.sensor.definitionSeq,
      retainUntil: retainUntil.toISOString(),
    });

    const image = await decodeRgba(frame.bytes);
    const { width, height } = image;
    const zones = (state.data.privacyZones[frame.deviceId] ?? [])
      .map((z) => normToPixel(z, width, height))
      .filter((r): r is PixelRect => !!r)
      .map((r) => ({ ...r, kind: "privacy_zone" as const }));
    const faceBoxes = (await faces.detect(frame.bytes))
      .map((f) => normToPixel(f, width, height))
      .map((r) => (r ? expand(r, 0.25, width, height) : null))
      .filter((r): r is PixelRect => !!r)
      .map((r) => ({ ...r, kind: "face" as const }));
    const regions = [...zones, ...faceBoxes];
    const rects = regions.map(({ x, y, w, h }) => ({ x, y, w, h }));

    const preserved = await preservedPixelsDigest(image, rects);
    const png = await encodePng(mosaic(image, rects));
    // Self-check: the shared PNG must reproduce the signed digest, or verification would fail later.
    if ((await preservedPixelsDigest(decodePngRgba(png), rects)) !== preserved) {
      throw new Error("Redaction self-check failed: encoded PNG does not preserve untouched pixels");
    }
    const redactedSha256 = sha256(png);

    const extension = frame.mediaType === "image/png" ? "png" : "jpg";
    const originalKey = `evidence/${id}/original.${extension}`;
    const redactedKey = `evidence/${id}/redacted.png`;
    await blobs.put(originalKey, frame.bytes, frame.mediaType, { retainUntil });
    await blobs.put(redactedKey, png, "image/png", { retainUntil });

    const redacted = await ledger.append("evidence.redacted", {
      evidenceId: id,
      originalSha256,
      redactedSha256,
      width,
      height,
      regions,
      preservedPixelsDigest: preserved,
      method: "mosaic",
    });

    const record: EvidenceRecord = {
      id,
      sensorId: ctx.sensor.id,
      sensorName: ctx.sensor.name,
      deviceId: frame.deviceId,
      deviceName: ctx.deviceName,
      state: ctx.state,
      question: ctx.sensor.question,
      capturedAt,
      originalKey,
      redactedKey,
      originalSha256,
      redactedSha256,
      width,
      height,
      regions,
      capturedSeq: captured.seq,
      redactedSeq: redacted.seq,
      triggerSeq: ctx.triggerSeq,
      definitionSeq: ctx.sensor.definitionSeq,
      clip: null,
      purgedAt: null,
    };
    state.update((s) => s.evidence.push(record));
    this.deps.sse.send("evidence", record);

    if (this.deps.ring.mode === "api") void this.attachClip(record, frame.capturedAt);
    return record;
  }

  /** Real Ring accounts: also preserve the recorded clip around the event (best effort). */
  private async attachClip(record: EvidenceRecord, atMs: number): Promise<void> {
    try {
      // Docs: wait for the range to finish recording, plus ~5s of processing.
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      const clip = await this.deps.ring.getClip(record.deviceId, atMs - 10_000, 20_000);
      if (!clip) return;
      const key = `evidence/${record.id}/clip.mp4`;
      const digest = sha256(clip);
      await this.deps.blobs.put(key, clip, "video/mp4", { retainUntil: new Date(Date.now() + this.deps.retentionDays * 86_400_000) });
      const entry = await this.deps.ledger.append("evidence.clip_attached", { evidenceId: record.id, sha256: digest, bytes: clip.length, startMs: atMs - 10_000, durationMs: 20_000 });
      this.deps.state.update(() => {
        record.clip = { key, sha256: digest, seq: entry.seq };
      });
      this.deps.sse.send("evidence", record);
    } catch (error) {
      console.warn(`[evidence] clip for ${record.id} unavailable: ${(error as Error).message}`);
    }
  }

  find(id: string): EvidenceRecord | undefined {
    return this.deps.state.data.evidence.find((e) => e.id === id);
  }

  async redactedImage(id: string): Promise<Buffer | null> {
    const record = this.find(id);
    return record ? this.deps.blobs.get(record.redactedKey) : null;
  }

  /** Viewing an unredacted original is always written to the ledger. */
  async originalImage(id: string, viewer: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
    const record = this.find(id);
    if (!record?.originalKey) return null;
    const bytes = await this.deps.blobs.get(record.originalKey);
    if (!bytes) return null;
    await this.deps.ledger.append("evidence.viewed", { evidenceId: id, variant: "original", viewer });
    return { bytes, mediaType: record.originalKey.endsWith(".png") ? "image/png" : "image/jpeg" };
  }

  /** Delete originals past their retention date (local storage; S3 uses lifecycle rules). */
  async purgeExpired(): Promise<number> {
    const cutoff = Date.now() - this.deps.retentionDays * 86_400_000;
    let purged = 0;
    for (const record of this.deps.state.data.evidence) {
      if (!record.originalKey || Date.parse(record.capturedAt) > cutoff) continue;
      try {
        await this.deps.blobs.delete(record.originalKey);
      } catch (error) {
        console.warn(`[evidence] could not purge ${record.id}: ${(error as Error).message}`);
        continue;
      }
      await this.deps.ledger.append("evidence.purged", { evidenceId: record.id, originalSha256: record.originalSha256, reason: "retention" });
      this.deps.state.update(() => {
        record.originalKey = null;
        record.purgedAt = new Date().toISOString();
      });
      purged++;
    }
    return purged;
  }
}
