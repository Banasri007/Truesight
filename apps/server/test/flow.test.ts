import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asEs256PublicJwk, verifyBundle, verifyLedger, type EvidenceBundle, type LedgerEntry } from "witness-verify";
import { bootstrap } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import type { Sensor } from "../src/domain.js";
import type { AppContext } from "../src/http/context.js";
import { createApp } from "../src/http/app.js";
import { SIM } from "../src/ring/simulator/simulator.js";
import { signWebhookBody } from "../src/ring/webhook.js";

let dir: string;
let server: Server;
let base: string;
let ctx: AppContext;

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
};

async function waitFor<T>(what: string, probe: () => Promise<T | undefined> | T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "witness-test-"));
  const cfg = loadConfig({ DATA_DIR: dir, PORT: "8787", RING_MODE: "simulator", VISION_PROVIDER: "mock" });
  const booted = await bootstrap(cfg, { eventSnapshotDelayMs: 10, confirmDelayMs: 50 });
  ctx = booted.ctx;
  server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  booted.setPort(port);
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await ctx.engine.stop();
  ctx.sse.close();
  await ctx.state.flush();
  await ctx.simulator?.flush();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("rejects webhooks with a bad signature", async () => {
  const body = JSON.stringify({ meta: { request_id: "x" }, data: { id: "e", type: "motion_detected", attributes: {} } });
  const bad = await fetch(`${base}/webhooks/ring`, { method: "POST", headers: { "X-Signature": signWebhookBody(body, "wrong-key") }, body });
  assert.equal(bad.status, 401);
});

test("teach -> alert -> signed, redacted evidence -> verifiable bundle", async () => {
  // A privacy zone over the neighbor's side of the frame.
  await api(`/api/devices/${SIM.side}/privacy-zones`, { method: "PUT", body: JSON.stringify([{ x: 0, y: 0.35, w: 0.2, h: 0.5 }]) });

  const sensor = await api<Sensor>("/api/sensors", {
    method: "POST",
    body: JSON.stringify({
      name: "Side gate",
      deviceId: SIM.side,
      question: "Is the side gate latched or open?",
      region: { x: 0.35, y: 0.35, w: 0.3, h: 0.5 },
      states: ["latched", "open"],
      alertStates: ["open"],
      debounce: 2,
      actions: { notify: true, chime: { deviceId: SIM.chime, slotEvent: "witness_alert" } },
      corroboratingDeviceIds: [SIM.gateContact],
    }),
  });

  // Creating a sensor runs a first check, which sets the baseline.
  await waitFor("baseline", () => (ctx.engine.get(sensor.id)?.current?.state === "latched" ? true : undefined));

  // Open the gate: the simulator sends signed contact + motion webhooks, the engine debounces and alerts.
  await api(`/api/sim/scene/${SIM.side}`, { method: "POST", body: JSON.stringify({ patch: { gate: "open" }, autoMotion: true }) });
  const evidence = await waitFor("evidence", () => ctx.state.data.evidence.find((e) => e.sensorId === sensor.id));
  assert.equal(evidence.state, "open");
  assert.equal(ctx.engine.get(sensor.id)?.current?.state, "open");
  assert.ok(evidence.regions.some((r) => r.kind === "privacy_zone"), "privacy zone is redacted in evidence");

  // Ring events were recorded in the ledger.
  assert.ok(ctx.state.data.ringEvents.some((e) => e.type === "contact_sensor_faulted"));
  assert.ok(ctx.state.data.ringEvents.some((e) => e.type === "motion_detected"));

  // Privacy receipts exist and say what the AI saw.
  const receipts = await api<{ sensorId: string; regionAreaPct: number; retainedAsEvidence: string | null }[]>("/api/receipts");
  assert.ok(receipts.some((r) => r.sensorId === sensor.id && r.retainedAsEvidence === evidence.id));
  assert.ok(receipts.every((r) => r.regionAreaPct > 0 && r.regionAreaPct < 100));

  // Export and verify the bundle exactly as a third party would.
  const bundle = await api<EvidenceBundle>(`/api/evidence/${evidence.id}/export`, { method: "POST" });
  const report = await verifyBundle(bundle);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.ok), null, 2));
  assert.ok(report.checks.find((c) => c.id === "trigger-link")?.ok, "bundle links evidence to the triggering state change");

  // Tamper with one pixel byte of the image: verification fails.
  const tampered = structuredClone(bundle);
  const b64 = tampered.assets[0]!.dataBase64;
  tampered.assets[0]!.dataBase64 = (b64[100] === "A" ? "B" : "A") + b64.slice(1);
  assert.equal((await verifyBundle(tampered)).ok, false);

  // Whole-ledger verification from genesis.
  const entries = await api<LedgerEntry[]>("/api/ledger/all");
  const signer = await api<{ publicJwk: unknown }>("/api/public/signer");
  const ledgerReport = await verifyLedger(entries, asEs256PublicJwk(signer.publicJwk), { requireGenesis: true });
  assert.equal(ledgerReport.ok, true, ledgerReport.problems.join("\n"));
  const types = new Set(entries.map((e) => e.type));
  for (const type of ["ledger.genesis", "sensor.created", "privacy.zones_updated", "ring.event", "sensor.state_changed", "evidence.captured", "evidence.redacted", "evidence.exported"]) {
    assert.ok(types.has(type), `ledger has ${type}`);
  }

  // Closing the gate resolves the alert without capturing new evidence.
  await api(`/api/sim/scene/${SIM.side}`, { method: "POST", body: JSON.stringify({ patch: { gate: "closed" }, autoMotion: true }) });
  await waitFor("resolved", () => (ctx.engine.get(sensor.id)?.current?.state === "latched" ? true : undefined));
  assert.equal(ctx.state.data.evidence.filter((e) => e.sensorId === sensor.id).length, 1);
});

test("viewing an unredacted original is written to the ledger", async () => {
  const evidence = ctx.state.data.evidence[0]!;
  const before = ctx.ledger.head().seq;
  const response = await fetch(`${base}/api/evidence/${evidence.id}/original`);
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const viewed = (await ctx.ledger.range(before + 1, ctx.ledger.head().seq)).find((e) => e.type === "evidence.viewed");
  assert.equal(viewed?.data.evidenceId, evidence.id);
});

test("sensor definitions are validated", async () => {
  const response = await fetch(`${base}/api/sensors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bad", deviceId: SIM.side, question: "Is it?", region: { x: 0.9, y: 0, w: 0.5, h: 0.5 }, states: ["a", "a"], alertStates: ["b"] }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { issues: { path: string }[] };
  const paths = body.issues.map((i) => i.path);
  assert.ok(paths.includes("states") && paths.includes("alertStates") && paths.includes("region"));
});
