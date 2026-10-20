/**
 * Small WebCrypto helpers. WebCrypto exists in modern browsers and in Node 20+,
 * so everything here is isomorphic.
 */
import { canonicalize } from "./canonical.js";

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto (crypto.subtle) is not available in this runtime");
  return s;
}

/** Copy into a fresh ArrayBuffer so WebCrypto typings and detached views are never an issue. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", toArrayBuffer(data)));
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await sha256(data));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}==`;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}${B64[(n >> 6) & 63]!}=`;
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const base64UrlDecode = base64Decode;

/** An EC P-256 public key as a JSON Web Key. */
export interface Es256PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export function asEs256PublicJwk(jwk: unknown): Es256PublicJwk {
  const k = jwk as Partial<Es256PublicJwk> | null;
  if (!k || k.kty !== "EC" || k.crv !== "P-256" || typeof k.x !== "string" || typeof k.y !== "string") {
    throw new Error("Expected an EC P-256 public JWK");
  }
  return { kty: "EC", crv: "P-256", x: k.x, y: k.y };
}

/** RFC 7638 JWK thumbprint (base64url SHA-256 over the required members). */
export async function jwkThumbprint(jwk: Es256PublicJwk): Promise<string> {
  const required = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return base64UrlEncode(await sha256(utf8(canonicalize(required))));
}

export async function importEs256PublicKey(jwk: Es256PublicJwk): Promise<CryptoKey> {
  return subtle().importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

/** Verify an ES256 signature in IEEE P1363 (r || s, 64 bytes) form, which is what JOSE and WebCrypto use. */
export async function verifyEs256(key: CryptoKey, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  if (signature.byteLength !== 64) return false;
  return subtle().verify({ name: "ECDSA", hash: "SHA-256" }, key, toArrayBuffer(signature), toArrayBuffer(data));
}
