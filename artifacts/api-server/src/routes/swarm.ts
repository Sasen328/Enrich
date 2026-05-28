/**
 * Agent Swarm — SSE endpoint
 *
 * POST /api/swarm/start
 *   body: { brief: string, useKimi?: boolean, maxAgents?: number }
 *
 * Streams the same SSE shape as /api/ai-chat/stream (agent_start / agent_done /
 * intent / token / final / error) so the AI Chat UI can render swarm runs.
 *
 * Runs entirely on the NEXUS fabric — works without an Anthropic key. The
 * coordinator (Kimi-pinned when OPENROUTER_API_KEY is set) decomposes the brief
 * and fans out specialist agents in parallel.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { runSwarm } from "../lib/agents/swarm.js";
import type { OrchestratorEvent } from "../lib/agents/orchestrator.js";
import { enterJob } from "../lib/paid-api-guard.js";
import { publishEvent } from "../lib/event-bus.js";

const router: IRouter = Router();

router.post("/swarm/start", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { brief?: string; useKimi?: boolean; maxAgents?: number };
  const brief = String(body.brief || "").trim();
  if (!brief) {
    res.status(400).json({ error: "brief is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => { closed = true; });

  const emit = (e: OrchestratorEvent): void => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch { /* connection closed */ }
  };

  try {
    enterJob(`swarm:${Date.now()}`);
    publishEvent({ kind: "swarm.start", ico: "🐝", source: "swarm", text: `Swarm started: ${brief.slice(0, 60)}` });
    await runSwarm(brief, emit, {
      useKimi: body.useKimi !== false,
      maxAgents: Number(body.maxAgents) || undefined,
    });
    publishEvent({ kind: "swarm.complete", ico: "🐝", source: "swarm", text: `Swarm completed: ${brief.slice(0, 60)}` });
  } catch (e) {
    emit({ event: "error", data: { message: e instanceof Error ? e.message : String(e) } });
    emit({ event: "final", data: { text: "" } });
  } finally {
    res.end();
  }
});

export default router;
