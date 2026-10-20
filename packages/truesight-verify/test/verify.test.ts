import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import {
  BUNDLE_FORMAT,
  GENESIS_PREV,
  asEs256PublicJwk,
  base64Encode,
  canonicalize,
  createEntry,
  kidFor,
  preservedPixelsDigest,
  sha256Hex,
  signBundle,
  verifyBundle,
  verifyLedger,
  type EvidenceBundle,
  type LedgerEntry,
  type PixelRect,
  type SignFn,
} from "../src/index.js";

async function makeSigner() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = asEs256PublicJwk(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const sign: SignFn = async (data) =>
    new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data.slice().buffer));
  return { jwk, sign, kid: await kidFor("local", jwk) };
}

async function appendAll(sign: SignFn, kid: string, items: { type: string; data: Record<string, unknown> }[]) {
  const entries: LedgerEntry[] = [];
  for (const item of items) {
    const prev = entries.at(-1)?.hash ?? GENESIS_PREV;
    entries.push(
      await createEntry({ v: 1, seq: entries.length, ts: new Date(2026, 9, 20, 12, 0, entries.length).toISOString(), type: item.type, data: item.data, prev, kid }, sign),
    );
  }
  return entries;
}

function makeImage(width: number, height: number) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 7) % 256;
    rgba[i * 4 + 1] = (i * 13) % 256;
    rgba[i * 4 + 2] = (i * 31) % 256;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

async function makeBundle() {
  const { jwk, sign, kid } = await makeSigner();
  const original = makeImage(32, 24);
  const regions: PixelRect[] = [{ x: 4, y: 4, w: 8, h: 6 }];
  const preserved = await preservedPixelsDigest(original, regions);
  const redactedRgba = new Uint8Array(original.rgba);
  for (let y = 4; y < 10; y++) for (let x = 4; x < 12; x++) redactedRgba.fill(128, (y * 32 + x) * 4, (y * 32 + x) * 4 + 3);
  const png = encode({ width: 32, height: 24, data: redactedRgba, channels: 4, depth: 8 });
  const originalSha256 = await sha256Hex(original.rgba);
  const redactedSha256 = await sha256Hex(png);

  const ledger = await appendAll(sign, kid, [
    { type: "ledger.genesis", data: { app: "test" } },
    { type: "sensor.state_changed", data: { sensorId: "s1", from: "closed", to: "open", frameSha256: originalSha256 } },
    { type: "evidence.captured", data: { evidenceId: "e1", originalSha256, triggerSeq: 1 } },
    {
      type: "evidence.redacted",
      data: { evidenceId: "e1", originalSha256, redactedSha256, width: 32, height: 24, regions, preservedPixelsDigest: preserved },
    },
  ]);
  const head = ledger.at(-1)!;
  const bundle = await signBundle(
    {
      format: BUNDLE_FORMAT,
      bundleId: "b1",
      createdAt: new Date(2026, 9, 20).toISOString(),
      title: "Gate open",
      app: { name: "test", version: "0" },
      signer: { kid, alg: "ES256", publicJwk: jwk },
      subject: { evidenceId: "e1" },
      assets: [{ evidenceId: "e1", name: "redacted.png", mediaType: "image/png", sha256: redactedSha256, width: 32, height: 24, dataBase64: base64Encode(png) }],
      ledger,
      ledgerHead: { seq: head.seq, hash: head.hash },
    },
    sign,
  );
  return { bundle, jwk, sign, kid, png, ledger };
}

test("canonicalize sorts keys and drops undefined", () => {
  assert.equal(canonicalize({ b: 1, a: [true, undefined, "x"], c: undefined }), '{"a":[true,null,"x"],"b":1}');
  assert.throws(() => canonicalize({ n: Number.NaN }));
});

test("a freshly signed bundle verifies", async () => {
  const { bundle } = await makeBundle();
  const report = await verifyBundle(bundle);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.ok)));
});

test("bundle survives a JSON round trip", async () => {
  const { bundle } = await makeBundle();
  const report = await verifyBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(report.ok, true);
});

test("changing one byte of the image is detected", async () => {
  const { bundle, png } = await makeBundle();
  const tampered = structuredClone(bundle) as EvidenceBundle;
  const bytes = new Uint8Array(png);
  bytes[bytes.length - 20] ^= 0xff;
  tampered.assets[0]!.dataBase64 = base64Encode(bytes);
  const report = await verifyBundle(tampered);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((c) => c.id === "bundle-signature")?.ok, false);
  assert.equal(report.checks.find((c) => c.id === "asset-hash")?.ok, false);
});

test("re-signed bundle with altered pixels outside the redaction still fails", async () => {
  // An attacker who controls a different key can re-sign the file, but cannot
  // forge the original ledger entries, so the preserved-pixel check still fails.
  const { bundle, sign } = await makeBundle();
  const image = makeImage(32, 24);
  image.rgba[0] = 1; // outside the redacted region
  const png = encode({ width: 32, height: 24, data: image.rgba, channels: 4, depth: 8 });
  const { signature: _drop, ...unsigned } = structuredClone(bundle) as EvidenceBundle;
  unsigned.assets[0]!.dataBase64 = base64Encode(png);
  unsigned.assets[0]!.sha256 = await sha256Hex(png);
  const report = await verifyBundle(await signBundle(unsigned, sign));
  assert.equal(report.checks.find((c) => c.id === "bundle-signature")?.ok, true);
  assert.equal(report.checks.find((c) => c.id === "asset-hash")?.ok, false);
  assert.equal(report.checks.find((c) => c.id === "preserved-pixels")?.ok, false);
  assert.equal(report.ok, false);
});

test("preserved pixel digest ignores the redacted region only", async () => {
  const image = makeImage(16, 16);
  const regions = [{ x: 2, y: 2, w: 4, h: 4 }];
  const base = await preservedPixelsDigest(image, regions);
  const inside = { ...image, rgba: new Uint8Array(image.rgba) };
  inside.rgba[(3 * 16 + 3) * 4] = 99;
  assert.equal(await preservedPixelsDigest(inside, regions), base);
  const outside = { ...image, rgba: new Uint8Array(image.rgba) };
  outside.rgba[(10 * 16 + 10) * 4] = 99;
  assert.notEqual(await preservedPixelsDigest(outside, regions), base);
});

test("ledger verification catches edits, reordering and wrong keys", async () => {
  const { ledger, jwk } = await makeBundle();
  assert.equal((await verifyLedger(ledger, jwk, { requireGenesis: true })).ok, true);

  const edited = structuredClone(ledger);
  (edited[1]!.data as Record<string, unknown>).to = "closed";
  const editedReport = await verifyLedger(edited, jwk);
  assert.equal(editedReport.ok, false);
  assert.match(editedReport.problems.join(" "), /does not match its hash/);

  const other = await makeSigner();
  assert.equal((await verifyLedger(ledger, other.jwk)).ok, false);
});
