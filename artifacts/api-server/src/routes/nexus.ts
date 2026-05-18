/**
 * NEXUS Engine — Status & Control API
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * GET  /api/nexus/status          — full engine status (all layers)
 * GET  /api/nexus/llm/status      — LLM provider status + cost tracking
 * GET  /api/nexus/proxy/status    — proxy provider status
 * GET  /api/nexus/captcha/status  — CAPTCHA solver status
 * POST /api/nexus/llm/test        — test-fire LLM routing with a prompt
 * POST /api/nexus/captcha/test    — test CAPTCHA solver (dry-run, no real solve)
 * DELETE /api/nexus/session/usage — clear session cost tracking
 */

import { Router, type Request, type Response } from "express";
import {
  nexus,
  getLLMStatus,
  getSessionUsage,
  clearSessionUsage,
  getProxyStatus,
  clearStickySessions,
  getCaptchaStatus,
  isCaptchaAvailable,
  nexusGenerate,
} from "../lib/nexus/index.js";

const router = Router();

// ── GET /api/nexus/status ──────────────────────────────────────────────────────
router.get("/nexus/status", (_req: Request, res: Response): void => {
  try {
    res.json({
      ok: true,
      engine: "NEXUS",
      description: "Autonomous AI-Native Lead Intelligence Engine",
      ...nexus.status(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/nexus/llm/status ──────────────────────────────────────────────────
router.get("/nexus/llm/status", (_req: Request, res: Response): void => {
  const status = getLLMStatus();
  const usage = getSessionUsage();
  res.json({
    ok: true,
    ...status,
    sessionUsage: usage,
    costBreakdown: {
      description: "Estimated USD cost for current session",
      totalUSD: usage.totalCostUSD.toFixed(6),
      recordCount: usage.records.length,
      byProvider: usage.records.reduce<Record<string, number>>((acc, r) => {
        acc[r.provider] = (acc[r.provider] || 0) + r.estimatedCostUSD;
        return acc;
      }, {}),
    },
  });
});

// ── GET /api/nexus/proxy/status ────────────────────────────────────────────────
router.get("/nexus/proxy/status", (_req: Request, res: Response): void => {
  res.json({ ok: true, ...getProxyStatus() });
});

// ── GET /api/nexus/captcha/status ──────────────────────────────────────────────
router.get("/nexus/captcha/status", (_req: Request, res: Response): void => {
  res.json({ ok: true, ...getCaptchaStatus(), anyAvailable: isCaptchaAvailable() });
});

// ── POST /api/nexus/llm/test ───────────────────────────────────────────────────
router.post("/nexus/llm/test", async (req: Request, res: Response): Promise<void> => {
  const {
    prompt = "Say hello in Arabic and English in one short sentence.",
    tier = "extraction",
    systemPrompt,
    maxTokens = 200,
  } = req.body as {
    prompt?: string;
    tier?: string;
    systemPrompt?: string;
    maxTokens?: number;
  };

  try {
    const result = await nexusGenerate(prompt, {
      tier: tier as import("../lib/nexus/llm-router.js").TaskTier,
      systemPrompt,
      maxTokens,
      timeoutMs: 30000,
      trackUsage: true,
    });
    res.json({
      ok: true,
      result: result.text,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── DELETE /api/nexus/session/usage ───────────────────────────────────────────
router.delete("/nexus/session/usage", (_req: Request, res: Response): void => {
  clearSessionUsage();
  clearStickySessions();
  res.json({ ok: true, message: "Session usage and sticky sessions cleared" });
});

export default router;
