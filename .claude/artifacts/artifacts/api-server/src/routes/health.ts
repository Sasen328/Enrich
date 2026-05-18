import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isShuttingDown } from "../lib/lifecycle.js";

const router: IRouter = Router();

/**
 * Liveness probe. Returns 200 if the process is up.
 *
 * During shutdown, returns 503 so load balancers stop sending new traffic
 * while in-flight requests finish draining.
 */
router.get("/healthz", (_req, res) => {
  if (isShuttingDown()) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.json({ status: "ok" });
});

/**
 * Readiness probe. Verifies the database is reachable. Use this in K8s
 * `readinessProbe` so pods are taken out of rotation when the DB is down.
 */
router.get("/readyz", async (_req, res) => {
  if (isShuttingDown()) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ready", db: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ status: "not_ready", db: "down", error: msg });
  }
});

export default router;
