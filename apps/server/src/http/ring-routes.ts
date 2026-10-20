import express, { Router } from "express";
import { createHash } from "node:crypto";
import type { RingEventRecord } from "../domain.js";
import { RingApiError } from "../ring/types.js";
import { CAMERA_ACTIVITY_EVENTS, SENSOR_EVENTS, parseWebhook, verifyWebhookSignature, type RingWebhook } from "../ring/webhook.js";
import { HttpError, type AppContext } from "./context.js";
import { isAdmin, requireAdmin, setSessionCookie, tokenMatches } from "./session.js";

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:10vh auto;padding:0 16px;color:#16202c}
button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#1463ff;color:#fff;cursor:pointer}a{color:#1463ff}</style></head><body>${body}</body></html>`;

const escapeHtml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Ring-facing endpoints: the webhook receiver and account linking. */
export function ringRoutes(ctx: AppContext): Router {
  const router = Router();

  // Reachability check (the Developer Console and uptime probes use GET): Ring expects a 200.
  router.get("/webhooks/ring", (_req, res) => {
    res.json({ ok: true, accepts: "POST application/json with X-Signature: sha256=<hex>" });
  });

  // Webhook URL. Raw body is required for the HMAC check.
  router.post("/webhooks/ring", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyWebhookSignature(raw, req.get("X-Signature"), ctx.cfg.webhookHmacKey)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    let hook: RingWebhook;
    try {
      hook = parseWebhook(raw);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message }); // 4xx: Ring will not retry
      return;
    }
    const duplicate = ctx.state.data.seenWebhookRequestIds.includes(hook.meta.request_id);
    res.status(200).json({ ok: true, duplicate }); // acknowledge within Ring's 5s budget, then work async
    if (duplicate) return;
    ctx.state.update((s) => s.seenWebhookRequestIds.push(hook.meta.request_id));
    void handleWebhook(ctx, hook, raw).catch((error: unknown) => console.error("[webhook]", error));
  });

  // ---- Account linking (real Ring accounts) ------------------------------------------

  const auth = () => {
    if (!ctx.auth) throw new HttpError(400, "Account linking is only available with RING_MODE=api");
    return ctx.auth;
  };

  // Partner-initiated OAuth 2.0 + PKCE.
  router.get("/auth/ring/start", requireAdmin(ctx), (_req, res) => {
    res.redirect(auth().startPartnerLink());
  });

  router.get("/auth/ring/callback", async (req, res) => {
    const { code, state, error, error_description: description } = req.query as Record<string, string | undefined>;
    if (error) {
      res.status(400).send(page("Ring link cancelled", `<h2>Ring account not linked</h2><p>${escapeHtml(error)}: ${escapeHtml(description ?? "")}</p><p><a href="/">Back to TrueSight</a></p>`));
      return;
    }
    if (!code || !state) throw new HttpError(400, "Missing code or state");
    await auth().completePartnerLink(code, state);
    res.redirect("/#/dashboard?linked=1");
  });

  // One-way linking, step 1: Ring POSTs a single-use authorization code (valid 60s) as
  // application/x-www-form-urlencoded `code=...`. JSON and query are tolerated for local testing.
  router.post("/auth/ring/token-exchange", express.urlencoded({ extended: false }), express.json(), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const code = String(body.code ?? req.query.code ?? "");
    if (!code) throw new HttpError(400, "Missing code");
    await auth().acceptTokenExchange(code);
    res.json({ ok: true });
  });

  // One-way linking, step 2: Ring redirects the customer here with nonce + time. Ring
  // requires a partner sign-in at this point, so the page itself carries the sign-in
  // form: on a phone, coming from the Ring app, there is no console session yet.
  const linkPage = (nonce: string, time: string, signedIn: boolean, error?: string) =>
    page(
      "Link Ring to TrueSight",
      `<h2>Link your Ring account to TrueSight?</h2>
       <p>TrueSight will read snapshots and events from the Ring devices you shared, to run the virtual sensors you create, and can play sounds on your chime.</p>
       ${error ? `<p style="color:#c0392b">${escapeHtml(error)}</p>` : ""}
       <form method="post" action="/auth/ring/link/confirm">
         <input type="hidden" name="nonce" value="${escapeHtml(nonce)}"><input type="hidden" name="time" value="${escapeHtml(time)}">
         ${
           signedIn
             ? ""
             : `<p><label>Sign in with your TrueSight admin token<br>
                <input type="password" name="token" autocomplete="current-password" required style="font:inherit;width:100%;padding:10px;margin-top:6px;border:1px solid #ccd;border-radius:8px"></label></p>`
         }
         <button type="submit">${signedIn ? "Link account" : "Sign in and link account"}</button>
       </form>`,
    );

  router.get("/auth/ring/link", (req, res) => {
    const { nonce, time } = req.query as Record<string, string | undefined>;
    const problem = auth().validateLinkRequest(nonce, time);
    if (problem) {
      res.status(400).send(page("Link request invalid", `<h2>Can't link this Ring account</h2><p>${escapeHtml(problem)}</p>`));
      return;
    }
    res.send(linkPage(nonce!, time!, isAdmin(ctx, req)));
  });

  router.post("/auth/ring/link/confirm", express.urlencoded({ extended: false }), async (req, res) => {
    const { nonce = "", time = "", token = "" } = req.body as Record<string, string | undefined>;
    if (!isAdmin(ctx, req)) {
      if (!tokenMatches(ctx, token)) {
        res.status(401).send(linkPage(nonce, time, false, "That admin token is not correct."));
        return;
      }
      setSessionCookie(ctx, res, token);
    }
    try {
      await auth().confirmOneWayLink(nonce, time);
    } catch (error) {
      console.error("[link]", (error as Error).message);
      res.status(error instanceof RingApiError && error.status < 500 ? error.status : 502).send(
        page("Ring link failed", `<h2>Ring account not linked</h2><p>${escapeHtml((error as Error).message)}</p><p>Start again from the Ring app. Links expire after 10 minutes.</p>`),
      );
      return;
    }
    res.redirect("/#/sensors?linked=1");
  });

  router.post("/api/ring/unlink", requireAdmin(ctx), async (_req, res) => {
    await auth().unlink();
    res.json({ ok: true });
  });

  return router;
}

async function handleWebhook(ctx: AppContext, hook: RingWebhook, raw: Buffer): Promise<void> {
  const { type, attributes } = hook.data;
  const deviceId = typeof attributes.source === "string" ? attributes.source : null;
  const timestamp = typeof attributes.timestamp === "number" ? attributes.timestamp : Date.parse(hook.meta.time ?? "") || Date.now();

  // Everything Ring tells us becomes a signed, timestamped record.
  const entry = await ctx.ledger.append("ring.event", {
    requestId: hook.meta.request_id,
    eventId: hook.data.id,
    type,
    deviceId,
    subType: typeof attributes.sub_type === "string" ? attributes.sub_type : null,
    timestamp,
    bodySha256: createHash("sha256").update(raw).digest("hex"),
    signatureVerified: true,
  });
  const record: RingEventRecord = {
    id: hook.data.id,
    requestId: hook.meta.request_id,
    type,
    deviceId,
    subType: typeof attributes.sub_type === "string" ? attributes.sub_type : null,
    timestamp,
    receivedAt: new Date().toISOString(),
    ledgerSeq: entry.seq,
    attributes,
  };
  ctx.state.update((s) => s.ringEvents.push(record));
  ctx.sse.send("ring-event", record);

  if (type === "app_integration_removed") {
    await ctx.auth?.forget();
    await ctx.notifier.send({ level: "info", title: "Ring account disconnected", body: "The Ring account removed TrueSight. Link it again to resume." });
  } else if (deviceId && CAMERA_ACTIVITY_EVENTS.has(type)) {
    ctx.engine.onCameraActivity(deviceId, type as "motion_detected" | "button_press");
  } else if (deviceId && SENSOR_EVENTS.has(type)) {
    ctx.engine.onSensorEvent(deviceId);
  }
}
