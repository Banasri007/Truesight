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
