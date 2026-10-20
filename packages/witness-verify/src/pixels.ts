import { decode } from "fast-png";
import { sha256Hex, utf8 } from "./crypto.js";

/** Integer pixel rectangle; covers columns x..x+w-1 and rows y..y+h-1. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  /** 8-bit RGBA, row-major, length = width * height * 4. */
  rgba: Uint8Array;
}

/** Clamp a rectangle to the image bounds. Returns null if nothing is left. */
export function clampRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.floor(rect.x) + Math.floor(rect.w));
  const y1 = Math.min(height, Math.floor(rect.y) + Math.floor(rect.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Copy of the pixels with every pixel inside any region set to transparent black. */
export function zeroRegions(image: RgbaImage, regions: PixelRect[]): Uint8Array {
  const out = new Uint8Array(image.rgba);
  for (const region of regions) {
    const r = clampRect(region, image.width, image.height);
    if (!r) continue;
    for (let y = r.y; y < r.y + r.h; y++) {
      out.fill(0, (y * image.width + r.x) * 4, (y * image.width + r.x + r.w) * 4);
    }
  }
  return out;
}

/**
 * Digest of every pixel OUTSIDE the redaction regions.
 *
 * Computed by the server from the original frame at redaction time and signed
 * into the ledger. Anyone holding only the redacted PNG can recompute it: if
 * it matches, the redaction changed nothing except the declared regions.
 */
export async function preservedPixelsDigest(image: RgbaImage, regions: PixelRect[]): Promise<string> {
  const header = utf8(`witness.pixels/1:${image.width}x${image.height}:`);
  const body = zeroRegions(image, regions);
  const data = new Uint8Array(header.length + body.length);
  data.set(header, 0);
  data.set(body, header.length);
  return sha256Hex(data);
}

/** Decode an 8-bit PNG into RGBA. */
export function decodePngRgba(bytes: Uint8Array): RgbaImage {
  const png = decode(bytes);
  if (png.depth !== 8) throw new Error(`Unsupported PNG bit depth ${png.depth}; expected 8`);
  if (png.palette) throw new Error("Palette PNGs are not supported; expected truecolor");
  const { width, height, channels } = png;
  const src = png.data as Uint8Array;
  if (channels === 4) return { width, height, rgba: new Uint8Array(src) };

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const o = i * 4;
    if (channels === 3) {
      rgba[o] = src[p]!;
      rgba[o + 1] = src[p + 1]!;
      rgba[o + 2] = src[p + 2]!;
      rgba[o + 3] = 255;
    } else if (channels === 2) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = src[p]!;
      rgba[o + 3] = src[p + 1]!;
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = src[p]!;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba };
}
