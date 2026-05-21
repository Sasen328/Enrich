// Harvest AI route — silent consolidator for backend sources.
//
// Strict routing rules (per user 2026-05-21):
//   - masar_companies + masar_harvest_jobs + masar_custom_sources
//       → GET /api/harvest-ai/masaar-database
//   - builder_companies
//       → GET /api/harvest-ai/builder-database
//
// Both endpoints feed silently into Lead Factory hunts via the
// /api/lead-factory/company-suggest endpoint (already updated to query
// masar_companies + builder_companies + companies).

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { masarCompaniesTable, masarHarvestJobsTable, masarCustomSourcesTable, builderCompaniesTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/harvest-ai/masaar-database", async (_req: Request, res: Response) => {
  try {
    const [companies, jobs, sources] = await Promise.all([
      db.select().from(masarCompaniesTable).limit(500),
      db.select().from(masarHarvestJobsTable).limit(200),
      db.select().from(masarCustomSourcesTable).limit(200),
    ]);
    const [{ c: companyCount }] = await db.select({ c: sql<number>`count(*)::int` }).from(masarCompaniesTable);
    return res.json({
      companies, jobs, sources,
      totals: { companies: Number(companyCount) || 0, jobs: jobs.length, sources: sources.length },
    });
  } catch (err: any) {
    return res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

router.get("/harvest-ai/builder-database", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(builderCompaniesTable).limit(500);
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(builderCompaniesTable);
    return res.json({ companies: rows, total: Number(c) || 0 });
  } catch (err: any) {
    return res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

// Combined stats for Dashboard's Harvest AI card
router.get("/harvest-ai/stats", async (_req: Request, res: Response) => {
  try {
    const [m] = await db.select({ c: sql<number>`count(*)::int` }).from(masarCompaniesTable);
    const [b] = await db.select({ c: sql<number>`count(*)::int` }).from(builderCompaniesTable);
    const [j] = await db.select({ c: sql<number>`count(*)::int` }).from(masarHarvestJobsTable);
    return res.json({
      masaarCompanies: Number(m.c) || 0,
      builderCompanies: Number(b.c) || 0,
      masaarJobs: Number(j.c) || 0,
      combined: (Number(m.c) || 0) + (Number(b.c) || 0),
    });
  } catch (err: any) {
    return res.status(500).json({ error: "stats_failed", message: err?.message });
  }
});

export default router;
