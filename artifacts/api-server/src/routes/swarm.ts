import { Router } from "express";
import { getRuns, getRun, getActiveRuns, subscribeToRun, subscribeToAll } from "../lib/agents/swarm-bus.js";

const router = Router();

// ── SSE: stream all active swarm events ────────────────────────────────────
router.get("/api/swarm/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send initial snapshot of active runs
  const active = getActiveRuns();
  res.write(`data: ${JSON.stringify({ event: "init", data: { activeRuns: active.map(r => runToSnapshot(r)) } })}\n\n`);

  // Subscribe to all future events
  const unsub = subscribeToAll((runId, event) => {
    const payload = JSON.stringify({ event: "swarm_event", data: { runId, event } });
    res.write(`data: ${payload}\n\n`);
  });

  req.on("close", () => {
    unsub();
  });
});

// ── GET: list all runs ─────────────────────────────────────────────────────
router.get("/api/swarm/runs", (_req, res) => {
  const runs = getRuns().map(r => runToSnapshot(r));
  res.json({ runs });
});

// ── GET: single run details ────────────────────────────────────────────────
router.get("/api/swarm/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(runToDetail(run));
});

// ── SSE: stream a specific run ─────────────────────────────────────────────
router.get("/api/swarm/runs/:id/stream", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Replay all past events
  for (const ev of run.events) {
    res.write(`data: ${JSON.stringify({ event: ev.event, data: ev.data })}\n\n`);
  }

  // Subscribe to new events
  const unsub = subscribeToRun(req.params.id, (event) => {
    res.write(`data: ${JSON.stringify({ event: event.event, data: event.data })}\n\n`);
  });

  req.on("close", () => {
    unsub();
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
function runToSnapshot(run: ReturnType<typeof getRun> & {}) {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    trigger: run.trigger,
    agentCount: run.agents.size,
    completedAgents: Array.from(run.agents.values()).filter(a => a.status === "done").length,
  };
}

function runToDetail(run: NonNullable<ReturnType<typeof getRun>>) {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    trigger: run.trigger,
    events: run.events,
    agents: Array.from(run.agents.values()),
  };
}

export default router;
