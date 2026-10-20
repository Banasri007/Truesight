import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import { repoRoot } from "../config.js";
import { RingApiError } from "../ring/types.js";
import { apiRoutes, simulatorRoutes } from "./api-routes.js";
import { HttpError, type AppContext } from "./context.js";
import { ringRoutes } from "./ring-routes.js";

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    next();
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use(ringRoutes(ctx));
  app.use(simulatorRoutes(ctx));
  app.use(apiRoutes(ctx));

  // Production: serve the built dashboard (apps/web/dist) with an SPA fallback.
  const webDist = join(repoRoot, "apps", "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/(api|auth|webhooks)\/).*/, (_req, res) => res.sendFile(join(webDist, "index.html")));
  }

  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "Invalid input", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof RingApiError) {
      res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({ error: error.message, source: "ring" });
      return;
    }
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: (error as Error).message });
      return;
    }
    console.error("[http]", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal error" });
  });

  return app;
}
