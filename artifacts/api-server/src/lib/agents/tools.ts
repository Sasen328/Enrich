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

// ── deep_scrape: Playwright + stealth for JS-heavy pages ──────────────────────
const deep_scrape: ToolDef = {
  name: "deep_scrape",
  description:
    "Render a JS-heavy page with Playwright (headless Chromium + stealth) and return the rendered text. Use when url_crawl returns thin content because the page renders client-side. Slower than url_crawl (3-10s).",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "Absolute URL." } },
    required: ["url"],
  },
  async handler(input) {
    const url = String(input.url || "");
    try {
      const mod = await import("../power-scraper.js").catch(() => null);
      if (mod && typeof (mod as { scrapeWithPlaywright?: (u: string) => Promise<{ text?: string }> }).scrapeWithPlaywright === "function") {
        const out = await (mod as { scrapeWithPlaywright: (u: string) => Promise<{ text?: string }> }).scrapeWithPlaywright(url);
        const text = (out.text || "").slice(0, 12000);
        return { result: { url, text }, summary: `deep_scrape: ${text.length} chars from ${new URL(url).hostname}` };
      }
      return url_crawl.handler({ url });
    } catch (e) {
      return { result: { url, error: e instanceof Error ? e.message : String(e) }, summary: "deep_scrape: failed" };
    }
  },
};

// ── sanctions_screen: OFAC + UN + EU + OpenSanctions ──────────────────────────
const sanctions_screen: ToolDef = {
  name: "sanctions_screen",
  description: "Screen a company or person against OFAC SDN, UN Consolidated, EU sanctions, and OpenSanctions. Returns match confidence.",
  input_schema: {
    type: "object",
    properties: { name: { type: "string", description: "Entity name to screen." } },
    required: ["name"],
  },
  async handler(input) {
    const name = String(input.name || "");
    try {
      const mod = await import("../sanctions-screen.js").catch(() => null);
      const fn = mod && (mod as { screenName?: (n: string) => Promise<unknown> }).screenName;
      if (typeof fn === "function") {
        const result = await fn(name);
        return { result, summary: `sanctions_screen: ${name}` };
      }
      return { result: { name, error: "sanctions module unavailable" }, summary: "sanctions_screen: degraded" };
    } catch (e) {
      return { result: { error: e instanceof Error ? e.message : String(e) }, summary: "sanctions_screen: failed" };
    }
  },
};

// ── scout_osint: Python Scout OSINT (Sherlock + multi-source) ─────────────────
const scout_osint: ToolDef = {
  name: "scout_osint",
  description: "Run the Python Scout OSINT engine on a person or username. Returns presence across platforms via Sherlock + custom rules.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Name, email, username, or domain." } },
    required: ["query"],
  },
  async handler(input) {
    const query = String(input.query || "");
    try {
      const axios = (await import("axios")).default;
      const base = process.env.SCOUT_URL || "http://localhost:8099";
      const r = await axios.post(`${base}/osint`, { query }, { timeout: 30000 });
      return { result: r.data, summary: `scout_osint: ${query}` };
    } catch (e) {
      return { result: { error: e instanceof Error ? e.message : String(e) }, summary: "scout_osint: degraded" };
    }
  },
};

// ── lead_factory_run: invoke the 7-agent pipeline ─────────────────────────────
const lead_factory_run: ToolDef = {
  name: "lead_factory_run",
  description: "Start the full 7-agent Lead Factory pipeline. Heavy — only use when the user explicitly wants a full lead-gen sweep.",
  input_schema: {
    type: "object",
    properties: {
      industry: { type: "string", description: "Target industry." },
      country: { type: "string", description: "Country code or region." },
      targetCount: { type: "number", description: "Leads to produce." },
    },
    required: ["industry"],
  },
  async handler(input) {
    try {
      const axios = (await import("axios")).default;
      const base = process.env.SELF_URL || "http://localhost:3000";
      const r = await axios.post(`${base}/api/lead-factory/start`, {
        mode: "person",
        targetCount: Number(input.targetCount) || 25,
        industries: input.industry ? [input.industry] : [],
        regions: input.country ? [input.country] : [],
      }, { timeout: 15000 });
      return { result: r.data, summary: `lead_factory_run: job ${r.data?.jobId}` };
    } catch (e) {
      return { result: { error: e instanceof Error ? e.message : String(e) }, summary: "lead_factory_run: failed" };
    }
  },
};

// ── signal_monitor: live buying signals via harvester ─────────────────────────
const signal_monitor: ToolDef = {
  name: "signal_monitor",
  description: "Detect recent buying signals (funding, hiring spike, leadership change) for a company. Last 90 days.",
  input_schema: {
    type: "object",
    properties: { company: { type: "string", description: "Company name." } },
    required: ["company"],
  },
  async handler(input) {
    const company = String(input.company || "");
    try {
      const result = await harvester_run.handler({ query: company + " hiring OR funding OR leadership", limit: 20 });
      return { result: result.result, summary: `signal_monitor: scanned ${company}` };
    } catch (e) {
      return { result: { error: e instanceof Error ? e.message : String(e) }, summary: "signal_monitor: failed" };
    }
  },
};

export const AGENT_TOOLS: ToolDef[] = [
  nexus_run,        // delegates to Nexus (Gemini, Groq, DeepSeek, Kimi, GPT, Ollama, Llama)
  web_search,       // Tavily → SearXNG → Google waterfall
  url_crawl,        // fast static fetch
  deep_scrape,      // Playwright + stealth (JS-heavy)
  harvester_run,    // façade (GLEIF, OpenCorporates, Wikidata, news, Scout)
  sanctions_screen, // OFAC + UN + EU + OpenSanctions
  scout_osint,      // Python Scout OSINT (Sherlock)
  lead_factory_run, // full 7-agent pipeline
  signal_monitor,   // buying signals scanner
];

export function getToolByName(name: string): ToolDef | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** Anthropic-compatible tool definitions (no handler field). */
export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: ToolDef["input_schema"] }> {
  return AGENT_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
