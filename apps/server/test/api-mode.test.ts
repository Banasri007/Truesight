import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/http/app.js";
import type { AppContext } from "../src/http/context.js";

// Real-Ring mode with no account linked yet. Nothing here reaches Ring's servers.
let dir: string;
let server: Server;
let base: string;
let ctx: AppContext;
const TOKEN = "test-admin-token";

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "truesight-api-"));
  const cfg = loadConfig({
    DATA_DIR: dir,
    RING_MODE: "api",
    RING_CLIENT_ID: "client",
    RING_CLIENT_SECRET: "secret",
    RING_HMAC_KEY: "hmac",
    ADMIN_TOKEN: TOKEN,
    PUBLIC_BASE_URL: "https://example.test",
  });
  ({ ctx } = await bootstrap(cfg));
  server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await ctx.engine.stop();
  ctx.sse.close();
  await ctx.state.flush();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("an unlinked Ring account is 409 from Ring, not a 401 that signs the owner out", async () => {
  const signedIn = await fetch(`${base}/api/devices`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(signedIn.status, 409);
  const body = (await signedIn.json()) as { source: string; notLinked: boolean };
  assert.equal(body.source, "ring");
  assert.equal(body.notLinked, true);

  const anonymous = await fetch(`${base}/api/devices`);
  assert.equal(anonymous.status, 401);
});

test("a Playground access token works without app credentials", async () => {
  const cfg = loadConfig({ DATA_DIR: join(dir, "playground"), RING_MODE: "api", RING_ACCESS_TOKEN: "playground-token" });
  const { ctx: pg } = await bootstrap(cfg);
  assert.equal(await pg.auth!.accessToken(), "playground-token");
  assert.deepEqual({ linked: pg.auth!.status().linked, method: pg.auth!.status().method }, { linked: true, method: "playground" });
  await assert.rejects(pg.auth!.forceRefresh(), /Playground token expired/);
  await pg.engine.stop();
  pg.sse.close();
  await pg.state.flush();

  assert.throws(() => loadConfig({ RING_MODE: "api" }), /RING_CLIENT_ID is required/);
  assert.throws(() => loadConfig({ RING_MODE: "api", RING_ACCESS_TOKEN: "a", RING_REFRESH_TOKEN: "b" }), /not both/);
});

test("snapshots shrink the time window when Ring says it predates consent", async () => {
  const express = (await import("express")).default;
  const consentAt = Date.now() - 5 * 60_000; // linked five minutes ago
  const starts: number[] = [];
  const fake = express();
  // Ring's clock runs 30s behind this machine (seen on a real dev PC), and Ring rejects future timestamps.
  const ringClock = () => Date.now() - 30_000;
  fake.use((_req, res, next) => {
    res.set("Date", new Date(ringClock()).toUTCString());
    next();
  });
  fake.post("/v1/devices/:id/media/image/download", express.json(), (req, res) => {
    const body = req.body as { start_timestamp: number; end_timestamp?: number };
    if ((body.end_timestamp ?? 0) > ringClock() || body.start_timestamp > ringClock()) {
      res.status(400).json({ errors: [{ status: "400", code: "INVALID_PAYLOAD", detail: "end_timestamp cannot be in the future" }] });
      return;
    }
    const start = Number(body.start_timestamp);
    starts.push(start);
    if (start < consentAt) {
      res.status(403).json({ errors: [{ status: "403", code: "TIME_RANGE_NOT_AUTHORIZED", detail: "Requested time range is not within authorized boundaries" }] });
      return;
    }
    res.redirect(303, "/media/frame.jpg");
  });
  fake.get("/media/frame.jpg", (_req, res) => res.type("image/jpeg").set("X-Media-Origin", "recording").send(Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
  const fakeServer = fake.listen(0);
  await new Promise((resolve) => fakeServer.once("listening", resolve));
  const ringBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  const cfg = loadConfig({ DATA_DIR: join(dir, "window"), RING_MODE: "api", RING_ACCESS_TOKEN: "t", RING_API_BASE: ringBase });
  const { ctx: c } = await bootstrap(cfg);
  try {
    const frame = await c.ring.getSnapshot("cam-1");
    assert.equal(frame.bytes.length, 4);
    assert.ok(starts.length >= 2 && starts[0]! < consentAt && starts.at(-1)! >= consentAt, `starts: ${starts.join(",")}`);
    // The learned boundary is reused: the next request starts inside the consent window right away.
    const before = starts.length;
    await c.ring.getSnapshot("cam-1");
    assert.equal(starts.length, before + 1);
  } finally {
    await c.engine.stop();
    c.sse.close();
    await c.state.flush();
    await new Promise((resolve) => fakeServer.close(resolve));
  }
});

test("event-history polling stands in for webhooks with a Playground token", async () => {
  const express = (await import("express")).default;
  const history: { id: string; type: string; attributes: Record<string, unknown> }[] = [
    { id: "old-1", type: "history-events", attributes: { event_type: "on_demand", start: Date.now() - 120_000, end: Date.now() - 80_000 } },
  ];
  const fake = express();
  fake.get("/v1/devices", (_req, res) =>
    res.json({
      data: [{ id: "cam-1", type: "devices", attributes: { name: "Playground Device" }, relationships: { capabilities: { data: { type: "device-capabilities", id: "c1" } } } }],
      included: [{ id: "c1", type: "device-capabilities", attributes: { video: {} } }],
    }),
  );
  fake.get("/v1/history/devices/:id/events", (_req, res) => res.json({ data: history, links: {} }));
  const fakeServer = fake.listen(0);
  await new Promise((resolve) => fakeServer.once("listening", resolve));
  const ringBase = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`;

  const cfg = loadConfig({ DATA_DIR: join(dir, "history"), RING_MODE: "api", RING_ACCESS_TOKEN: "t", RING_API_BASE: ringBase });
  const { ctx: c } = await bootstrap(cfg, { eventSnapshotDelayMs: 60_000 });
  try {
    assert.ok(c.historyPoller, "polling is on automatically with a Playground token");
    assert.equal(await c.historyPoller!.poll(), 0, "first pass only records what already exists");
    history.unshift({ id: "new-1", type: "history-events", attributes: { event_type: "on_demand", start: Date.now() - 40_000, end: Date.now() - 1_000 } });
    assert.equal(await c.historyPoller!.poll(), 1);
    assert.equal(await c.historyPoller!.poll(), 0, "each event triggers once");
    const event = c.state.data.ringEvents.find((e) => e.id === "new-1");
    assert.equal(event?.type, "history.on_demand");
    assert.equal((await c.ledger.get(event!.ledgerSeq))?.data.source, "event-history");
  } finally {
    c.historyPoller?.stop();
    await c.engine.stop();
    c.sse.close();
    await c.state.flush();
    await new Promise((resolve) => fakeServer.close(resolve));
  }
});

test("the webhook URL answers a reachability GET", async () => {
  assert.equal((await fetch(`${base}/webhooks/ring`)).status, 200);
});

test("the Account Link URL carries its own sign-in form", async () => {
  const time = String(Date.now());
  const page = await fetch(`${base}/auth/ring/link?nonce=abc&time=${time}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /name="token"/);

  const stale = await fetch(`${base}/auth/ring/link?nonce=abc&time=${Date.now() - 3_600_000}`);
  assert.equal(stale.status, 400);

  const form = (token: string) => new URLSearchParams({ nonce: "abc", time, token });
  const wrong = await fetch(`${base}/auth/ring/link/confirm`, { method: "POST", body: form("nope") });
  assert.equal(wrong.status, 401);

  // Right token: signs in (cookie), then linking fails cleanly because Ring never sent a code.
  const right = await fetch(`${base}/auth/ring/link/confirm`, { method: "POST", body: form(TOKEN), redirect: "manual" });
  assert.equal(right.status, 404);
  assert.match(right.headers.get("set-cookie") ?? "", /truesight_admin=/);
  assert.match(await right.text(), /has not delivered a token/);
});
