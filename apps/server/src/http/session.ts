import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AppContext } from "./context.js";

export const SESSION_COOKIE = "truesight_admin";

const digest = (value: string) => createHash("sha256").update(value).digest();

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Single-owner access control. If ADMIN_TOKEN is unset (local development),
 * everyone is the owner. Otherwise the owner signs in once and gets an
 * httpOnly cookie (EventSource cannot send headers), or sends a bearer token.
 */
export function isAdmin(ctx: AppContext, req: Request): boolean {
  const token = ctx.cfg.ADMIN_TOKEN;
  if (!token) return true;
  const header = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const presented = header ?? readCookie(req, SESSION_COOKIE);
  return !!presented && timingSafeEqual(digest(presented), digest(token));
}

export function requireAdmin(ctx: AppContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAdmin(ctx, req)) next();
    else res.status(401).json({ error: "Sign in required" });
  };
}

export function setSessionCookie(ctx: AppContext, res: Response, token: string): void {
  const secure = ctx.cfg.PUBLIC_BASE_URL.startsWith("https://");
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, maxAge: 30 * 86_400_000, path: "/" });
}
