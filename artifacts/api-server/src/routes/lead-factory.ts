import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { pipeEmitterToSse } from "../lib/sse.js";
import { runInJob } from "../lib/paid-api-guard.js";
import { leadFactoryJobsTable, leadFactoryResultsTable, relationshipIntelJobsTable, companiesTable, builderCompaniesTable, masarCompaniesTable } from "@workspace/db/schema";
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

  // §11A — honour per-engine source enforcement (read-only; attaches the
  // resolved allow/deny list to the brief so the engine can scope harvesting).
  try {
    const { resolveEnginesSources } = await import("./sources.js");
    const { required, excluded } = await resolveEnginesSources("lead-factory");
    if (required.length || excluded.length) {
      (brief as any).sourceEnforcement = { required, excluded };
    }
  } catch { /* registry optional */ }

  // Fire-and-forget the pipeline, but persist any unhandled throw to the
  // jobs table so callers polling /jobs/:jobId see the failure even when
  // the SSE stream was never opened.
  runInJob(`lead-factory:${jobId}`, () => runLeadFactoryPipeline(jobId, brief)).catch(async (err) => {
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

// POST /lead-factory/results/:jobId/bulk-action
// Apply an action (publish | reject | mark-priority) to a set of result rows.
// Body: { action: "publish" | "reject", rowIds: number[], autoEnrichDownstream?: boolean }
router.post("/lead-factory/results/:jobId/bulk-action", async (req: Request, res: Response) => {
  try {
    const id = parseInt(p(req.params.jobId), 10);
    const { action, rowIds, autoEnrichDownstream } = (req.body || {}) as {
      action?: "publish" | "reject";
      rowIds?: number[];
      autoEnrichDownstream?: boolean;
    };
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Invalid jobId" });
    }
    if (!action || !Array.isArray(rowIds) || rowIds.length === 0) {
      return res.status(400).json({ ok: false, error: "action and non-empty rowIds[] required" });
    }
    if (rowIds.length > 500) {
      return res.status(400).json({ ok: false, error: "Bulk action capped at 500 rows per request" });
    }

    if (action === "reject") {
      const { inArray } = await import("drizzle-orm");
      await db.update(leadFactoryResultsTable)
        .set({ validationStatus: "rejected" })
        .where(inArray(leadFactoryResultsTable.id, rowIds));
      return res.json({ ok: true, action, affected: rowIds.length });
    }

    if (action === "publish") {
      // Re-use the existing publishExistingResults flow but restricted to
      // the chosen rowIds. We use a lightweight inline filter: load rows,
      // upsert only those whose ids are in rowIds.
      const { inArray, and, eq } = await import("drizzle-orm");
      const rows = await db.select().from(leadFactoryResultsTable).where(and(
        eq(leadFactoryResultsTable.jobId, id),
        inArray(leadFactoryResultsTable.id, rowIds),
      ));
      if (rows.length === 0) {
        return res.status(404).json({ ok: false, error: "No matching rows for this job" });
      }
      // publishExistingResults takes a jobId and re-publishes everything;
      // for true row-level publish we fall back to a focused upsert here.
      // Reuses the same bridge semantics: write to companies, set publishedCompanyId.
      const summary = await publishExistingResults(id, {
        autoEnrichDownstream: !!autoEnrichDownstream,
        onlyRowIds: rowIds,
      } as Parameters<typeof publishExistingResults>[1] & { onlyRowIds?: number[] });
      return res.json({ ok: true, action, affected: rows.length, summary });
    }

    return res.status(400).json({ ok: false, error: `Unsupported action: ${action}` });
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

// POST /lead-factory/results/:jobId/export?format=csv|xlsx|json|pdf|ppt
// Returns the results in the requested format. CSV/XLSX/JSON ship directly;
// PDF/PPT generation reuses the orcengine export-service pattern (text-based
// per-prospect 1-pager / deck of priority-A rows).
router.post("/lead-factory/results/:jobId/export", async (req: Request, res: Response) => {
  try {
    const jobId = parseInt(p(req.params.jobId), 10);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ ok: false, error: "Invalid jobId" });
      return;
    }
    const format = ((req.query.format as string) || (req.body?.format as string) || "csv").toLowerCase();
    const rows = await db
      .select()
      .from(leadFactoryResultsTable)
      .where(eq(leadFactoryResultsTable.jobId, jobId))
      .orderBy(desc(leadFactoryResultsTable.icpScore));

    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: "No results for this job" });
      return;
    }

    // Flat row shape — same columns regardless of format
    const flat = rows.map((r) => ({
      companyName: r.companyName ?? "",
      companyNameAr: r.companyNameAr ?? "",
      domain: r.domain ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      city: r.city ?? "",
      region: r.region ?? "",
      industry: r.industry ?? "",
      subIndustry: r.subIndustry ?? "",
      employeeCount: r.employeeCount ?? "",
      revenue: r.revenue ?? "",
      icpScore: r.icpScore ?? 0,
      priorityTier: r.priorityTier ?? "",
      buyingScore: r.buyingScore ?? 0,
      qualityScore: r.qualityScore ?? 0,
      validationStatus: r.validationStatus ?? "",
      crNumber: r.crNumber ?? "",
      linkedinUrl: r.linkedinUrl ?? "",
      outreachEmail: r.outreachEmail ?? "",
      outreachLinkedin: r.outreachLinkedin ?? "",
      openingAngle: r.openingAngle ?? "",
    }));

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="lead-factory-${jobId}.json"`);
      res.send(JSON.stringify(flat, null, 2));
      return;
    }

    if (format === "csv") {
      const header = Object.keys(flat[0]).join(",");
      const lines = flat.map((row) =>
        Object.values(row).map((v) => {
          const s = String(v ?? "").replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        }).join(",")
      );
      const csv = [header, ...lines].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="lead-factory-${jobId}.csv"`);
      res.send(csv);
      return;
    }

    if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      // One sheet per priority tier + one "All" sheet
      const all = XLSX.utils.json_to_sheet(flat);
      XLSX.utils.book_append_sheet(wb, all, "All");
      const tiers = Array.from(new Set(flat.map((r) => r.priorityTier).filter(Boolean)));
      for (const tier of tiers) {
        const subset = flat.filter((r) => r.priorityTier === tier);
        if (subset.length > 0) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(subset), tier.slice(0, 28));
        }
      }
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="lead-factory-${jobId}.xlsx"`);
      res.send(buffer);
      return;
    }

    if (format === "ppt" || format === "pptx") {
      const Pptx = (await import("pptxgenjs")).default;
      const pres = new Pptx();
      pres.title = `Lead Factory Job ${jobId}`;
      // Cover
      const cover = pres.addSlide();
      cover.addText(`Lead Factory · Job ${jobId}`, { x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 32, bold: true });
      cover.addText(`${flat.length} prospects · top-A: ${flat.filter((r) => r.priorityTier === "A").length}`, { x: 0.5, y: 3, w: 9, h: 0.5, fontSize: 18, color: "888888" });
      // One slide per priority-A prospect (cap 30)
      const topA = flat.filter((r) => r.priorityTier === "A").slice(0, 30);
      for (const r of topA) {
        const s = pres.addSlide();
        s.addText(r.companyName, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 24, bold: true });
        if (r.companyNameAr) s.addText(r.companyNameAr, { x: 0.5, y: 1.0, w: 9, h: 0.4, fontSize: 14, color: "666666" });
        const facts = [
          `ICP score: ${r.icpScore} (${r.priorityTier})`,
          `Industry: ${r.industry}${r.subIndustry ? " / " + r.subIndustry : ""}`,
          `Location: ${r.city}${r.region ? ", " + r.region : ""}`,
          `Size: ${r.employeeCount} employees · Revenue: ${r.revenue}`,
          `Domain: ${r.domain}`,
          `Email: ${r.email}  ·  Phone: ${r.phone}`,
          `LinkedIn: ${r.linkedinUrl}`,
        ].filter((l) => !l.endsWith(": ") && !l.endsWith(":  ·  Phone: "));
        s.addText(facts.join("\n"), { x: 0.5, y: 1.6, w: 9, h: 2.5, fontSize: 14 });
        if (r.openingAngle) s.addText(`Opening angle: ${r.openingAngle}`, { x: 0.5, y: 4.2, w: 9, h: 1.0, fontSize: 13, color: "0078d4", italic: true });
        if (r.outreachEmail) s.addText(r.outreachEmail.slice(0, 600), { x: 0.5, y: 5.3, w: 9, h: 2.0, fontSize: 11, color: "444444" });
      }
      const buf = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="lead-factory-${jobId}.pptx"`);
      res.send(buf);
      return;
    }

    if (format === "pdf") {
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Lead Factory Job ${jobId}`, Subject: "Prospect report" } });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="lead-factory-${jobId}.pdf"`);
      doc.pipe(res);

      // Cover page
      doc.fontSize(28).font("Helvetica-Bold").text(`Lead Factory — Job ${jobId}`, { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(13).font("Helvetica").fillColor("#666666");
      doc.text(`${flat.length} prospects · Tier A: ${flat.filter((r) => r.priorityTier === "A").length} · Tier B: ${flat.filter((r) => r.priorityTier === "B").length}`);
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.moveDown(1);

      // Tier distribution
      const tiers: Record<string, number> = {};
      for (const r of flat) { const t = r.priorityTier || "?"; tiers[t] = (tiers[t] || 0) + 1; }
      doc.fillColor("#000000").fontSize(11).font("Helvetica-Bold").text("Priority distribution:");
      for (const t of Object.keys(tiers).sort()) doc.font("Helvetica").text(`  Tier ${t}: ${tiers[t]}`);

      // One page per Tier A prospect (cap 40)
      const topA = flat.filter((r) => r.priorityTier === "A").slice(0, 40);
      for (const r of topA) {
        doc.addPage();
        doc.fontSize(20).font("Helvetica-Bold").fillColor("#000000").text(r.companyName || "—");
        if (r.companyNameAr) {
          doc.fontSize(12).fillColor("#555555").font("Helvetica").text(r.companyNameAr, { align: "right", features: ["rtla"] });
        }
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor("#000000").font("Helvetica-Bold").text(`ICP ${r.icpScore} · Tier ${r.priorityTier} · ${r.validationStatus}`);
        doc.moveDown(0.5);

        doc.fontSize(10).font("Helvetica").fillColor("#000000");
        const facts: Array<[string, string]> = [
          ["Industry", `${r.industry}${r.subIndustry ? " / " + r.subIndustry : ""}`],
          ["Location", `${r.city}${r.region ? ", " + r.region : ""}`],
          ["Size", String(r.employeeCount)],
          ["Revenue", String(r.revenue)],
          ["CR", String(r.crNumber)],
          ["Domain", String(r.domain)],
          ["Email", String(r.email)],
          ["Phone", String(r.phone)],
          ["LinkedIn", String(r.linkedinUrl)],
        ];
        for (const [k, v] of facts) {
          if (!v || v === "null" || v === "undefined") continue;
          doc.font("Helvetica-Bold").text(`${k}: `, { continued: true }).font("Helvetica").text(v);
        }
        if (r.openingAngle) {
          doc.moveDown(0.5);
          doc.font("Helvetica-Bold").fillColor("#0078d4").text("Opening angle:");
          doc.font("Helvetica-Oblique").fillColor("#0078d4").text(r.openingAngle);
        }
        if (r.outreachEmail) {
          doc.moveDown(0.5);
          doc.font("Helvetica-Bold").fillColor("#000000").text("Outreach email:");
          doc.font("Helvetica").fillColor("#333333").fontSize(9).text(r.outreachEmail.slice(0, 1400));
        }
      }
      doc.end();
      return;
    }

    res.status(400).json({ ok: false, error: `Unsupported format: ${format}. Use csv|xlsx|json|pdf|ppt.` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
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

    // Harvest AI — Masaar CR records (industry not on schema; null)
    const masarRows = await db.select({
      nameEn: masarCompaniesTable.nameEn,
      nameAr: masarCompaniesTable.nameAr,
      city: masarCompaniesTable.city,
      domain: masarCompaniesTable.website,
    }).from(masarCompaniesTable)
      .where(or(ilike(masarCompaniesTable.nameEn, `%${q}%`), ilike(masarCompaniesTable.nameAr, `%${q}%`)))
      .limit(6);
    const masarMapped = masarRows.map((r) => ({ ...r, industry: null as string | null }));

    // Merge, deduplicate by nameEn
    const seen = new Set<string>();
    const merged: { nameEn: string | null; nameAr: string | null; city: string | null; industry: string | null; domain: string | null }[] = [];
    for (const r of [...mainRows, ...builderRows, ...masarMapped]) {
      const key = (r.nameEn || r.nameAr || "").toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); merged.push(r); }
    }

    res.json({ suggestions: merged.slice(0, 8) });
  } catch (err) {
    res.json({ suggestions: [] });
  }
});

// ── Person Autocomplete Suggest ───────────────────────────────────────────────
// Strict source routing (per user): Person Hunt pulls from leads + executives
// (+ prosengine_research is fetched on demand by the engine itself).

// GET /lead-factory/person-suggest?q=ahmed
router.get("/lead-factory/person-suggest", async (req: Request, res: Response) => {
  const q = ((req.query.q as string) || "").trim();
  if (q.length < 2) { res.json({ suggestions: [] }); return; }
  try {
    const { leadsTable, executivesTable } = await import("@workspace/db/schema");
    const leadRows = await db.select({
      firstName: leadsTable.firstName, lastName: leadsTable.lastName,
      title: leadsTable.title, email: leadsTable.email,
    }).from(leadsTable)
      .where(or(
        ilike(leadsTable.firstName, `%${q}%`),
        ilike(leadsTable.lastName,  `%${q}%`),
        ilike(leadsTable.email,     `%${q}%`),
      )).limit(6);
    const execRows = await db.select({
      firstName: executivesTable.firstName, lastName: executivesTable.lastName,
      title: executivesTable.title, email: executivesTable.email,
    }).from(executivesTable)
      .where(or(
        ilike(executivesTable.firstName, `%${q}%`),
        ilike(executivesTable.lastName,  `%${q}%`),
      )).limit(6);
    const seen = new Set<string>();
    const merged: { firstName: string | null; lastName: string | null; title: string | null; email: string | null }[] = [];
    for (const r of [...leadRows, ...execRows]) {
      const key = `${(r.firstName||"").toLowerCase()}|${(r.lastName||"").toLowerCase()}`;
      if (key.trim() !== "|" && !seen.has(key)) { seen.add(key); merged.push(r); }
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
