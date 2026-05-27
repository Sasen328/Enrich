// §11A — Harvest source registry API.
// Single source-of-truth for which sites each engine may harvest, with
// credibility tiers + trust weights that feed the verdict layer (§7) and
// per-engine enforcement (whitelist/blacklist).

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { harvestSourcesTable, sourceEnforcementTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

// GET /api/sources?category=&engine=
router.get("/sources", async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const rows = await db.select().from(harvestSourcesTable)
      .where(category ? eq(harvestSourcesTable.category, category) : undefined as any);
    res.json({ sources: rows });
  } catch (err: any) {
    res.status(500).json({ error: "query_failed", message: err?.message });
  }
});

const createSchema = z.object({
  label: z.string().min(1),
  url: z.string().optional(),
  type: z.enum(["rss", "sitemap", "api", "web", "pdf", "gov-registry"]).default("web"),
  category: z.string().default("custom"),
  language: z.enum(["ar", "en", "both"]).default("both"),
  credibility: z.enum(["primary", "secondary", "inferred"]).default("secondary"),
  trustWeight: z.number().int().min(0).max(100).default(65),
  countries: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
});

router.post("/sources", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  try {
    const [row] = await db.insert(harvestSourcesTable).values({
      ...parsed.data, visibility: "user",
      countries: parsed.data.countries ?? [], industries: parsed.data.industries ?? [],
    } as any).returning();
    res.json({ ok: true, source: row });
  } catch (err: any) {
    res.status(500).json({ error: "insert_failed", message: err?.message });
  }
});

router.patch("/sources/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad_id" });
  try {
    const [row] = await db.update(harvestSourcesTable)
      .set(req.body as any).where(eq(harvestSourcesTable.id, id)).returning();
    res.json({ ok: true, source: row });
  } catch (err: any) {
    res.status(500).json({ error: "update_failed", message: err?.message });
  }
});

router.delete("/sources/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad_id" });
  try {
    // Only user-added rows are deletable.
    await db.delete(harvestSourcesTable)
      .where(and(eq(harvestSourcesTable.id, id), eq(harvestSourcesTable.visibility, "user")));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "delete_failed", message: err?.message });
  }
});

// POST /api/sources/:id/test — live reachability probe
router.post("/sources/:id/test", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "bad_id" });
  try {
    const [src] = await db.select().from(harvestSourcesTable).where(eq(harvestSourcesTable.id, id));
    if (!src?.url) return res.json({ ok: false, status: "down", reason: "no url" });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let status: "ok" | "degraded" | "down" = "down";
    try {
      const r = await fetch(src.url, { method: "HEAD", signal: ctrl.signal });
      status = r.ok ? "ok" : "degraded";
    } catch { status = "down"; }
    clearTimeout(t);
    await db.update(harvestSourcesTable).set({ status, lastSynced: new Date() } as any).where(eq(harvestSourcesTable.id, id));
    res.json({ ok: status === "ok", status });
  } catch (err: any) {
    res.status(500).json({ error: "test_failed", message: err?.message });
  }
});

// POST /api/sources/enforce — set per-engine whitelist/blacklist
const enforceSchema = z.object({
  engineName: z.string().min(1),
  requiredIds: z.array(z.number().int()).default([]),
  excludedIds: z.array(z.number().int()).default([]),
});

router.post("/sources/enforce", async (req: Request, res: Response) => {
  const parsed = enforceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_failed", issues: parsed.error.issues });
  const { engineName, requiredIds, excludedIds } = parsed.data;
  try {
    await db.insert(sourceEnforcementTable)
      .values({ engineName, requiredIds, excludedIds, updatedAt: new Date() } as any)
      .onConflictDoUpdate({ target: sourceEnforcementTable.engineName, set: { requiredIds, excludedIds, updatedAt: new Date() } as any });
    res.json({ ok: true, engineName, requiredIds, excludedIds });
  } catch (err: any) {
    res.status(500).json({ error: "enforce_failed", message: err?.message });
  }
});

// GET /api/sources/health — dashboard widget feed
router.get("/sources/health", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select({
      id: harvestSourcesTable.id, label: harvestSourcesTable.label,
      status: harvestSourcesTable.status, lastSynced: harvestSourcesTable.lastSynced,
      enabled: harvestSourcesTable.enabled,
    }).from(harvestSourcesTable);
    res.json({ sources: rows });
  } catch (err: any) {
    res.status(500).json({ error: "health_failed", message: err?.message });
  }
});

/** Helper for engines: resolve the effective source list given enforcement. */
export async function resolveEnginesSources(engineName: string): Promise<{ all: any[]; required: number[]; excluded: number[] }> {
  const all = await db.select().from(harvestSourcesTable).where(eq(harvestSourcesTable.enabled, true));
  const [enf] = await db.select().from(sourceEnforcementTable).where(eq(sourceEnforcementTable.engineName, engineName));
  return { all, required: (enf?.requiredIds as number[]) ?? [], excluded: (enf?.excludedIds as number[]) ?? [] };
}

export default router;
