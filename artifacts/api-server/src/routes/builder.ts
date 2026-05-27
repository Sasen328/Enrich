import { Router, type IRouter, type Request, type Response } from "express";
import { db, builderCompaniesTable, builderJobsTable, jobsTable, companiesTable, builderCustomSourcesTable } from "@workspace/db";
import { eq, desc, and, sql, inArray, ilike, or } from "drizzle-orm";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";
import { SAUDI_DATA_SOURCES } from "../lib/data-sources.js";
import { runInJob } from "../lib/paid-api-guard.js";
import {
  runHarvest,
  reEnrichCompany,
  reEnrichAll,
  deduplicateAll,
  autoClean,
  getIncompleteCompanies,
  getAllBuilderCompanies,
  getBuilderJob,
  getBuilderJobs,
  cancelBuilderJobByLegacyJobId,
} from "../lib/builder-engine.js";
import { enrichCompanyWithAI } from "../lib/enrichment-engine.js";
import { addToBlocklist } from "../lib/blocklist.js";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const router: IRouter = Router();

const sourceLastHarvested: Record<string, Date> = {};

async function loadCustomSourcesFromDB() {
  try {
    return await db.select().from(builderCustomSourcesTable).orderBy(builderCustomSourcesTable.createdAt);
  } catch {
    return [];
  }
}

router.get("/builder/sources", async (_req: Request, res: Response): Promise<void> => {
  const custom = await loadCustomSourcesFromDB();

  // Count how many companies exist per sourceId in builder_companies
  const countRows = await db.execute(
    sql`SELECT source_id, COUNT(*)::int AS cnt FROM builder_companies GROUP BY source_id`
  );
  const countMap: Record<string, number> = {};
  for (const row of (countRows as any).rows ?? countRows) {
    const r = row as { source_id: string; cnt: number };
    if (r.source_id) countMap[r.source_id] = Number(r.cnt);
  }

  const all = [
    ...SAUDI_DATA_SOURCES.map(s => ({
      ...s,
      isEnabled: true,
      isCustom: false,
      lastHarvestedAt: sourceLastHarvested[s.id]?.toISOString() || null,
      harvestedCount: countMap[s.id] || 0,
    })),
    ...custom.map(s => ({
      id: `custom-${s.id}`,
      name: s.name,
      nameAr: s.nameAr || s.name,
      category: s.category,
      url: s.url,
      description: s.description || "",
      estimatedCompanies: s.estimatedCompanies || 0,
      isEnabled: true,
      isCustom: true,
      dbId: s.id,
      lastHarvestedAt: sourceLastHarvested[`custom-${s.id}`]?.toISOString() || null,
      harvestedCount: countMap[`custom-${s.id}`] || 0,
    })),
  ];
  res.json(all);
});

router.post("/builder/sources", async (req: Request, res: Response): Promise<void> => {
  const { name, url, category, description, estimatedCompanies } = req.body as {
    name: string; url: string; category: string; description?: string; estimatedCompanies?: number;
  };

  if (!name || !url || !category) {
    res.status(400).json({ error: "name, url, and category are required" });
    return;
  }

  const [inserted] = await db.insert(builderCustomSourcesTable).values({
    name: name.trim(),
    nameAr: name.trim(),
    url: url.trim(),
    category: category.trim(),
    description: description?.trim() || null,
    estimatedCompanies: estimatedCompanies || 0,
  } as any).returning();

  const newSource = {
    id: `custom-${inserted.id}`,
    name: inserted.name,
    nameAr: inserted.nameAr || inserted.name,
    category: inserted.category,
    url: inserted.url,
    description: inserted.description || "",
    estimatedCompanies: inserted.estimatedCompanies || 0,
    isEnabled: true,
    isCustom: true,
    dbId: inserted.id,
    lastHarvestedAt: null,
  };

  res.json({ success: true, source: newSource });
});

router.delete("/builder/sources/:id", async (req: Request, res: Response): Promise<void> => {
  const id = p(req.params.id);
  const numId = id.startsWith("custom-") ? parseInt(id.replace("custom-", ""), 10) : parseInt(id, 10);
  if (!isNaN(numId)) {
    await db.delete(builderCustomSourcesTable).where(eq(builderCustomSourcesTable.id, numId));
  }
  res.json({ success: true });
});

router.post("/builder/sources/:id/harvest", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { batchSize = 1, enrichmentDepth = "standard" } = req.body as { batchSize?: number; enrichmentDepth?: "basic" | "standard" | "deep" };

  try {
    const customSources = await loadCustomSourcesFromDB();
    const extraSources = customSources.map(s => ({
      id: `custom-${s.id}`, name: s.name, nameAr: s.nameAr || s.name, url: s.url,
      category: s.category, description: s.description || "", estimatedCompanies: s.estimatedCompanies || 0,
    }));

    const allSources = [
      ...SAUDI_DATA_SOURCES.map(s => ({ ...s })),
      ...extraSources,
    ];

    const source = allSources.find(s => s.id === id);
    if (!source) {
      res.status(404).json({ error: `Source '${id}' not found` });
      return;
    }

    const _id = p(req.params.id);
    const result = await runHarvest({ sourceIds: [_id], batchSize, enrichmentDepth, extraSources });
    sourceLastHarvested[String(_id)] = new Date();

    const agentStatuses = [{ agentId: "agent-1", sourceId: source.id, sourceName: source.name, status: "idle" as const, companiesFound: 0, progress: 0 }];

    const [job] = await db.insert(jobsTable).values({
      jobId: result.jobId,
      type: "builder_harvest",
      status: "harvesting",
      sourceIds: JSON.stringify([id]),
      sourcesTotal: 1,
      sourcesCompleted: 0,
      companiesHarvested: 0,
      companiesEnriched: 0,
      companiesDuplicated: 0,
      progress: 0,
      total: 1,
      companiesProcessed: 0,
      agentStatuses: JSON.stringify(agentStatuses),
    } as any).returning();

    res.json({ jobId: job.jobId, builderJobId: result.builderJobId, sourceId: id, status: "harvesting" });

    setImmediate(async () => {
      const pollInterval = setInterval(async () => {
        try {
          const builderJob = await getBuilderJob(result.builderJobId);
          if (!builderJob) { clearInterval(pollInterval); return; }
          await db.update(jobsTable).set({
            companiesHarvested: builderJob.companiesAdded,
            progress: builderJob.status === "completed" ? 100 : 50,
            status: builderJob.status === "completed" ? "completed" : builderJob.status === "failed" ? "failed" : "harvesting",
            updatedAt: new Date(),
          }).where(eq(jobsTable.jobId, result.jobId));
          if (["completed", "failed", "cancelled"].includes(builderJob.status)) { clearInterval(pollInterval); }
        } catch { clearInterval(pollInterval); }
      }, 2000);
    });
  } catch (err) {
    console.error("Single-source harvest error:", err);
    res.status(500).json({ error: "Failed to start harvest" });
  }
});

router.post("/builder/harvest", async (req: Request, res: Response): Promise<void> => {
  const {
    sourceIds = [],
    batchSize = 5,
    enrichmentDepth = "standard",
  } = req.body as { sourceIds?: string[]; batchSize?: number; enrichmentDepth?: "basic" | "standard" | "deep" };

  try {
    const customSources = await loadCustomSourcesFromDB();
    const extraSources = customSources.map(s => ({
      id: `custom-${s.id}`, name: s.name, nameAr: s.nameAr || s.name, url: s.url,
      category: s.category, description: s.description || "", estimatedCompanies: s.estimatedCompanies || 0,
    }));

    const allSources = [
      ...SAUDI_DATA_SOURCES,
      ...extraSources,
    ];

    const filteredSources = sourceIds.length > 0
      ? allSources.filter(s => sourceIds.includes(s.id))
      : allSources;

    if (filteredSources.length === 0) {
      res.status(400).json({ error: "No valid sources found for the provided sourceIds" });
      return;
    }

    const result = await runHarvest({ sourceIds: filteredSources.map(s => s.id), batchSize, enrichmentDepth, extraSources });

    const agentStatuses = filteredSources.map((s, i) => ({
      agentId: `agent-${i + 1}`,
      sourceId: s.id,
      sourceName: s.name,
      status: "idle" as const,
      companiesFound: 0,
      progress: 0,
    }));

    const [job] = await db.insert(jobsTable).values({
      jobId: result.jobId,
      type: "builder_harvest",
      status: "harvesting",
      sourceIds: JSON.stringify(filteredSources.map((s) => s.id)),
      sourcesTotal: filteredSources.length,
      sourcesCompleted: 0,
      companiesHarvested: 0,
      companiesEnriched: 0,
      companiesDuplicated: 0,
      progress: 0,
      total: filteredSources.length,
      companiesProcessed: 0,
      agentStatuses: JSON.stringify(agentStatuses),
    } as any).returning();

    res.json({
      jobId: job.jobId,
      builderJobId: result.builderJobId,
      status: "harvesting",
      sourceIds: filteredSources.map((s) => s.id),
      sourcesTotal: filteredSources.length,
      sourcesCompleted: 0,
      companiesHarvested: 0,
      companiesEnriched: 0,
      companiesDuplicated: 0,
      progress: 0,
      agentStatuses,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });

    setImmediate(async () => {
      const pollInterval = setInterval(async () => {
        try {
          const builderJob = await getBuilderJob(result.builderJobId);
          if (!builderJob) { clearInterval(pollInterval); return; }

          const progress = builderJob.status === "completed" ? 100 :
            Math.round((builderJob.sourceIndex / filteredSources.length) * 100);

          const updatedAgentStatuses = agentStatuses.map((agent, i) => {
            if (i < builderJob.sourceIndex) {
              return { ...agent, status: "completed" as const, progress: 100 };
            } else if (i < builderJob.sourceIndex + 1 && builderJob.status === "running") {
              return { ...agent, status: "harvesting" as const, progress: 50 };
            }
            return agent;
          });

          await db.update(jobsTable).set({
            sourcesCompleted: builderJob.sourceIndex,
            companiesHarvested: builderJob.companiesAdded,
            companiesDuplicated: builderJob.companiesDuplicate,
            progress,
            agentStatuses: JSON.stringify(updatedAgentStatuses),
            status: builderJob.status === "completed" ? "completed" : builderJob.status === "failed" ? "failed" : builderJob.status === "cancelled" ? "cancelled" : "harvesting",
            updatedAt: new Date(),
          }).where(eq(jobsTable.jobId, result.jobId));

          if (builderJob.status === "completed" || builderJob.status === "failed" || builderJob.status === "cancelled") {
            clearInterval(pollInterval);

            if (builderJob.status === "completed") {
              const enrichedCount = await db.select({ count: sql<number>`count(*)` }).from(builderCompaniesTable).where(
                and(eq(builderCompaniesTable.jobId, result.jobId), eq(builderCompaniesTable.isDuplicate, false))
              );
              await db.update(jobsTable).set({
                companiesEnriched: Number(enrichedCount[0]?.count || 0),
                status: "completed",
                progress: 100,
                updatedAt: new Date(),
              }).where(eq(jobsTable.jobId, result.jobId));
            }

            for (const s of filteredSources) {
              sourceLastHarvested[s.id] = new Date();
            }
          }
        } catch (err) {
          console.error("Poll error:", err);
          clearInterval(pollInterval);
        }
      }, 3000);
    });
  } catch (err) {
    console.error("Harvest error:", err);
    res.status(500).json({ error: "Failed to start harvest" });
  }
});

router.get("/builder/jobs", async (_req: Request, res: Response): Promise<void> => {
  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.type, "builder_harvest")).orderBy(desc(jobsTable.createdAt)).limit(20);
  res.json(jobs.map(formatJob));
});

router.get("/builder/jobs/:jobId", async (req: Request, res: Response): Promise<void> => {
  const jobId = p(req.params.jobId);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.jobId, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(formatJob(job));
});

router.post("/builder/jobs/:jobId/cancel", async (req: Request, res: Response): Promise<void> => {
  const jobId = p(req.params.jobId);
  await db.update(jobsTable).set({ status: "cancelled", updatedAt: new Date() } as any).where(eq(jobsTable.jobId, jobId));
  await cancelBuilderJobByLegacyJobId(jobId);
  res.json({ success: true, message: "Job cancelled" });
});

router.get("/builder/stats", async (_req: Request, res: Response): Promise<void> => {
  const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(builderCompaniesTable);
  const [enrichedRow] = await db.select({ count: sql<number>`count(*)::int` }).from(builderCompaniesTable).where(eq(builderCompaniesTable.enrichmentStatus, "enriched"));
  const [pendingRow] = await db.select({ count: sql<number>`count(*)::int` }).from(builderCompaniesTable).where(
    sql`(${builderCompaniesTable.enrichmentStatus} IS NULL OR ${builderCompaniesTable.enrichmentStatus} != 'enriched')`
  );
  const [dupRow] = await db.select({ count: sql<number>`count(*)::int` }).from(builderCompaniesTable).where(eq(builderCompaniesTable.isDuplicate, true));
  res.json({
    total: totalRow?.count || 0,
    enriched: enrichedRow?.count || 0,
    pending: pendingRow?.count || 0,
    duplicates: dupRow?.count || 0,
  });
});

router.get("/builder/results", async (req: Request, res: Response): Promise<void> => {
  const result = await getAllBuilderCompanies({
    page: parseInt(String(req.query.page || "1"), 10),
    limit: Math.min(parseInt(String(req.query.limit || "20"), 10), 100),
    status: req.query.status as string | undefined,
    industry: req.query.industry as string | undefined,
    companyType: req.query.companyType as string | undefined,
    jobId: req.query.jobId as string | undefined,
    hideDuplicates: req.query.hideDuplicates !== "false",
  });
  res.json(result);
});

router.post("/builder/results/:id/enrich", async (req: Request, res: Response): Promise<void> => {
  const rawId = Array.isArray(p(p(req.params.id))) ? p(p(req.params.id))[0] : p(p(req.params.id));
  const id = parseInt(rawId, 10);
  const [company] = await db.select().from(builderCompaniesTable).where(eq(builderCompaniesTable.id, id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  res.json({ success: true, message: "Enrichment started" });

  setImmediate(() => runInJob(`builder-enrich:${id}`, () => reEnrichCompany(id)).catch(console.error));
});

router.post("/builder/results/:id/save-enrichment", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(p(req.params.id)), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const {
    keyExecutives, shareholders, description, marketPositioning,
    ownerName, ownerNameAr, ownerTitle, revenue, employeeCount,
  } = req.body as Record<string, string | number | undefined>;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (keyExecutives != null) updates.keyExecutives = keyExecutives;
  if (shareholders != null) updates.shareholders = shareholders;
  if (description) updates.description = description;
  if (marketPositioning) updates.marketPositioning = marketPositioning;
  if (ownerName) updates.ownerName = ownerName;
  if (ownerNameAr) updates.ownerNameAr = ownerNameAr;
  if (ownerTitle) updates.ownerTitle = ownerTitle;
  if (revenue) updates.revenue = String(revenue);
  if (employeeCount) updates.employeeCount = Number(employeeCount) || undefined;

  await db.update(builderCompaniesTable).set(updates as any).where(eq(builderCompaniesTable.id, id));
  res.json({ success: true });
});

router.post("/builder/bulk-enrich", async (req: Request, res: Response): Promise<void> => {
  let { ids } = req.body as { ids?: number[] };

  if (!ids?.length) {
    const pending = await db.select({ id: builderCompaniesTable.id })
      .from(builderCompaniesTable)
      .where(
        and(
          eq(builderCompaniesTable.isDuplicate, false),
          sql`(${builderCompaniesTable.enrichmentStatus} IS NULL OR ${builderCompaniesTable.enrichmentStatus} != 'enriched')`
        )
      );
    ids = pending.map(c => c.id);
  }

  if (!ids.length) {
    res.json({ success: true, message: "All companies are already enriched" });
    return;
  }

  res.json({ success: true, message: `Bulk enrichment started for ${ids.length} companies` });

  setImmediate(() => runInJob(`builder-bulk-enrich:${Date.now()}`, async () => {
    for (const id of ids) {
      try {
        await reEnrichCompany(id);
      } catch (err) {
        console.error(`[Builder] Bulk enrich error for ID ${id}:`, err);
      }
    }
    console.log(`[Builder] Bulk enrichment complete for ${ids.length} companies`);
  }));
});

router.post("/builder/re-enrich/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(p(req.params.id)), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid company ID" });
    return;
  }
  const result = await runInJob(`builder-enrich:${id}`, () => reEnrichCompany(id));
  if (!result.success) {
    res.status(404).json({ error: result.message });
    return;
  }
  res.json(result);
});

router.post("/builder/re-enrich-all", async (_req: Request, res: Response): Promise<void> => {
  const result = await runInJob(`builder-enrich-all:${Date.now()}`, () => reEnrichAll());
  res.json(result);
});

router.post("/builder/deduplicate", async (_req: Request, res: Response): Promise<void> => {
  const result = await deduplicateAll();
  res.json(result);
});

router.post("/builder/clean", async (_req: Request, res: Response): Promise<void> => {
  const result = await autoClean();
  res.json(result);
});

router.get("/builder/incomplete", async (_req: Request, res: Response): Promise<void> => {
  const companies = await getIncompleteCompanies();
  res.json({ companies, total: companies.length });
});

router.get("/builder/companies", async (_req: Request, res: Response): Promise<void> => {
  const companies = await db.select().from(builderCompaniesTable).orderBy(desc(builderCompaniesTable.updatedAt));
  res.json({ companies, total: companies.length });
});

router.post("/builder/clean-data", async (_req: Request, res: Response): Promise<void> => {
  const result = await autoClean();
  res.json(result);
});

router.post("/builder/push-to-database", async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.body as { ids: number[] };

  let companies;
  if (ids?.length) {
    companies = await db.select().from(builderCompaniesTable).where(inArray(builderCompaniesTable.id, ids));
  } else {
    companies = await db.select().from(builderCompaniesTable).where(eq(builderCompaniesTable.isDuplicate, false));
  }

  let pushed = 0;
  for (const bc of companies) {
    try {
      await db.insert(companiesTable).values({
        nameAr: bc.nameAr,
        nameEn: bc.nameEn,
        industry: bc.industry,
        industryAr: bc.industryAr,
        city: bc.city,
        region: bc.region,
        country: bc.country,
        website: bc.website,
        phone: bc.phone,
        email: bc.email,
        description: bc.description,
        descriptionAr: bc.descriptionAr,
        employeeCount: bc.employeeCount,
        revenue: bc.revenue,
        foundingYear: bc.foundingYear,
        crNumber: bc.crNumber,
        capitalAmount: bc.capitalAmount,
        entityType: bc.entityType,
        companyType: bc.companyType,
        ownerName: bc.ownerName,
        ownerNameAr: bc.ownerNameAr,
        ownerTitle: bc.ownerTitle,
        ownerPhone: bc.ownerPhone,
        ownerEmail: bc.ownerEmail,
        ownerLinkedin: bc.ownerLinkedin,
        estimatedWealth: bc.estimatedWealth,
        shareholders: bc.shareholders,
        keyExecutives: bc.keyExecutives,
        marketPositioning: bc.marketPositioning,
        recentNews: bc.recentNews,
        linkedinUrl: bc.linkedinUrl,
        enrichmentScore: bc.enrichmentScore,
        enrichmentStatus: bc.enrichmentStatus,
        dataSource: `builder:${bc.sourceId}`,
      } as any);
      pushed++;
    } catch {
    }
  }

  res.json({ success: true, message: `Pushed ${pushed} companies to main database` });
});

router.get("/builder/builder-jobs", async (_req: Request, res: Response): Promise<void> => {
  const jobs = await getBuilderJobs();
  res.json(jobs);
});

router.get("/builder/builder-jobs/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(p(req.params.id)), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }
  const job = await getBuilderJob(id);
  if (!job) {
    res.status(404).json({ error: "Builder job not found" });
    return;
  }
  res.json(job);
});

function formatJob(job: typeof jobsTable.$inferSelect) {
  let agentStatuses = [];
  try { agentStatuses = JSON.parse(job.agentStatuses || "[]"); } catch {}
  let sourceIds = [];
  try { sourceIds = JSON.parse(job.sourceIds || "[]"); } catch {}

  return {
    jobId: job.jobId,
    status: job.status,
    sourceIds,
    sourcesTotal: job.sourcesTotal,
    sourcesCompleted: job.sourcesCompleted,
    companiesHarvested: job.companiesHarvested,
    companiesEnriched: job.companiesEnriched,
    companiesDuplicated: job.companiesDuplicated,
    progress: job.progress,
    agentStatuses,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// DELETE /api/builder/companies/bulk — delete multiple builder companies by id
router.delete("/builder/companies/bulk", async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array required" }); return; }
  try {
    const companies = await db.select().from(builderCompaniesTable).where(inArray(builderCompaniesTable.id, ids));
    if (companies.length > 0) {
      await addToBlocklist(companies.map(c => ({ nameEn: c.nameEn, nameAr: c.nameAr, crNumber: c.crNumber, website: c.website })), "builder");
    }
    await db.delete(builderCompaniesTable).where(inArray(builderCompaniesTable.id, ids));
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", detail: String(err) });
  }
});

// GET /api/builder/export — export builder results as CSV, Excel, Word, PDF, or PPTX
router.get("/builder/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const format = String(req.query.format || "csv").toLowerCase();
    const search = String(req.query.search || "").trim();
    const sourceFilter = String(req.query.sourceId || "").trim();
    const hideDuplicates = req.query.hideDuplicates !== "false";
    const idsParam = req.query.ids as string | undefined;

    const date = new Date().toISOString().slice(0, 10);
    const humanDate = new Date().toLocaleDateString("en-SA", { year: "numeric", month: "long", day: "numeric" });

    let companies;
    if (idsParam) {
      const ids = idsParam.split(",").map(Number).filter(Boolean);
      companies = await db.select().from(builderCompaniesTable).where(inArray(builderCompaniesTable.id, ids)).orderBy(desc(builderCompaniesTable.updatedAt));
    } else {
      const conditions: ReturnType<typeof eq>[] = [];
      if (hideDuplicates) conditions.push(eq(builderCompaniesTable.isDuplicate, false));
      if (search) conditions.push(or(ilike(builderCompaniesTable.nameEn, `%${search}%`), ilike(builderCompaniesTable.nameAr, `%${search}%`)) as ReturnType<typeof eq>);
      if (sourceFilter) conditions.push(ilike(builderCompaniesTable.sourceId, sourceFilter) as ReturnType<typeof eq>);
      companies = await db.select().from(builderCompaniesTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(builderCompaniesTable.updatedAt))
        .limit(10000);
    }
    const label = idsParam ? `${companies.length} selected companies` : `${companies.length} companies`;

    const rows = companies.map(c => ({
      "ID": c.id, "Name (EN)": c.nameEn || "", "Name (AR)": c.nameAr || "",
      "Industry": c.industry || "", "City": c.city || "", "Region": c.region || "",
      "Country": c.country || "Saudi Arabia", "Website": c.website || "",
      "Phone": c.phone || "", "Email": c.email || "",
      "Description": (c.description || "").replace(/\n/g, " ").slice(0, 300),
      "CR Number": c.crNumber || "", "Capital": c.capitalAmount || "",
      "Entity Type": c.entityType || "", "Company Type": c.companyType || "",
      "Founding Year": c.foundingYear || "", "Owner Name": c.ownerName || "",
      "Owner Email": c.ownerEmail || "", "Owner Phone": c.ownerPhone || "",
      "Revenue": c.revenue || "", "Key Executives": c.keyExecutives || "",
      "LinkedIn": c.linkedinUrl || "", "Enrichment Score": c.enrichmentScore ?? "",
      "Enrichment Status": c.enrichmentStatus || "", "Source": c.sourceId || "",
      "Duplicate": c.isDuplicate ? "Yes" : "No",
    }));

    if (format === "excel") {
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 12) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Builder Results");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="builder_results_${date}.xlsx"`);
      res.send(buf); return;
    }

    if (format === "word") {
      const wordRows = companies.map((c, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f0fdf4'}">
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#1f2937;font-weight:bold;">${c.nameEn || c.nameAr || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.industry || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.city || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.crNumber || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.website || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.phone || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.email || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.ownerName || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.revenue || "—"}</td>
        <td style="padding:5pt 8pt;border-bottom:1pt solid #e5e7eb;color:#374151;">${c.enrichmentStatus || "pending"}</td>
      </tr>`).join("");
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>AI Database Builder Results</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; margin: 2cm; color: #1a1a2e; background: #ffffff; }
  h1 { font-size: 20pt; color: #0d7a5f; margin-bottom: 2pt; font-weight: bold; }
  h2 { font-size: 11pt; color: #2563eb; margin: 0 0 4pt 0; font-weight: normal; }
  .meta { font-size: 9pt; color: #4b5563; margin-bottom: 18pt; border-top: 2pt solid #0d7a5f; padding-top: 6pt; }
  table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
  th { background: #0d7a5f; color: #ffffff; padding: 6pt 8pt; text-align: left; font-weight: bold; }
  .footer { font-size: 8pt; color: #6b7280; margin-top: 14pt; border-top: 1pt solid #d1d5db; padding-top: 6pt; }
</style></head>
<body>
<h1>AI Database Builder — Results</h1>
<h2>ProspectSA — Saudi B2B Intelligence Platform</h2>
<div class="meta">Exported: ${humanDate} &nbsp;|&nbsp; ${label}</div>
<table>
  <thead><tr>
    <th>Company</th><th>Industry</th><th>City</th><th>CR No.</th>
    <th>Website</th><th>Phone</th><th>Email</th><th>Owner</th><th>Revenue</th><th>Status</th>
  </tr></thead>
  <tbody>${wordRows}</tbody>
</table>
<div class="footer">ProspectSA · AI Database Builder · Generated ${humanDate}</div>
</body></html>`;
      res.setHeader("Content-Type", "application/vnd.ms-word");
      res.setHeader("Content-Disposition", `attachment; filename="builder_results_${date}.doc"`);
      res.send(html); return;
    }

    if (format === "pdf") {
      const pdfRows = companies.map((c, i) => `
      <tr style="background:${i % 2 === 0 ? "#0d1117" : "#111827"}">
        <td style="font-weight:bold;color:#e2e8f0;">${c.nameEn || c.nameAr || "—"}</td>
        <td>${c.industry || "—"}</td>
        <td>${c.city || "—"}</td>
        <td>${c.crNumber || "—"}</td>
        <td>${c.website || "—"}</td>
        <td>${c.phone || "—"}</td>
        <td>${c.email || "—"}</td>
        <td>${c.ownerName || "—"}</td>
        <td>${c.revenue || "—"}</td>
        <td><span style="color:${c.enrichmentStatus === 'enriched' ? '#34d399' : '#6b7280'}">${c.enrichmentStatus || "pending"}</span></td>
      </tr>`).join("");
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Builder Results — ${humanDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; background: #0b0b14; color: #e2e8f0; padding: 16px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #1e2d3d; }
  .logo { font-size: 20px; font-weight: 700; color: #34d399; letter-spacing: -0.5px; }
  .logo span { color: #818cf8; }
  .meta { font-size: 9px; color: #64748b; }
  h2 { font-size: 13px; color: #94a3b8; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { background: #0f1f3d; color: #60a5fa; padding: 5px 7px; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #1e3a5f; }
  td { padding: 4px 7px; border-bottom: 1px solid #1a2234; vertical-align: top; color: #cbd5e1; }
  .footer { margin-top: 12px; font-size: 8px; color: #334155; text-align: center; }
  .print-btn { background: #34d399; color: #0f0f1a; border: none; padding: 7px 18px; border-radius: 6px; font-size: 11px; cursor: pointer; margin-bottom: 12px; font-weight: 600; }
  @media print { .print-btn { display: none; } body { padding: 6mm; } }
</style></head>
<body>
<div class="header">
  <div class="logo">Prospect<span>SA</span></div>
  <div class="meta">AI Database Builder &nbsp;·&nbsp; ${humanDate}</div>
</div>
<h2>${label}</h2>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<table>
  <thead><tr>
    <th>Company</th><th>Industry</th><th>City</th><th>CR No.</th>
    <th>Website</th><th>Phone</th><th>Email</th><th>Owner</th><th>Revenue</th><th>Status</th>
  </tr></thead>
  <tbody>${pdfRows}</tbody>
</table>
<div class="footer">ProspectSA · AI Database Builder · Generated ${humanDate} · Total: ${companies.length} companies</div>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html); return;
    }

    if (format === "pptx") {
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: "LAYOUT_WIDE", width: 13.33, height: 7.5 });
      pptx.layout = "LAYOUT_WIDE";
      for (const c of companies) {
        const slide = pptx.addSlide();
        slide.background = { color: "0f0f1a" };
        const name = c.nameEn || c.nameAr || "Unknown Company";
        slide.addText(name, { x: 0.4, y: 0.25, w: 9, h: 0.6, fontSize: 22, bold: true, color: "FFFFFF", fontFace: "Calibri" });
        if (c.nameAr && c.nameEn) slide.addText(c.nameAr, { x: 0.4, y: 0.85, w: 9, h: 0.35, fontSize: 13, color: "AAAACC", fontFace: "Calibri", rtlMode: true });
        const fields: [string, string][] = [
          ["Industry", c.industry || "—"], ["City", c.city || "—"],
          ["CR Number", c.crNumber || "—"], ["Capital", c.capitalAmount || "—"],
          ["Website", c.website || "—"], ["Phone", c.phone || "—"],
          ["Email", c.email || "—"], ["Owner", c.ownerName || "—"],
          ["Revenue", c.revenue || "—"], ["Founded", String(c.foundingYear || "—")],
          ["Score", `${c.enrichmentScore ?? "—"}%`], ["Status", c.enrichmentStatus || "pending"],
        ];
        const half = Math.ceil(fields.length / 2);
        fields.forEach(([label, value], i) => {
          const col = i < half ? 0 : 1;
          const row = i < half ? i : i - half;
          const x = col === 0 ? 0.4 : 6.8;
          const y = 1.35 + row * 0.55;
          slide.addText(label.toUpperCase(), { x, y, w: 2.8, h: 0.22, fontSize: 7, bold: true, color: "7777AA", fontFace: "Calibri" });
          slide.addText(value, { x, y: y + 0.2, w: 2.8, h: 0.28, fontSize: 10, color: "DDDDEE", fontFace: "Calibri" });
        });
        if (c.description) {
          slide.addText(c.description.slice(0, 400), { x: 0.4, y: 5.5, w: 12.4, h: 1.6, fontSize: 9, color: "9999BB", fontFace: "Calibri", wrap: true });
        }
        slide.addText(`ProspectSA · AI Database Builder · ${humanDate}`, { x: 0.4, y: 7.15, w: 12.4, h: 0.25, fontSize: 7, color: "555577", fontFace: "Calibri" });
      }
      const buf = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="builder_results_${date}.pptx"`);
      res.send(buf); return;
    }

    // CSV (default)
    const headers = Object.keys(rows[0] || {});
    const csvRows = rows.map(r =>
      headers.map(h => `"${String((r as Record<string, unknown>)[h] ?? "").replace(/"/g, '""')}"`).join(",")
    );
    const csv = [headers.map(h => `"${h}"`).join(","), ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="builder_results_${date}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    res.status(500).json({ error: "Export failed", detail: String(err) });
  }
});

export default router;
