import { Router, type IRouter, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db, prospectingSessionsTable, jobsTable, prospectingResultsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { crawlAndAnalyze, runExtractionJob, runBluepagesJob } from "../lib/prospecting-engine.js";
import { isBluepagesUrl } from "../lib/bluepages-scraper.js";

const router: IRouter = Router();
const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;


// ─── Scan ─────────────────────────────────────────────────────────────────────
router.post("/prospecting/scan", async (req: Request, res: Response): Promise<void> => {
  const { url, maxPages = 20 } = req.body as { url: string; maxPages?: number };

  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  try {
    const result = await crawlAndAnalyze(url, maxPages);
    const sessionId = uuidv4();

    await db.insert(prospectingSessionsTable).values({
      sessionId,
      url,
      websiteType: result.siteType,
      detectedCategories: JSON.stringify(result.fields.filter((f: any) => f.detected).map((f) => f.key)),
      estimatedCompanyCount: result.estimatedTotal,
      pagesFound: result.pagesDiscovered,
      sampleCompanies: JSON.stringify(result.sampleItems),
      language: result.language,
      status: "scanned",
    } as any);

    res.json({
      sessionId,
      url,
      siteType: result.siteType,
      contentType: result.contentType,
      language: result.language,
      estimatedTotal: result.estimatedTotal,
      pagesDiscovered: result.pagesDiscovered,
      sampleItems: result.sampleItems,
      fields: result.fields,
      pageUrls: result.pageUrls,
      siteNote: result.siteNote || "",
    });
  } catch (err) {
    console.error("[Prospecting] Scan error:", err);
    res.status(500).json({ error: "Failed to scan website. Please check the URL and try again.", detail: String(err) });
  }
});

// ─── Extract (start background job) ──────────────────────────────────────────
router.post("/prospecting/extract", async (req: Request, res: Response): Promise<void> => {
  const { sessionId, selectedFields, pageUrls, maxPages = 20 } = req.body as {
    sessionId: string;
    selectedFields: string[];
    pageUrls?: string[];
    maxPages?: number;
  };

  if (!sessionId || !selectedFields || selectedFields.length === 0) {
    res.status(400).json({ error: "sessionId and selectedFields are required" });
    return;
  }

  const _sessResult = await db.select().from(prospectingSessionsTable)
    .where(eq(prospectingSessionsTable.sessionId, p(req.params.sessionId)));
  const session = _sessResult[0];
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const urls = pageUrls?.slice(0, maxPages) || [session.url];
  const jobId = uuidv4();

  const [job] = await db.insert(jobsTable).values({
    jobId,
    type: "prospecting_extract",
    status: "running",
    phase: "extract",
    sessionId,
    progress: 0,
    total: urls.length,
    companiesProcessed: 0,
    companiesEnriched: 0,
    companiesHarvested: 0,
    companiesDuplicated: 0,
    sourcesTotal: urls.length,
    sourcesCompleted: 0,
    agentStatuses: JSON.stringify({
      selectedFields,
      pagesProcessed: 0,
      totalPages: urls.length,
      recordsExtracted: 0,
      recordsEnriched: 0,
      scraperMode: "multi_agent",
    } as any),
  }).returning();

  await db.update(prospectingSessionsTable).set({
    status: "extracting",
    updatedAt: new Date(),
  } as any).where(eq(prospectingSessionsTable.sessionId, p(req.params.sessionId)));

  res.json({
    jobId: job.jobId,
    sessionId,
    status: "running",
    totalPages: urls.length,
    selectedFields,
    scraperMode: "multi_agent",
  });

  // Run in background — BluPages uses the JSON API extractor; everything else uses multi-agent
  setImmediate(async () => {
    try {
      if (isBluepagesUrl(session.url)) {
        await runBluepagesJob(jobId, sessionId, session.url, selectedFields, maxPages * 24);
      } else {
        await runExtractionJob(jobId, sessionId, urls, selectedFields, session.url);
      }
      const [jobRecord] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.jobId, jobId));
      const count = jobRecord?.id
        ? await db.select({ count: sql<number>`count(*)` })
            .from(prospectingResultsTable)
            .where(eq(prospectingResultsTable.jobId, jobRecord.id))
        : [{ count: 0 }];
      await db.update(prospectingSessionsTable).set({
        status: "completed",
        companiesFound: Number(count[0]?.count || 0),
        enrichmentStatus: "enriched",
        updatedAt: new Date(),
      } as any).where(eq(prospectingSessionsTable.sessionId, p(req.params.sessionId)));
    } catch (err) {
      console.error("[Prospecting] Extract job error:", err);
      await db.update(jobsTable).set({
        status: "failed",
        errorMessage: String(err),
        updatedAt: new Date(),
      } as any).where(eq(jobsTable.jobId, jobId));
    }
  });
});

// ─── Poll job status + live feed ─────────────────────────────────────────────
router.get("/prospecting/jobs/:jobId", async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;

  const _jobResult = await db.select().from(jobsTable).where(eq(jobsTable.jobId, p(req.params.jobId)));
  const job = _jobResult[0];
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  let agentInfo: Record<string, unknown> = {};
  try { agentInfo = JSON.parse(job.agentStatuses || "{}"); } catch { /* */ }

  // Fetch recently extracted records for the live feed
  let recentRecords: Record<string, unknown>[] = [];
  try {
    const rows = await db.select()
      .from(prospectingResultsTable)
      .where(eq(prospectingResultsTable.jobId, job.id))
      .orderBy(desc(prospectingResultsTable.createdAt))
      .limit(10);
    recentRecords = rows
      .filter(r => r.companyData && typeof r.companyData === "object")
      .map(r => ({ id: r.id, ...r.companyData as Record<string, unknown>, enrichmentStatus: r.enrichmentStatus, createdAt: r.createdAt }));
  } catch { /* */ }

  res.json({
    jobId: job.jobId,
    sessionId: job.sessionId,
    status: job.status,
    progress: job.progress,
    pagesProcessed: agentInfo.pagesProcessed ?? job.companiesProcessed,
    totalPages: agentInfo.totalPages ?? job.total,
    recordsExtracted: agentInfo.recordsExtracted ?? job.companiesHarvested,
    recordsEnriched: agentInfo.recordsEnriched ?? job.companiesEnriched,
    errorMessage: job.errorMessage,
    recentRecords,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

// ─── Session results (all extracted companies) ────────────────────────────────
router.get("/prospecting/session/:sessionId/companies", async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const page = parseInt(String(req.query.page || "1"));
  const limit = 50;
  const offset = (page - 1) * limit;

  const _sessResult = await db.select().from(prospectingSessionsTable)
    .where(eq(prospectingSessionsTable.sessionId, p(req.params.sessionId)));
  const session = _sessResult[0];
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Find the job for this session to get the integer job ID
  const _sjResult = await db.select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.sessionId, p(req.params.sessionId)))
    .orderBy(desc(jobsTable.createdAt))
    .limit(1);

  const sessionJob = _sjResult[0];
  if (!sessionJob) {
    res.json({ sessionId, total: 0, page, companies: [] });
    return;
  }

  const rows = await db.select()
    .from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, sessionJob.id))
    .orderBy(desc(prospectingResultsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db.select({ count: sql<number>`count(*)` })
    .from(prospectingResultsTable)
    .where(eq(prospectingResultsTable.jobId, sessionJob.id));

  const companies = rows
    .filter(r => r.companyData && typeof r.companyData === "object")
    .map(r => ({ id: r.id, ...r.companyData as Record<string, unknown>, enrichmentStatus: r.enrichmentStatus, sourceUrl: r.sourceUrl, createdAt: r.createdAt }));

  res.json({
    sessionId,
    total: Number(countResult?.count || 0),
    page,
    companies,
  });
});

// ─── List sessions ────────────────────────────────────────────────────────────
router.get("/prospecting/sessions", async (_req: Request, res: Response): Promise<void> => {
  const sessions = await db.select().from(prospectingSessionsTable)
    .orderBy(desc(prospectingSessionsTable.createdAt))
    .limit(20);

  res.json(sessions.map((s) => ({
    sessionId: s.sessionId,
    url: s.url,
    siteType: s.websiteType,
    companiesFound: s.companiesFound,
    status: s.status,
    enrichmentStatus: s.enrichmentStatus,
    pagesFound: s.pagesFound,
    createdAt: s.createdAt,
  })));
});

export default router;
