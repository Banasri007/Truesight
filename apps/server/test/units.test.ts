import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { decodePngRgba, preservedPixelsDigest } from "witness-verify";
import { decodeRgba, encodePng, mosaic } from "../src/privacy/redact.js";
import { derToP1363 } from "../src/proof/signer.js";
import { renderSideYard } from "../src/ring/simulator/scenes.js";
import { signWebhookBody, verifyWebhookSignature } from "../src/ring/webhook.js";
import { applyGuardrails, GENERIC_OBSERVATION } from "../src/vision/guardrails.js";
import { MockVision } from "../src/vision/mock.js";
import sharp from "sharp";

test("webhook HMAC: accepts Ring's sha256=<hex> format and rejects tampering", () => {
  const body = Buffer.from('{"meta":{"request_id":"r1"},"data":{"id":"e1","type":"motion_detected"}}');
  const header = signWebhookBody(body, "secret");
  assert.match(header, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature(body, header, "secret"), true);
  assert.equal(verifyWebhookSignature(Buffer.from(body.toString().replace("r1", "r2")), header, "secret"), false);
  assert.equal(verifyWebhookSignature(body, header, "other-key"), false);
  assert.equal(verifyWebhookSignature(body, undefined, "secret"), false);
  assert.equal(verifyWebhookSignature(body, "sha256=zz", "secret"), false);
});

test("redaction keeps every untouched pixel bit-identical through PNG encoding", async () => {
  const svg = renderSideYard({ gate: "open", bins: "curb", night: false }, "Side Yard", new Date(0));
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  const image = await decodeRgba(jpeg);
  const regions = [
    { x: 100, y: 120, w: 200, h: 150 },
    { x: 900, y: 500, w: 500, h: 400 }, // extends past the edge; must be clamped consistently
  ];
  const signed = await preservedPixelsDigest(image, regions);
  const png = await encodePng(mosaic(image, regions));
  const decoded = decodePngRgba(png);
  assert.equal(decoded.width, image.width);
  assert.equal(await preservedPixelsDigest(decoded, regions), signed);
  assert.notEqual(await preservedPixelsDigest(decoded, []), await preservedPixelsDigest(image, []), "mosaic must change pixels inside regions");
});

test("KMS DER signatures convert to verifiable P1363", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const data = Buffer.from("witness");
  for (let i = 0; i < 20; i++) {
    const der = sign("sha256", data, createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" })));
    const p1363 = derToP1363(der);
    assert.equal(p1363.length, 64);
    assert.equal(verify("sha256", data, { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, p1363), true);
  }
});

test("guardrails: unknown labels, percentages and sensitive descriptions", () => {
  const states = ["open", "closed"];
  assert.equal(applyGuardrails({ state: "ajar", confidence: 0.9, observation: "x" }, states).state, "unknown");
  assert.equal(applyGuardrails({ state: "OPEN", confidence: 87, observation: "Gate swung in." }, states).confidence, 0.87);
  const blocked = applyGuardrails({ state: "open", confidence: 0.9, observation: "A suspicious man is near the gate." }, states);
  assert.equal(blocked.observation, GENERIC_OBSERVATION);
  assert.match(blocked.guardrail ?? "", /blocked term/);
  // Colors of objects are fine.
  assert.equal(applyGuardrails({ state: "open", confidence: 0.9, observation: "A white van is parked." }, states).guardrail, null);
});

test("mock vision maps simulator truth onto the owner's own labels", async () => {
  const mock = new MockVision();
  const ask = (question: string, states: string[], simTruth: Record<string, string | boolean>) =>
    mock.ask({ image: Buffer.alloc(0), mediaType: "image/jpeg", question, states, simTruth });
  assert.equal((await ask("Is the side gate latched?", ["latched", "open"], { gate: "closed" })).state, "latched");
  assert.equal((await ask("Is the side gate latched?", ["latched", "open"], { gate: "open" })).state, "open");
  assert.equal((await ask("Are the bins out at the curb?", ["at curb", "in yard"], { bins: "curb" })).state, "at curb");
  assert.equal((await ask("Is there a package?", ["yes", "no"], { package: false })).state, "no");
  assert.equal((await ask("Is the pool cover on?", ["on", "off"], { gate: "open" })).state, "unknown");
});
