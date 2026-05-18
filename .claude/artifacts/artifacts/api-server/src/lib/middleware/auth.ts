/**
 * Bearer-token auth middleware.
 *
 * - If `API_TOKEN` env is unset, the middleware is a NO-OP and logs a warning
 *   on first request. This preserves the existing local-dev experience.
 * - If `API_TOKEN` is set, every request must include
 *     `Authorization: Bearer <API_TOKEN>`
 *   except for paths in `OPEN_PATHS` (health checks).
 * - Comparison uses `timingSafeEqual` to prevent timing oracles.
 */
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { env } from "../config/env.js";

/** Paths that must always be reachable without auth (liveness probes, etc.). */
const OPEN_PATHS = new Set<string>([
  "/api/healthz",
  "/api/readyz",
]);

let warned = false;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  if (OPEN_PATHS.has(req.path)) return next();

  if (!env.API_TOKEN) {
    if (!warned) {
      warned = true;
      console.warn(
        "[auth] API_TOKEN is not set — the API is UNAUTHENTICATED. " +
        "This is acceptable for local dev only. Do not deploy in this state.",
      );
    }
    return next();
  }

  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ ok: false, error: "Missing bearer token" });
    return;
  }
  if (!safeEqual(match[1].trim(), env.API_TOKEN)) {
    res.status(401).json({ ok: false, error: "Invalid bearer token" });
    return;
  }
  next();
}
