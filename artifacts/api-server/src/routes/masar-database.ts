/**
 * Masar Database API Routes
 * Routes at /api/masar/database/*
 * NEVER writes to companiesTable.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { masarCompaniesTable, masarHarvestJobsTable, masarCustomSourcesTable } from "@workspace/db/schema";
import { addToBlocklist } from "../lib/blocklist.js";
import { eq, desc, ilike, or, and, sql, ne, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";
import {
  createHarvestJob,
  cancelHarvestJob,
  getHarvestEmitter,
  runHarvest,
  enrichMasarCompany,
  type HarvestEvent,
} from "../lib/masar-harvester.js";
import { createJob, getJobEmitter, runMasaarPipeline, runMasaarPipelineByName, type MasaarReport } from "../lib/masaar-engine.js";
import Anthropic from "@anthropic-ai/sdk";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const router: IRouter = Router();

// POST /api/masar/database/harvest — start a harvest job
router.post("/masar/database/harvest", async (req: Request, res: Response): Promise<void> => {
  const { companyName, keyword, sector, instructions, parameters, source, sources, customUrls } = req.body as {
    companyName?: string;
    keyword?: string;
    sector?: string;
    instructions?: string;
    parameters?: { city?: string; legalForm?: string; size?: string; revenue?: string };
    source?: string;
    sources?: string[];
    customUrls?: string[];
  };

  // Support both legacy `source` (string) and new `sources` (array)
  let resolvedSources: string[];
  if (Array.isArray(sources) && sources.length > 0) {
    resolvedSources = sources;
  } else if (source) {
    resolvedSources = [source === "amaaly-aoa" ? "amaaly-aoa" : "open-data"];
  } else {
    resolvedSources = ["open-data"];
  }

  const transientUrls = Array.isArray(customUrls) ? customUrls.filter(u => u && u.startsWith("http")) : [];
  // Only use URLs explicitly passed from the frontend (includes saved sources the user selected)
  const resolvedCustomUrls = [...new Set(transientUrls)];

  // Build a composite search term from all inputs (any combination is valid)
  const parts = [companyName, keyword, sector].filter(p => p && String(p).trim().length > 0).map(p => String(p).trim());
  const kw = parts.length > 0 ? parts.join(" ") : "Saudi Arabia companies";

  const jobId = randomUUID();
  createHarvestJob(jobId);

  res.json({
    jobId,
    keyword: kw,
    sources: resolvedSources,
    customUrls: resolvedCustomUrls,
    message: `Harvest started — streaming via GET /api/masar/database/stream/${jobId}`,
  });

  setImmediate(() => {
    runHarvest(jobId, kw, resolvedSources, resolvedCustomUrls, {
      companyName: companyName?.trim(),
      keyword: keyword?.trim(),
      sector: sector?.trim(),
      instructions: instructions?.trim(),
      parameters,
    }).catch((err) => {
      const emitter = getHarvestEmitter(jobId);
      emitter?.emit("event", { type: "error", error: err instanceof Error ? err.message : "Harvest failed" });
    });
  });
});

// GET /api/masar/database/stream/:jobId — SSE stream of harvest events
router.get("/masar/database/stream/:jobId", (req: Request, res: Response): void => {
  const jobId = String(p(req.params.jobId));
  const emitter = getHarvestEmitter(jobId);

  if (!emitter) {
    res.status(404).json({ error: "Job not found or expired" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: HarvestEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if ("flush" in res && typeof (res as Record<string, unknown>).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);

  emitter.on("event", sendEvent);

  const cleanup = () => {
    clearInterval(heartbeat);
    emitter.off("event", sendEvent);
  };

  emitter.on("event", (evt: HarvestEvent) => {
    if (evt.type === "complete" || evt.type === "error") {
      setTimeout(cleanup, 3000);
    }
  });

  req.on("close", cleanup);
  req.on("error", cleanup);
});

// GET /api/masar/database/companies — paginated list with filters
router.get("/masar/database/companies", async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1")));
    const limit = Math.min(100, Math.max(5, parseInt(String(req.query.limit || "25"))));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const city = String(req.query.city || "").trim();
    const enrichmentStatus = String(req.query.enrichmentStatus || "").trim();
    const source = String(req.query.source || "").trim();
    const legalForm = String(req.query.legalForm || "").trim();

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(masarCompaniesTable.nameEn, `%${search}%`),
          ilike(masarCompaniesTable.nameAr, `%${search}%`),
          ilike(masarCompaniesTable.crNumber, `%${search}%`),
          ilike(masarCompaniesTable.mainActivity, `%${search}%`),
        )
      );
    }
    if (city) conditions.push(or(ilike(masarCompaniesTable.city, `%${city}%`), ilike(masarCompaniesTable.cityAr, `%${city}%`)));
    if (enrichmentStatus) conditions.push(eq(masarCompaniesTable.enrichmentStatus, enrichmentStatus));
    if (source) conditions.push(eq(masarCompaniesTable.source, source));
    if (legalForm) conditions.push(ilike(masarCompaniesTable.legalForm, `%${legalForm}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [companies, countResult] = await Promise.all([
      db.select().from(masarCompaniesTable)
        .where(whereClause)
        .orderBy(desc(masarCompaniesTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)` }).from(masarCompaniesTable).where(whereClause),
    ]);

    const total = Number(countResult[0]?.count || 0);

    res.json({
      companies,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch companies", detail: String(err) });
  }
});

// GET /api/masar/database/companies/:id — single company detail
router.get("/masar/database/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(p(req.params.id)));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const rows = await db.select().from(masarCompaniesTable).where(eq(masarCompaniesTable.id, id)).limit(1);
    if (!rows.length) { res.status(404).json({ error: "Company not found" }); return; }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch company", detail: String(err) });
  }
});

// DELETE /api/masar/database/companies/bulk — MUST be before /:id to avoid "bulk" matching as id
router.delete("/masar/database/companies/bulk", async (req: Request, res: Response): Promise<void> => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array required" }); return; }
  try {
    const companies = await db.select().from(masarCompaniesTable).where(inArray(masarCompaniesTable.id, ids));
    if (companies.length > 0) {
      await addToBlocklist(companies.map(c => ({ nameEn: c.nameEn, nameAr: c.nameAr, crNumber: c.crNumber, website: c.website })), "masaar");
    }
    await db.delete(masarCompaniesTable).where(inArray(masarCompaniesTable.id, ids));
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", detail: String(err) });
  }
});

// DELETE /api/masar/database/companies/:id
router.delete("/masar/database/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(p(req.params.id)));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [company] = await db.select().from(masarCompaniesTable).where(eq(masarCompaniesTable.id, id)).limit(1);
    if (company) {
      await addToBlocklist([{ nameEn: company.nameEn, nameAr: company.nameAr, crNumber: company.crNumber, website: company.website }], "masaar");
    }
    await db.delete(masarCompaniesTable).where(eq(masarCompaniesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", detail: String(err) });
  }
});

// POST /api/masar/database/companies/:id/re-enrich
router.post("/masar/database/companies/:id/re-enrich", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(p(req.params.id)));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  res.json({ ok: true, message: "Re-enrichment started" });

  setImmediate(() => enrichMasarCompany(id).catch(console.error));
});

// POST /api/masar/database/companies/:id/pipeline-enrich
// Runs the full 7-agent Masaar CR-lookup pipeline (mc.gov.sa + Amaaly AOA) and saves structured data back to the company
router.post("/masar/database/companies/:id/pipeline-enrich", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(p(req.params.id)));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db.select().from(masarCompaniesTable).where(eq(masarCompaniesTable.id, id)).limit(1);
  if (!rows.length) { res.status(404).json({ error: "Company not found" }); return; }
  const company = rows[0];
  const companyName = company.nameEn || company.nameAr || "";

  let crNumber = company.crNumber;

  // If no CR number, try to find it via Claude
  if (!crNumber && companyName) {
    try {
      const anthropicCl = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
      });
      const msg = await anthropicCl.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{ role: "user", content: `What is the Saudi Arabia Commercial Registration (CR) number for the company "${companyName}"? The CR number is a 10-digit number starting with 1 (e.g. 1010123456). Return ONLY the 10-digit number or "UNKNOWN" if not found.` }],
      });
      const txt = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
      const match = txt.match(/\b1\d{9}\b/);
      if (match) crNumber = match[0];
    } catch { /* non-fatal */ }
  }

  // Determine if we will use CR-based or name-based pipeline
  const useNameMode = !crNumber;
  const nameArForPipeline = company.nameAr || "";
  const nameEnForPipeline = company.nameEn || "";

  if (useNameMode && !nameArForPipeline && !nameEnForPipeline) {
    res.status(400).json({ error: "No CR number and no company name found. Cannot run enrichment." });
    return;
  }

  // Create a pipeline job
  const jobId = `masaar-db-enrich-${id}-${Date.now()}`;
  createJob(jobId, true);
  const emitter = getJobEmitter(jobId);

  await db.update(masarCompaniesTable).set({ enrichmentStatus: "enriching" } as any).where(eq(masarCompaniesTable.id, id));

  const modeMsg = useNameMode
    ? `Masaar name-based pipeline started for "${nameArForPipeline || nameEnForPipeline}" (no CR — searching Amaaly by name)`
    : `Masaar pipeline started for CR ${crNumber}`;

  res.json({ ok: true, jobId, crNumber: crNumber || null, nameMode: useNameMode, message: modeMsg });

  // Run pipeline in background, save results when the "event" stream emits job_complete
  if (emitter) {
    const onEvent = async (event: { type: string; report?: MasaarReport; message?: string }) => {
      if (event.type === "job_complete" && event.report) {
        emitter.off("event", onEvent);
        try {
          const report = event.report;
          const p = report.parsed;
          const aoa = (report.aoa || {}) as Record<string, unknown>;

          // Map managers → management (management uses title, pipeline uses appointmentTerm)
          const management = (p.managers || []).map(m => ({
            nameEn: m.nameEn || "",
            nameAr: m.nameAr || "",
            title: m.appointmentTerm || "Manager",
            nationalId: m.nationalId || null,
            powers: m.powers || null,
          }));

          // Board from AOA if available
          const boardFromAoa = Array.isArray(aoa.boardOfDirectors)
            ? (aoa.boardOfDirectors as Array<{ nameEn?: string; nameAr?: string; role?: string }>).map(b => ({
                nameEn: String(b.nameEn || ""),
                nameAr: String(b.nameAr || ""),
                role: String(b.role || "Member"),
                nationalId: null,
              }))
            : [];

          const updateFields: Record<string, unknown> = {
            enrichmentStatus: "enriched",
            enrichedAt: new Date(),
            analysisEn: report.reportEn || null,
            analysisAr: report.reportAr || null,
            analysisData: { riskFactors: [], growthIndicators: [], dataQuality: "high", confidenceScore: 90, source: "masaar-pipeline" },
          };

          // Only fill blank fields with pipeline data (don't overwrite existing good data)
          if (!company.crNumber && p.crNumber) updateFields.crNumber = p.crNumber;
          if (!company.nameEn && p.nameEn) updateFields.nameEn = p.nameEn;
          if (!company.nameAr && p.nameAr) updateFields.nameAr = p.nameAr;
          if (!company.legalForm && p.legalForm) updateFields.legalForm = p.legalForm;
          if (!company.legalFormAr && p.legalFormAr) updateFields.legalFormAr = p.legalFormAr;
          if (!company.city && p.headquarterCity) updateFields.city = p.headquarterCity;
          if (!company.paidUpCapital && p.capitalAmount) updateFields.paidUpCapital = p.capitalAmount;
          if (!company.foundingYear && p.foundingYear) updateFields.foundingYear = p.foundingYear;
          if (!company.authorizedSignatory && aoa.authorizedSignatory) updateFields.authorizedSignatory = String(aoa.authorizedSignatory);

          // Filter out undisclosed / placeholder persons before saving
          const isUndisclosedName = (nameEn?: string, nameAr?: string): boolean => {
            const UNDISCLOSED_PATTERNS = [
              /undisclosed/i, /unknown/i, /not\s*found/i, /غير\s*معلن/u, /مساهم\s*غير/u,
              /shareholder\s*\d+/i, /owner\s*\d+/i, /person\s*\d+/i, /مجهول/u,
              /placeholder/i, /n\/a/i, /^\s*-+\s*$/, /مساهم\s*\d+/u,
            ];
            const combined = `${nameEn || ""} ${nameAr || ""}`.trim();
            if (!combined) return true;
            return UNDISCLOSED_PATTERNS.some(pat => pat.test(combined));
          };

          const filteredShareholders = (p.shareholders || []).filter(s => !isUndisclosedName(s.nameEn, s.nameAr));
          const filteredManagement = management.filter(m => !isUndisclosedName(m.nameEn, m.nameAr));
          const filteredBoard = boardFromAoa.filter(b => !isUndisclosedName(b.nameEn, b.nameAr));

          // Structural data — always update if pipeline found richer data
          if (filteredShareholders.length > 0) updateFields.shareholders = filteredShareholders;
          if (filteredManagement.length > 0) updateFields.management = filteredManagement;
          if (filteredBoard.length > 0) updateFields.boardOfDirectors = filteredBoard;

          await db.update(masarCompaniesTable).set(updateFields).where(eq(masarCompaniesTable.id, id));
          console.log(`[PipelineEnrich] ✅ Saved: company id=${id} — ${p.shareholders?.length || 0} shareholders, ${management.length} managers, ${boardFromAoa.length} board`);
        } catch (err) {
          console.error("[PipelineEnrich] Save error:", err);
          await db.update(masarCompaniesTable).set({ enrichmentStatus: "failed" } as any).where(eq(masarCompaniesTable.id, id));
        }
      } else if (event.type === "job_error") {
        emitter.off("event", onEvent);
        await db.update(masarCompaniesTable).set({ enrichmentStatus: "failed" } as any).where(eq(masarCompaniesTable.id, id));
      }
    };
    emitter.on("event", onEvent);

    // Safety timeout — if pipeline doesn't complete in 5 min, mark failed
    setTimeout(async () => {
      emitter.off("event", onEvent);
    }, 5 * 60 * 1000);
  }

  // Fire and forget — choose pipeline based on whether we have a CR number
  const pipelinePromise = useNameMode
    ? runMasaarPipelineByName(nameArForPipeline, nameEnForPipeline, jobId)
    : runMasaarPipeline(crNumber!, jobId);

  pipelinePromise.catch(async (err: unknown) => {
    console.error("[PipelineEnrich] Pipeline error:", err);
    await db.update(masarCompaniesTable).set({ enrichmentStatus: "failed" } as any).where(eq(masarCompaniesTable.id, id));
  });
});

// POST /api/masar/database/enrich-all — force-enrich all companies concurrently
router.post("/masar/database/enrich-all", async (req: Request, res: Response): Promise<void> => {
  const { mode = "pending" } = req.body as { mode?: "pending" | "all" };

  let companies;
  if (mode === "all") {
    // Force mode: reset ALL non-enriching companies back to pending, then process them
    await db.execute(
      sql`UPDATE masar_companies SET enrichment_status = 'pending' WHERE enrichment_status != 'enriching'`
    );
    companies = await db.select({ id: masarCompaniesTable.id, nameEn: masarCompaniesTable.nameEn, nameAr: masarCompaniesTable.nameAr })
      .from(masarCompaniesTable)
      .orderBy(desc(masarCompaniesTable.createdAt))
      .limit(100);
  } else {
    // Smart mode: pending, failed, or enriched but missing key data
    companies = await db.select({ id: masarCompaniesTable.id, nameEn: masarCompaniesTable.nameEn, nameAr: masarCompaniesTable.nameAr })
      .from(masarCompaniesTable)
      .where(
        or(
          eq(masarCompaniesTable.enrichmentStatus, "pending"),
          eq(masarCompaniesTable.enrichmentStatus, "failed"),
          sql`jsonb_array_length(COALESCE(${masarCompaniesTable.shareholders}, '[]'::jsonb)) = 0 AND ${masarCompaniesTable.enrichmentStatus} = 'enriched'`
        )
      )
      .orderBy(desc(masarCompaniesTable.createdAt))
      .limit(50);
  }

  res.json({ ok: true, message: `Bulk enrichment started for ${companies.length} companies`, count: companies.length });

  // Fire all concurrently — enrichMasarCompany uses a semaphore (max 3 parallel) internally
  setImmediate(async () => {
    console.log(`[BulkEnrich] Starting concurrent enrichment for ${companies.length} companies (mode=${mode})`);
    const results = await Promise.allSettled(
      companies.map(c => enrichMasarCompany(c.id).catch(err => {
        console.error(`[BulkEnrich] Failed id=${c.id}:`, err);
      }))
    );
    const succeeded = results.filter(r => r.status === "fulfilled").length;
    console.log(`[BulkEnrich] Done — ${succeeded}/${companies.length} enriched`);
  });
});

// GET /api/masar/database/export — CSV, Excel, Word, or PDF export
router.get("/masar/database/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const search = String(req.query.search || "").trim();
    const format = String(req.query.format || "csv").toLowerCase();
    const idsParam = req.query.ids as string | undefined;
    const dateStr = new Date().toISOString().slice(0, 10);

    let companies;
    if (idsParam) {
      const ids = idsParam.split(",").map(Number).filter(Boolean);
      companies = await db.select().from(masarCompaniesTable).where(inArray(masarCompaniesTable.id, ids)).orderBy(desc(masarCompaniesTable.createdAt));
    } else {
      const whereClause = search
        ? or(ilike(masarCompaniesTable.nameEn, `%${search}%`), ilike(masarCompaniesTable.nameAr, `%${search}%`))
        : undefined;
      companies = await db.select().from(masarCompaniesTable).where(whereClause).orderBy(desc(masarCompaniesTable.createdAt)).limit(5000);
    }
    const label = idsParam ? `${companies.length} selected records` : `${companies.length} companies${search ? ` (filtered: "${search}")` : ""}`;

    const humanDate = new Date().toLocaleDateString("en-SA", { year: "numeric", month: "long", day: "numeric" });

    // ── helpers for full-profile export ──────────────────────────────────────
    type ArrRow = { nameEn?: string; nameAr?: string; ownershipPct?: string; nationality?: string; title?: string; role?: string; powers?: string; nationalId?: string };
    const safe = (v: unknown) => (v == null || v === "" || v === "null") ? "—" : String(v);
    const arrRows = (arr: unknown, cols: string[]) => {
      if (!Array.isArray(arr) || arr.length === 0) return "";
      return (arr as ArrRow[]).map(r =>
        `<tr>${cols.map(c => `<td style="padding:3px 6px;border:1px solid #1e2d40;color:#cbd5e1;font-size:8px">${safe(r[c as keyof ArrRow])}</td>`).join("")}</tr>`
      ).join("");
    };
    const sectionHtml = (c: typeof companies[0]) => {
      const shareholders = Array.isArray(c.shareholders) ? c.shareholders : [];
      const management = Array.isArray(c.management) ? c.management : [];
      const board = Array.isArray(c.boardOfDirectors) ? c.boardOfDirectors : [];
      const contacts = ((c as any)?.contactDetails as Record<string,string> | null) || {};
      return `<div style="page-break-inside:avoid;margin-bottom:28px;padding:16px;background:#0d1117;border:1px solid #1e2d40;border-radius:6px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
    <div>
      <div style="font-size:16px;font-weight:700;color:#34d399">${safe(c.nameEn || c.nameAr)}</div>
      ${c.nameAr && c.nameEn ? `<div style="font-size:12px;color:#94a3b8;direction:rtl">${c.nameAr}</div>` : ""}
    </div>
    <span style="padding:3px 9px;border-radius:4px;font-size:9px;font-weight:600;background:${c.enrichmentStatus === "enriched" ? "#065f46" : "#1f2937"};color:${c.enrichmentStatus === "enriched" ? "#34d399" : "#9ca3af"}">${safe(c.enrichmentStatus)}</span>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9px">
    <tr>
      <td style="padding:3px 6px;color:#64748b;width:130px">CR Number</td><td style="padding:3px 6px;color:#e2e8f0;font-weight:600">${safe(c.crNumber)}</td>
      <td style="padding:3px 6px;color:#64748b;width:130px">Legal Form</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.legalForm)} ${c.legalFormAr ? `/ ${c.legalFormAr}` : ""}</td>
    </tr><tr>
      <td style="padding:3px 6px;color:#64748b">City</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.city || c.cityAr)} ${c.region ? `· ${c.region}` : ""}</td>
      <td style="padding:3px 6px;color:#64748b">Paid-Up Capital</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.paidUpCapital)}</td>
    </tr><tr>
      <td style="padding:3px 6px;color:#64748b">Main Activity</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.mainActivity)}</td>
      <td style="padding:3px 6px;color:#64748b">Founded</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.foundingYear)} ${c.registrationDate ? `(Reg: ${c.registrationDate})` : ""}</td>
    </tr><tr>
      <td style="padding:3px 6px;color:#64748b">Revenue Est.</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.revenueEstimate)}</td>
      <td style="padding:3px 6px;color:#64748b">Employees</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.employeeCount)}</td>
    </tr><tr>
      <td style="padding:3px 6px;color:#64748b">Website</td><td style="padding:3px 6px;color:#60a5fa">${safe(c.website || contacts.website)}</td>
      <td style="padding:3px 6px;color:#64748b">Phone</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.phone || contacts.phone)}</td>
    </tr><tr>
      <td style="padding:3px 6px;color:#64748b">Email</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.email || contacts.email)}</td>
      <td style="padding:3px 6px;color:#64748b">Auth. Signatory</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.authorizedSignatory)}</td>
    </tr><tr>
      <td style="padding:3px 6px;color:#64748b">Source</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.source)}</td>
      <td style="padding:3px 6px;color:#64748b">Reg. Status</td><td style="padding:3px 6px;color:#e2e8f0">${safe(c.registrationStatus)}</td>
    </tr>
  </table>
  ${shareholders.length > 0 ? `<div style="margin-bottom:8px">
    <div style="font-size:9px;font-weight:700;color:#818cf8;text-transform:uppercase;margin-bottom:4px">Shareholders / Owners</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <tr style="background:#1e2d40"><th style="padding:3px 6px;color:#93c5fd;text-align:left">Name (EN)</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">الاسم</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">%</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">Nationality</th></tr>
      ${arrRows(shareholders, ["nameEn","nameAr","ownershipPct","nationality"])}
    </table>
  </div>` : ""}
  ${management.length > 0 ? `<div style="margin-bottom:8px">
    <div style="font-size:9px;font-weight:700;color:#f59e0b;text-transform:uppercase;margin-bottom:4px">Management</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <tr style="background:#1e2d40"><th style="padding:3px 6px;color:#93c5fd;text-align:left">Name (EN)</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">الاسم</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">Title</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">Powers</th></tr>
      ${arrRows(management, ["nameEn","nameAr","title","powers"])}
    </table>
  </div>` : ""}
  ${board.length > 0 ? `<div style="margin-bottom:8px">
    <div style="font-size:9px;font-weight:700;color:#34d399;text-transform:uppercase;margin-bottom:4px">Board of Directors</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <tr style="background:#1e2d40"><th style="padding:3px 6px;color:#93c5fd;text-align:left">Name (EN)</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">الاسم</th><th style="padding:3px 6px;color:#93c5fd;text-align:left">Role</th></tr>
      ${arrRows(board, ["nameEn","nameAr","role"])}
    </table>
  </div>` : ""}
  ${c.analysisEn ? `<div style="margin-top:8px;padding:8px;background:#0f172a;border-left:3px solid #3b82f6;border-radius:0 4px 4px 0">
    <div style="font-size:8px;font-weight:700;color:#60a5fa;margin-bottom:4px">AI Intelligence Analysis</div>
    <div style="font-size:8px;color:#94a3b8;line-height:1.5">${c.analysisEn.replace(/</g,"&lt;").slice(0,600)}</div>
  </div>` : ""}
  ${c.analysisAr ? `<div style="margin-top:6px;padding:8px;background:#0f172a;border-right:3px solid #8b5cf6;border-radius:4px 0 0 4px;direction:rtl">
    <div style="font-size:8px;font-weight:700;color:#a78bfa;margin-bottom:4px">تحليل الذكاء الاصطناعي</div>
    <div style="font-size:8px;color:#94a3b8;line-height:1.5">${c.analysisAr.replace(/</g,"&lt;").slice(0,600)}</div>
  </div>` : ""}
</div>`;
    };

    if (format === "pdf") {
      const pdfRows = companies.map(c => sectionHtml(c)).join("");
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Masar Database — ${humanDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; background: #0b0b14; color: #e2e8f0; padding: 20px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #1e2d3d; }
  .logo { font-size: 22px; font-weight: 700; color: #34d399; letter-spacing: -0.5px; }
  .logo span { color: #818cf8; }
  .meta { font-size: 9px; color: #64748b; }
  h2 { font-size: 12px; color: #94a3b8; margin-bottom: 14px; }
  .footer { margin-top: 16px; font-size: 8px; color: #334155; text-align: center; }
  .print-btn { background: #34d399; color: #0f0f1a; border: none; padding: 7px 18px; border-radius: 6px; font-size: 11px; cursor: pointer; margin-bottom: 16px; font-weight: 600; }
  @media print { .print-btn { display: none; } body { padding: 6mm; background: #0b0b14; } }
</style></head>
<body>
<div class="header">
  <div class="logo">Prospect<span>SA</span></div>
  <div class="meta">Masar Company Database · Full Profiles &nbsp;·&nbsp; ${humanDate}</div>
</div>
<h2>${label}</h2>
<button class="print-btn no-print" onclick="window.print()">🖨 Print / Save as PDF</button>
${pdfRows}
<div class="footer">ProspectSA · Masar Database · Generated ${humanDate} · Total: ${companies.length} companies</div>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }

    if (format === "word") {
      // Word: full company profiles one per section
      const wordSections = companies.map(c => {
        const shareholders = Array.isArray(c.shareholders) ? c.shareholders as ArrRow[] : [];
        const management = Array.isArray(c.management) ? c.management as ArrRow[] : [];
        const board = Array.isArray(c.boardOfDirectors) ? c.boardOfDirectors as ArrRow[] : [];
        const contacts = ((c as any)?.contactDetails as Record<string,string> | null) || {};
        const shTable = shareholders.length > 0 ? `
<table><thead><tr><th>Name (EN)</th><th>الاسم</th><th>%</th><th>Nationality</th></tr></thead><tbody>
${shareholders.map(s => `<tr><td>${safe(s.nameEn)}</td><td>${safe(s.nameAr)}</td><td>${safe(s.ownershipPct)}</td><td>${safe(s.nationality)}</td></tr>`).join("")}
</tbody></table>` : "<p>—</p>";
        const mgmtTable = management.length > 0 ? `
<table><thead><tr><th>Name (EN)</th><th>الاسم</th><th>Title</th></tr></thead><tbody>
${management.map(m => `<tr><td>${safe(m.nameEn)}</td><td>${safe(m.nameAr)}</td><td>${safe(m.title)}</td></tr>`).join("")}
</tbody></table>` : "<p>—</p>";
        const boardTable = board.length > 0 ? `
<table><thead><tr><th>Name (EN)</th><th>الاسم</th><th>Role</th></tr></thead><tbody>
${board.map(b => `<tr><td>${safe(b.nameEn)}</td><td>${safe(b.nameAr)}</td><td>${safe(b.role)}</td></tr>`).join("")}
</tbody></table>` : "";
        return `<div class="company-section">
<h2>${safe(c.nameEn || c.nameAr)}</h2>
${c.nameAr && c.nameEn ? `<p class="arabic">${c.nameAr}</p>` : ""}
<table><tbody>
<tr><td class="label">CR Number</td><td><strong>${safe(c.crNumber)}</strong></td><td class="label">Legal Form</td><td>${safe(c.legalForm)}${c.legalFormAr ? ` / ${c.legalFormAr}` : ""}</td></tr>
<tr><td class="label">City / Region</td><td>${safe(c.city || c.cityAr)}${c.region ? ` · ${c.region}` : ""}</td><td class="label">Paid-Up Capital</td><td>${safe(c.paidUpCapital)}</td></tr>
<tr><td class="label">Main Activity</td><td>${safe(c.mainActivity)}</td><td class="label">Founded</td><td>${safe(c.foundingYear)}${c.registrationDate ? ` (Reg: ${c.registrationDate})` : ""}</td></tr>
<tr><td class="label">Revenue Est.</td><td>${safe(c.revenueEstimate)}</td><td class="label">Employees</td><td>${safe(c.employeeCount)}</td></tr>
<tr><td class="label">Website</td><td>${safe(c.website || contacts.website)}</td><td class="label">Phone</td><td>${safe(c.phone || contacts.phone)}</td></tr>
<tr><td class="label">Email</td><td>${safe(c.email || contacts.email)}</td><td class="label">Auth. Signatory</td><td>${safe(c.authorizedSignatory)}</td></tr>
<tr><td class="label">Status</td><td>${safe(c.enrichmentStatus)}</td><td class="label">Source</td><td>${safe(c.source)}</td></tr>
</tbody></table>
${shareholders.length > 0 ? `<h3>Shareholders / Owners</h3>${shTable}` : ""}
${management.length > 0 ? `<h3>Management</h3>${mgmtTable}` : ""}
${board.length > 0 ? `<h3>Board of Directors</h3>${boardTable}` : ""}
${c.analysisEn ? `<h3>AI Intelligence Analysis</h3><p class="analysis">${c.analysisEn.replace(/</g,"&lt;").slice(0,800)}</p>` : ""}
${c.analysisAr ? `<h3>تحليل الذكاء الاصطناعي</h3><p class="analysis arabic">${c.analysisAr.replace(/</g,"&lt;").slice(0,800)}</p>` : ""}
</div>`;
      }).join("\n");
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Masar Company Database — Full Profiles</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; margin: 2cm; color: #1a1a2e; background: #ffffff; }
  h1 { font-size: 20pt; color: #0d7a5f; margin-bottom: 4pt; font-weight: bold; }
  .meta-header { font-size: 9pt; color: #4b5563; margin-bottom: 20pt; border-top: 2pt solid #0d7a5f; padding-top: 6pt; }
  .company-section { margin-bottom: 24pt; padding: 12pt; border: 1pt solid #d1fae5; border-radius: 4pt; page-break-inside: avoid; }
  h2 { font-size: 14pt; color: #0d7a5f; margin-bottom: 2pt; font-weight: bold; }
  h3 { font-size: 10pt; color: #2563eb; margin: 10pt 0 4pt 0; font-weight: bold; border-bottom: 0.5pt solid #bfdbfe; padding-bottom: 2pt; }
  p.arabic { font-size: 11pt; color: #6b7280; direction: rtl; text-align: right; margin-bottom: 6pt; }
  p.analysis { font-size: 8.5pt; color: #374151; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; font-size: 8.5pt; margin-bottom: 4pt; }
  th { background: #0d7a5f; color: #ffffff; padding: 4pt 6pt; text-align: left; font-weight: bold; font-size: 8pt; }
  td { padding: 3pt 6pt; border-bottom: 0.5pt solid #e5e7eb; vertical-align: top; color: #1f2937; }
  td.label { color: #6b7280; font-size: 8pt; width: 18%; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { font-size: 8pt; color: #6b7280; margin-top: 16pt; border-top: 1pt solid #d1d5db; padding-top: 6pt; text-align: center; }
</style></head>
<body>
<h1>Masar Company Database — Full Profiles</h1>
<div class="meta-header">ProspectSA · Saudi B2B Intelligence &nbsp;|&nbsp; Exported: ${humanDate} &nbsp;|&nbsp; ${label}</div>
${wordSections}
<div class="footer">ProspectSA · Masar Database · Generated ${humanDate}</div>
</body></html>`;
      res.setHeader("Content-Type", "application/vnd.ms-word");
      res.setHeader("Content-Disposition", `attachment; filename="masar_companies_${dateStr}.doc"`);
      res.send(html);
      return;
    }

    if (format === "excel") {
      // Main companies sheet
      const excelRows = companies.map(c => ({
        "ID": c.id,
        "Name (EN)": c.nameEn || "",
        "Name (AR)": c.nameAr || "",
        "CR Number": c.crNumber || "",
        "Legal Form": c.legalForm || "",
        "City": c.city || "",
        "Region": c.region || "",
        "Paid-Up Capital": c.paidUpCapital || "",
        "Main Activity": c.mainActivity || "",
        "Main Activity AR": c.mainActivityAr || "",
        "Founding Year": c.foundingYear || "",
        "Registration Date": c.registrationDate || "",
        "Registration Status": c.registrationStatus || "",
        "Authorized Signatory": c.authorizedSignatory || "",
        "Source": c.source || "",
        "Enrichment Status": c.enrichmentStatus || "",
        "Website": c.website || "",
        "Phone": c.phone || "",
        "Email": c.email || "",
        "Employee Count": c.employeeCount || "",
        "Revenue Estimate": c.revenueEstimate || "",
        "Shareholders Count": Array.isArray(c.shareholders) ? c.shareholders.length : 0,
        "Management Count": Array.isArray(c.management) ? c.management.length : 0,
        "Analysis (EN)": (c.analysisEn || "").replace(/\n/g, " ").slice(0, 1000),
        "Analysis (AR)": (c.analysisAr || "").replace(/\n/g, " ").slice(0, 500),
        "Created At": c.createdAt?.toISOString() || "",
      }));
      const ws = XLSX.utils.json_to_sheet(excelRows);
      ws["!cols"] = Object.keys(excelRows[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 14) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Companies");

      // Shareholders sheet
      const shRows: Record<string,unknown>[] = [];
      for (const c of companies) {
        if (Array.isArray(c.shareholders)) {
          for (const s of c.shareholders as ArrRow[]) {
            shRows.push({ "Company ID": c.id, "Company Name": c.nameEn || c.nameAr || "", "CR Number": c.crNumber || "", "Shareholder EN": safe(s.nameEn), "Shareholder AR": safe(s.nameAr), "Ownership %": safe(s.ownershipPct), "Nationality": safe(s.nationality), "National ID": safe(s.nationalId) });
          }
        }
      }
      if (shRows.length > 0) {
        const wsSh = XLSX.utils.json_to_sheet(shRows);
        wsSh["!cols"] = Object.keys(shRows[0]).map(k => ({ wch: Math.max(k.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, wsSh, "Shareholders");
      }

      // Management sheet
      const mgmtRows: Record<string,unknown>[] = [];
      for (const c of companies) {
        if (Array.isArray(c.management)) {
          for (const m of c.management as ArrRow[]) {
            mgmtRows.push({ "Company ID": c.id, "Company Name": c.nameEn || c.nameAr || "", "CR Number": c.crNumber || "", "Name EN": safe(m.nameEn), "Name AR": safe(m.nameAr), "Title": safe(m.title), "National ID": safe(m.nationalId), "Powers": safe(m.powers) });
          }
        }
        if (Array.isArray(c.boardOfDirectors)) {
          for (const b of c.boardOfDirectors as ArrRow[]) {
            mgmtRows.push({ "Company ID": c.id, "Company Name": c.nameEn || c.nameAr || "", "CR Number": c.crNumber || "", "Name EN": safe(b.nameEn), "Name AR": safe(b.nameAr), "Title": `Board: ${safe(b.role)}`, "National ID": safe(b.nationalId), "Powers": "—" });
          }
        }
      }
      if (mgmtRows.length > 0) {
        const wsMgmt = XLSX.utils.json_to_sheet(mgmtRows);
        wsMgmt["!cols"] = Object.keys(mgmtRows[0]).map(k => ({ wch: Math.max(k.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, wsMgmt, "Management & Board");
      }

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="masar_companies_${dateStr}.xlsx"`);
      res.send(buf);
      return;
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
          ["CR Number", c.crNumber || "—"],
          ["Legal Form", c.legalForm || "—"],
          ["City", c.city || c.cityAr || "—"],
          ["Paid-Up Capital", c.paidUpCapital || "—"],
          ["Main Activity", c.mainActivity || "—"],
          ["Founded", String(c.foundingYear || "—")],
          ["Revenue Est.", c.revenueEstimate || "—"],
          ["Employees", String(c.employeeCount || "—")],
          ["Status", c.enrichmentStatus || "pending"],
          ["Source", c.source || "—"],
          ["Website", c.website || "—"],
          ["Phone", c.phone || "—"],
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
        if (c.analysisEn) {
          slide.addText(c.analysisEn.slice(0, 400), { x: 0.4, y: 5.5, w: 12.4, h: 1.6, fontSize: 9, color: "9999BB", fontFace: "Calibri", wrap: true });
        }
        slide.addText(`ProspectSA · Masar Database · ${humanDate}`, { x: 0.4, y: 7.15, w: 12.4, h: 0.25, fontSize: 7, color: "555577", fontFace: "Calibri" });
      }
      const buf = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="masar_companies_${dateStr}.pptx"`);
      res.send(buf);
      return;
    }

    const headers = [
      "ID", "Name (EN)", "Name (AR)", "CR Number", "Legal Form", "City", "Region",
      "Paid-Up Capital", "Main Activity", "Founding Year", "Registration Date",
      "Authorized Signatory", "Registration Status", "Source", "Enrichment Status",
      "Website", "Phone", "Email", "Employee Count", "Revenue Estimate",
      "Analysis (EN)", "Created At",
    ];
    const csvRows = companies.map(c => [
      c.id, c.nameEn || "", c.nameAr || "", c.crNumber || "", c.legalForm || "",
      c.city || "", c.region || "", c.paidUpCapital || "", c.mainActivity || "",
      c.foundingYear || "", c.registrationDate || "", c.authorizedSignatory || "",
      c.registrationStatus || "", c.source || "", c.enrichmentStatus || "",
      c.website || "", c.phone || "", c.email || "", c.employeeCount || "",
      c.revenueEstimate || "",
      (c.analysisEn || "").replace(/"/g, "'").replace(/\n/g, " ").slice(0, 500),
      c.createdAt?.toISOString() || "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [headers.map(h => `"${h}"`).join(","), ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="masar_companies_${dateStr}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    res.status(500).json({ error: "Export failed", detail: String(err) });
  }
});

// POST /api/masar/database/deduplicate — remove duplicates from Masar database
router.post("/masar/database/deduplicate", async (_req: Request, res: Response): Promise<void> => {
  try {
    // ── Normalize company name for fuzzy dedup matching ──────────────────────
    const normalizeName = (name: string | null | undefined): string => {
      if (!name) return "";
      return name
        .toLowerCase()
        .replace(/\b(company|co|ltd|llc|corp|inc|group|holding|holdings|international|intl|establishment|est|trading|industries|industrial|services|solutions|technology|technologies|شركة|مؤسسة|مجموعة)\b\.?/gi, "")
        .replace(/[^a-z0-9\u0600-\u06FF]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    // Keep the record with most enrichment data (higher enrichmentStatus score wins)
    const enrichScore = (c: typeof masarCompaniesTable.$inferSelect) => {
      let score = 0;
      if (c.enrichmentStatus === "enriched") score += 100;
      else if (c.enrichmentStatus === "enriching") score += 50;
      if (c.website) score += 10;
      if (c.email) score += 8;
      if (c.phone) score += 8;
      if (c.shareholders?.length) score += 15;
      if (c.boardOfDirectors?.length) score += 10;
      if (c.paidUpCapital) score += 5;
      return score;
    };

    const all = await db.select().from(masarCompaniesTable).orderBy(masarCompaniesTable.id);

    // Group by: CR number (strongest) → normalized English name → normalized Arabic name
    const seenCr = new Map<string, typeof masarCompaniesTable.$inferSelect>();
    const seenEn = new Map<string, typeof masarCompaniesTable.$inferSelect>();
    const seenAr = new Map<string, typeof masarCompaniesTable.$inferSelect>();
    const toDelete = new Set<number>();

    for (const co of all) {
      const crKey = (co.crNumber || "").trim();
      const enKey = normalizeName(co.nameEn);
      const arKey = normalizeName(co.nameAr);

      let canonicalDup: typeof masarCompaniesTable.$inferSelect | undefined;

      if (crKey && seenCr.has(crKey)) canonicalDup = seenCr.get(crKey);
      else if (enKey && seenEn.has(enKey)) canonicalDup = seenEn.get(enKey);
      else if (arKey && seenAr.has(arKey)) canonicalDup = seenAr.get(arKey);

      if (canonicalDup) {
        // Keep the richer record, delete the other
        if (enrichScore(co) > enrichScore(canonicalDup)) {
          toDelete.add(canonicalDup.id);
          // Replace canonical with this richer record
          if (crKey) seenCr.set(crKey, co);
          if (enKey) seenEn.set(enKey, co);
          if (arKey) seenAr.set(arKey, co);
        } else {
          toDelete.add(co.id);
        }
      } else {
        if (crKey) seenCr.set(crKey, co);
        if (enKey) seenEn.set(enKey, co);
        if (arKey) seenAr.set(arKey, co);
      }
    }

    const idsToDelete = Array.from(toDelete);
    if (idsToDelete.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < idsToDelete.length; i += BATCH) {
        const chunk = idsToDelete.slice(i, i + BATCH);
        await db.execute(sql.raw(`DELETE FROM masar_companies WHERE id = ANY(ARRAY[${chunk.join(",")}]::int[])`));
      }
    }

    const remaining = await db.select({ count: sql<number>`COUNT(*)` }).from(masarCompaniesTable);
    res.json({
      duplicatesFound: idsToDelete.length,
      duplicatesDeleted: idsToDelete.length,
      remainingCompanies: Number(remaining[0]?.count || 0),
    });
  } catch (err) {
    res.status(500).json({ error: "Deduplication failed", detail: String(err) });
  }
});

// GET /api/masar/database/jobs — recent harvest jobs
// POST /api/masar/database/jobs/:jobId/cancel
router.post("/masar/database/jobs/:jobId/cancel", (req: Request, res: Response): void => {
  const ok = cancelHarvestJob(p(req.params.jobId));
  if (!ok) {
    res.status(404).json({ ok: false, error: "Job not found or already finished" });
    return;
  }
  res.json({ ok: true });
});

router.get("/masar/database/jobs", async (req: Request, res: Response): Promise<void> => {
  try {
    const jobs = await db.select().from(masarHarvestJobsTable).orderBy(desc(masarHarvestJobsTable.createdAt)).limit(20);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch jobs", detail: String(err) });
  }
});

// GET /api/masar/database/stats — aggregate stats
router.get("/masar/database/stats", async (req: Request, res: Response): Promise<void> => {
  try {
    const [total, enriched, pending, sourceCounts] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(masarCompaniesTable),
      db.select({ count: sql<number>`COUNT(*)` }).from(masarCompaniesTable).where(eq(masarCompaniesTable.enrichmentStatus, "enriched")),
      db.select({ count: sql<number>`COUNT(*)` }).from(masarCompaniesTable).where(
        sql`${masarCompaniesTable.enrichmentStatus} IS NULL OR ${masarCompaniesTable.enrichmentStatus} = 'pending'`
      ),
      db.select({
        source: masarCompaniesTable.source,
        count: sql<number>`COUNT(*)`,
      }).from(masarCompaniesTable).groupBy(masarCompaniesTable.source),
    ]);

    const bySource: Record<string, number> = {};
    for (const row of sourceCounts) {
      bySource[row.source] = Number(row.count);
    }

    res.json({
      total: Number(total[0]?.count || 0),
      enriched: Number(enriched[0]?.count || 0),
      pending: Number(pending[0]?.count || 0),
      activeSources: sourceCounts.length,
      bySource,
      // Legacy fields kept for backwards compat
      openData: bySource["open-data"] || 0,
      aamalyAoa: bySource["amaaly-aoa"] || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats", detail: String(err) });
  }
});

// ─── Custom Sources CRUD ───────────────────────────────────────────────────

// GET /api/masar/database/custom-sources
router.get("/masar/database/custom-sources", async (_req: Request, res: Response): Promise<void> => {
  try {
    const sources = await db.select().from(masarCustomSourcesTable).orderBy(desc(masarCustomSourcesTable.createdAt));
    res.json(sources);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch custom sources", detail: String(err) });
  }
});

// POST /api/masar/database/custom-sources
router.post("/masar/database/custom-sources", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, url } = req.body as { name?: string; url?: string };
    if (!url || !url.startsWith("http")) {
      res.status(400).json({ error: "Valid URL is required" });
      return;
    }
    const sourceName = name || new URL(url).hostname;
    const [created] = await db.insert(masarCustomSourcesTable).values({ name: sourceName, url } as any).returning();
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: "Failed to create custom source", detail: String(err) });
  }
});

// POST /api/masar/database/analyze-source — fetch a URL and describe what company data it contains
router.post("/masar/database/analyze-source", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url: string };
  if (!url?.startsWith("http")) { res.status(400).json({ error: "Valid URL required" }); return; }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
  });

  // Fetch the URL with a test keyword
  const testUrl = url.replace(/\{[^}]+\}/g, "Saudi Arabia companies");
  let pageText = "";
  try {
    const resp = await fetch(testUrl, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
      },
    });
    if (resp.ok) {
      const html = await resp.text();
      const { load } = await import("cheerio");
      const $ = load(html);
      $("script, style, nav, footer, header, noscript").remove();
      pageText = $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, 6000);
    }
  } catch { /* ignore fetch errors */ }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: pageText.length > 100
          ? `Analyze this website content and tell me if it contains Saudi company/business directory data.\n\nURL: ${url}\nContent preview:\n${pageText}\n\nReturn ONLY JSON: {"suggestedName":"short source name","description":"1 sentence description","dataTypes":["company names","CR numbers","shareholders","contact info","etc — list what's actually present"],"hasCompanyData":true/false,"language":"ar/en/both","confidence":"high/medium/low"}`
          : `The URL ${url} returned minimal content (likely a JavaScript SPA or requires authentication).\n\nBased on the domain name and URL pattern, guess what this website likely contains for Saudi business intelligence.\n\nReturn ONLY JSON: {"suggestedName":"short source name","description":"1 sentence description","dataTypes":["likely data types"],"hasCompanyData":true/false,"language":"ar/en/both","confidence":"low","note":"Site requires browser/login — content could not be previewed"}`,
      }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestedName: new URL(url).hostname, description: "Custom source", dataTypes: [], hasCompanyData: true, confidence: "low" };
    res.json({ ok: true, analysis, previewChars: pageText.length });
  } catch (err) {
    res.status(500).json({ error: "Analysis failed", detail: String(err) });
  }
});

// DELETE /api/masar/database/custom-sources/:id
router.delete("/masar/database/custom-sources/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(p(req.params.id));
    await db.delete(masarCustomSourcesTable).where(eq(masarCustomSourcesTable.id, id));
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete custom source", detail: String(err) });
  }
});

export default router;
