/**
 * Agent Swarm — Kimi-coordinated parallel multi-agent engine.
 *
 * Unlike the single-threaded orchestrator (one Claude tool loop), the swarm:
 *   1. PLAN   — a coordinator (Kimi-pinned when available) decomposes the brief
 *               into 3-6 specialist sub-tasks.
 *   2. FAN-OUT— every sub-task runs IN PARALLEL through NEXUS role routing,
 *               each optionally pre-fed live web context.
 *   3. FUSE   — a writer agent synthesises all worker outputs into one report.
 *
 * The whole swarm runs on the NEXUS fabric (OpenRouter free → Groq → DeepSeek →
 * Kimi → Gemini → Claude), so it works WITHOUT an Anthropic key — degraded mode
 * is reported via the SSE `intent` event, never a hard failure.
 *
 * Emits the same privacy-safe SSE shape as the orchestrator so the AI Chat UI
 * can render swarm runs with zero changes.
 */

import { nexusRunRole, type AgentRole, type NexusGenerateResult } from "../nexus/llm-router.js";
import { ROLE_LABEL } from "../nexus/roles.js";
import { getToolByName } from "./tools.js";
import type { OrchestratorEvent } from "./orchestrator.js";

export interface SwarmOptions {
  /** Prefer Kimi (Moonshot) as the planning coordinator. Default true. */
  useKimi?: boolean;
  /** Hard cap on parallel sub-agents. Default 6, max 8. */
  maxAgents?: number;
}

interface SubTask {
  role: AgentRole;
  task: string;
}

interface WorkerOutput extends SubTask {
  label: string;
  output: string;
  provider: string;
  ok: boolean;
}

const VALID_ROLES: AgentRole[] = [
  "planner", "researcher", "extractor", "arabic", "writer", "validator", "bulk", "signal", "tree",
];

/** Roles that benefit from a live-web context pre-fetch before reasoning. */
const WEB_ROLES = new Set<AgentRole>(["researcher", "signal"]);

/**
 * Pin the coordinator to Kimi when requested AND OpenRouter is available
 * (Kimi is reachable through OpenRouter). Otherwise fall back to normal planner
 * tier routing. Returns the nexus opts + a human label for the SSE breadcrumb.
 */
function coordinatorOpts(useKimi: boolean): { opts: Parameters<typeof nexusRunRole>[2]; label: string } {
  if (useKimi && process.env.OPENROUTER_API_KEY) {
    return {
      opts: { forceProvider: "openrouter", forceModel: "moonshotai/kimi-k2" },
      label: "🧠 Kimi Coordinator",
    };
  }
  return { opts: {}, label: "🧠 Coordinator" };
}

/** Best-effort extraction of the first JSON array from an LLM response. */
function parsePlan(text: string): SubTask[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Array<{ role?: string; task?: string }>;
    return raw
      .filter((r) => r && typeof r.task === "string" && r.task.trim())
      .map((r) => ({
        role: (VALID_ROLES.includes(r.role as AgentRole) ? r.role : "researcher") as AgentRole,
        task: String(r.task).trim(),
      }));
  } catch {
    return [];
  }
}

/** Deterministic decomposition used when the coordinator can't produce JSON. */
function fallbackPlan(brief: string): SubTask[] {
  return [
    { role: "researcher", task: `Find the most relevant, current facts and source URLs for: ${brief}` },
    { role: "extractor", task: `Extract structured entities (companies, people, contacts, metrics) relevant to: ${brief}` },
    { role: "signal", task: `Detect buying/risk signals (funding, hiring, leadership change, sanctions) for: ${brief}` },
  ];
}

async function runWorker(sub: SubTask, onEvent: (e: OrchestratorEvent) => void): Promise<WorkerOutput> {
  const label = ROLE_LABEL[sub.role] || sub.role;
  onEvent({ event: "agent_start", data: { agent: label, description: sub.task.slice(0, 100) } });

  // Optionally pre-fetch live web context for research-flavoured roles.
  let context = "";
  if (WEB_ROLES.has(sub.role)) {
    try {
      const ws = getToolByName("web_search");
      if (ws) {
        const hits = await ws.handler({ query: sub.task, limit: 6 });
        context = "\n\nLIVE WEB RESULTS:\n" + JSON.stringify(hits.result).slice(0, 4000);
      }
    } catch { /* context is optional */ }
  }

  try {
    const res: NexusGenerateResult = await nexusRunRole(sub.role, sub.task + context);
    onEvent({ event: "agent_done", data: { agent: label, found: true, summary: `${res.text.length} chars` } });
    return { ...sub, label, output: res.text, provider: res.provider, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onEvent({ event: "agent_done", data: { agent: label, found: false, summary: msg } });
    return { ...sub, label, output: "", provider: "none", ok: false };
  }
}

export async function runSwarm(
  brief: string,
  onEvent: (e: OrchestratorEvent) => void,
  opts: SwarmOptions = {},
): Promise<string> {
  const useKimi = opts.useKimi !== false;
  const maxAgents = Math.min(Math.max(Number(opts.maxAgents) || 6, 1), 8);

  // ── 1. PLAN ────────────────────────────────────────────────────────────────
  const { opts: coordOpts, label: coordLabel } = coordinatorOpts(useKimi);
  onEvent({ event: "agent_start", data: { agent: coordLabel, description: "Decomposing the brief into parallel sub-agents" } });

  const planPrompt =
    `Decompose this B2B intelligence brief into ${Math.min(maxAgents, 6)} concrete, independent sub-tasks ` +
    `that specialist agents can run IN PARALLEL. Output ONLY a JSON array of ` +
    `{ "role", "task" } objects. Valid roles: ${VALID_ROLES.join(", ")}. ` +
    `Each task must be self-contained and reference the brief specifics.\n\nBRIEF:\n${brief}`;

  let plan: SubTask[] = [];
  let coordProvider = "fallback";
  try {
    const planRes = await nexusRunRole("planner", planPrompt, coordOpts);
    coordProvider = planRes.provider;
    plan = parsePlan(planRes.text);
  } catch { /* fall through to fallback plan */ }

  if (plan.length === 0) plan = fallbackPlan(brief);
  plan = plan.slice(0, maxAgents);

  onEvent({ event: "agent_done", data: { agent: coordLabel, found: true, summary: `${plan.length} agents · via ${coordProvider}` } });
  onEvent({ event: "intent", data: { plan: `degraded_mode: ${coordProvider} · swarm of ${plan.length} agents: ${plan.map((p) => p.role).join(", ")}` } });

  // ── 2. FAN-OUT (parallel) ────────────────────────────────────────────────────
  const settled = await Promise.allSettled(plan.map((s) => runWorker(s, onEvent)));
  const outputs: WorkerOutput[] = settled
    .filter((s): s is PromiseFulfilledResult<WorkerOutput> => s.status === "fulfilled")
    .map((s) => s.value)
    .filter((w) => w.ok && w.output);

  if (outputs.length === 0) {
    const msg = "All swarm agents failed. Set at least one NEXUS provider key (OPENROUTER_API_KEY / GROQ_API_KEY / GEMINI_API_KEY).";
    onEvent({ event: "error", data: { message: msg } });
    onEvent({ event: "final", data: { text: "" } });
    return "";
  }

  // ── 3. FUSE ──────────────────────────────────────────────────────────────────
  const writerLabel = ROLE_LABEL.writer;
  onEvent({ event: "agent_start", data: { agent: writerLabel, description: "Synthesising agent findings into one report" } });

  const synthPrompt =
    `You are the swarm synthesiser. Merge the findings below into ONE coherent, cited, well-structured ` +
    `Markdown report answering the original brief. Resolve overlaps, keep every source URL, never invent facts.\n\n` +
    `ORIGINAL BRIEF:\n${brief}\n\n` +
    outputs.map((o) => `### ${o.label} (${o.role})\n${o.output}`).join("\n\n");

  let finalText = "";
  try {
    const writeRes = await nexusRunRole("writer", synthPrompt, { maxTokens: 4000 });
    finalText = writeRes.text;
  } catch {
    // Last-resort: stitch the raw worker outputs together.
    finalText = outputs.map((o) => `## ${o.label}\n${o.output}`).join("\n\n");
  }

  onEvent({ event: "agent_done", data: { agent: writerLabel, found: true, summary: `${finalText.length} chars` } });
  onEvent({ event: "token", data: finalText });
  onEvent({ event: "final", data: { text: finalText } });
  return finalText;
}
