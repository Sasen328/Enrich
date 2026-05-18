/**
 * Signal Intelligence Routes
 * Event-driven lead scoring for Saudi B2B companies.
 *
 * POST /api/signals/scan        — run full signal scan for a company
 * GET  /api/signals/:companyId  — get stored signals for a company
 * POST /api/signals/sanctions   — quick sanctions-only check
 * POST /api/signals/news        — news-only fetch (no DB write)
 */

import { Router, type Request, type Response } from "express";
import {
  scanCompanySignals,
  getCompanySignals,
  getSignalsByName,
  scanIndividualSignals,
  scanRegulatorySignals,
} from "../lib/signal-engine.js";
import {
  scoutSignalsNews,
  scoutSignalsSanctions,
} from "../lib/scout-client.js";
import { db, companySignalsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const router = Router();

// ── POST /api/signals/scan ────────────────────────────────────────────────────

router.post("/signals/scan", async (req: Request, res: Response) => {
  const {
    company_name,
    company_name_ar,
    company_id,
    domain,
    run_llm = true,
    save_to_db = true,
  } = req.body as {
    company_name?: string;
    company_name_ar?: string;
    company_id?: number;
    domain?: string;
    run_llm?: boolean;
    save_to_db?: boolean;
  };

  if (!company_name) {
    res.status(400).json({ ok: false, error: "company_name is required" });
    return;
  }

  try {
    const result = await scanCompanySignals({
      companyName: company_name,
      companyNameAr: company_name_ar,
      companyId: company_id,
      domain,
      runLlmClassification: run_llm,
      saveToDB: save_to_db,
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("[signals/scan] error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/signals/:companyId ───────────────────────────────────────────────

router.get("/signals/:companyId", async (req: Request, res: Response) => {
  const companyId = parseInt(p(req.params.companyId));
  if (isNaN(companyId)) {
    res.status(400).json({ ok: false, error: "Invalid company ID" });
    return;
  }
  try {
    const signals = await getCompanySignals(companyId, 30);
    const positive = signals.filter(s => s.category === "positive");
    const negative = signals.filter(s => s.category === "negative");
    const sanctioned = signals.some(s => s.isSanctioned === 1);
    res.json({ ok: true, data: { signals, positive, negative, sanctioned, total: signals.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/signals/by-name/:name ────────────────────────────────────────────

router.get("/signals/by-name/:name", async (req: Request, res: Response) => {
  const name = decodeURIComponent(p(req.params.name));
  try {
    const signals = await getSignalsByName(name, 30);
    res.json({ ok: true, data: { signals, total: signals.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/signals/news ────────────────────────────────────────────────────

router.post("/signals/news", async (req: Request, res: Response) => {
  const { company_name, company_name_ar, domain, max_articles = 20 } = req.body as {
    company_name?: string;
    company_name_ar?: string;
    domain?: string;
    max_articles?: number;
  };
  if (!company_name) {
    res.status(400).json({ ok: false, error: "company_name is required" });
    return;
  }
  try {
    const data = await scoutSignalsNews(company_name, company_name_ar, domain, max_articles);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/signals/sanctions ───────────────────────────────────────────────

router.post("/signals/sanctions", async (req: Request, res: Response) => {
  const { name, aliases } = req.body as { name?: string; aliases?: string[] };
  if (!name) {
    res.status(400).json({ ok: false, error: "name is required" });
    return;
  }
  try {
    const data = await scoutSignalsSanctions(name, aliases);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/signals/recent ───────────────────────────────────────────────────

router.get("/signals/recent", async (_req: Request, res: Response) => {
  try {
    const signals = await db
      .select()
      .from(companySignalsTable)
      .orderBy(desc(companySignalsTable.createdAt))
      .limit(50);

    const prioritize = signals.filter(s => s.recommendedAction === "prioritize");
    const disqualify = signals.filter(s => s.recommendedAction === "disqualify");
    const hold       = signals.filter(s => s.recommendedAction === "hold");

    res.json({ ok: true, data: { signals, prioritize, disqualify, hold, total: signals.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/signals/individual ──────────────────────────────────────────────

router.post("/signals/individual", async (req: Request, res: Response) => {
  const {
    full_name,
    full_name_ar,
    company_name,
    title,
    max_articles = 20,
  } = req.body as {
    full_name?: string;
    full_name_ar?: string;
    company_name?: string;
    title?: string;
    max_articles?: number;
  };

  if (!full_name) {
    res.status(400).json({ ok: false, error: "full_name is required" });
    return;
  }

  try {
    const result = await scanIndividualSignals({
      fullName: full_name,
      fullNameAr: full_name_ar,
      companyName: company_name,
      title,
      maxArticles: max_articles,
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("[signals/individual] error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/signals/regulatory ─────────────────────────────────────────────

router.post("/signals/regulatory", async (req: Request, res: Response) => {
  const {
    company_name,
    company_name_ar,
    include_tadawul = true,
  } = req.body as {
    company_name?: string;
    company_name_ar?: string;
    include_tadawul?: boolean;
  };

  if (!company_name) {
    res.status(400).json({ ok: false, error: "company_name is required" });
    return;
  }

  try {
    const result = await scanRegulatorySignals({
      companyName: company_name,
      companyNameAr: company_name_ar,
      includeTadawul: include_tadawul,
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("[signals/regulatory] error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
