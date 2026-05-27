// §2A — Behavior Agent backend.
// Watches the user's recent actions + current composer state and returns a
// one-line suggestion, an optional system-prompt hint to inject, and
// ready-to-plug action chips (each fires a real endpoint with a prefilled body).
// Runs on the cheap planner tier (Kimi-pinned when available).

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { behaviorEventsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { enterJob } from "../lib/paid-api-guard.js";

const router = Router();

// Log an event (fire-and-forget from the client).
router.post("/behavior/event", async (req: Request, res: Response) => {
  const { sessionId, kind, payload } = req.body as { sessionId?: string; kind?: string; payload?: Record<string, unknown> };
  if (!sessionId || !kind) { res.status(400).json({ error: "sessionId + kind required" }); return; }
  try {
    await db.insert(behaviorEventsTable).values({ sessionId, kind, payload: payload ?? {} } as any);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "log_failed", message: err?.message });
  }
});

const suggestSchema = z.object({
  sessionId: z.string().optional(),
  state: z.object({
    target: z.string().optional(),     // person|company|both
    reportShape: z.string().optional(),
    modes: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    chips: z.record(z.string(), z.boolean()).optional(),
    page: z.string().optional(),
  }).optional(),
  history: z.array(z.object({ kind: z.string(), payload: z.record(z.string(), z.unknown()).optional() })).optional(),
});

router.post("/behavior/suggest", async (req: Request, res: Response) => {
  const parsed = suggestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "validation_failed", issues: parsed.error.issues }); return; }
  const { state = {}, history = [] } = parsed.data;

  // Deterministic rules first (instant, zero-cost) — cover the common cases.
  const rule = deterministicSuggestion(state, history);
  if (rule) { res.json(rule); return; }

  // Fall back to a cheap LLM suggestion (job-gated, Kimi planner).
  try {
    enterJob(`behavior:${Date.now()}`);
    const { nexusRunRole } = await import("../lib/nexus/llm-router.js");
    const prompt = `User state: ${JSON.stringify(state)}. Recent actions: ${JSON.stringify(history.slice(-5))}.
Suggest ONE next action in <=14 words. Output strict JSON:
{"suggestion":"...", "oneLineHint":"<system hint or empty>", "plugActions":[{"label":"...","endpoint":"/api/...","body":{}}]}`;
    const out = await nexusRunRole("planner", prompt, { maxTokens: 300 });
    let json: any = {};
    try { json = JSON.parse(out.text.replace(/```json|```/g, "").trim()); } catch { /* keep empty */ }
    res.json({
      suggestion: json.suggestion || "Make a selection to see suggestions.",
      oneLineHint: json.oneLineHint || "",
      plugActions: Array.isArray(json.plugActions) ? json.plugActions.slice(0, 3) : [],
    });
  } catch (err: any) {
    res.json({ suggestion: "Make a selection to see suggestions.", oneLineHint: "", plugActions: [] });
  }
});

function deterministicSuggestion(state: any, history: any[]) {
  const last = history[history.length - 1];
  const hints: Record<string, any> = {};

  if (state.chips?.["Arabic-first"]) {
    hints.oneLineHint = "User enabled 'Arabic-first' — prefer Arabic sources and respond bilingually.";
  }

  if (state.target === "both") {
    return {
      suggestion: "Both targets active — enrich runs person + company gates separately.",
      oneLineHint: hints.oneLineHint || "",
      plugActions: [
        { label: "Run Person Hunt", endpoint: "/api/lead-factory/start", body: { mode: "person", icpDescription: state.reportShape || "" } },
        { label: "Run Company Hunt", endpoint: "/api/lead-factory/start", body: { mode: "company", icpDescription: state.reportShape || "" } },
      ],
    };
  }
  if (last?.kind === "compose") {
    return {
      suggestion: "Loadout looks good — toggle Enhance ON, then Run.",
      oneLineHint: hints.oneLineHint || "",
      plugActions: [{ label: "Run now", endpoint: "/api/ai-chat/stream", body: {} }],
    };
  }
  if (last?.kind === "nav" && String(last?.payload?.to || "").includes("results")) {
    return {
      suggestion: "Push the highest-trust rows to Lead Genome?",
      oneLineHint: hints.oneLineHint || "",
      plugActions: [{ label: "Save top 5 → Genome", endpoint: "/api/lead-genome/save", body: { source: "lead-factory" } }],
    };
  }
  return Object.keys(hints).length ? { suggestion: "", oneLineHint: hints.oneLineHint, plugActions: [] } : null;
}

export default router;
