/**
 * Composer — AI prompt enhancer.
 *
 * Takes the user's raw text + all composer selections (template, modes,
 * target, scope, sources, connectors, skills, sub-filters, ask-filters,
 * clarifications) and produces a SINGLE structured enhanced prompt that the
 * orchestrator executes verbatim.
 *
 * If anything is ambiguous, returns clarifying questions instead.
 */

import { nexusGenerate } from "../nexus/llm-router.js";
import { findTemplate } from "./templates.js";
import { findMode, MODES } from "./modes.js";
import { findSkill } from "./skills.js";
import { recommendSources, findSource } from "./sources.js";

export interface EnhanceInput {
  templateId?: string;
  modes: string[];
  target: "person" | "company" | "both";
  countries: string[];
  industry?: string;
  listing?: string;
  subFilters?: Record<string, string>;
  askFilters?: Record<string, string | string[]>;
  sources?: string[];          // user-overridden source IDs
  connectors?: string[];
  skills?: string[];
  reportShape?: "exec" | "detail" | "custom";
  reportBlocks?: string[];     // if custom
  freeText?: string;
  clarifications?: Record<string, string>;  // round-2+ refinements
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface EnhancedPrompt {
  enhancedPrompt: string;
  requiredSchema: string;
  suggestedTools: string[];
  needsClarification: { questions: Array<{ id: string; q: string; options?: string[] }> } | null;
}

const ENHANCER_SYSTEM = `You are a research-prompt enhancer. The user has filled out a composer with template, modes, target, country, industry, listing, sub-filters, sources, skills, and free-text question. Your job: merge everything into ONE complete, unambiguous task definition for a downstream multi-agent system.

OUTPUT JSON ONLY. No prose. Schema:
{
  "enhancedPrompt": "<long structured prompt — OBJECTIVE + FILTERS line-by-line + SOURCES + RULES + SCHEMA>",
  "requiredSchema": "<LeadList|CompanyDossier|CompareMatrix|SignalDigest|Custom>",
  "suggestedTools": ["web_search", "url_crawl", ...],
  "needsClarification": null | { "questions": [{ "id":"q1", "q":"...", "options":["A","B"] }, ...] }
}

Trigger clarifications ONLY when a real contradiction or missing key fact would force the agent to guess. Max 3 questions.`;

export async function enhancePrompt(input: EnhanceInput): Promise<EnhancedPrompt> {
  // Heuristic fallback (used when AI is unavailable or fast-path desired)
  const fallback = buildFallback(input);

  // If no Anthropic / Nexus key, return fallback directly
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    return fallback;
  }

  // Compose AI prompt
  const ctx = {
    template: input.templateId ? findTemplate(input.templateId) : null,
    modes: input.modes.map((m) => findMode(m)).filter(Boolean),
    skills: (input.skills || []).map((s) => findSkill(s)).filter(Boolean),
    sources: (input.sources && input.sources.length
      ? input.sources.map(findSource).filter(Boolean)
      : recommendSources({ industry: input.industry, countries: input.countries, listing: input.listing, target: input.target })),
    ...input,
  };

  const promptForAI = `USER COMPOSER STATE:\n${JSON.stringify(ctx, null, 2).slice(0, 6000)}\n\nProduce the EnhancedPrompt JSON.`;

  try {
    const res = await nexusGenerate(promptForAI, {
      tier: "extraction",
      systemPrompt: ENHANCER_SYSTEM,
      temperature: 0,
      maxTokens: 1500,
      timeoutMs: 20000,
    });
    const cleaned = res.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as EnhancedPrompt;
    // Sanity: must have an enhanced prompt
    if (parsed.enhancedPrompt && typeof parsed.enhancedPrompt === "string") return parsed;
  } catch { /* fall through to heuristic */ }

  return fallback;
}

function buildFallback(input: EnhanceInput): EnhancedPrompt {
  const tpl = input.templateId ? findTemplate(input.templateId) : null;
  const modeObjs = input.modes.map(findMode).filter(Boolean);
  const skillObjs = (input.skills || []).map(findSkill).filter(Boolean);
  const sources = (input.sources && input.sources.length
    ? input.sources.map(findSource).filter(Boolean)
    : recommendSources({ industry: input.industry, countries: input.countries, listing: input.listing, target: input.target })
  );

  const requiredSchema = (skillObjs[0]?.reportSchema)
    || (modeObjs.find((m) => m?.defaultReportSchema)?.defaultReportSchema)
    || tpl?.requiredSchema
    || "LeadList";

  const suggestedTools = Array.from(new Set(modeObjs.flatMap((m) => m?.defaultTools || [])));

  const askFilterStr = Object.entries(input.askFilters || {})
    .map(([k, v]) => `  • ${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("\n");
  const subFilterStr = Object.entries(input.subFilters || {})
    .map(([k, v]) => `  • ${k}: ${v}`).join("\n");

  const enhanced = [
    `OBJECTIVE`,
    input.freeText || tpl?.defaultQuestion || "Research the targets matching the filters below.",
    ``,
    `TARGET TYPE — ${input.target}`,
    `MODES — ${modeObjs.map((m) => m?.label).join(" + ")}`,
    `COUNTRY — ${input.countries.join(", ") || "any"}`,
    input.industry ? `INDUSTRY — ${input.industry}` : "",
    input.listing && input.listing !== "Any" ? `LISTING STATUS — ${input.listing}` : "",
    subFilterStr ? `SUB-FILTERS\n${subFilterStr}` : "",
    askFilterStr ? `ASK FILTERS\n${askFilterStr}` : "",
    ``,
    `SOURCES — ${sources.map((s) => s?.label).join(" · ")}`,
    `REPORT SHAPE — ${input.reportShape || "detail"}`,
    input.reportBlocks ? `REPORT BLOCKS — ${input.reportBlocks.join(", ")}` : "",
    ``,
    `RULES`,
    `  1. Honor every filter above. No relaxation without asking.`,
    `  2. Cite every claim with source URL.`,
    `  3. NEVER invent contact data (emails, phones, CR numbers). Leave blank + flag.`,
    `  4. Halt-and-ask on conflict.`,
    `  5. Currency: normalize all financials to SAR.`,
    `  6. Output strictly follows REPORT SHAPE: ${input.reportShape === "exec" ? "Executive Summary — narrative + 4 KPIs, NO detailed table." : input.reportShape === "custom" ? "Custom — only the blocks listed in REPORT BLOCKS." : "Detailed — all blocks."}`,
    ``,
    skillObjs.length ? `SKILL CONTEXT\n${skillObjs.map((s) => s?.systemPrompt).filter(Boolean).join("\n---\n")}` : "",
    modeObjs.length ? `MODE INSTRUCTIONS\n${modeObjs.map((m) => `${m?.label}: ${m?.promptSuffix}`).join("\n")}` : "",
    ``,
    `SCHEMA — ${requiredSchema}`,
  ].filter(Boolean).join("\n");

  // Heuristic clarification: ambiguous target + person filter
  const needsClarification = (!input.freeText || input.freeText.length < 12) ? {
    questions: [
      { id: "q-detail", q: "Your question is short — what's the specific outcome you want?", options: ["List of leads", "Single dossier", "Comparison", "Signal monitor"] },
    ],
  } : null;

  return { enhancedPrompt: enhanced, requiredSchema, suggestedTools, needsClarification };
}
