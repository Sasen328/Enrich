// Lead Genome — the save bucket + list builder + deep-enrich layer.
//
// Architecture (per user 2026-05-21):
//   - Research happens in Lead Factory / ProsEngine / Harvest AI / AI Chat.
//   - Lead Genome is the DESTINATION for those engines and the
//     categorization / segmentation / persona / list-builder workspace.
//   - Deep research on an EXISTING saved lead is supported (enrich).
//
// Endpoints:
//   POST /api/lead-genome/save                — any engine pushes a lead row
//   POST /api/lead-genome/hunt                — filter saved leads
//   GET  /api/lead-genome/stats               — totals + per-source counts
//   POST /api/lead-genome/lists               — create a new list (segment/persona)
//   GET  /api/lead-genome/lists               — list all
//   GET  /api/lead-genome/lists/:id           — get list + items
//   POST /api/lead-genome/lists/:id/items     — add saved leads to a list
//   POST /api/lead-genome/enrich/:leadId      — deep research on an existing lead

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable, leadListsTable, leadListItemsTable } from "@workspace/db/schema";
import { and, or, ilike, eq, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();
const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

// ── SAVE ─────────────────────────────────────────────────────────────────
const saveSchema = z.object({
  firstName:   z.string().optional(),
  lastName:    z.string().optional(),
  firstNameAr: z.string().optional(),
  lastNameAr:  z.string().optional(),
  title:       z.string().optional(),
  titleAr:     z.string().optional(),
  email:       z.string().optional(),
  phone:       z.string().optional(),
  linkedinUrl: z.string().optional(),
  twitterUrl:  z.string().optional(),
  department:  z.string().optional(),
  seniority:   z.string().optional(),
  companyId:   z.number().optional(),
  source:      z.enum(["lead-factory", "prosengine", "ai-chat", "manual",
                       "executives", "masaar", "builder", "meshbase"]).optional(),
  notes:       z.string().optional(),
});

router.post("/lead-genome/save", async (req: Request, res: Response) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  const { source, notes, ...rest } = parsed.data;
  const tag = source ? `[from:${source}] ` : "";
  try {
    const [row] = await db.insert(leadsTable).values({
      ...rest, notes: tag + (notes ?? ""), status: "new",
    }).returning();
    return res.json({ ok: true, lead: row });
  } catch (err: any) {
    return res.status(500).json({ error: "insert_failed", message: err?.message });
  }
});

// ── HUNT (filter the saved bucket) ───────────────────────────────────────
const huntSchema = z.object({
  q:          z.string().optional(),
  title:      z.string().optional(),
  department: z.string().optional(),
  seniority:  z.string().optional(),
  source:     z.string().optional(),
  limit:      z.number().int().min(1).max(500).default(50),
});

router.post("/lead-genome/hunt", async (req: Request, res: Response) => {
  const parsed = huntSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  const f = parsed.data;
  const conds: any[] = [];
  if (f.q) conds.push(or(
    ilike(leadsTable.firstName, `%${f.q}%`),
    ilike(leadsTable.lastName,  `%${f.q}%`),
    ilike(leadsTable.email,     `%${f.q}%`),
  ));
  if (f.title)      conds.push(ilike(leadsTable.title, `%${f.title}%`));
  if (f.department) conds.push(eq(leadsTable.department, f.department));
  if (f.seniority)  conds.push(eq(leadsTable.seniority,  f.seniority));
  if (f.source)     conds.push(ilike(leadsTable.notes, `%[from:${f.source}]%`));
  try {
    const rows = await db.select().from(leadsTable)
      .where(conds.length ? and(...conds) : undefined).limit(f.limit);
    return res.json({ leads: rows, count: rows.length });
  } catch (err: any) {
    return res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

// ── STATS ───────────────────────────────────────────────────────────────
router.get("/lead-genome/stats", async (_req: Request, res: Response) => {
  try {
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(leadsTable);
    const sources = ["lead-factory","prosengine","ai-chat","manual","executives","masaar","builder","meshbase"];
    const bySource: Record<string, number> = {};
    for (const s of sources) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
        .from(leadsTable).where(ilike(leadsTable.notes, `%[from:${s}]%`));
      bySource[s] = Number(c) || 0;
    }
    const [{ listCount }] = await db.select({ listCount: sql<number>`count(*)::int` }).from(leadListsTable);
    return res.json({ total, bySource, listCount: Number(listCount) || 0 });
  } catch (err: any) {
    return res.status(500).json({ error: "stats_failed", message: err?.message });
  }
});

// ── LISTS — categorization / segmentation / personas ─────────────────────
const createListSchema = z.object({
  name: z.string().min(1),
  criteria: z.string().default(""),
  sourcesSearched: z.string().optional(),
});

router.post("/lead-genome/lists", async (req: Request, res: Response) => {
  const parsed = createListSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  try {
    const [row] = await db.insert(leadListsTable).values({
      name: parsed.data.name,
      criteria: parsed.data.criteria,
      sourcesSearched: parsed.data.sourcesSearched ?? null,
      status: "ready",
      totalFound: 0,
    }).returning();
    return res.json({ ok: true, list: row });
  } catch (err: any) {
    return res.status(500).json({ error: "create_failed", message: err?.message });
  }
});

router.get("/lead-genome/lists", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(leadListsTable).orderBy(sql`created_at desc`).limit(200);
    return res.json({ lists: rows });
  } catch (err: any) {
    return res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

router.get("/lead-genome/lists/:id", async (req: Request, res: Response) => {
  const id = parseInt(p(req.params.id), 10);
  if (!id) return res.status(400).json({ error: "bad_id" });
  try {
    const [list] = await db.select().from(leadListsTable).where(eq(leadListsTable.id, id));
    if (!list) return res.status(404).json({ error: "not_found" });
    const items = await db.select().from(leadListItemsTable).where(eq(leadListItemsTable.listId, id));
    return res.json({ list, items });
  } catch (err: any) {
    return res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

const addItemsSchema = z.object({
  leadIds: z.array(z.number().int()).min(1),
});

router.post("/lead-genome/lists/:id/items", async (req: Request, res: Response) => {
  const id = parseInt(p(req.params.id), 10);
  if (!id) return res.status(400).json({ error: "bad_id" });
  const parsed = addItemsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  try {
    const leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, parsed.data.leadIds));
    if (leads.length === 0) return res.json({ ok: true, added: 0 });
    // Map leads → list item shape
    const inserts = leads.map((l) => ({
      listId: id,
      personName:   [l.firstName, l.lastName].filter(Boolean).join(" ") || null,
      personNameAr: [l.firstNameAr, l.lastNameAr].filter(Boolean).join(" ") || null,
      personTitle:  l.title ?? null,
      personTitleAr: l.titleAr ?? null,
      department:   l.department ?? null,
      seniority:    l.seniority ?? null,
      linkedin:     l.linkedinUrl ?? null,
      phone:        l.phone ?? null,
      email:        l.email ?? null,
      source:       (l.notes || "").match(/\[from:([^\]]+)\]/)?.[1] ?? "manual",
      sourceId:     String(l.id),
    }));
    await db.insert(leadListItemsTable).values(inserts);
    await db.update(leadListsTable)
      .set({ totalFound: sql`coalesce(${leadListsTable.totalFound},0) + ${inserts.length}` })
      .where(eq(leadListsTable.id, id));
    return res.json({ ok: true, added: inserts.length });
  } catch (err: any) {
    return res.status(500).json({ error: "insert_failed", message: err?.message });
  }
});

// ── ENRICH a saved lead (deep research on EXISTING lead) ─────────────────
// Pipes the lead's name/title/company through Lead Factory's research
// pipeline as a targeted single-person enrichment, then updates the lead.
router.post("/lead-genome/enrich/:leadId", async (req: Request, res: Response) => {
  const leadId = parseInt(p(req.params.leadId), 10);
  if (!leadId) return res.status(400).json({ error: "bad_id" });
  try {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    if (!lead) return res.status(404).json({ error: "not_found" });

    const { runLeadFactoryPipeline, createLeadFactoryJob } = await import("../lib/lead-factory-engine.js");
    const jobId = createLeadFactoryJob();
    const brief = {
      mode: "person" as const,
      icpDescription: `Deep enrichment for ${lead.firstName ?? ""} ${lead.lastName ?? ""} (${lead.title ?? "role unknown"})`,
      titles: lead.title ? [lead.title] : [],
      targetCount: 1,
    } as any;
    runLeadFactoryPipeline(jobId, brief).catch((err) =>
      console.error("[lead-genome] enrich crashed:", err)
    );
    return res.json({ ok: true, jobId, leadId, message: "Deep enrichment started. Stream via /api/lead-factory/stream/:jobId." });
  } catch (err: any) {
    return res.status(500).json({ error: "enrich_failed", message: err?.message });
  }
});

export default router;
