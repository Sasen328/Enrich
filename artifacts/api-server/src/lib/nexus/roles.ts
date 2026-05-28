/**
 * NEXUS — Role → Tier mapping
 *
 * Specialized agent roles map to NEXUS task tiers so the orchestrator can
 * dispatch each sub-task to the optimal provider/model.
 */
import type { TaskTier } from "./llm-router.js";

export type AgentRole =
  | "planner"      // breaks user query into sub-tasks
  | "researcher"   // live-web research
  | "extractor"    // pulls structured fields
  | "arabic"       // Arabic NLP
  | "writer"       // synthesizes the report
  | "validator"    // verify + dedup pass
  | "bulk"         // cheap mass classification
  | "signal"       // detect buying signals
  | "tree";        // map relationships

export const ROLE_TO_TIER: Record<AgentRole, TaskTier> = {
  planner:    "planning",
  researcher: "realtime",
  extractor:  "extraction",
  arabic:     "arabic",
  writer:     "synthesis",
  validator:  "bulk",
  bulk:       "bulk",
  signal:     "extraction",
  tree:       "extraction",
};

export const ROLE_DEFAULTS: Record<AgentRole, { temperature: number; maxTokens: number; systemPrompt?: string }> = {
  planner: {
    temperature: 0.2, maxTokens: 1500,
    systemPrompt: "You are a research planner. Decompose the user's query into 3-6 concrete sub-tasks. Output JSON array of { role, task } objects. No prose.",
  },
  researcher: {
    temperature: 0.1, maxTokens: 2000,
    systemPrompt: "You are a research specialist. Given a task and live-web search results, extract the most relevant facts with source URLs. Never invent.",
  },
  extractor: {
    temperature: 0, maxTokens: 1500,
    systemPrompt: "You are a precise data extractor. Output valid JSON only. No markdown. Use null for missing fields.",
  },
  arabic: {
    temperature: 0.1, maxTokens: 2000,
    systemPrompt: "You are an Arabic-English bilingual analyst. Read Arabic sources and produce English summaries plus the original Arabic quote.",
  },
  writer: {
    temperature: 0.3, maxTokens: 4000,
    systemPrompt: "You are a senior intelligence analyst. Write structured, cited, well-organised report blocks. Cite every claim with source URL.",
  },
  validator: {
    temperature: 0, maxTokens: 800,
    systemPrompt: "You validate leads/companies. Output JSON { status: 'pass'|'warn'|'reject', reasons: [] }. Reject obvious dummy/placeholder data.",
  },
  bulk: {
    temperature: 0, maxTokens: 600,
    systemPrompt: "You classify records into categories at scale. Output the category label only, nothing else.",
  },
  signal: {
    temperature: 0.1, maxTokens: 1000,
    systemPrompt: "You detect buying signals (funding, hiring, partnerships, leadership change). Output JSON { signal, strength: 0-100, sourceUrl, summary }.",
  },
  tree: {
    temperature: 0.1, maxTokens: 1500,
    systemPrompt: "You map organisational relationships. Output JSON { nodes: [{ id, name, role }], edges: [{ from, to, type }] }.",
  },
};

/** Friendly user-facing label per role. Used in SSE breadcrumbs (privacy-safe). */
export const ROLE_LABEL: Record<AgentRole, string> = {
  planner:    "🧠 Planner",
  researcher: "🔍 Researcher",
  extractor:  "📊 Extractor",
  arabic:     "🇸🇦 Arabic NLP",
  writer:     "📝 Writer",
  validator:  "🛡️ Validator",
  bulk:       "🗂️ Classifier",
  signal:     "📡 Signal scout",
  tree:       "🌳 Tree builder",
};
