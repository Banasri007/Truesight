import sharp from "sharp";
import { clampRect, type RgbaImage } from "truesight-verify";
import type { NormRect, PixelRect } from "../domain.js";

/** Decode any image sharp understands into 8-bit sRGB RGBA. */
export async function decodeRgba(bytes: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Expected 4 channels after decoding, got ${info.channels}`);
  return { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

function rawInput(image: RgbaImage) {
  return sharp(Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  });
}

/** Lossless PNG. Pixels are written exactly as given, which the preserved-pixels proof relies on. */
export function encodePng(image: RgbaImage): Promise<Buffer> {
  return rawInput(image).png({ compressionLevel: 9, palette: false }).toBuffer();
}

export function encodeJpeg(image: RgbaImage, quality = 88): Promise<Buffer> {
  return rawInput(image).jpeg({ quality }).toBuffer();
}

export function normToPixel(rect: NormRect, width: number, height: number): PixelRect | null {
  return clampRect(
    { x: Math.round(rect.x * width), y: Math.round(rect.y * height), w: Math.round(rect.w * width), h: Math.round(rect.h * height) },
    width,
    height,
  );
}

/** Grow a rectangle by a fraction of its size on every side (face boxes are tight). */
export function expand(rect: PixelRect, fraction: number, width: number, height: number): PixelRect | null {
  const dx = Math.round(rect.w * fraction);
  const dy = Math.round(rect.h * fraction);
  return clampRect({ x: rect.x - dx, y: rect.y - dy, w: rect.w + 2 * dx, h: rect.h + 2 * dy }, width, height);
}

export function intersects(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Coarse mosaic inside each rectangle (returns a copy). Blocks are large
 * relative to the region, so faces and private areas are not recoverable.
 */
export function mosaic(image: RgbaImage, rects: PixelRect[]): RgbaImage {
  const out = new Uint8Array(image.rgba);
  const { width, height } = image;
  for (const raw of rects) {
    const r = clampRect(raw, width, height);
    if (!r) continue;
    const block = Math.max(12, Math.round(Math.min(r.w, r.h) / 5));
    for (let by = r.y; by < r.y + r.h; by += block) {
      for (let bx = r.x; bx < r.x + r.w; bx += block) {
        const x1 = Math.min(bx + block, r.x + r.w);
        const y1 = Math.min(by + block, r.y + r.h);
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (let y = by; y < y1; y++) {
          for (let x = bx; x < x1; x++) {
            const o = (y * width + x) * 4;
            sr += out[o]!;
            sg += out[o + 1]!;
            sb += out[o + 2]!;
            n++;
          }
        }
        const cr = Math.round(sr / n);
        const cg = Math.round(sg / n);
        const cb = Math.round(sb / n);
        for (let y = by; y < y1; y++) {
          for (let x = bx; x < x1; x++) {
            const o = (y * width + x) * 4;
            out[o] = cr;
            out[o + 1] = cg;
            out[o + 2] = cb;
            out[o + 3] = 255;
          }
        }
      }
    }
  }
  return { width, height, rgba: out };
}

export function crop(image: RgbaImage, r: PixelRect): RgbaImage {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const start = ((r.y + y) * image.width + r.x) * 4;
    out.set(image.rgba.subarray(start, start + r.w * 4), y * r.w * 4);
  }
  return { width: r.w, height: r.h, rgba: out };
}
