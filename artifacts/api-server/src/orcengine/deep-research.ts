// ─── Deep Research Loop ───────────────────────────────────────────────────────
// Recursive web-research agent inspired by dzhng/deep-research. Uses our
// existing Nexus router for the LLM and our existing freeWebSearch for the
// web hits (Tavily → SearXNG → Google). No new paid deps.
//
// Flow:
//   1. LLM generates N search queries from the prompt + accumulated learnings.
//   2. For each query, run freeWebSearch and feed top hits back to the LLM,
//      which extracts "learnings" + follow-up questions.
//   3. Recurse up to `depth` times, narrowing on the follow-ups.
//   4. Final synthesis: LLM produces a report with all learnings as input.
//
// Designed to be called from a route (POST /api/orcengine/deep-research) or
// from another engine that needs a deep dive on a topic.

import { nexusGenerate, nexusSynthesize } from "../lib/nexus/index.js";
import { freeWebSearch, type FreeSearchHit } from "../lib/free-search.js";

export interface DeepResearchOptions {
  /** Top-level question or topic. */
  query: string;
  /** Max recursion depth (default 2). */
  depth?: number;
  /** Queries to issue per level (default 3). */
  breadth?: number;
  /** Hits to keep per query (default 5). */
  hitsPerQuery?: number;
  /** Callback invoked at each level with progress. */
  onProgress?: (event: DeepResearchEvent) => void;
}

export type DeepResearchEvent =
  | { type: "queries"; level: number; queries: string[] }
  | { type: "search"; level: number; query: string; hits: number }
  | { type: "learnings"; level: number; learnings: string[]; followups: string[] }
  | { type: "synthesizing" }
  | { type: "done"; learningCount: number };

export interface DeepResearchResult {
  query: string;
  learnings: string[];
  followups: string[];
  visitedUrls: string[];
  report: string;
}

interface JsonShape {
  queries?: string[];
  learnings?: string[];
  followups?: string[];
}

function tryParseJson(text: string): JsonShape {
  // Strip ```json fences then attempt parse
  const cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]) as JsonShape; } catch { return {}; }
}

async function generateQueries(query: string, learnings: string[], breadth: number): Promise<string[]> {
  const ctx = learnings.length > 0
    ? `\n\nWhat we've learned so far:\n${learnings.slice(-10).map((l) => `- ${l}`).join("\n")}`
    : "";
  const res = await nexusGenerate(
    `Generate ${breadth} distinct, focused web-search queries to research this topic. ` +
      `Queries should each target a different angle. Return JSON only.\n\n` +
      `Topic: ${query}${ctx}\n\n` +
      `Format: {"queries": ["q1", "q2", "q3"]}`,
    { tier: "extraction", maxTokens: 500, temperature: 0.3 },
  );
  const parsed = tryParseJson(res.text);
  return Array.isArray(parsed.queries) ? parsed.queries.slice(0, breadth) : [];
}

async function extractLearnings(query: string, hits: FreeSearchHit[]): Promise<{ learnings: string[]; followups: string[] }> {
  if (hits.length === 0) return { learnings: [], followups: [] };
  const block = hits
    .map((h, i) => `[${i + 1}] ${h.title}\n${h.url}\n${(h.rawContent || h.snippet).slice(0, 800)}`)
    .join("\n\n");

  const res = await nexusGenerate(
    `For the query "${query}", extract concrete factual learnings from these search results. ` +
      `Be specific: include numbers, dates, names, and entities. Then propose 2 follow-up questions ` +
      `that would deepen understanding. Return JSON only.\n\n` +
      `Results:\n${block}\n\n` +
      `Format: {"learnings": ["fact 1", ...], "followups": ["question 1", "question 2"]}`,
    { tier: "extraction", maxTokens: 1500, temperature: 0.2 },
  );
  const parsed = tryParseJson(res.text);
  return {
    learnings: Array.isArray(parsed.learnings) ? parsed.learnings.slice(0, 10) : [],
    followups: Array.isArray(parsed.followups) ? parsed.followups.slice(0, 2) : [],
  };
}

async function synthesizeReport(originalQuery: string, learnings: string[], urls: string[]): Promise<string> {
  const res = await nexusSynthesize(
    `Learnings:\n${learnings.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n` +
      `Sources:\n${urls.map((u, i) => `[${i + 1}] ${u}`).join("\n")}`,
    `Write a comprehensive research report answering: "${originalQuery}". ` +
      `Use only the learnings above. Cite source URLs inline as [n] with a Sources section at the end. Markdown output.`,
    { maxTokens: 4000, temperature: 0.3 },
  );
  return res.text;
}

export async function deepResearch(opts: DeepResearchOptions): Promise<DeepResearchResult> {
  const depth = opts.depth ?? 2;
  const breadth = opts.breadth ?? 3;
  const hitsPerQuery = opts.hitsPerQuery ?? 5;
  const emit = (e: DeepResearchEvent) => opts.onProgress?.(e);

  const allLearnings: string[] = [];
  const allUrls = new Set<string>();
  let currentQueries: string[] = [opts.query];

  for (let level = 0; level < depth; level++) {
    const generated: string[] = [];
    for (const q of currentQueries) {
      const sub = await generateQueries(q, allLearnings, breadth);
      generated.push(...sub);
    }
    const queries = generated.slice(0, breadth);
    emit({ type: "queries", level, queries });

    const allFollowups: string[] = [];
    for (const q of queries) {
      const hits = await freeWebSearch(q, { limit: hitsPerQuery, searchDepth: "advanced" });
      emit({ type: "search", level, query: q, hits: hits.length });
      for (const h of hits) allUrls.add(h.url);
      const { learnings, followups } = await extractLearnings(q, hits);
      allLearnings.push(...learnings);
      allFollowups.push(...followups);
      emit({ type: "learnings", level, learnings, followups });
    }
    // Next level explores the follow-up questions
    currentQueries = allFollowups.length > 0 ? allFollowups.slice(0, breadth) : [];
    if (currentQueries.length === 0) break;
  }

  emit({ type: "synthesizing" });
  const urls = Array.from(allUrls);
  const report = await synthesizeReport(opts.query, allLearnings, urls);
  emit({ type: "done", learningCount: allLearnings.length });

  return {
    query: opts.query,
    learnings: allLearnings,
    followups: currentQueries,
    visitedUrls: urls,
    report,
  };
}
