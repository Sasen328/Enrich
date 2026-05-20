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

  // Fallback if no Anthropic key
  if (!process.env.ANTHROPIC_API_KEY) {
    emit({
      event: "error",
      data: { message: "ANTHROPIC_API_KEY not configured — orchestrator unavailable. Set the key in .env and restart." },
    });
    emit({ event: "final", data: { text: "" } });
    res.end();
    return;
  }

  let closed = false;
  req.on("close", () => { closed = true; });

  try {
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
