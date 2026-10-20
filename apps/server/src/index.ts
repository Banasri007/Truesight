import type { AddressInfo } from "node:net";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { createApp } from "./http/app.js";
import { APP_NAME, APP_VERSION } from "./version.js";

const cfg = loadConfig();
const { ctx, setPort } = await bootstrap(cfg);
const app = createApp(ctx);

const server = app.listen(cfg.PORT, () => {
  const port = (server.address() as AddressInfo).port;
  setPort(port);
  const lines = [
    `${APP_NAME} v${APP_VERSION}`,
    `  Server           http://localhost:${port}${process.env.npm_lifecycle_event === "dev" ? "  (dashboard: http://localhost:5173)" : ""}`,
    `  Ring             ${cfg.RING_MODE === "simulator" ? "simulator (no Ring account needed)" : `Ring API ${cfg.RING_API_BASE}`}`,
    `  Webhook URL      ${cfg.PUBLIC_BASE_URL}/webhooks/ring`,
    `  Vision           ${ctx.vision.name} (${ctx.vision.model})`,
    `  Faces            ${ctx.faces.name}`,
    `  Signer           ${ctx.signer.kid}`,
    `  Ledger           ${ctx.ledger.store.description}, head #${ctx.ledger.head().seq}`,
    `  Evidence store   ${ctx.blobs.description}`,
    cfg.ADMIN_TOKEN ? "  Access           ADMIN_TOKEN required" : "  Access           open (set ADMIN_TOKEN before exposing this server)",
  ];
  console.log(lines.join("\n"));
});

ctx.engine.start();
const purge = setInterval(() => {
  ctx.evidence.purgeExpired().catch((error: unknown) => console.error("[purge]", error));
}, 3_600_000);
purge.unref();

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  await ctx.engine.stop();
  ctx.sse.close();
  await ctx.state.flush();
  await ctx.simulator?.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
