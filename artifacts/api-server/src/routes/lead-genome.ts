// Lead Genome route — central save + hunt for all leads pushed from any tool.
//
// Strict input contract (per user 2026-05-21):
//   - POST /api/lead-genome/save     — any engine can push a lead row here.
//   - POST /api/lead-genome/hunt     — filter saved leads by parameters.
//   - GET  /api/lead-genome/stats    — counts grouped by source.
//
// Backing table: leadsTable (lib/db schema). Source tag stored in `notes`
// prefix as "[from:masar]" / "[from:builder]" / "[from:executives]" / etc.
// so we don't migrate the schema mid-flight.

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db/schema";
import { and, or, ilike, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

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
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  }
  const { source, notes, ...rest } = parsed.data;
  const tag = source ? `[from:${source}] ` : "";
  try {
    const [row] = await db.insert(leadsTable).values({
      ...rest,
      notes: tag + (notes ?? ""),
      status: "new",
    }).returning();
    return res.json({ ok: true, lead: row });
  } catch (err: any) {
    return res.status(500).json({ error: "insert_failed", message: err?.message });
  }
});

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
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  }
  const f = parsed.data;
  const conds: any[] = [];
  if (f.q) {
    conds.push(or(
      ilike(leadsTable.firstName, `%${f.q}%`),
      ilike(leadsTable.lastName,  `%${f.q}%`),
      ilike(leadsTable.email,     `%${f.q}%`),
    ));
  }
  if (f.title)      conds.push(ilike(leadsTable.title,      `%${f.title}%`));
  if (f.department) conds.push(eq(leadsTable.department, f.department));
  if (f.seniority)  conds.push(eq(leadsTable.seniority,  f.seniority));
  if (f.source)     conds.push(ilike(leadsTable.notes, `%[from:${f.source}]%`));

  try {
    const rows = await db.select().from(leadsTable)
      .where(conds.length ? and(...conds) : undefined)
      .limit(f.limit);
    return res.json({ leads: rows, count: rows.length });
  } catch (err: any) {
    return res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

router.get("/lead-genome/stats", async (_req: Request, res: Response) => {
  try {
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(leadsTable);
    // Per-source counts via notes-tag prefix scan
    const sources = ["lead-factory","prosengine","ai-chat","manual","executives","masaar","builder","meshbase"];
    const bySource: Record<string, number> = {};
    for (const s of sources) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` })
        .from(leadsTable).where(ilike(leadsTable.notes, `%[from:${s}]%`));
      bySource[s] = Number(c) || 0;
    }
    return res.json({ total, bySource });
  } catch (err: any) {
    return res.status(500).json({ error: "stats_failed", message: err?.message });
  }
});

export default router;
