/**
 * Swarm Event Bus
 * 
 * In-memory pub/sub for agent orchestration events.
 * The orchestrator publishes events here; the swarm SSE route subscribes.
 * Simple EventEmitter — sufficient for single-node dev/prod.
 * Scale: replace with Redis Pub/Sub if multi-node.
 */

import { EventEmitter } from "events";
import type { OrchestratorEvent } from "./orchestrator.js";

export interface SwarmRunRecord {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  status: "running" | "completed" | "failed";
  trigger: { type: "chat" | "lead-factory" | "scheduled" | "manual"; userQuery?: string };
  events: Array<OrchestratorEvent & { at: Date }>;
  agents: Map<string, SwarmAgentNode>;
}

export interface SwarmAgentNode {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  startedAt?: Date;
  endedAt?: Date;
  description?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  parentId?: string;
  children: string[];
}

const runs = new Map<string, SwarmRunRecord>();
const bus = new EventEmitter();

// Keep last 50 runs in memory (LRU-ish)
const MAX_RUNS = 50;

export function createRun(runId: string, trigger: SwarmRunRecord["trigger"]): SwarmRunRecord {
  const run: SwarmRunRecord = {
    id: runId,
    startedAt: new Date(),
    status: "running",
    trigger,
    events: [],
    agents: new Map(),
  };
  runs.set(runId, run);

  // Prune old runs
  if (runs.size > MAX_RUNS) {
    const firstKey = runs.keys().next().value;
    if (firstKey) runs.delete(firstKey);
  }

  bus.emit("run:created", run);
  return run;
}

export function publishEvent(runId: string, event: OrchestratorEvent): void {
  const run = runs.get(runId);
  if (!run) return;

  const timedEvent = { ...event, at: new Date() };
  run.events.push(timedEvent);

  // Update agent nodes from event
  if (event.event === "agent_start" && event.data?.agent) {
    const agentId = `${runId}-${event.data.agent}-${run.events.length}`;
    const node: SwarmAgentNode = {
      id: agentId,
      name: event.data.agent,
      status: "running",
      startedAt: new Date(),
      description: event.data.description,
      children: [],
    };
    run.agents.set(agentId, node);
  } else if (event.event === "agent_done" && event.data?.agent) {
    // Find the most recent matching agent that's running
    for (const [id, node] of [...run.agents.entries()].reverse()) {
      if (node.name === event.data.agent && node.status === "running") {
        node.status = event.data.found ? "done" : "error";
        node.endedAt = new Date();
        node.output = event.data.summary;
        break;
      }
    }
  } else if (event.event === "error") {
    run.status = "failed";
    run.endedAt = new Date();
  } else if (event.event === "final") {
    run.status = "completed";
    run.endedAt = new Date();
  }

  bus.emit(`run:${runId}`, timedEvent);
  bus.emit("broadcast", runId, timedEvent);
}

export function subscribeToRun(runId: string, handler: (event: OrchestratorEvent & { at: Date }) => void): () => void {
  const listener = (event: OrchestratorEvent & { at: Date }) => handler(event);
  bus.on(`run:${runId}`, listener);
  return () => bus.off(`run:${runId}`, listener);
}

export function subscribeToAll(handler: (runId: string, event: OrchestratorEvent & { at: Date }) => void): () => void {
  const listener = (runId: string, event: OrchestratorEvent & { at: Date }) => handler(runId, event);
  bus.on("broadcast", listener);
  return () => bus.off("broadcast", listener);
}

export function getRun(runId: string): SwarmRunRecord | undefined {
  return runs.get(runId);
}

export function getRuns(): SwarmRunRecord[] {
  return Array.from(runs.values()).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export function getActiveRuns(): SwarmRunRecord[] {
  return getRuns().filter((r) => r.status === "running");
}
