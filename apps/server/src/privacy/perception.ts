import { createHash } from "node:crypto";
import sharp from "sharp";
import type { NormRect, PixelRect } from "../domain.js";
import type { Frame } from "../ring/types.js";
import type { FaceDetector } from "./faces.js";
import { crop, decodeRgba, encodeJpeg, expand, intersects, mosaic, normToPixel } from "./redact.js";

export interface PerceptionImage {
  /** The only pixels the AI ever sees. */
  aiView: Buffer;
  frameSha256: string;
  aiViewSha256: string;
  frameSize: { width: number; height: number };
  regionAreaPct: number;
  privacyZonesApplied: number;
  facesBlurred: number;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Vision models handle ~1568px on the long edge well; upscale tiny crops so detail is legible. */
const MAX_EDGE = 1568;
const MIN_EDGE = 448;

/**
 * Data minimization for every AI call:
 *  1. privacy zones are mosaicked on the full frame,
 *  2. the frame is cropped to the owner's region,
 *  3. faces inside the crop are found and mosaicked,
 *  4. only that crop is encoded and handed to the vision model.
 */
export async function preparePerception(frame: Frame, region: NormRect, zones: NormRect[], faces: FaceDetector): Promise<PerceptionImage> {
  const image = await decodeRgba(frame.bytes);
  const { width, height } = image;
  const regionPx = normToPixel(region, width, height);
  if (!regionPx) throw new Error("Sensor region is outside the frame");

  const zonePx = zones.map((z) => normToPixel(z, width, height)).filter((r): r is PixelRect => !!r);
  const zonesInCrop = zonePx.filter((z) => intersects(z, regionPx));
  let cropped = crop(mosaic(image, zonesInCrop), regionPx);

  let facesBlurred = 0;
  const found = await faces.detect(await encodeJpeg(cropped, 90));
  if (found.length > 0) {
    const faceRects = found
      .map((f) => normToPixel(f, cropped.width, cropped.height))
      .map((r) => (r ? expand(r, 0.25, cropped.width, cropped.height) : null))
      .filter((r): r is PixelRect => !!r);
    facesBlurred = faceRects.length;
    cropped = mosaic(cropped, faceRects);
  }

  let aiView = await encodeJpeg(cropped, 90);
  const longEdge = Math.max(cropped.width, cropped.height);
  if (longEdge > MAX_EDGE || longEdge < MIN_EDGE) {
    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : MIN_EDGE / longEdge;
    aiView = await sharp(aiView)
      .resize(Math.round(cropped.width * scale), Math.round(cropped.height * scale), { kernel: "lanczos3" })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  return {
    aiView,
    frameSha256: sha256(frame.bytes),
    aiViewSha256: sha256(aiView),
    frameSize: { width, height },
    regionAreaPct: Math.round(((regionPx.w * regionPx.h) / (width * height)) * 1000) / 10,
    privacyZonesApplied: zonesInCrop.length,
    facesBlurred,
  };
}
