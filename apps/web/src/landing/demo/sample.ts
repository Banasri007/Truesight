import { encode } from "fast-png";
import {
  BUNDLE_FORMAT,
  GENESIS_PREV,
  asEs256PublicJwk,
  base64Encode,
  createEntry,
  kidFor,
  preservedPixelsDigest,
  sha256Hex,
  signBundle,
  type EvidenceBundle,
  type LedgerEntry,
  type SignFn,
} from "truesight-verify";
import { FACE, REGION, ZONE, mosaic, rasterize, yardSvg } from "./yard";

/**
 * Build a real evidence bundle entirely in the browser: a fresh ES256 key,
 * a hash-chained ledger, a redacted PNG with a preserved-pixels digest, and
 * a bundle signature. The landing page then verifies it with the same
 * open-source verifier the console uses.
 */
export async function makeSampleBundle(): Promise<EvidenceBundle> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = asEs256PublicJwk(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const kid = await kidFor("demo", publicJwk);
  const sign: SignFn = async (data) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data.slice().buffer));

  const original = await rasterize(yardSvg({ gate: "open", person: true }));
  const originalPng = encode({ width: original.width, height: original.height, data: original.rgba, channels: 4, depth: 8 });
  const regions = [
    { ...ZONE, kind: "privacy_zone" },
    { x: FACE.x - 8, y: FACE.y - 8, w: FACE.w + 16, h: FACE.h + 16, kind: "face" },
  ];
  const rects = regions.map(({ x, y, w, h }) => ({ x, y, w, h }));
  const preserved = await preservedPixelsDigest(original, rects);
  const redactedPng = encode({ width: original.width, height: original.height, data: mosaic(original, rects), channels: 4, depth: 8 });
  const originalSha256 = await sha256Hex(originalPng);
  const redactedSha256 = await sha256Hex(redactedPng);

  const evidenceId = "ev_demo_gate";
  const t0 = Date.now() - 60_000;
  const items: { type: string; data: Record<string, unknown> }[] = [
    { type: "ledger.genesis", data: { app: "TrueSight", version: "demo", kid, publicJwk } },
    {
      type: "sensor.created",
      data: { sensorId: "sen_gate", definition: { name: "Side gate", question: "Is the side gate latched shut, or is it open?", states: ["latched", "open"], alertStates: ["open"], region: REGION } },
    },
    { type: "ring.event", data: { type: "contact_sensor_faulted", deviceId: "contact-gate", signatureVerified: true } },
    {
      type: "sensor.state_changed",
      data: { sensorId: "sen_gate", sensorName: "Side gate", from: "latched", to: "open", confidence: 0.93, trigger: "confirm", frameSha256: originalSha256 },
    },
    { type: "evidence.captured", data: { evidenceId, sensorId: "sen_gate", originalSha256, triggerSeq: 3, definitionSeq: 1 } },
    {
      type: "evidence.redacted",
      data: { evidenceId, originalSha256, redactedSha256, width: original.width, height: original.height, regions, preservedPixelsDigest: preserved, method: "mosaic" },
    },
    { type: "evidence.exported", data: { evidenceId, format: BUNDLE_FORMAT, redactedSha256, exportedBy: "landing-demo" } },
  ];
  const ledger: LedgerEntry[] = [];
  for (const [seq, item] of items.entries()) {
    ledger.push(
      await createEntry({ v: 1, seq, ts: new Date(t0 + seq * 4000).toISOString(), type: item.type, data: item.data, prev: ledger.at(-1)?.hash ?? GENESIS_PREV, kid }, sign),
    );
  }
  const head = ledger.at(-1)!;

  return signBundle(
    {
      format: BUNDLE_FORMAT,
      bundleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      title: "Side gate: open",
      app: { name: "TrueSight", version: "demo", mode: "landing" },
      signer: { kid, alg: "ES256", publicJwk },
      subject: {
        evidenceId,
        sensorId: "sen_gate",
        sensorName: "Side gate",
        question: "Is the side gate latched shut, or is it open?",
        deviceId: "side-yard",
        deviceName: "Side Yard (demo)",
        state: "open",
        capturedAt: new Date(t0 + 12_000).toISOString(),
      },
      assets: [{ evidenceId, name: "redacted.png", mediaType: "image/png", sha256: redactedSha256, width: original.width, height: original.height, dataBase64: base64Encode(redactedPng) }],
      ledger,
      ledgerHead: { seq: head.seq, hash: head.hash },
    },
    sign,
  );
}
