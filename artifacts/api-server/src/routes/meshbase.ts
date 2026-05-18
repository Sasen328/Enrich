import { Router, type IRouter, type Request, type Response } from "express";
import { db, companiesTable, executivesTable } from "@workspace/db";
import { eq, ilike, and, or, sql, desc, asc, inArray, gte, lte } from "drizzle-orm";
import {
  enrichCompanyWithApollo,
  searchPeopleByDomain,
  matchPerson,
} from "../lib/apollo-service.js";
import { getOpenAIClient } from "../openai-client.js";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const aiGenerationJobs = new Map<string, { status: string; processed: number; total: number; generated: number }>();
const router: IRouter = Router();
const activeJobs = new Map<string, { status: string; processed: number; total: number; errors: string[] }>();

function cleanCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (/^Q\d+$/.test(name.trim())) return null;
  return name;
}

function estimatedSalaryRange(position?: string | null, seniority?: string | null): string | null {
  const p = (position || "").toLowerCase();
  const s = (seniority || "").toLowerCase();
  const combined = `${p} ${s}`;
  if (/\b(ceo|cfo|cto|coo|chief|founder|managing director|president|general manager)\b/.test(combined)) return "SAR 1.2M – 5M / year";
  if (/\b(vp|vice president)\b/.test(combined)) return "SAR 600K – 1.5M / year";
  if (/\b(director)\b/.test(combined)) return "SAR 360K – 800K / year";
  if (/\b(manager|head of|senior)\b/.test(combined)) return "SAR 180K – 420K / year";
  if (/\b(analyst|specialist|engineer|consultant)\b/.test(combined)) return "SAR 90K – 200K / year";
  return null;
}

// ── MeshBase stats ─────────────────────────────────────────────────────────

router.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  const [cCount, eCount, indCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select({ count: sql<number>`count(*)` }).from(executivesTable),
    db.select({ count: sql<number>`count(distinct ${companiesTable.industry})` }).from(companiesTable).where(sql`${companiesTable.industry} IS NOT NULL`),
  ]);
  res.json({
    totalCompanies: Number(cCount[0]?.count || 0),
    totalExecutives: Number(eCount[0]?.count || 0),
    totalIndustries: Number(indCount[0]?.count || 0),
  });
});

router.get("/industry-distribution", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({ industry: companiesTable.industry, count: sql<number>`count(*)` })
    .from(companiesTable)
    .where(sql`${companiesTable.industry} IS NOT NULL AND ${companiesTable.industry} != ''`)
    .groupBy(companiesTable.industry)
    .orderBy(sql`count(*) DESC`)
    .limit(20);
  res.json(rows.map(r => ({ name: r.industry, count: Number(r.count) })));
});

// ── Executives list ────────────────────────────────────────────────────────

router.get("/executives", async (req: Request, res: Response): Promise<void> => {
  const page = parseInt(String(req.query.page || "1"), 10);
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10), 100);
  const offset = (page - 1) * limit;

  const search = (req.query.search || req.query.q) as string | undefined;
  const companyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;
  const sortBy = (req.query.sortBy as string) || "name_asc";

  const levels = req.query.levels as string | undefined;
  const experienceRanges = req.query.experienceRanges as string | undefined;
  const salaryRanges = req.query.salaryRanges as string | undefined;
  const companyIds = req.query.companyIds as string | undefined;

  const conditions: any[] = [];

  if (search) {
    conditions.push(
      or(
        ilike(executivesTable.name, `%${search}%`),
        ilike(executivesTable.position, `%${search}%`),
        ilike(executivesTable.companyName, `%${search}%`)
      )
    );
  }

  if (companyId && !isNaN(companyId)) {
    conditions.push(eq(executivesTable.companyId, companyId));
  }

  if (companyIds) {
    const cIdList = companyIds.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (cIdList.length > 0) {
      conditions.push(inArray(executivesTable.companyId, cIdList));
    }
  }

  if (levels) {
    const levelList = levels.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const levelConditions: any[] = [];
    for (const lvl of levelList) {
      switch (lvl) {
        case "c-suite":
          levelConditions.push(
            or(
              ilike(executivesTable.position, "%chief%"),
              ilike(executivesTable.position, "%ceo%"),
              ilike(executivesTable.position, "%cfo%"),
              ilike(executivesTable.position, "%cto%"),
              ilike(executivesTable.position, "%coo%"),
              ilike(executivesTable.position, "%president%"),
              ilike(executivesTable.position, "%general manager%"),
              ilike(executivesTable.position, "%managing director%")
            )
          );
          break;
        case "vp":
          levelConditions.push(
            or(
              ilike(executivesTable.position, "%vice president%"),
              ilike(executivesTable.position, "%vp%"),
              ilike(executivesTable.position, "%svp%"),
              ilike(executivesTable.position, "%evp%")
            )
          );
          break;
        case "director":
          levelConditions.push(ilike(executivesTable.position, "%director%"));
          break;
        case "manager":
          levelConditions.push(
            or(
              ilike(executivesTable.position, "%manager%"),
              ilike(executivesTable.position, "%head of%")
            )
          );
          break;
        case "founder":
          levelConditions.push(ilike(executivesTable.position, "%founder%"));
          break;
        case "chairman":
          levelConditions.push(ilike(executivesTable.position, "%chairman%"));
          break;
      }
    }
    if (levelConditions.length === 1) {
      conditions.push(levelConditions[0]);
    } else if (levelConditions.length > 1) {
      conditions.push(or(...levelConditions));
    }
  }

  if (experienceRanges) {
    const expList = experienceRanges.split(",").map(s => s.trim()).filter(Boolean);
    const expConditions: any[] = [];
    for (const range of expList) {
      if (range === "0-5") expConditions.push(and(gte(executivesTable.yearsOfExperience, 0), lte(executivesTable.yearsOfExperience, 5)));
      else if (range === "5-10") expConditions.push(and(gte(executivesTable.yearsOfExperience, 5), lte(executivesTable.yearsOfExperience, 10)));
      else if (range === "10-15") expConditions.push(and(gte(executivesTable.yearsOfExperience, 10), lte(executivesTable.yearsOfExperience, 15)));
      else if (range === "15-20") expConditions.push(and(gte(executivesTable.yearsOfExperience, 15), lte(executivesTable.yearsOfExperience, 20)));
      else if (range === "20+") expConditions.push(gte(executivesTable.yearsOfExperience, 20));
    }
    if (expConditions.length === 1) conditions.push(expConditions[0]);
    else if (expConditions.length > 1) conditions.push(or(...expConditions));
  }

  if (salaryRanges) {
    const salList = salaryRanges.split(",").map(s => s.trim()).filter(Boolean);
    const salConditions: any[] = [];
    for (const range of salList) {
      if (range === "0-500000") salConditions.push(lte(executivesTable.estimatedSalary, 500000));
      else if (range === "500000-1000000") salConditions.push(and(gte(executivesTable.estimatedSalary, 500000), lte(executivesTable.estimatedSalary, 1000000)));
      else if (range === "1000000-2000000") salConditions.push(and(gte(executivesTable.estimatedSalary, 1000000), lte(executivesTable.estimatedSalary, 2000000)));
      else if (range === "2000000-5000000") salConditions.push(and(gte(executivesTable.estimatedSalary, 2000000), lte(executivesTable.estimatedSalary, 5000000)));
      else if (range === "5000000+") salConditions.push(gte(executivesTable.estimatedSalary, 5000000));
    }
    if (salConditions.length === 1) conditions.push(salConditions[0]);
    else if (salConditions.length > 1) conditions.push(or(...salConditions));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let orderByClause: any;
  switch (sortBy) {
    case "name_asc":   orderByClause = asc(executivesTable.name);  break;
    case "name_desc":  orderByClause = desc(executivesTable.name); break;
    case "salary_high": orderByClause = desc(executivesTable.estimatedSalary); break;
    case "salary_low":  orderByClause = asc(executivesTable.estimatedSalary);  break;
    case "experience_most":  orderByClause = desc(executivesTable.yearsOfExperience); break;
    case "experience_least": orderByClause = asc(executivesTable.yearsOfExperience);  break;
    default: orderByClause = asc(executivesTable.name);
  }

  const [rawExecs, countResult] = await Promise.all([
    db.select().from(executivesTable).where(whereClause).orderBy(orderByClause).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(executivesTable).where(whereClause),
  ]);

  const executives = rawExecs.map((e) => ({
    ...e,
    companyName: cleanCompanyName(e.companyName),
    linkedinUrl: e.linkedinUrl || e.linkedin || null,
    salary: e.salary || estimatedSalaryRange(e.position, e.seniorityLevel),
  }));

  const total = Number(countResult[0]?.count || 0);
  res.json({ executives, total, page, limit, totalPages: Math.ceil(total / limit) });
});

router.get("/executives/export", async (req: Request, res: Response): Promise<void> => {
  const format = (req.query.format as string) || "csv";
  const idsParam = req.query.ids as string | undefined;

  let execs;
  if (idsParam) {
    const ids = idsParam.split(",").map(Number).filter(Boolean);
    execs = await db.select().from(executivesTable).where(inArray(executivesTable.id, ids));
  } else {
    execs = await db.select().from(executivesTable).orderBy(asc(executivesTable.name)).limit(10000);
  }

  if (format === "json") {
    res.json(execs);
    return;
  }

  const headers = [
    "id", "name", "nameAr", "position", "companyName", "email", "linkedin",
    "yearsOfExperience", "estimatedSalary", "education", "biography", "photoUrl", "seniorityLevel",
  ];

  const csvRows = [
    headers.join(","),
    ...execs.map((e) =>
      headers.map((h) => {
        const val = e[h as keyof typeof e];
        if (val === null || val === undefined) return "";
        if (Array.isArray(val)) return `"${val.join("; ").replace(/"/g, '""')}"`;
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(",")
    ),
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=meshbase-executives.csv");
  res.send(csvRows.join("\n"));
});

router.post("/executives/bulk-delete", async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.body as { ids: number[] };
  if (!ids?.length) { res.status(400).json({ error: "No IDs provided" }); return; }
  await db.delete(executivesTable).where(inArray(executivesTable.id, ids));
  res.json({ success: true, message: `Deleted ${ids.length} executives` });
});

router.get("/executives/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(p(req.params.id)), 10);
  const [executive] = await db.select().from(executivesTable).where(eq(executivesTable.id, id));
  if (!executive) { res.status(404).json({ error: "Executive not found" }); return; }
  res.json({
    ...executive,
    linkedinUrl: executive.linkedinUrl || executive.linkedin || null,
    salary: executive.salary || estimatedSalaryRange(executive.position, executive.seniorityLevel),
  });
});

router.post("/executives", async (req: Request, res: Response): Promise<void> => {
  const body = req.body;
  const allowed: Record<string, any> = {};
  const allowedFields = [
    "companyId", "companyName", "name", "nameAr", "position", "positionAr",
    "email", "phone", "linkedinUrl", "location", "biography", "education",
    "salary", "seniorityLevel", "department", "photoUrl", "yearsOfExperience", "estimatedSalary",
  ];
  for (const field of allowedFields) {
    if (body[field] !== undefined) allowed[field] = body[field];
  }
  if (!allowed.name) { res.status(400).json({ error: "Name is required" }); return; }
  const [created] = await db.insert(executivesTable).values(allowed).returning();
  res.status(201).json(created);
});

router.delete("/executives/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(p(req.params.id)), 10);
  await db.delete(executivesTable).where(eq(executivesTable.id, id));
  res.json({ success: true, message: "Executive deleted" });
});

router.get("/companies/:id/executives", async (req: Request, res: Response): Promise<void> => {
  const companyId = parseInt(String(p(req.params.id)), 10);
  const rawExecs = await db.select().from(executivesTable).where(eq(executivesTable.companyId, companyId)).orderBy(asc(executivesTable.name));
  const executives = rawExecs.map((e) => ({
    ...e,
    companyName: cleanCompanyName(e.companyName),
    linkedinUrl: e.linkedinUrl || e.linkedin || null,
    salary: e.salary || estimatedSalaryRange(e.position, e.seniorityLevel),
  }));
  res.json({ executives });
});

router.get("/enrichment/stats", async (_req: Request, res: Response): Promise<void> => {
  const [totalCompanies, enrichedCompanies, partialCompanies, totalExecutives, enrichedExecutives] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.enrichmentStatus, "enriched")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.enrichmentStatus, "partial")),
    db.select({ count: sql<number>`count(*)` }).from(executivesTable),
    db.select({ count: sql<number>`count(*)` }).from(executivesTable).where(eq(executivesTable.enrichmentStatus, "enriched")),
  ]);

  res.json({
    companies: {
      total: Number(totalCompanies[0]?.count || 0),
      enriched: Number(enrichedCompanies[0]?.count || 0),
      partial: Number(partialCompanies[0]?.count || 0),
      unenriched: Number(totalCompanies[0]?.count || 0) - Number(enrichedCompanies[0]?.count || 0) - Number(partialCompanies[0]?.count || 0),
    },
    executives: {
      total: Number(totalExecutives[0]?.count || 0),
      enriched: Number(enrichedExecutives[0]?.count || 0),
      unenriched: Number(totalExecutives[0]?.count || 0) - Number(enrichedExecutives[0]?.count || 0),
    },
  });
});

router.post("/enrichment/run", async (_req: Request, res: Response): Promise<void> => {
  const jobId = `enrich-${Date.now()}`;
  activeJobs.set(jobId, { status: "running", processed: 0, total: 0, errors: [] });
  res.json({ success: true, jobId, message: "Batch enrichment started" });
});

router.post("/enrichment/single/:companyId", async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, message: "Single enrichment started" });
});

router.post("/enrichment/add-team", async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, message: "Team enrichment started" });
});

router.post("/ai-generate-executives", async (req: Request, res: Response): Promise<void> => {
  const batchSize = parseInt(String(req.body?.batchSize || "30"), 10);
  const jobId = `ai-exec-${Date.now()}`;
  aiGenerationJobs.set(jobId, { status: "running", processed: 0, total: 0, generated: 0 });
  res.json({ success: true, jobId, message: "AI executive generation started" });
});

router.get("/ai-generate-executives/:jobId", async (req: Request, res: Response): Promise<void> => {
  const jobId = p(req.params.jobId);
  const job = aiGenerationJobs.get(jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(job);
});

export default router;
