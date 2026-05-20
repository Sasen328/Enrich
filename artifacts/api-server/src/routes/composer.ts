/**
 * Composer API routes
 *   GET  /api/composer/templates
 *   GET  /api/composer/modes
 *   GET  /api/composer/sources           ?category=ksa-market | ?reco=1 (with scope)
 *   GET  /api/composer/connectors
 *   GET  /api/composer/skills
 *   POST /api/composer/enhance           — runs the prompt enhancer
 *
 * All registries are in-memory for now (PR-C will add DB-backed user CRUD).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, composerSkillsTable, composerTemplatesTable, composerUserSourcesTable, composerRunsTable } from "@workspace/db";
import { BUILTIN_TEMPLATES } from "../lib/composer/templates.js";
import { MODES } from "../lib/composer/modes.js";
import { BUILTIN_SOURCES, recommendSources, type ScopeForReco } from "../lib/composer/sources.js";
import { BUILTIN_CONNECTORS } from "../lib/composer/connectors.js";
import { BUILTIN_SKILLS } from "../lib/composer/skills.js";
import { enhancePrompt, type EnhanceInput } from "../lib/composer/enhancer.js";
import { parseToBlocks, type ReportBlock, type ReportShape } from "../lib/composer/report-builder.js";
import { exportReport, type ExportFormat } from "../lib/composer/exporters.js";

const router: IRouter = Router();

router.get("/composer/templates", async (_req: Request, res: Response): Promise<void> => {
  // Merge built-in + user-saved
  let user: typeof composerTemplatesTable.$inferSelect[] = [];
  try { user = await db.select().from(composerTemplatesTable).orderBy(desc(composerTemplatesTable.updatedAt)); }
  catch { /* table may not exist yet — degrade to built-in only */ }
  res.json({
    templates: [
      ...user.map((u) => ({
        id: `user-${u.id}`,
        label: `💾 ${u.name}`,
        description: u.description || "",
        defaultQuestion: u.defaultQuestion,
        defaultModes: u.defaultModes,
        defaultTarget: u.defaultTarget as "person" | "company" | "both",
        defaultCountries: u.defaultCountries,
        defaultIndustry: u.defaultIndustry || undefined,
        defaultSources: u.defaultSources,
        defaultSkills: u.defaultSkills,
        requiredSchema: u.requiredSchema,
        isUser: true, dbId: u.id,
      })),
      ...BUILTIN_TEMPLATES,
    ],
  });
});

router.get("/composer/modes", (_req: Request, res: Response): void => {
  res.json({ modes: MODES });
});

router.get("/composer/sources", (req: Request, res: Response): void => {
  const cat = (req.query.category as string | undefined) || null;
  if (req.query.reco === "1" || req.query.reco === "true") {
    const scope: ScopeForReco = {
      industry: (req.query.industry as string) || undefined,
      countries: String(req.query.countries || "").split(",").filter(Boolean),
      listing: (req.query.listing as string) || undefined,
      target: (req.query.target as ScopeForReco["target"]) || "both",
    };
    res.json({ sources: recommendSources(scope), category: "reco", scope });
    return;
  }
  const sources = cat ? BUILTIN_SOURCES.filter((s) => s.category === cat) : BUILTIN_SOURCES;
  res.json({ sources, category: cat });
});

router.get("/composer/connectors", (_req: Request, res: Response): void => {
  res.json({ connectors: BUILTIN_CONNECTORS });
});

router.get("/composer/skills", async (_req: Request, res: Response): Promise<void> => {
  let user: typeof composerSkillsTable.$inferSelect[] = [];
  try { user = await db.select().from(composerSkillsTable).where(eq(composerSkillsTable.enabled, true)).orderBy(desc(composerSkillsTable.updatedAt)); }
  catch { /* table may not exist yet */ }
  res.json({
    skills: [
      ...user.map((u) => ({
        id: `user-${u.id}`,
        label: `💾 ${u.name}`,
        category: "other" as const,
        description: u.description || "",
        systemPrompt: u.systemPrompt,
        toolWhitelist: u.toolWhitelist,
        reportSchema: u.reportSchema,
        isUser: true, dbId: u.id,
      })),
      ...BUILTIN_SKILLS,
    ],
  });
});

// ── CRUD: user skills ─────────────────────────────────────────────────────────
router.post("/composer/skills", async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, unknown>;
  if (!b.name || !b.systemPrompt) { res.status(400).json({ error: "name + systemPrompt required" }); return; }
  const [row] = await db.insert(composerSkillsTable).values({
    builtinId: (b.builtinId as string) || null,
    name: String(b.name), description: (b.description as string) || null,
    systemPrompt: String(b.systemPrompt),
    toolWhitelist: Array.isArray(b.toolWhitelist) ? (b.toolWhitelist as string[]) : [],
    reportSchema: (b.reportSchema as string) || "Custom",
    modelTier: (b.modelTier as string) || null,
    visibility: (b.visibility as string) || "private",
  }).returning();
  res.status(201).json(row);
});

router.patch("/composer/skills/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const b = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "description", "systemPrompt", "toolWhitelist", "reportSchema", "modelTier", "visibility", "enabled"]) {
    if (k in b) patch[k] = b[k];
  }
  const [row] = await db.update(composerSkillsTable).set(patch).where(eq(composerSkillsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/composer/skills/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(composerSkillsTable).where(eq(composerSkillsTable.id, id));
  res.json({ ok: true });
});

// ── CRUD: user templates ──────────────────────────────────────────────────────
router.post("/composer/templates", async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, unknown>;
  if (!b.name || !b.defaultQuestion) { res.status(400).json({ error: "name + defaultQuestion required" }); return; }
  const [row] = await db.insert(composerTemplatesTable).values({
    builtinId: (b.builtinId as string) || null,
    name: String(b.name), description: (b.description as string) || null,
    defaultQuestion: String(b.defaultQuestion),
    defaultModes: Array.isArray(b.defaultModes) ? (b.defaultModes as string[]) : [],
    defaultTarget: (b.defaultTarget as string) || "both",
    defaultCountries: Array.isArray(b.defaultCountries) ? (b.defaultCountries as string[]) : [],
    defaultIndustry: (b.defaultIndustry as string) || null,
    defaultSources: Array.isArray(b.defaultSources) ? (b.defaultSources as string[]) : [],
    defaultSkills: Array.isArray(b.defaultSkills) ? (b.defaultSkills as string[]) : [],
    requiredSchema: (b.requiredSchema as string) || "LeadList",
    visibility: (b.visibility as string) || "private",
  }).returning();
  res.status(201).json(row);
});

router.patch("/composer/templates/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const b = req.body as Record<string, unknown>;
  const [row] = await db.update(composerTemplatesTable).set(b).where(eq(composerTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/composer/templates/:id", async (req: Request, res: Response): Promise<void> => {
  await db.delete(composerTemplatesTable).where(eq(composerTemplatesTable.id, parseInt(req.params.id, 10)));
  res.json({ ok: true });
});

// ── CRUD: user sources ────────────────────────────────────────────────────────
router.post("/composer/user-sources", async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, unknown>;
  if (!b.label || !b.url) { res.status(400).json({ error: "label + url required" }); return; }
  const [row] = await db.insert(composerUserSourcesTable).values({
    label: String(b.label), url: String(b.url),
    category: (b.category as string) || null,
    language: (b.language as string) || "both",
    countries: Array.isArray(b.countries) ? (b.countries as string[]) : null,
    industries: Array.isArray(b.industries) ? (b.industries as string[]) : null,
  }).returning();
  res.status(201).json(row);
});

router.get("/composer/user-sources", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.select().from(composerUserSourcesTable).where(eq(composerUserSourcesTable.enabled, true));
    res.json({ sources: rows });
  } catch { res.json({ sources: [] }); }
});

router.delete("/composer/user-sources/:id", async (req: Request, res: Response): Promise<void> => {
  await db.delete(composerUserSourcesTable).where(eq(composerUserSourcesTable.id, parseInt(req.params.id, 10)));
  res.json({ ok: true });
});

// ── Runs: persist, render blocks, export ──────────────────────────────────────
router.post("/composer/runs", async (req: Request, res: Response): Promise<void> => {
  const b = req.body as Record<string, unknown>;
  const [row] = await db.insert(composerRunsTable).values({
    state: b.state || {},
    enhancedPrompt: String(b.enhancedPrompt || ""),
    reportShape: (b.reportShape as string) || "detail",
    rawText: (b.rawText as string) || null,
    blocks: b.blocks || null,
    status: (b.status as string) || "running",
  }).returning();
  res.status(201).json(row);
});

router.patch("/composer/runs/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const b = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["state", "enhancedPrompt", "reportShape", "rawText", "blocks", "status", "errorMessage"]) {
    if (k in b) patch[k] = b[k];
  }
  if (b.status === "done") patch.completedAt = new Date();
  const [row] = await db.update(composerRunsTable).set(patch).where(eq(composerRunsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.get("/composer/runs", async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10), 100);
  const rows = await db.select().from(composerRunsTable).orderBy(desc(composerRunsTable.createdAt)).limit(limit);
  res.json({ runs: rows });
});

router.get("/composer/runs/:id", async (req: Request, res: Response): Promise<void> => {
  const [row] = await db.select().from(composerRunsTable).where(eq(composerRunsTable.id, parseInt(req.params.id, 10)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── Parse raw LLM text into report blocks (for inline rendering) ──────────────
router.post("/composer/render-blocks", (req: Request, res: Response): void => {
  const b = req.body as { rawText?: string; shape?: ReportShape };
  res.json({ blocks: parseToBlocks(b.rawText || "", b.shape || "detail") });
});

// ── Export a run to xlsx / pdf / pptx / csv / html / jsx / json ───────────────
router.get("/composer/runs/:id/export", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const format = String(req.query.format || "xlsx") as ExportFormat;
  const [row] = await db.select().from(composerRunsTable).where(eq(composerRunsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const blocks: ReportBlock[] = Array.isArray(row.blocks) ? (row.blocks as ReportBlock[]) : parseToBlocks(row.rawText || "", row.reportShape as ReportShape);
  try {
    const out = await exportReport(blocks, format, { runId: row.id });
    res.setHeader("Content-Type", out.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.send(out.buffer);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Stateless export: pass blocks directly (UI doesn't need to save first) ────
router.post("/composer/export", async (req: Request, res: Response): Promise<void> => {
  const b = req.body as { blocks?: ReportBlock[]; rawText?: string; shape?: ReportShape; format?: ExportFormat; title?: string };
  const format: ExportFormat = (b.format || "xlsx") as ExportFormat;
  const blocks = b.blocks && b.blocks.length ? b.blocks : parseToBlocks(b.rawText || "", b.shape || "detail");
  try {
    const out = await exportReport(blocks, format, { title: b.title });
    res.setHeader("Content-Type", out.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.send(out.buffer);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/composer/enhance", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Partial<EnhanceInput>;
  // basic shape sanity
  const input: EnhanceInput = {
    templateId: body.templateId,
    modes: Array.isArray(body.modes) && body.modes.length ? body.modes : ["leadgen"],
    target: body.target === "person" || body.target === "company" || body.target === "both" ? body.target : "both",
    countries: Array.isArray(body.countries) ? body.countries : ["sa"],
    industry: body.industry,
    listing: body.listing,
    subFilters: body.subFilters || {},
    askFilters: body.askFilters || {},
    sources: body.sources || [],
    connectors: body.connectors || [],
    skills: body.skills || [],
    reportShape: body.reportShape || "detail",
    reportBlocks: body.reportBlocks || [],
    freeText: body.freeText || "",
    clarifications: body.clarifications || {},
    history: body.history || [],
  };
  try {
    const result = await enhancePrompt(input);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
