import express, { Router } from "express";
import { z } from "zod";
import { NormRectSchema } from "../domain.js";
import { exportBundle } from "../proof/bundle.js";
import { APP_VERSION } from "../version.js";
import { HttpError, type AppContext } from "./context.js";
import { isAdmin, requireAdmin, setSessionCookie } from "./session.js";

const param = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? "" : value ?? "");

export function apiRoutes(ctx: AppContext): Router {
  const router = Router();
  const json = express.json({ limit: "1mb" });

  // ---- Public ----------------------------------------------------------------------------

  router.get("/api/session", (req, res) => {
    res.json({ authRequired: !!ctx.cfg.ADMIN_TOKEN, authenticated: isAdmin(ctx, req) });
  });

  router.post("/api/login", json, (req, res) => {
    const token = String((req.body as { token?: unknown })?.token ?? "");
    req.headers.authorization = `Bearer ${token}`;
    if (!ctx.cfg.ADMIN_TOKEN || !isAdmin(ctx, req)) {
      res.status(401).json({ error: "Wrong token" });
      return;
    }
    setSessionCookie(ctx, res, token);
    res.json({ ok: true });
  });

  /** The verification key, so anyone can check bundles and the ledger. */
  router.get("/api/public/signer", (_req, res) => {
    res.json({ kid: ctx.signer.kid, alg: "ES256", publicJwk: ctx.signer.publicJwk, description: ctx.signer.description });
  });

  // ---- Owner-only ------------------------------------------------------------------------

  router.use("/api", requireAdmin(ctx));

  router.get("/api/status", (_req, res) => {
    const head = ctx.ledger.head();
    res.json({
      version: APP_VERSION,
      ringMode: ctx.ring.mode,
      ring: ctx.auth ? ctx.auth.status() : { linked: true, accountId: "sim-account", simulated: true },
      vision: { provider: ctx.vision.name, model: ctx.vision.model, effort: ctx.cfg.VISION_EFFORT },
      faceDetector: ctx.faces.name,
      signer: { kid: ctx.signer.kid, description: ctx.signer.description },
      ledger: { store: ctx.ledger.store.description, headSeq: head.seq, headHash: head.hash },
      blobs: ctx.blobs.description,
      notifier: ctx.notifier.description,
      retentionDays: ctx.cfg.EVIDENCE_RETENTION_DAYS,
      counts: { sensors: ctx.state.data.sensors.length, evidence: ctx.state.data.evidence.length },
    });
  });

  router.get("/api/events", (req, res) => ctx.sse.attach(req, res));

  // Devices
  router.get("/api/devices", async (_req, res) => {
    const devices = await ctx.ring.listDevices();
    res.json(devices.map((d) => ({ ...d, privacyZones: ctx.state.data.privacyZones[d.id] ?? [] })));
  });

  router.put("/api/devices/:id/kind", json, (req, res) => {
    const kind = z.enum(["camera", "chime", "sensor", "unknown"]).parse((req.body as { kind?: unknown }).kind);
    ctx.state.update((s) => {
      s.deviceKinds[param(req.params.id)] = kind;
    });
    res.json({ ok: true });
  });

  router.get("/api/devices/:id/snapshot", async (req, res) => {
    const frame = await ctx.ring.getSnapshot(param(req.params.id));
    res.set("Cache-Control", "no-store").type(frame.mediaType).send(frame.bytes);
  });

  router.get("/api/devices/:id/history", async (req, res) => {
    res.json(await ctx.ring.getEventHistory(param(req.params.id), 25));
  });

  router.get("/api/devices/:id/chime-slots", async (req, res) => {
    res.json(await ctx.ring.listChimeSlots(param(req.params.id)));
  });

  router.get("/api/devices/:id/privacy-zones", (req, res) => {
    res.json(ctx.state.data.privacyZones[param(req.params.id)] ?? []);
  });

  router.put("/api/devices/:id/privacy-zones", json, async (req, res) => {
    const zones = z.array(NormRectSchema).max(20).parse(req.body);
    const id = param(req.params.id);
    await ctx.ledger.append("privacy.zones_updated", { deviceId: id, zones });
    ctx.state.update((s) => {
      s.privacyZones[id] = zones;
    });
    res.json(zones);
  });

  // Sensors
  router.get("/api/sensors", (_req, res) => res.json(ctx.engine.list()));
  router.post("/api/sensors", json, async (req, res) => res.status(201).json(await ctx.engine.create(req.body)));
  router.post("/api/sensors/test", json, async (req, res) => res.json(await ctx.engine.test(req.body)));
  router.put("/api/sensors/:id", json, async (req, res) => res.json(await ctx.engine.update(param(req.params.id), req.body)));
  router.delete("/api/sensors/:id", async (req, res) => {
    await ctx.engine.remove(param(req.params.id));
    res.status(204).end();
  });
  router.post("/api/sensors/:id/check", async (req, res) => {
    const result = await ctx.engine.check(param(req.params.id), "manual");
    if (!result) throw new HttpError(502, ctx.engine.get(param(req.params.id))?.lastError ?? "Check failed");
    res.json({ answer: result.answer, transition: result.transition, evidenceId: result.evidenceId });
  });
  router.get("/api/sensors/:id/ai-view", (req, res) => {
    const view = ctx.engine.aiView(param(req.params.id));
    if (!view) throw new HttpError(404, "No AI view yet (views are kept in memory only, for the latest check)");
    res.set("Cache-Control", "no-store").type("image/jpeg").send(view.jpeg);
  });

  // Receipts, Ring events, ledger
  router.get("/api/receipts", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(ctx.state.data.receipts.slice(-limit).reverse());
  });

  router.get("/api/ring-events", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(ctx.state.data.ringEvents.slice(-limit).reverse());
  });

  router.get("/api/ledger", async (req, res) => {
    const before = req.query.before === undefined ? null : Number(req.query.before);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ head: { seq: ctx.ledger.head().seq, hash: ctx.ledger.head().hash }, entries: await ctx.ledger.page(before, limit) });
  });

  /** Full ledger for in-browser verification (capped to keep responses small). */
  router.get("/api/ledger/all", async (_req, res) => {
    const head = ctx.ledger.head();
    if (head.seq > 20_000) throw new HttpError(413, "Ledger too large to verify in the browser; use the witness-verify CLI");
    res.json(await ctx.ledger.range(0, head.seq));
  });

  // Evidence
  router.get("/api/evidence", (_req, res) => res.json([...ctx.state.data.evidence].reverse()));

  router.get("/api/evidence/:id/redacted", async (req, res) => {
    const bytes = await ctx.evidence.redactedImage(param(req.params.id));
    if (!bytes) throw new HttpError(404, "Not found");
    res.type("image/png").send(bytes);
  });

  router.get("/api/evidence/:id/original", async (req, res) => {
    const original = await ctx.evidence.originalImage(param(req.params.id), "owner");
    if (!original) throw new HttpError(404, "Original not available (it may have been purged after the retention period)");
    res.set("Cache-Control", "no-store").type(original.mediaType).send(original.bytes);
  });

  router.post("/api/evidence/:id/export", async (req, res) => {
    const bundle = await exportBundle({
      evidenceId: param(req.params.id),
      exportedBy: "owner",
      ledger: ctx.ledger,
      signer: ctx.signer,
      state: ctx.state,
      evidence: ctx.evidence,
      mode: ctx.ring.mode,
    });
    res.set("Content-Disposition", `attachment; filename="witness-${bundle.subject.evidenceId}.json"`).json(bundle);
  });

  return router;
}

export function simulatorRoutes(ctx: AppContext): Router {
  const router = Router();
  const sim = () => {
    if (!ctx.simulator) throw new HttpError(404, "Simulator is disabled (RING_MODE=api)");
    return ctx.simulator;
  };

  router.use("/api/sim", requireAdmin(ctx));
  router.get("/api/sim/state", (_req, res) => res.json(sim().state()));

  router.post("/api/sim/scene/:deviceId", express.json(), async (req, res) => {
    const body = z.object({ patch: z.record(z.string(), z.union([z.string(), z.boolean()])), autoMotion: z.boolean().default(true) }).parse(req.body);
    await sim().updateScene(param(req.params.deviceId), body.patch, body.autoMotion);
    res.json(sim().state());
  });

  router.post("/api/sim/trigger", express.json(), async (req, res) => {
    const body = z.object({ deviceId: z.string(), type: z.enum(["motion_detected", "button_press"]) }).parse(req.body);
    await sim().trigger(body.deviceId, body.type);
    res.json({ ok: true });
  });

  router.put("/api/sim/frame/:deviceId", express.raw({ type: ["image/jpeg", "image/png"], limit: "15mb" }), async (req, res) => {
    const type = req.is("image/png") ? "image/png" : "image/jpeg";
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "Send a JPEG or PNG body");
    await sim().setCustomFrame(param(req.params.deviceId), req.body, type);
    res.json(sim().state());
  });

  router.delete("/api/sim/frame/:deviceId", async (req, res) => {
    await sim().clearCustomFrame(param(req.params.deviceId));
    res.json(sim().state());
  });

  return router;
}
