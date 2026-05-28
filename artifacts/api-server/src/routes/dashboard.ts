// §16 — Live dashboard. Aggregates REAL counts from the DB (not stored stats
// snapshots) + a recent-activity feed, and streams deltas over SSE so the
// cockpit updates without manual polling.

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  companiesTable, leadsTable, leadListsTable, masarCompaniesTable,
  builderCompaniesTable, behaviorEventsTable, seederRowsTable,
} from "@workspace/db/schema";
import { sql, desc } from "drizzle-orm";
import { subscribeEvents, recentEvents } from "../lib/event-bus.js";

const router = Router();

async function liveSnapshot() {
  const count = async (tbl: any) => {
    try { const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(tbl); return Number(r?.c) || 0; }
    catch { return 0; }
  };
  const [companies, leads, lists, masar, builder, seeded] = await Promise.all([
    count(companiesTable), count(leadsTable), count(leadListsTable),
    count(masarCompaniesTable), count(builderCompaniesTable), count(seederRowsTable),
  ]);

  // Recent activity = newest rows across a few tables, merged + sorted.
  const recent: { ico: string; text: string; ts: string }[] = [];
  try {
    const rl = await db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)).limit(5);
    for (const l of rl) {
      const src = (l.notes || "").match(/\[from:([^\]]+)\]/)?.[1] || "manual";
      recent.push({ ico: "🧬", text: `Lead saved (${src}): ${[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}`, ts: String(l.createdAt) });
    }
  } catch { /* ignore */ }
  try {
    const be = await db.select().from(behaviorEventsTable).orderBy(desc(behaviorEventsTable.createdAt)).limit(3);
    for (const e of be) recent.push({ ico: "🤖", text: `User action: ${e.kind}`, ts: String(e.createdAt) });
  } catch { /* ignore */ }
  // Merge in live bus events (job starts, enrichments) so the feed reflects
  // in-flight activity, not just persisted rows.
  for (const e of recentEvents(8)) {
    recent.push({ ico: e.ico || "•", text: e.text, ts: new Date(e.ts || Date.now()).toISOString() });
  }
  recent.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return {
    counts: { companies, leadGenome: leads, leadLists: lists, masaar: masar, builder, harvestAi: masar + builder, seeded },
    recent: recent.slice(0, 8),
    ts: Date.now(),
  };
}

// GET /api/dashboard/live — one-shot snapshot
router.get("/dashboard/live", async (_req: Request, res: Response) => {
  try { res.json(await liveSnapshot()); }
  catch (err: any) { res.status(500).json({ error: "live_failed", message: err?.message }); }
});

// GET /api/dashboard/stream — SSE, emits a fresh snapshot every 5s
router.get("/dashboard/stream", async (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let closed = false;

  // Push live bus events the instant they happen (event-driven, not polled).
  const unsubscribe = subscribeEvents((evt) => {
    if (closed) return;
    try { res.write(`event: activity\ndata: ${JSON.stringify(evt)}\n\n`); }
    catch { /* connection closed */ }
  });

  req.on("close", () => { closed = true; unsubscribe(); });

  // Periodic snapshot acts as a heartbeat + reconciles counts.
  const tick = async () => {
    if (closed) return;
    try {
      const snap = await liveSnapshot();
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
    } catch { /* skip tick */ }
    if (!closed) setTimeout(tick, 5000);
  };
  tick();
});

export default router;
