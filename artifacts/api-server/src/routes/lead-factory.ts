import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { pipeEmitterToSse } from "../lib/sse.js";
import { leadFactoryJobsTable, leadFactoryResultsTable, relationshipIntelJobsTable, companiesTable, builderCompaniesTable } from "@workspace/db/schema";
import { eq, desc, ilike, or, sql } from "drizzle-orm";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;
import {
  createLeadFactoryJob,
  getLeadFactoryEmitter,
  runLeadFactoryPipeline,
  publishExistingResults,
  leadFactoryBriefSchema,
  cancelLeadFactoryJob,
  LeadFactoryBrief,
} from "../lib/lead-factory-engine.js";
import {
  createRelationshipIntelJob,
  getRelationshipIntelEmitter,
  runRelationshipIntelPipeline,
  cancelRelationshipIntelJob,
  RelationshipIntelBrief,
} from "../lib/relationship-intel-engine.js";
import {
  createSignalJob,
  getSignalEmitter,
  runSignalMonitor,
  cancelSignalJob,
} from "../lib/signal-monitor.js";

const router = Router();

// ── Lead Factory ──────────────────────────────────────────────────────────────

// POST /lead-factory/start  (mounted at /api via routes/index.ts → app.use("/api", router))
router.post("/lead-factory/start", async (req: Request, res: Response) => {
  const parsed = leadFactoryBriefSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid brief",
      issues: parsed.error.issues,
    });
  }
  const brief: LeadFactoryBrief = parsed.data;
  const jobId = createLeadFactoryJob();

  // Fire-and-forget the pipeline, but persist any unhandled throw to the
  // jobs table so callers polling /jobs/:jobId see the failure even when
  // the SSE stream was never opened.
  runLeadFactoryPipeline(jobId, brief).catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lead-factory] pipeline crashed for ${jobId}:`, msg);
    try {
      const { db } = await import("@workspace/db");
      const { leadFactoryJobsTable } = await import("@workspace/db/schema");
      await db.update(leadFactoryJobsTable)
        .set({ status: "failed", errorMessage: msg })
        .where(eq(leadFactoryJobsTable.id, parseInt(jobId.split("-")[1] || "0", 10)));
    } catch {/* best-effort */}
  });

  res.json({ ok: true, jobId });
});

// GET /lead-factory/stream/:jobId (SSE)
router.get("/lead-factory/stream/:jobId", (req: Request, res: Response) => {
  const emitter = getLeadFactoryEmitter(p(req.params.jobId));
  if (!emitter) {
    res.status(404).json({ ok: false, error: "Job not found" });
    return;
  }
  pipeEmitterToSse(req, res, emitter);
});

// GET /lead-factory/jobs
router.get("/lead-factory/jobs", async (_req: Request, res: Response) => {
  try {
    const jobs = await db.select().from(leadFactoryJobsTable).orderBy(desc(leadFactoryJobsTable.createdAt)).limit(50);
    res.json({ ok: true, jobs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// GET /lead-factory/jobs/:jobId
router.get("/lead-factory/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const id = parseInt(p(req.params.jobId), 10);
    const [job] = await db.select().from(leadFactoryJobsTable).where(eq(leadFactoryJobsTable.id, id));
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
    res.json({ ok: true, job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// POST /lead-factory/results/:jobId/publish
// Manual bridge into the unified companies/executives pool. Idempotent.
// Body: { autoEnrichDownstream?: boolean } — when true, also fires Signals
// + Relationship/Network Intel for each newly-seeded company.
router.post("/lead-factory/results/:jobId/publish", async (req: Request, res: Response) => {
  try {
    const id = parseInt(p(req.params.jobId), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Invalid jobId" });
    }
    const autoEnrichDownstream = !!req.body?.autoEnrichDownstream;
    const summary = await publishExistingResults(id, { autoEnrichDownstream });
    res.json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// POST /lead-factory/jobs/:jobId/cancel
router.post("/lead-factory/jobs/:jobId/cancel", (req: Request, res: Response) => {
  const ok = cancelLeadFactoryJob(p(req.params.jobId));
  if (!ok) return res.status(404).json({ ok: false, error: "Job not found or already finished" });
  res.json({ ok: true });
});

// POST /relationship-intel/jobs/:jobId/cancel
router.post("/relationship-intel/jobs/:jobId/cancel", (req: Request, res: Response) => {
  const ok = cancelRelationshipIntelJob(p(req.params.jobId));
  if (!ok) return res.status(404).json({ ok: false, error: "Job not found or already finished" });
  res.json({ ok: true });
});

// POST /signals/jobs/:jobId/cancel
router.post("/signals/jobs/:jobId/cancel", (req: Request, res: Response) => {
  const ok = cancelSignalJob(p(req.params.jobId));
  if (!ok) return res.status(404).json({ ok: false, error: "Job not found or already finished" });
  res.json({ ok: true });
});

// GET /lead-factory/results/:jobId
router.get("/lead-factory/results/:jobId", async (req: Request, res: Response) => {
  try {
    const jobId = parseInt(p(req.params.jobId), 10);
    const results = await db
      .select()
      .from(leadFactoryResultsTable)
      .where(eq(leadFactoryResultsTable.jobId, jobId))
      .orderBy(desc(leadFactoryResultsTable.icpScore));
    res.json({ ok: true, results, total: results.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── Relationship Intelligence ─────────────────────────────────────────────────

// POST /relationship-intel/start
router.post("/relationship-intel/start", async (req: Request, res: Response) => {
  try {
    const brief: RelationshipIntelBrief = req.body;
    if (!brief?.targetCompanyName) {
      return res.status(400).json({ ok: false, error: "targetCompanyName is required" });
    }
    const jobId = createRelationshipIntelJob();
    runRelationshipIntelPipeline(jobId, brief).catch(console.error);
    res.json({ ok: true, jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// GET /relationship-intel/stream/:jobId (SSE)
router.get("/relationship-intel/stream/:jobId", (req: Request, res: Response) => {
  const emitter = getRelationshipIntelEmitter(p(req.params.jobId));
  if (!emitter) {
    res.status(404).json({ ok: false, error: "Job not found" });
    return;
  }
  pipeEmitterToSse(req, res, emitter);
});

// GET /relationship-intel/jobs/:jobId
router.get("/relationship-intel/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const id = parseInt(p(req.params.jobId), 10);
    const [job] = await db.select().from(relationshipIntelJobsTable).where(eq(relationshipIntelJobsTable.id, id));
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
    res.json({ ok: true, job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// GET /relationship-intel/jobs
router.get("/relationship-intel/jobs", async (_req: Request, res: Response) => {
  try {
    const jobs = await db.select().from(relationshipIntelJobsTable).orderBy(desc(relationshipIntelJobsTable.createdAt)).limit(20);
    res.json({ ok: true, jobs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── Company Autocomplete Suggest ──────────────────────────────────────────────

// GET /lead-factory/company-suggest?q=aramco
router.get("/lead-factory/company-suggest", async (req: Request, res: Response) => {
  const q = ((req.query.q as string) || "").trim();
  if (q.length < 2) { res.json({ suggestions: [] }); return; }
  try {
    // Search main companies table
    const mainRows = await db.select({
      nameEn: companiesTable.nameEn,
      nameAr: companiesTable.nameAr,
      city: companiesTable.city,
      industry: companiesTable.industry,
      domain: companiesTable.website,
    }).from(companiesTable)
      .where(or(ilike(companiesTable.nameEn, `%${q}%`), ilike(companiesTable.nameAr, `%${q}%`)))
      .limit(6);

    // Also search builder companies for more coverage
    const builderRows = await db.select({
      nameEn: builderCompaniesTable.nameEn,
      nameAr: builderCompaniesTable.nameAr,
      city: builderCompaniesTable.city,
      industry: builderCompaniesTable.industry,
      domain: builderCompaniesTable.website,
    }).from(builderCompaniesTable)
      .where(or(ilike(builderCompaniesTable.nameEn, `%${q}%`), ilike(builderCompaniesTable.nameAr, `%${q}%`)))
      .limit(6);

    // Merge, deduplicate by nameEn
    const seen = new Set<string>();
    const merged: { nameEn: string | null; nameAr: string | null; city: string | null; industry: string | null; domain: string | null }[] = [];
    for (const r of [...mainRows, ...builderRows]) {
      const key = (r.nameEn || r.nameAr || "").toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); merged.push(r); }
    }

    res.json({ suggestions: merged.slice(0, 8) });
  } catch (err) {
    res.json({ suggestions: [] });
  }
});

// ── Signal Monitor ────────────────────────────────────────────────────────────

// POST /signals/push  — starts a signal monitor run, returns SSE jobId
router.post("/signals/push", async (req: Request, res: Response) => {
  try {
    const jobId = createSignalJob();
    runSignalMonitor(jobId).catch(console.error);
    res.json({ ok: true, jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// GET /signals/stream/:jobId (SSE)
router.get("/signals/stream/:jobId", (req: Request, res: Response) => {
  const emitter = getSignalEmitter(p(req.params.jobId));
  if (!emitter) {
    res.status(404).json({ ok: false, error: "Job not found" });
    return;
  }
  pipeEmitterToSse(req, res, emitter);
});

export default router;
