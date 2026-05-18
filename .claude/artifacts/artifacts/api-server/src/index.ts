import app from "./app";
import { seedMeshbaseIfEmpty } from "./lib/meshbase-seed";
import { db, leadListsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { env } from "./lib/config/env.js";
import { markShuttingDown } from "./lib/lifecycle.js";
import type { Server } from "http";

const port = env.PORT;

async function recoverStuckHunts() {
  try {
    const stuck = await db.update(leadListsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(leadListsTable.status, "running"))
      .returning({ id: leadListsTable.id, name: leadListsTable.name });
    if (stuck.length > 0) {
      console.log(`[LeadLists] Recovered ${stuck.length} stuck hunt(s): ${stuck.map(h => `#${h.id} "${h.name}"`).join(", ")} — set to failed so they can be retried.`);
    }
  } catch (e) {
    console.warn("[LeadLists] Could not recover stuck hunts:", e);
  }
}

const server: Server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  seedMeshbaseIfEmpty().catch(err =>
    console.error("[Seed] Error during MeshBase seed:", err)
  );
  recoverStuckHunts().catch(err =>
    console.error("[LeadLists] Startup recovery error:", err)
  );
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Flips /healthz to 503 so LBs stop routing, stops accepting new connections,
// waits up to SHUTDOWN_GRACE_MS for in-flight requests to drain, then exits.
// A second signal short-circuits the wait.

let shutdownInProgress = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownInProgress) {
    console.warn(`[shutdown] ${signal} received again — forcing exit`);
    process.exit(1);
  }
  shutdownInProgress = true;
  markShuttingDown();
  console.log(`[shutdown] ${signal} received — draining (grace ${env.SHUTDOWN_GRACE_MS}ms)`);

  const forceTimer = setTimeout(() => {
    console.error("[shutdown] Grace period expired — forcing exit");
    process.exit(1);
  }, env.SHUTDOWN_GRACE_MS);
  // Don't keep the event loop alive solely for this timer.
  forceTimer.unref();

  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) console.error("[shutdown] server.close error:", err);
      resolve();
    });
  });

  console.log("[shutdown] HTTP server closed — exiting cleanly");
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

// Surface uncaught errors instead of dying silently.
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});
