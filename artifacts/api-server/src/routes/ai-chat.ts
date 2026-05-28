/**
 * AI Chat — Composer-aware SSE endpoint
 *
 * POST /api/ai-chat/stream
 *   body: { message: string, history?: [{role, content}], system?: string }
 *
 * Streams SSE events:
 *   data: {"event":"agent_start","data":{"agent":"🔍 Researcher","description":"..."}}
 *   data: {"event":"agent_done","data":{"agent":"🔍 Researcher","found":true,"summary":"..."}}
 *   data: {"event":"token","data":"..."}
 *   data: {"event":"final","data":{"text":"..."}}
 *   data: {"event":"error","data":{"message":"..."}}
 *
 * Provider/model identifiers are stripped — only friendly agent labels emitted.
 * Fallback: if ANTHROPIC_API_KEY is missing, the route proxies the existing
 * single-pass ProsEngine handler so nothing breaks.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { runAgentChat, type OrchestratorEvent } from "../lib/agents/orchestrator.js";
import { enterJob } from "../lib/paid-api-guard.js";

const router: IRouter = Router();

router.post("/ai-chat/stream", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    system?: string;
  };
  const message = String(body.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const emit = (e: OrchestratorEvent): void => {
    try {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch { /* connection closed */ }
  };

  let closed = false;
  req.on("close", () => { closed = true; });

  // ── Plan B: no Anthropic key → single-pass synthesis via Nexus (Kimi planner
  //    → OpenRouter Claude → GPT-4o → Llama). No tool loop, but still answers. ──
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      enterJob(`ai-chat-planb:${Date.now()}`);
      const { nexusRunRole } = await import("../lib/nexus/llm-router.js");
      emit({ event: "agent_start", data: { agent: "🧠 Planner", description: "Anthropic key absent — using Nexus fallback (degraded mode)" } });
      const result = await nexusRunRole("planner", message, {
        systemPrompt: body.system || "You are a Saudi B2B research analyst. Answer directly and cite sources where possible.",
        maxTokens: 2000,
      });
      emit({ event: "agent_done", data: { agent: "🧠 Planner", found: true, summary: `via ${result.provider}` } });
      emit({ event: "intent", data: { plan: `degraded_mode: ${result.provider}` } });
      emit({ event: "token", data: result.text });
      emit({ event: "final", data: { text: result.text } });
    } catch (e) {
      emit({ event: "error", data: { message: "No orchestrator available. Set ANTHROPIC_API_KEY or any Nexus provider key (OPENROUTER_API_KEY / MOONSHOT_API_KEY)." } });
      emit({ event: "final", data: { text: "" } });
    }
    res.end();
    return;
  }

  try {
    // Explicit user-initiated chat → permit paid APIs within budget.
    enterJob(`ai-chat:${Date.now()}`);
    await runAgentChat(
      message,
      (body.history || []).slice(-10), // keep last 10 turns
      (e) => { if (!closed) emit(e); },
      { systemPrompt: body.system },
    );
  } catch (e) {
    if (!closed) emit({ event: "error", data: { message: e instanceof Error ? e.message : String(e) } });
  } finally {
    res.end();
  }
});

export default router;
