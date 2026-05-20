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
import { BUILTIN_TEMPLATES } from "../lib/composer/templates.js";
import { MODES } from "../lib/composer/modes.js";
import { BUILTIN_SOURCES, recommendSources, type ScopeForReco } from "../lib/composer/sources.js";
import { BUILTIN_CONNECTORS } from "../lib/composer/connectors.js";
import { BUILTIN_SKILLS } from "../lib/composer/skills.js";
import { enhancePrompt, type EnhanceInput } from "../lib/composer/enhancer.js";

const router: IRouter = Router();

router.get("/composer/templates", (_req: Request, res: Response): void => {
  res.json({ templates: BUILTIN_TEMPLATES });
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

router.get("/composer/skills", (_req: Request, res: Response): void => {
  res.json({ skills: BUILTIN_SKILLS });
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
