/**
 * Agent Tools — exposed to the Claude orchestrator via the Anthropic SDK
 * tool-use API. Each tool wraps an existing engine (NEXUS, harvester, free
 * search, scrapers) so the orchestrator can call them as functions.
 *
 * NB: tool input schemas follow Anthropic's Tool input_schema spec.
 */

import { nexusRunRole, type AgentRole } from "../nexus/llm-router.js";
import { freeWebSearch } from "../free-search.js";

export interface ToolHandlerResult {
  result: unknown;
  /** Human-friendly summary surfaced in SSE breadcrumbs */
  summary?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<ToolHandlerResult>;
}

// ── nexus_run: dispatch a sub-task to NEXUS by role ───────────────────────────
const nexus_run: ToolDef = {
  name: "nexus_run",
  description:
    "Dispatch a sub-task to a specialized model via NEXUS. Pick the role that best matches the sub-task; NEXUS will route to the optimal provider behind the scenes.",
  input_schema: {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["planner", "researcher", "extractor", "arabic", "writer", "validator", "bulk", "signal", "tree"],
        description: "Specialist role to handle the sub-task.",
      },
      task: { type: "string", description: "The full task / prompt for the sub-agent." },
    },
    required: ["role", "task"],
  },
  async handler(input) {
    const role = input.role as AgentRole;
    const task = String(input.task || "");
    const res = await nexusRunRole(role, task);
    return { result: res.text, summary: `${role} returned ${res.text.length} chars` };
  },
};

// ── web_search: free search waterfall (Tavily → SearXNG → Google) ─────────────
const web_search: ToolDef = {
  name: "web_search",
  description:
    "Search the live web for current information. Returns title + url + snippet for top results. Use for any task that needs fresh facts not in your training data.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      limit: { type: "number", description: "Max results (default 8, max 20)." },
    },
    required: ["query"],
  },
  async handler(input) {
    const q = String(input.query || "");
    const limit = Math.min(Number(input.limit) || 8, 20);
    const hits = await freeWebSearch(q, { limit });
    return {
      result: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet?.slice(0, 240) })),
      summary: `web_search: ${hits.length} results for "${q.slice(0, 60)}"`,
    };
  },
};

// ── url_crawl: fast static fetch via Cheerio/axios ────────────────────────────
const url_crawl: ToolDef = {
  name: "url_crawl",
  description:
    "Fetch a single URL and return the visible text. Fast — uses static HTML parsing. Use this first; escalate to deep_scrape only if the page is JS-heavy.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute URL to fetch." },
    },
    required: ["url"],
  },
  async handler(input) {
    const url = String(input.url || "");
    try {
      const axios = (await import("axios")).default;
      const r = await axios.get(url, {
        timeout: 12000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ProspectSA-Bot/1.0)" },
      });
      const html: string = typeof r.data === "string" ? r.data : "";
      const text = html
        .replace(/<script[^]*?<\/script>/gi, "")
        .replace(/<style[^]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);
      return { result: { url, text }, summary: `url_crawl: ${text.length} chars from ${new URL(url).hostname}` };
    } catch (e) {
      return { result: { url, error: e instanceof Error ? e.message : String(e) }, summary: "url_crawl: failed" };
    }
  },
};

// ── harvester_run: unified harvester façade ───────────────────────────────────
const harvester_run: ToolDef = {
  name: "harvester_run",
  description:
    "Run the multi-source harvester for a company/topic query. Wraps Google News, Saudi RSS feeds, GLEIF, OpenCorporates, Wikidata, sanctions, and Scout site intel.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Company name or topic." },
      limit: { type: "number", description: "Max rows (default 12)." },
    },
    required: ["query"],
  },
  async handler(input) {
    const query = String(input.query || "");
    const limit = Math.min(Number(input.limit) || 12, 30);
    try {
      const mod = await import("../harvester/index.js");
      const rows: unknown[] = [];
      const harvest = (mod as unknown as { harvest: (q: string) => AsyncIterable<unknown> }).harvest;
      if (typeof harvest === "function") {
        for await (const row of harvest(query)) {
          rows.push(row);
          if (rows.length >= limit) break;
        }
      }
      return { result: rows, summary: `harvester_run: ${rows.length} rows` };
    } catch (e) {
      return { result: { error: e instanceof Error ? e.message : String(e) }, summary: "harvester_run: degraded" };
    }
  },
};

// ── spawn_sub_agent: recursive — orchestrator can fan out planner-style ───────
// (Implemented in orchestrator.ts to avoid circular import. Declared here for shape.)

export const AGENT_TOOLS: ToolDef[] = [nexus_run, web_search, url_crawl, harvester_run];

export function getToolByName(name: string): ToolDef | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** Anthropic-compatible tool definitions (no handler field). */
export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: ToolDef["input_schema"] }> {
  return AGENT_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
