// ─── LEAD FACTORY ENGINE — 7-Agent Saudi B2B Lead Generation Pipeline ──────────
//
//  Agent 1 │ ICP Mapper & Source Orchestrator  — brief → prioritised sourcing plan
//  Agent 2 │ Lead Harvester                    — execute plan across 40+ free sources
//  Agent 3 │ Deep Enrichment                   — Scout + GLEIF + OC + Wikidata + Gemini
//  Agent 4 │ Signal Intelligence               — Scout signals full + regulatory
//  Agent 5 │ Validate, Verify & Deduplicate    — phone/email/data + DB dedup
//  Agent 6 │ ICP Scoring + AI Copywriter       — composite score + NEXUS outreach
//  Agent 7 │ Publish & Seed                    — leads table + companies + fingerprint index
//
// Sources master reference: ProspectSA_Master_Intelligence_Sources (May 2026)
// ─────────────────────────────────────────────────────────────────────────────────

import axios from "axios";
import * as cheerio from "cheerio";
import { EventEmitter } from "events";
import { db } from "@workspace/db";
import {
  companiesTable,
  executivesTable,
  leadFactoryJobsTable,
  leadFactoryResultsTable,
  leadFingerprintsTable,
  leadsTable,
} from "@workspace/db/schema";
import { and, eq, ilike, sql } from "drizzle-orm";
import { scanCompanySignals } from "./signal-engine.js";
import {
  createRelationshipIntelJob,
  runRelationshipIntelPipeline,
} from "./relationship-intel-engine.js";
import { generateWithGemini, isGeminiConfigured } from "../gemini-search.js";
import {
  scoutSiteIntel,
  scoutSignalsFull,
  scoutSignalsRegulatory,
} from "./scout-client.js";
import { nexusGenerate, nexusSynthesize } from "./nexus/index.js";
import { freeWebSearch } from "./free-search.js";
import { verifyLead } from "./lead-validator.js";
import { scrapePage } from "./power-scraper.js";
import { onLeadFactoryComplete } from "./activepieces-client.js";

// ─── Job Registry ────────────────────────────────────────────────────────────

import { JobRegistry } from "./job-registry.js";

const registry = new JobRegistry({ idPrefix: "lf", maxEntries: 200, maxListeners: 20 });
const jobEmitters = registry; // legacy name kept for internal references below

export function createLeadFactoryJob(): string {
  return registry.create().jobId;
}

export function getLeadFactoryEmitter(jobId: string): EventEmitter | undefined {
  return registry.get(jobId);
}

/** Cancel a running Lead Factory job. Returns false if jobId not found / already cancelled. */
export function cancelLeadFactoryJob(jobId: string): boolean {
  return registry.cancel(jobId);
}

// ─── Types ───────────────────────────────────────────────────────────────────

// Zod schema for request-time validation. Routes call leadFactoryBriefSchema.safeParse()
// at /start so doomed jobs are rejected synchronously with a 400, instead of the
// route returning 200 and the pipeline crashing later in the background.
import { z } from "zod";

export const leadFactoryBriefSchema = z.object({
  inputMode: z.enum(["segment", "list"]),
  // Apollo-style: which side drives discovery — companies first or people first
  mode: z.enum(["person", "company"]).default("company").optional(),
  icpDescription: z.string().optional(),
  industries: z.array(z.string()).optional(),
  subIndustries: z.array(z.string()).optional(),
  companySizes: z.array(z.string()).optional(),
  employeeBands: z.array(z.string()).optional(),
  revenueBands: z.array(z.string()).optional(),
  cities: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  entityTypes: z.array(z.string()).optional(),
  targetTitles: z.array(z.string()).optional(),
  seniority: z.array(z.string()).optional(),
  departments: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  yearsInRoleMin: z.number().int().min(0).max(60).optional(),
  yearsInRoleMax: z.number().int().min(0).max(60).optional(),
  yearsExperienceMin: z.number().int().min(0).max(60).optional(),
  yearsExperienceMax: z.number().int().min(0).max(60).optional(),
  educationDegree: z.array(z.string()).optional(),
  fundingStage: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  foundedYearMin: z.number().int().optional(),
  foundedYearMax: z.number().int().optional(),
  prioritySignals: z.array(z.string()).optional(),
  buyingSignals: z.array(z.string()).optional(),
  signalRecencyDays: z.number().int().min(1).max(730).optional(),
  minIcpScore: z.number().int().min(0).max(100).optional(),
  hasExecutives: z.boolean().optional(),
  hasWebsite: z.boolean().optional(),
  hasVerifiedEmail: z.boolean().optional(),
  saudizationBand: z.string().optional(),
  tadawulListedOnly: z.boolean().optional(),
  companyList: z.array(z.string()).optional(),
  // The frontend wizard may send `companies` instead — keep both for compat
  companies: z.array(z.string()).optional(),
  targetCount: z.number().int().positive().max(500).optional(),
  enrichmentDepth: z.enum(["basic", "shallow", "standard", "deep"]).optional(),
  country: z.string().optional(),
  autoEnrichDownstream: z.boolean().optional(),
}).refine(
  (b) => b.inputMode !== "list" || ((b.companyList && b.companyList.length > 0) || (b.companies && b.companies.length > 0)),
  { message: "companyList (or companies) is required when inputMode='list'" },
);

export interface LeadFactoryBrief {
  // Matches the frontend wizard: only "segment" or "list" are sent
  inputMode: "segment" | "list";
  icpDescription?: string;
  industries?: string[];
  subIndustries?: string[];
  companySizes?: string[];
  cities?: string[];
  regions?: string[];
  entityTypes?: string[];
  targetTitles?: string[];
  seniority?: string[];
  prioritySignals?: string[];
  companyList?: string[];
  targetCount?: number;
  enrichmentDepth?: "basic" | "standard" | "deep";
  country?: string;
  /**
   * When true, after Agent 7 publishes A/B-tier leads into the unified
   * companies pool, fire Signals + Relationship/Network Intel for each one
   * (best-effort, non-blocking). Off by default to preserve cost ceiling.
   */
  autoEnrichDownstream?: boolean;
}

/** Result of pushing one A/B-tier lead into the unified pool. */
export interface PublishedCompany {
  companyId: number;
  companyName: string;
  companyNameAr?: string;
  domain?: string;
  crNumber?: string;
}

interface RawLead {
  companyName?: string;
  companyNameAr?: string;
  domain?: string;
  phone?: string;
  email?: string;
  emailTrusted?: boolean;
  city?: string;
  region?: string;
  country?: string;
  industry?: string;
  employeeCount?: string;
  revenue?: string;
  crNumber?: string;
  entityType?: string;
  foundingYear?: string;
  description?: string;
  logoUrl?: string;
  linkedinUrl?: string;
  sourceUsed?: string;
  rawData?: Record<string, unknown>;
  enrichedData?: Record<string, unknown>;
  signalData?: Record<string, unknown>;
}

export type AgentEvent =
  | { type: "agent_start"; agent: number; label: string }
  | { type: "agent_log"; agent: number; message: string }
  | { type: "agent_progress"; agent: number; current: number; total: number }
  | { type: "lead_found"; agent: number; lead: RawLead }
  | { type: "lead_enriched"; agent: number; lead: RawLead }
  | { type: "lead_scored"; agent: number; lead: RawLead & { icpScore?: number; tier?: string } }
  | { type: "lead_published"; agent: number; resultId: number; companyName?: string; tier?: string }
  | { type: "lead_rejected"; agent: number; companyName?: string; reasons: string[] }
  | { type: "agent_complete"; agent: number; label: string; count?: number }
  | { type: "agent_error"; agent: number; message: string }
  | { type: "pipeline_complete"; totalPublished: number; totalRejected: number; jobId: number }
  | { type: "heartbeat" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function httpGet(url: string, timeoutMs = 12000): Promise<{ ok: boolean; data?: unknown; text?: string }> {
  try {
    const r = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProspectSA/1.0; +https://prospectsa.com/bot)",
        Accept: "application/json, text/html, */*",
        "Accept-Language": "ar,en;q=0.9",
      },
    });
    if (typeof r.data === "string") return { ok: true, text: r.data };
    return { ok: true, data: r.data };
  } catch { return { ok: false }; }
}

function normalisePhone(p: string): string {
  return p.replace(/[\s\-().+]/g, "");
}

function normaliseName(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9أ-ي\s]/g, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  }
  return dp[m][n];
}

function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a), nb = normaliseName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

async function parseJsonFromGemini(raw: string | null, fallback: unknown = null): Promise<unknown> {
  if (!raw) return fallback;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) {
    try { return JSON.parse(match[1] || match[0]); } catch {}
  }
  try { return JSON.parse(raw); } catch {}
  return fallback;
}

// ── NEXUS call adapter ─────────────────────────────────────────────────────────
// Routes every LLM call through the NEXUS multi-model fabric (OpenRouter → Groq
// → Gemini → Claude → GPT-4o) with automatic cost-optimised tier selection.
// Falls back to direct Gemini if NEXUS is unavailable.
async function nexusCall(prompt: string, system?: string): Promise<string | null> {
  try {
    const result = await nexusGenerate(prompt, { tier: "extraction", systemPrompt: system });
    return result.text ?? null;
  } catch {
    try { return await generateWithGemini(prompt, system); } catch { return null; }
  }
}

async function nexusSynthCall(prompt: string, system?: string): Promise<string | null> {
  try {
    const result = await nexusSynthesize(prompt, system ?? "You are a Saudi B2B intelligence expert.");
    return result.text ?? null;
  } catch {
    try { return await generateWithGemini(prompt, system); } catch { return null; }
  }
}

function emit(emitter: EventEmitter, event: AgentEvent) {
  emitter.emit("event", event);
}

// ─── Agent 1: ICP Mapper & Source Orchestrator ───────────────────────────────

async function agent1_mapICP(brief: LeadFactoryBrief, emitter: EventEmitter): Promise<{ sourcePlan: SourcePlan; searchQueries: SourceQuery[] }> {
  emit(emitter, { type: "agent_start", agent: 1, label: "ICP Mapper & Source Orchestrator" });

  const allFreeSources = [
    // Saudi Government & Regulatory
    { id: "maroof", label: "Maroof.sa", category: "gov", url: "maroof.sa", access: "research" },
    { id: "bluepages", label: "Bluepages KSA", category: "gov", url: "api-old.bluepages.com.sa", access: "api" },
    { id: "aamaly", label: "Aamaly (أعمالي)", category: "gov", url: "aamaly.com", access: "research" },
    { id: "open_data", label: "Saudi Open Data Portal", category: "gov", url: "open.data.gov.sa", access: "api" },
    { id: "moci", label: "MoCI New Registrations", category: "gov", url: "mci.gov.sa", access: "research" },
    { id: "misa", label: "MISA Foreign Investment", category: "gov", url: "misa.gov.sa", access: "research" },
    { id: "modon", label: "MODON Industrial Cities", category: "gov", url: "modon.gov.sa", access: "research" },
    { id: "nic", label: "NIC Industrial Registry", category: "gov", url: "nic.org.sa", access: "research" },
    { id: "hrdf", label: "HRDF Employer Registry", category: "gov", url: "hrdf.org.sa", access: "research" },
    { id: "rcjy", label: "RCJY Jubail & Yanbu", category: "gov", url: "rcjy.gov.sa", access: "research" },
    { id: "etimad", label: "Etimad Government Contracts", category: "gov", url: "etimad.sa", access: "research" },
    { id: "ncbe", label: "NCBE Bankruptcy Register", category: "gov", url: "ncbe.gov.sa", access: "research" },
    { id: "sama_stats", label: "SAMA Licensed Entities", category: "gov", url: "sama.gov.sa", access: "research" },
    { id: "cma", label: "CMA Listed Companies", category: "gov", url: "cma.org.sa", access: "research" },
    { id: "zatca", label: "ZATCA VAT Registry", category: "gov", url: "zatca.gov.sa", access: "research" },
    { id: "gastat", label: "GASTAT Business Census", category: "gov", url: "stats.gov.sa", access: "research" },
    { id: "najiz", label: "Najiz Court Records", category: "gov", url: "najiz.sa", access: "research" },
    { id: "scopa", label: "Saudi Chambers (SCOPA)", category: "gov", url: "scopa.org.sa", access: "research" },
    // GCC Exchanges
    { id: "tadawul", label: "Saudi Exchange (Tadawul)", category: "exchange", url: "saudiexchange.sa", access: "api" },
    { id: "dfm", label: "Dubai Financial Market", category: "exchange", url: "dfm.ae", access: "research" },
    { id: "adx", label: "Abu Dhabi Securities Exchange", category: "exchange", url: "adx.ae", access: "research" },
    { id: "boursa_kw", label: "Boursa Kuwait", category: "exchange", url: "boursakuwait.com.kw", access: "research" },
    { id: "bahrain_bourse", label: "Bahrain Bourse", category: "exchange", url: "bahrainbourse.com", access: "research" },
    { id: "msx", label: "Muscat Stock Exchange", category: "exchange", url: "msx.om", access: "research" },
    // GCC Registries
    { id: "ded", label: "DED Dubai", category: "gcc_reg", url: "ded.ae", access: "research" },
    { id: "difc", label: "DIFC Companies", category: "gcc_reg", url: "difc.ae", access: "research" },
    { id: "adgm", label: "ADGM Companies", category: "gcc_reg", url: "adgm.com", access: "research" },
    { id: "qfcra", label: "QFC Qatar", category: "gcc_reg", url: "qfc.qa", access: "research" },
    { id: "cipa_kw", label: "CIPA Kuwait", category: "gcc_reg", url: "cipa.gov.kw", access: "research" },
    { id: "sijilat", label: "MOCI Bahrain (Sijilat)", category: "gcc_reg", url: "sijilat.com.bh", access: "research" },
    { id: "ita_oman", label: "ITA Oman", category: "gcc_reg", url: "investinoman.com", access: "research" },
    // Global Open Data
    { id: "gleif", label: "GLEIF LEI Registry", category: "open", url: "api.gleif.org", access: "api" },
    { id: "opencorporates", label: "OpenCorporates (200M+)", category: "open", url: "opencorporates.com", access: "api" },
    { id: "wikidata", label: "Wikidata Knowledge Graph", category: "open", url: "wikidata.org", access: "sparql" },
    { id: "github", label: "GitHub Organizations", category: "open", url: "api.github.com", access: "api" },
    { id: "clearbit_logo", label: "Clearbit Logo CDN", category: "open", url: "logo.clearbit.com", access: "api" },
    // Business Media (Free)
    { id: "argaam_rss", label: "Argaam RSS Feed", category: "media", url: "argaam.com", access: "rss" },
    { id: "arabnews_rss", label: "Arab News RSS", category: "media", url: "arabnews.com", access: "rss" },
    { id: "wamda", label: "Wamda MENA Startups", category: "media", url: "wamda.com", access: "research" },
    { id: "magnitt", label: "MAGNiTT (free tier)", category: "media", url: "magnitt.com", access: "research" },
    { id: "aleqt", label: "Al Eqtisadiah", category: "media", url: "aleqt.com", access: "research" },
    { id: "maal", label: "Maal Financial News", category: "media", url: "maal.com.sa", access: "research" },
    { id: "cnbc_arabia", label: "CNBC Arabia", category: "media", url: "cnbcarabia.com", access: "research" },
    { id: "alarabiya_aswaq", label: "Al Arabiya Aswaq", category: "media", url: "alarabiya.net/aswaq", access: "research" },
    { id: "asharq_awsat", label: "Asharq Al-Awsat Business", category: "media", url: "aawsat.com", access: "research" },
    { id: "forbes_me", label: "Forbes Middle East", category: "media", url: "forbesmiddleeast.com", access: "research" },
    { id: "mubasher", label: "Mubasher GCC", category: "media", url: "mubasher.info", access: "research" },
    { id: "saudi_gazette", label: "Saudi Gazette Tenders", category: "media", url: "saudigazette.com.sa", access: "research" },
    { id: "zawya_free", label: "Zawya (free articles)", category: "media", url: "zawya.com", access: "research" },
    // Executive Directories
    { id: "saudiceos", label: "SaudiCEOs Directory", category: "exec", url: "saudiceos.com", access: "research" },
    { id: "saudibods", label: "SaudiBODs Directory", category: "exec", url: "saudibods.com", access: "research" },
    // Hiring Signal Sources (Company Discovery)
    { id: "bayt", label: "Bayt.com Job Postings", category: "jobs", url: "bayt.com", access: "research" },
    { id: "gulftalent", label: "GulfTalent", category: "jobs", url: "gulftalent.com", access: "research" },
    { id: "naukrigulf", label: "Naukrigulf", category: "jobs", url: "naukrigulf.com", access: "research" },
    // AI-Powered Discovery
    { id: "perplexity", label: "Perplexity AI Search", category: "ai", url: "api.perplexity.ai", access: "api" },
    { id: "scout_extract", label: "Scout AI Extract", category: "ai", url: "localhost:8099", access: "api" },
    { id: "gemini_flash", label: "Gemini Flash Extractor", category: "ai", url: "generativelanguage.googleapis.com", access: "api" },
  ];

  emit(emitter, { type: "agent_log", agent: 1, message: `Analysing ICP brief across ${allFreeSources.length} free source categories…` });

  const prompt = `You are a Saudi Arabia B2B intelligence architect. Analyse this ICP brief and produce a JSON sourcing plan.

ICP BRIEF:
${JSON.stringify(brief, null, 2)}

TASK:
1. Select the best sources from the list below for this ICP
2. For each selected source, write 3-5 precise search queries (in English AND Arabic)
3. Prioritise sources by expected yield (higher = better first)
4. Return a JSON object with this exact shape:
{
  "targetSegments": ["segment1", "segment2", ...],
  "sourcePriority": ["source_id1", "source_id2", ...],
  "queries": {
    "source_id": ["query1_en", "query1_ar", "query2_en", ...]
  },
  "estimatedLeads": number,
  "industryKeywordsAr": ["keyword1", "keyword2", ...],
  "industryKeywordsEn": ["keyword1", "keyword2", ...],
  "geographyFocus": "string describing cities/regions"
}

AVAILABLE SOURCES:
${allFreeSources.map(s => `- ${s.id}: ${s.label} (${s.category})`).join("\n")}

RULES:
- NO paid APIs (exclude: Apollo, Hunter, Lusha, ZoomInfo, etc.)
- Include all relevant government registry sources for KSA companies
- For tech companies include github, bayt, naukrigulf
- For listed companies include tadawul, gleif, opencorporates
- For startups include wamda, magnitt, wikidata
- Always include: perplexity, scout_extract, gemini_flash, maroof, bluepages, gleif, opencorporates, wikidata
- For industrial companies include modon, nic, rcjy
- For financial companies include cma, sama_stats, tadawul
- Always include media sources for signal discovery`;

  const raw = await nexusSynthCall(prompt, "You are a Saudi B2B intelligence architect. Output only valid JSON.");
  const plan = await parseJsonFromGemini(raw, {
    targetSegments: brief.industries || ["B2B"],
    sourcePriority: ["perplexity", "gleif", "opencorporates", "wikidata", "tadawul", "maroof", "bluepages", "argaam_rss", "scout_extract"],
    queries: {},
    estimatedLeads: brief.targetCount || 50,
    industryKeywordsAr: [],
    industryKeywordsEn: brief.industries || [],
    geographyFocus: (brief.cities || ["Saudi Arabia"]).join(", "),
  }) as SourcePlan;

  // Fallback: ensure critical sources are always included
  const criticalSources = ["perplexity", "gleif", "opencorporates", "wikidata", "maroof", "bluepages", "scout_extract", "tadawul", "argaam_rss", "arabnews_rss"];
  for (const src of criticalSources) {
    if (!plan.sourcePriority.includes(src)) plan.sourcePriority.unshift(src);
  }

  // Build search queries for each source
  const industryEn = (brief.industries || []).join(", ") || "B2B company";
  const industryAr = ((plan as SourcePlan).industryKeywordsAr || []).join(", ") || "شركة";
  const cities = (brief.cities || ["Saudi Arabia", "Riyadh", "Jeddah", "Dammam"]).join(", ");

  const defaultQueries: Record<string, string[]> = {
    perplexity: [
      `List top ${industryEn} companies in ${cities} Saudi Arabia with website and contact info`,
      `${industryEn} companies Saudi Arabia ${brief.companySizes?.join(" OR ") || "SME enterprise"} 2024 2025 list`,
      `أبرز شركات ${industryAr} في ${cities} السعودية مع معلومات الاتصال`,
      `Saudi Arabia ${industryEn} B2B companies directory website phone email`,
      `Vision 2030 ${industryEn} companies Saudi Arabia new registrations`,
    ],
    maroof: [`site:maroof.sa ${industryEn}`, `site:maroof.sa ${industryAr}`, `maroof.sa ${industryEn} company Saudi Arabia`],
    bluepages: [`${industryEn} ${cities}`, `${industryAr} ${cities}`],
    aamaly: [`site:aamaly.com ${industryAr}`, `aamaly.com ${industryEn} شركات`],
    tadawul: [`${industryEn} Saudi Exchange listed companies sector`, `Tadawul ${industryEn} listed`],
    gleif: [`${industryEn} Saudi Arabia`, `${industryEn} KSA`],
    opencorporates: [`${industryEn} Saudi Arabia`, `${industryEn} KSA`],
    wikidata: [`${industryEn} company Saudi Arabia`, `${industryEn} Riyadh`],
    argaam_rss: [`${industryEn} Saudi company news`, `أخبار ${industryAr} السعودية`],
    arabnews_rss: [`${industryEn} Saudi Arabia business`, `Saudi ${industryEn} company`],
    wamda: [`${industryEn} Saudi Arabia startup`, `Saudi ${industryEn} entrepreneur`],
    magnitt: [`${industryEn} Saudi Arabia`, `Saudi ${industryEn} funded`],
    bayt: [`${industryEn} company Saudi Arabia jobs`, `site:bayt.com ${industryEn} Saudi`],
    gulftalent: [`${industryEn} Saudi Arabia`, `site:gulftalent.com ${industryEn}`],
    naukrigulf: [`${industryEn} Saudi Arabia company`, `site:naukrigulf.com ${industryEn} Saudi`],
    etimad: [`${industryEn} government contract Saudi`, `etimad.sa ${industryEn}`],
    modon: [`${industryEn} MODON industrial city Saudi Arabia`, `modon.gov.sa ${industryEn}`],
    nic: [`${industryEn} NIC industrial Saudi Arabia`, `nic.org.sa ${industryEn}`],
    misa: [`${industryEn} MISA foreign investment Saudi Arabia`, `MISA licensed ${industryEn}`],
    saudiceos: [`site:saudiceos.com ${industryEn}`, `SaudiCEOs ${industryEn} directory`],
    saudibods: [`site:saudibods.com ${industryEn}`, `SaudiBODs ${industryEn} board`],
    scopa: [`site:scopa.org.sa ${industryEn}`, `Saudi chambers ${industryEn} member`],
    github: [`${industryEn} Saudi Arabia organization`, `Saudi ${industryEn} tech company GitHub`],
    forbes_me: [`site:forbesmiddleeast.com ${industryEn} Saudi`, `Forbes Middle East ${industryEn} company list`],
    aleqt: [`site:aleqt.com ${industryEn}`, `الاقتصادية ${industryAr}`],
    mubasher: [`site:mubasher.info ${industryEn} Saudi`, `مباشر ${industryAr} السعودية`],
    zawya_free: [`site:zawya.com ${industryEn} Saudi Arabia`, `Zawya ${industryEn} Saudi`],
  };

  // Merge plan queries with defaults
  const mergedQueries: Record<string, string[]> = { ...defaultQueries };
  if (plan.queries) {
    for (const [srcId, qs] of Object.entries(plan.queries)) {
      mergedQueries[srcId] = [...(mergedQueries[srcId] || []), ...(qs as string[])];
    }
  }

  const searchQueries: SourceQuery[] = [];
  for (const srcId of plan.sourcePriority) {
    const queries = mergedQueries[srcId] || [];
    for (const q of queries.slice(0, 5)) {
      searchQueries.push({ sourceId: srcId, query: q });
    }
  }

  emit(emitter, { type: "agent_log", agent: 1, message: `Sourcing plan ready: ${plan.sourcePriority.length} sources, ${searchQueries.length} search queries` });
  emit(emitter, { type: "agent_log", agent: 1, message: `Target segments: ${plan.targetSegments?.join(", ") || "B2B"}` });
  emit(emitter, { type: "agent_log", agent: 1, message: `Geography: ${plan.geographyFocus || cities}` });
  emit(emitter, { type: "agent_complete", agent: 1, label: "ICP Mapper & Source Orchestrator" });

  return { sourcePlan: plan, searchQueries };
}

interface SourcePlan {
  targetSegments: string[];
  sourcePriority: string[];
  queries: Record<string, string[]>;
  estimatedLeads: number;
  industryKeywordsAr: string[];
  industryKeywordsEn: string[];
  geographyFocus: string;
}

interface SourceQuery { sourceId: string; query: string; }

// ─── Agent 2: Lead Harvester ─────────────────────────────────────────────────

async function agent2_harvestLeads(
  brief: LeadFactoryBrief,
  sourcePlan: SourcePlan,
  searchQueries: SourceQuery[],
  emitter: EventEmitter,
): Promise<RawLead[]> {
  emit(emitter, { type: "agent_start", agent: 2, label: "Lead Harvester" });
  const discovered: RawLead[] = [];
  const seen = new Set<string>();
  const targetCount = brief.targetCount || 50;

  function addLead(lead: RawLead) {
    const key = (lead.domain || lead.crNumber || lead.phone || lead.companyName || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    discovered.push(lead);
    emit(emitter, { type: "lead_found", agent: 2, lead });
    emit(emitter, { type: "agent_progress", agent: 2, current: discovered.length, total: targetCount });
    emit(emitter, { type: "agent_log", agent: 2, message: `Found: ${lead.companyName || lead.domain || "unknown"} via ${lead.sourceUsed}` });
  }

  // ── Source: GLEIF (free REST API) ───────────────────────────────────────────
  async function harvestGLEIF() {
    const queries = searchQueries.filter(q => q.sourceId === "gleif").slice(0, 3);
    for (const { query } of queries) {
      const url = `https://api.gleif.org/api/v1/lei-records?filter[fulltext]=${encodeURIComponent(query)}&filter[entity.registeredAs]=*&filter[entity.legalAddress.country]=SA&page[size]=20`;
      const r = await httpGet(url);
      if (r.ok && r.data) {
        const items = (r.data as { data?: unknown[] }).data || [];
        for (const item of items.slice(0, 10) as Record<string, unknown>[]) {
          const entity = (item.attributes as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
          if (!entity) continue;
          const legalName = (entity.legalName as { name?: string })?.name || "";
          const address = (entity.legalAddress as Record<string, unknown>) || {};
          addLead({
            companyName: legalName,
            city: (address.city as string) || "",
            region: (address.region as string) || "",
            crNumber: (entity.registeredAs as string) || "",
            sourceUsed: "GLEIF",
            rawData: { lei: item.id, entity, country: (address.country as { id?: string })?.id || "SA" },
          });
        }
      }
    }
  }

  // ── Source: OpenCorporates (free, 50/day) ────────────────────────────────────
  async function harvestOpenCorporates() {
    const queries = searchQueries.filter(q => q.sourceId === "opencorporates").slice(0, 2);
    for (const { query } of queries) {
      const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(query)}&jurisdiction_code=sa&inactive=false&per_page=20`;
      const r = await httpGet(url);
      if (r.ok && r.data) {
        const results = ((r.data as Record<string, unknown>).results as Record<string, unknown>) || {};
        const companies = (results.companies as { company: Record<string, unknown> }[]) || [];
        for (const { company } of companies.slice(0, 10)) {
          addLead({
            companyName: company.name as string,
            crNumber: company.company_number as string,
            city: (company.registered_address as Record<string, unknown>)?.locality as string || "",
            entityType: company.company_type as string || "",
            foundingYear: company.incorporation_date as string || "",
            sourceUsed: "OpenCorporates",
            rawData: { oc_url: company.opencorporates_url, jurisdiction: company.jurisdiction_code },
          } as RawLead);
        }
      }
    }
  }

  // ── Source: Wikidata SPARQL ──────────────────────────────────────────────────
  async function harvestWikidata() {
    const industryEn = (brief.industries || []).join(" ").toLowerCase();
    const sparql = `SELECT DISTINCT ?company ?companyLabel ?website ?industryLabel ?city ?cityLabel ?founded WHERE {
  ?company wdt:P17 wd:Q851 .
  ?company wdt:P31 wd:Q4830453 .
  ${industryEn.includes("tech") || industryEn.includes("software") ? "OPTIONAL { ?company wdt:P452 ?industry . }" : ""}
  OPTIONAL { ?company wdt:P856 ?website }
  OPTIONAL { ?company wdt:P571 ?founded }
  OPTIONAL { ?company wdt:P131 ?city }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar" }
} LIMIT 30`;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const r = await httpGet(url, 20000);
    if (r.ok && r.data) {
      const bindings = ((r.data as Record<string, unknown>).results as Record<string, unknown>)?.bindings as Record<string, Record<string, string>>[];
      for (const b of (bindings || []).slice(0, 20)) {
        const website = b.website?.value || "";
        const domain = website ? new URL(website).hostname.replace(/^www\./, "") : "";
        addLead({
          companyName: b.companyLabel?.value || "",
          domain,
          city: b.cityLabel?.value || "",
          foundingYear: b.founded?.value?.slice(0, 4) || "",
          sourceUsed: "Wikidata",
          rawData: { wikidata_uri: b.company?.value },
        });
      }
    }
  }

  // ── Source: Tadawul Listed Companies (public JSON) ───────────────────────────
  async function harvestTadawul() {
    const url = "https://api.saudiexchange.sa/v2/main/GetAllSecurities?lang=en";
    const r = await httpGet(url, 15000);
    if (r.ok && r.data) {
      const securities = Array.isArray(r.data) ? r.data : ((r.data as Record<string, unknown>).data as unknown[] || []);
      const industries = (brief.industries || []).map(i => i.toLowerCase());
      for (const sec of (securities as Record<string, string>[]).slice(0, 200)) {
        const sector = (sec.sector || sec.Sector || sec.sectorAr || "").toLowerCase();
        const matches = industries.length === 0 || industries.some(i => sector.includes(i));
        if (matches || industries.length === 0) {
          addLead({
            companyName: sec.companyNameEn || sec.name || sec.CompanyNameEn || "",
            companyNameAr: sec.companyNameAr || sec.CompanyNameAr || "",
            industry: sec.sector || sec.Sector || "",
            entityType: "Listed (Tadawul)",
            sourceUsed: "Tadawul",
            rawData: { ticker: sec.symbol || sec.Symbol, isin: sec.isin || sec.ISIN },
          });
        }
      }
    }
  }

  // ── Source: GitHub Organizations (tech companies) ───────────────────────────
  async function harvestGitHub() {
    const queries = searchQueries.filter(q => q.sourceId === "github").slice(0, 2);
    for (const { query } of queries) {
      const url = `https://api.github.com/search/users?q=${encodeURIComponent(query + " type:org location:Saudi")}&per_page=20`;
      const r = await httpGet(url);
      if (r.ok && r.data) {
        const items = ((r.data as Record<string, unknown>).items as Record<string, unknown>[]) || [];
        for (const org of items.slice(0, 10)) {
          // Fetch org details
          const orgUrl = `https://api.github.com/orgs/${org.login}`;
          const orgR = await httpGet(orgUrl);
          if (orgR.ok && orgR.data) {
            const o = orgR.data as Record<string, string>;
            addLead({
              companyName: o.name || org.login as string || "",
              domain: o.blog ? o.blog.replace(/^https?:\/\//, "").replace(/\/$/, "") : "",
              email: o.email || "",
              city: o.location || "",
              description: o.description || "",
              sourceUsed: "GitHub",
              rawData: { github_url: org.html_url, repos: o.public_repos },
            });
          }
        }
      }
    }
  }

  // ── Source: Bluepages KSA (multi-page paginated API) ─────────────────────────
  async function harvestBluepages() {
    const queries = searchQueries.filter(q => q.sourceId === "bluepages").slice(0, 3);
    const maxPages = brief.enrichmentDepth === "deep" ? 10 : 5;
    for (const { query } of queries) {
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= maxPages) {
        const url = `https://api-old.bluepages.com.sa/companies/getAll/paginate?keyword=${encodeURIComponent(query)}&page=${page}&pageSize=20`;
        const r = await httpGet(url, 12000);
        if (!r.ok || !r.data) { hasMore = false; break; }
        const d = r.data as Record<string, unknown>;
        const items = (d.items as Record<string, unknown>[]) || [];
        if (items.length === 0) { hasMore = false; break; }
        for (const co of items) {
          const emailVal = (co.email || "") as string;
          addLead({
            companyName: (co.nameEn || co.name || co.companyName || "") as string,
            companyNameAr: (co.nameAr || co.companyNameAr || "") as string,
            phone: (co.phone || co.mobile || "") as string,
            email: emailVal || undefined,
            emailTrusted: !!emailVal,
            city: (co.city || co.cityEn || "") as string,
            industry: (co.activity || co.isicDescription || co.sector || "") as string,
            crNumber: (co.cr || co.crNumber || "") as string,
            sourceUsed: "Bluepages KSA",
            rawData: co,
          });
        }
        const totalPages = (d.totalPages as number) || (d.pages as number) || (d.pageCount as number) || 1;
        const total = (d.total as number) || (d.count as number) || 0;
        hasMore = page < totalPages && total > page * 20;
        emit(emitter, { type: "agent_log", agent: 2, message: `Bluepages pg ${page}/${totalPages}: ${items.length} companies (query: ${query.slice(0, 30)})` });
        page++;
      }
    }
  }

  // ── Source: Argaam RSS Feed (entity extraction via Gemini) ──────────────────
  async function harvestArgaamRSS() {
    const rssUrls = [
      "https://www.argaam.com/ar/rss/latest-news.aspx",
      "https://www.argaam.com/en/rss/latest-news.aspx",
    ];
    const headlines: string[] = [];
    for (const rssUrl of rssUrls) {
      const r = await httpGet(rssUrl, 10000);
      if (r.ok && r.text) {
        const $ = cheerio.load(r.text, { xmlMode: true });
        $("item").each((_, el) => {
          const title = $(el).find("title").text().trim();
          const desc = $(el).find("description").text().trim();
          if (title) headlines.push(`${title}. ${desc.slice(0, 80)}`);
        });
      }
    }
    if (headlines.length === 0) return;
    emit(emitter, { type: "agent_log", agent: 2, message: `Argaam RSS: ${headlines.length} headlines → extracting company entities…` });
    const industryKw = (brief.industries || []).join(", ") || "B2B";
    const raw = await nexusCall(
      `Extract Saudi business company names and entities from these Argaam (Saudi financial news) headlines. Focus on ${industryKw} companies. Return JSON array: [{companyName, companyNameAr, industry, city, description}]. Only real companies, no generic terms.\n\nHeadlines:\n${headlines.slice(0, 40).join("\n")}`,
      "Return only a valid JSON array of company objects. No markdown.",
    );
    const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
    if (Array.isArray(parsed)) {
      for (const lead of parsed.slice(0, 20)) {
        if (lead.companyName) addLead({ ...lead, sourceUsed: "Argaam RSS", emailTrusted: false });
      }
    }
  }

  // ── Source: Arab News RSS (entity extraction via Gemini) ─────────────────────
  async function harvestArabNewsRSS() {
    const rssUrls = [
      "https://www.arabnews.com/rss.xml",
      "https://www.arabnews.com/taxonomy/term/317/0/feed",
    ];
    const headlines: string[] = [];
    for (const rssUrl of rssUrls) {
      const r = await httpGet(rssUrl, 10000);
      if (r.ok && r.text) {
        const $ = cheerio.load(r.text, { xmlMode: true });
        $("item").each((_, el) => {
          const title = $(el).find("title").text().trim();
          const desc = $(el).find("description").text().trim();
          if (title) headlines.push(`${title}. ${desc.slice(0, 80)}`);
        });
      }
    }
    if (headlines.length === 0) return;
    emit(emitter, { type: "agent_log", agent: 2, message: `Arab News RSS: ${headlines.length} headlines → extracting entities…` });
    const industryKw = (brief.industries || []).join(", ") || "Saudi B2B";
    const raw = await nexusCall(
      `Extract Saudi business company names mentioned in these Arab News headlines. Focus on ${industryKw} sector. Return JSON array: [{companyName, industry, city, description}].\n\nHeadlines:\n${headlines.slice(0, 40).join("\n")}`,
      "Return only a valid JSON array. No markdown.",
    );
    const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
    if (Array.isArray(parsed)) {
      for (const lead of parsed.slice(0, 20)) {
        if (lead.companyName) addLead({ ...lead, sourceUsed: "Arab News RSS", emailTrusted: false });
      }
    }
  }

  // ── Source: Free Web Search (SearXNG → Google HTML) ─────────────────────────
  // Zero-cost discovery channel. Used as a Perplexity replacement when no
  // PERPLEXITY_API_KEY is set, and as an *additional* source even when it is.
  // Pulls SERP hits per query, then asks Nexus to extract company JSON from
  // the title+snippet text so we stay within the free LLM tier.
  async function harvestFreeWebSearch() {
    const queries = searchQueries
      .filter((q) => q.sourceId === "perplexity" || q.sourceId === "free_search")
      .slice(0, 5);
    if (queries.length === 0) return;

    for (const { query } of queries) {
      try {
        const hits = await freeWebSearch(query, { limit: 10 });
        if (hits.length === 0) continue;

        // Compact prompt: feed titles+snippets+URLs, let Nexus pull entities.
        const block = hits
          .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
          .join("\n\n");

        const res = await nexusGenerate(
          `Search query: ${query}\n\nSearch results:\n${block}\n\n` +
            `Extract Saudi B2B companies as a JSON array. Each item: ` +
            `{companyName, companyNameAr, domain, phone, email, city, industry, description, sourceUsed: "FreeWebSearch"}. ` +
            `Return only JSON, no prose, no markdown.`,
          { tier: "extraction", maxTokens: 2500, temperature: 0 },
        );

        const parsed = (await parseJsonFromGemini(res.text, [])) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 10)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "FreeWebSearch", emailTrusted: false });
          }
        }
      } catch {
        /* skip query */
      }
    }
  }

  // ── Source: Perplexity AI Discovery ─────────────────────────────────────────
  async function harvestPerplexity() {
    const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
    if (!PERPLEXITY_API_KEY) {
      emit(emitter, { type: "agent_log", agent: 2, message: "Perplexity not configured — using free web search instead" });
      await harvestFreeWebSearch();
      return;
    }
    const pQueries = searchQueries.filter(q => q.sourceId === "perplexity").slice(0, 5);
    for (const { query } of pQueries) {
      try {
        const r = await axios.post("https://api.perplexity.ai/chat/completions", {
          model: "sonar",
          messages: [
            { role: "system", content: "You are a Saudi B2B lead researcher. Extract company data as JSON array. Each item: {companyName, companyNameAr, domain, phone, email, city, industry, description, sourceUsed: 'Perplexity'}. Return only JSON, no markdown." },
            { role: "user", content: `Find Saudi B2B companies: ${query}\n\nReturn up to 10 companies as JSON array with these fields: companyName, companyNameAr, domain, phone, email, city, industry, description` },
          ],
          max_tokens: 3000,
          temperature: 0.1,
          return_citations: false,
        }, { headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}` }, timeout: 35000 });
        const content = r.data?.choices?.[0]?.message?.content || "";
        const parsed = await parseJsonFromGemini(content, []) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 10)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "Perplexity", emailTrusted: false });
          }
        }
      } catch { /* skip */ }
    }
  }

  // ── Source: Gemini-Powered Research (fallback discovery) ─────────────────────
  async function harvestGeminiResearch() {
    if (!isGeminiConfigured()) return;
    const industryEn = (brief.industries || []).join(", ") || "B2B";
    const cities = (brief.cities || ["Riyadh", "Jeddah", "Dammam"]).join(", ");
    const prompt = `You are a Saudi Arabia B2B intelligence researcher. List ${Math.min(20, targetCount)} real ${industryEn} companies based in ${cities}, Saudi Arabia.

For each company provide:
- companyName (English)
- companyNameAr (Arabic)
- domain (website domain)
- phone (Saudi format: 05XXXXXXXX or 011XXXXXXX)
- email (corporate email)
- city
- industry
- employeeCount (estimate: "1-50", "51-200", "201-1000", "1000+")
- description (1-2 sentences)

Return a JSON array only. Use real companies, not fictional ones. Focus on ${brief.enrichmentDepth === "deep" ? "large enterprise" : "SME and mid-market"} companies.`;

    const raw = await nexusSynthCall(prompt, "Output only a valid JSON array of company objects.");
    const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
    if (Array.isArray(parsed)) {
      for (const lead of parsed) {
        if (lead.companyName) addLead({ ...lead, sourceUsed: "Gemini Research", emailTrusted: false });
      }
    }
  }

  // ── Source: Saudi Open Data Portal ──────────────────────────────────────────
  async function harvestSaudiOpenData() {
    const industryKw = (brief.industries || []).join(" ") || "company";
    const url = `https://open.data.gov.sa/en/api/datasets?page=1&limit=10&q=${encodeURIComponent(industryKw)}`;
    const r = await httpGet(url, 12000);
    if (!r.ok || !r.data) return;
    const datasets = ((r.data as Record<string, unknown>).data || []) as Record<string, unknown>[];
    emit(emitter, { type: "agent_log", agent: 2, message: `Saudi Open Data: ${datasets.length} relevant datasets found` });
    for (const ds of datasets.slice(0, 4)) {
      const resources = ((ds.resources || ds.resource_list || []) as Record<string, string>[]);
      for (const res of resources.slice(0, 2)) {
        const resUrl = res.url || res.download_url || "";
        if (!resUrl || (!resUrl.endsWith(".json") && !resUrl.endsWith(".csv"))) continue;
        const resR = await httpGet(resUrl, 18000);
        if (!resR.ok || !resR.text || resR.text.length < 50) continue;
        const raw = await nexusCall(
          `Extract business/company names from this Saudi Open Data dataset. Return JSON array: [{companyName, companyNameAr, city, industry, crNumber, phone}].\n\nData (first 3000 chars):\n${resR.text.slice(0, 3000)}`,
          "Return only a valid JSON array. No markdown.",
        );
        const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 15)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "Saudi Open Data", emailTrusted: false });
          }
        }
      }
    }
  }

  // ── Source: Maroof.sa (Saudi Business Registry) ──────────────────────────────
  async function harvestMaroof() {
    const queries = searchQueries.filter(q => q.sourceId === "maroof").slice(0, 3);
    for (const { query } of queries) {
      const url = `https://maroof.sa/businesses?searchText=${encodeURIComponent(query)}`;
      const r = await httpGet(url, 15000);
      if (!r.ok || !r.text) continue;
      const $ = cheerio.load(r.text);
      $("script, style, nav, footer, header").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
      if (bodyText.length < 100) continue;
      const raw = await nexusCall(
        `Extract Saudi business listings from this Maroof.sa page. Return JSON array: [{companyName, companyNameAr, phone, city, industry, crNumber, description}]. Real entries only.\n\nText: ${bodyText.slice(0, 4000)}`,
        "Return only a valid JSON array. No markdown.",
      );
      const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
      if (Array.isArray(parsed)) {
        for (const lead of parsed.slice(0, 15)) {
          if (lead.companyName) addLead({ ...lead, sourceUsed: "Maroof.sa", emailTrusted: false });
        }
      }
      emit(emitter, { type: "agent_log", agent: 2, message: `Maroof.sa: leads extracted for "${query.slice(0, 30)}"` });
    }
  }

  // ── Source: Aamaly.com (Saudi B2B Directory) ──────────────────────────────────
  async function harvestAamaly() {
    const industryEn = (brief.industries || []).slice(0, 2).join(" ") || "business";
    const queries = [industryEn, (brief.cities || ["Riyadh"]).slice(0, 1).join(" ")];
    for (const query of queries.slice(0, 2)) {
      const url = `https://aamaly.com/sa-en/search?q=${encodeURIComponent(query)}&type=company`;
      const r = await httpGet(url, 15000);
      if (!r.ok || !r.text) continue;
      const $ = cheerio.load(r.text);
      $("script, style, nav, footer, header").remove();
      const companies: RawLead[] = [];
      $("[class*='company'], [class*='business'], [class*='card'], article, li").each((_, el) => {
        const name = $(el).find("h1,h2,h3,h4,[class*='name'],[class*='title']").first().text().trim();
        const phone = $(el).find("[class*='phone'],[href^='tel:']").first().text().replace(/[^\d+]/g, "");
        const city = $(el).find("[class*='city'],[class*='location']").first().text().trim();
        if (name && name.length > 2 && name.length < 120) {
          companies.push({ companyName: name, phone: phone || undefined, city: city || undefined });
        }
      });
      if (companies.length > 0) {
        for (const co of companies.slice(0, 15)) addLead({ ...co, sourceUsed: "Aamaly", emailTrusted: false });
        emit(emitter, { type: "agent_log", agent: 2, message: `Aamaly: ${companies.length} companies via HTML parse` });
      } else {
        const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
        if (bodyText.length < 200) continue;
        const raw = await nexusCall(
          `Extract company listings from this Aamaly.com Saudi business directory page. Return JSON array: [{companyName, companyNameAr, phone, city, industry}].\n\nText: ${bodyText.slice(0, 4000)}`,
          "Return only a valid JSON array.",
        );
        const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 15)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "Aamaly", emailTrusted: false });
          }
          emit(emitter, { type: "agent_log", agent: 2, message: `Aamaly: ${parsed.length} companies via Gemini extract` });
        }
      }
    }
  }

  // ── Source: Bayt.com (Jobs → company discovery) ──────────────────────────────
  async function harvestBayt() {
    const industryEn = encodeURIComponent((brief.industries || []).slice(0, 2).join(" ") || "company");
    const pages = brief.enrichmentDepth === "deep" ? 3 : 2;
    for (let page = 1; page <= pages; page++) {
      const url = `https://www.bayt.com/en/saudi-arabia/jobs/?q=${industryEn}&page=${page}`;
      const r = await httpGet(url, 15000);
      if (!r.ok || !r.text) break;
      const $ = cheerio.load(r.text);
      $("script, style").remove();
      const seen = new Set<string>();
      $("[class*='company'],[data-company],span.company,.company-name,[itemprop='hiringOrganization']").each((_, el) => {
        const name = $(el).text().trim().replace(/\s+/g, " ");
        if (name && name.length > 2 && name.length < 100 && !seen.has(name)) {
          seen.add(name);
          addLead({ companyName: name, sourceUsed: "Bayt.com", emailTrusted: false });
        }
      });
      if (seen.size === 0) {
        const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
        const raw = await nexusCall(
          `Extract company names from this Bayt.com Saudi job board page. Return JSON array: [{companyName, city, industry}].\n\nText: ${bodyText.slice(0, 3500)}`,
          "Return only a valid JSON array.",
        );
        const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 20)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "Bayt.com", emailTrusted: false });
          }
        }
      }
      emit(emitter, { type: "agent_log", agent: 2, message: `Bayt.com pg ${page}: ${seen.size} companies extracted` });
    }
  }

  // ── Source: GulfTalent (Jobs → company discovery) ─────────────────────────────
  async function harvestGulfTalent() {
    const industryEn = encodeURIComponent((brief.industries || []).slice(0, 2).join(" ") || "company");
    const pages = brief.enrichmentDepth === "deep" ? 3 : 2;
    for (let page = 1; page <= pages; page++) {
      const url = `https://www.gulftalent.com/saudi-arabia/jobs?search=${industryEn}&page=${page}`;
      const r = await httpGet(url, 15000);
      if (!r.ok || !r.text) break;
      const $ = cheerio.load(r.text);
      $("script, style").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
      const raw = await nexusCall(
        `Extract company names from this GulfTalent job listings page (Saudi Arabia). Return JSON array: [{companyName, city, industry}].\n\nText: ${bodyText.slice(0, 3500)}`,
        "Return only a valid JSON array.",
      );
      const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
      if (Array.isArray(parsed)) {
        for (const lead of parsed.slice(0, 20)) {
          if (lead.companyName) addLead({ ...lead, sourceUsed: "GulfTalent", emailTrusted: false });
        }
      }
      emit(emitter, { type: "agent_log", agent: 2, message: `GulfTalent pg ${page}: leads extracted` });
    }
  }

  // ── Source: Naukrigulf (Jobs → company discovery) ─────────────────────────────
  async function harvestNaukrigulf() {
    const industryEn = encodeURIComponent((brief.industries || []).slice(0, 2).join(" ") || "company");
    const url = `https://www.naukrigulf.com/saudi-arabia-jobs?q=${industryEn}`;
    const r = await httpGet(url, 15000);
    if (!r.ok || !r.text) return;
    const $ = cheerio.load(r.text);
    $("script, style").remove();
    const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
    const raw = await nexusCall(
      `Extract company names from this Naukrigulf.com Saudi Arabia job listings page. Return JSON array: [{companyName, city, industry}].\n\nText: ${bodyText.slice(0, 3500)}`,
      "Return only a valid JSON array.",
    );
    const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
    if (Array.isArray(parsed)) {
      for (const lead of parsed.slice(0, 20)) {
        if (lead.companyName) addLead({ ...lead, sourceUsed: "Naukrigulf", emailTrusted: false });
      }
    }
    emit(emitter, { type: "agent_log", agent: 2, message: `Naukrigulf: leads extracted` });
  }

  // ── Source: Etimad (Government Contracts & Tenders) ───────────────────────────
  async function harvestEtimad() {
    const url = "https://etimad.sa/Tender/AllTendersForVisitor";
    const r = await httpGet(url, 15000);
    if (r.ok && r.text) {
      const $ = cheerio.load(r.text);
      $("script, style").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 6000);
      if (bodyText.length > 200) {
        const raw = await nexusCall(
          `Extract private-sector company names involved in Saudi government tenders from this Etimad page. Return JSON array: [{companyName, companyNameAr, city, industry, description}]. Focus on supplier/contractor companies.\n\nText: ${bodyText.slice(0, 4000)}`,
          "Return only a valid JSON array.",
        );
        const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 20)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "Etimad", emailTrusted: false });
          }
        }
        emit(emitter, { type: "agent_log", agent: 2, message: `Etimad: government tender companies extracted` });
      }
    }
    // Also try JSON API
    const apiR = await httpGet("https://etimad.sa/api/tender/list?status=open&page=1&limit=20", 10000);
    if (apiR.ok && apiR.data) {
      const items = ((apiR.data as Record<string, unknown>).items || (apiR.data as Record<string, unknown>).data || []) as Record<string, unknown>[];
      for (const item of items.slice(0, 20)) {
        const name = (item.agencyName || item.entityName || item.supplierName || "") as string;
        if (name) addLead({ companyName: name, sourceUsed: "Etimad API", emailTrusted: false });
      }
    }
  }

  // ── Source: MODON Industrial Cities Directory ──────────────────────────────────
  async function harvestMODON() {
    const modonUrls = [
      "https://modon.gov.sa/ar/Pages/IndustrialCities.aspx",
      "https://modon.gov.sa/en/Pages/IndustrialCities.aspx",
    ];
    for (const modonUrl of modonUrls) {
      const r = await httpGet(modonUrl, 15000);
      if (!r.ok || !r.text) continue;
      const $ = cheerio.load(r.text);
      $("script, style").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
      if (bodyText.length < 200) continue;
      const raw = await nexusCall(
        `Extract industrial company names from this MODON (Saudi industrial cities authority) page. Return JSON array: [{companyName, companyNameAr, city, industry, description}]. Real companies registered in MODON cities only.\n\nText: ${bodyText.slice(0, 4000)}`,
        "Return only a valid JSON array.",
      );
      const parsed = await parseJsonFromGemini(raw, []) as RawLead[];
      if (Array.isArray(parsed)) {
        for (const lead of parsed.slice(0, 15)) {
          if (lead.companyName) addLead({ ...lead, sourceUsed: "MODON", emailTrusted: false });
        }
      }
      emit(emitter, { type: "agent_log", agent: 2, message: `MODON: industrial companies extracted` });
      break;
    }
    // Perplexity fallback for MODON companies
    const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
    if (PERPLEXITY_API_KEY) {
      const industryEn = (brief.industries || ["industrial"]).join(", ");
      try {
        const res = await axios.post("https://api.perplexity.ai/chat/completions", {
          model: "sonar",
          messages: [
            { role: "system", content: "Extract company data as JSON array. Return only JSON." },
            { role: "user", content: `List ${industryEn} companies registered in MODON Saudi Arabian industrial cities. Include company name, industrial city, industry sector. Return JSON array: [{companyName, city, industry}]` },
          ],
          max_tokens: 2000, temperature: 0.1,
        }, { headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}` }, timeout: 25000 });
        const content = res.data?.choices?.[0]?.message?.content || "";
        const parsed = await parseJsonFromGemini(content, []) as RawLead[];
        if (Array.isArray(parsed)) {
          for (const lead of parsed.slice(0, 15)) {
            if (lead.companyName) addLead({ ...lead, sourceUsed: "MODON (Perplexity)", emailTrusted: false });
          }
        }
      } catch {}
    }
  }

  // ── Source: List Mode (user-provided company names) ─────────────────────────
  async function harvestCompanyList() {
    if (brief.inputMode !== "list" || !brief.companyList?.length) return;
    for (const entry of brief.companyList) {
      const isUrl = entry.includes(".") && !entry.includes(" ");
      const isCR = /^\d{10}$/.test(entry.trim());
      addLead({
        companyName: isUrl || isCR ? "" : entry,
        domain: isUrl ? entry.replace(/^https?:\/\//, "").split("/")[0] : "",
        crNumber: isCR ? entry.trim() : "",
        sourceUsed: "User List",
      });
    }
  }

  // ── Run all harvesters in parallel batches ──────────────────────────────────
  emit(emitter, { type: "agent_log", agent: 2, message: "Running parallel harvest across all sources…" });

  await harvestCompanyList();
  // Batch 1: structured APIs (fastest, most reliable)
  await Promise.allSettled([
    harvestGLEIF(),
    harvestOpenCorporates(),
    harvestWikidata(),
    harvestTadawul(),
    harvestBluepages(),
  ]);
  // Batch 2: Saudi directories and media RSS
  await Promise.allSettled([
    harvestGitHub(),
    harvestArgaamRSS(),
    harvestArabNewsRSS(),
    harvestMaroof(),
    harvestAamaly(),
  ]);
  // Batch 3: job boards and government portals
  await Promise.allSettled([
    harvestBayt(),
    harvestGulfTalent(),
    harvestNaukrigulf(),
    harvestEtimad(),
    harvestMODON(),
    harvestSaudiOpenData(),
  ]);
  // Batch 4: AI-powered gap fill (Perplexity + Gemini)
  await harvestPerplexity();
  if (discovered.length < targetCount) await harvestGeminiResearch();

  emit(emitter, { type: "agent_complete", agent: 2, label: "Lead Harvester", count: discovered.length });
  return discovered;
}

// ─── Agent 3: Deep Enrichment ─────────────────────────────────────────────────

async function agent3_enrichLeads(
  leads: RawLead[],
  brief: LeadFactoryBrief,
  emitter: EventEmitter,
): Promise<RawLead[]> {
  emit(emitter, { type: "agent_start", agent: 3, label: "Deep Enrichment" });
  const enriched: RawLead[] = [];
  const depth = brief.enrichmentDepth || "standard";

  for (let i = 0; i < leads.length; i++) {
    const lead = { ...leads[i] };
    emit(emitter, { type: "agent_progress", agent: 3, current: i + 1, total: leads.length });

    // Scout site intel (primary enrichment)
    if (lead.domain) {
      try {
        const scout = await scoutSiteIntel(lead.domain);
        if (scout?.ok) {
          const s = scout;
          // Scout-scraped emails are trusted — directly from the company's own website
          if (s.emails?.[0] && !lead.emailTrusted) {
            lead.email = s.emails[0];
            lead.emailTrusted = true;
          } else {
            lead.email = lead.email || s.emails?.[0];
            if (s.emails?.[0]) lead.emailTrusted = true;
          }
          lead.phone = lead.phone || s.phones?.[0];
          lead.linkedinUrl = lead.linkedinUrl || s.socials?.linkedin;
          lead.crNumber = lead.crNumber || s.cr_vat?.cr_number;
          lead.description = lead.description || s.meta?.description;
          lead.logoUrl = lead.logoUrl || s.meta?.og_image;
          lead.enrichedData = { ...lead.enrichedData, techStack: s.tech_stack, socials: s.socials };
          emit(emitter, { type: "agent_log", agent: 3, message: `Scout enriched: ${lead.companyName || lead.domain}` });
        }
      } catch {}
    }

    // GLEIF LEI lookup
    if ((lead.companyName || lead.crNumber) && !lead.enrichedData?.lei) {
      try {
        const query = lead.companyName || lead.crNumber || "";
        const url = `https://api.gleif.org/api/v1/fuzzycompletions?field=fulltext&q=${encodeURIComponent(query)}&jurisdictions=SA`;
        const r = await httpGet(url, 8000);
        if (r.ok && r.data) {
          const completions = (r.data as { data?: { relationships?: { "lei-records"?: { links?: { related?: string } } } }[] }).data || [];
          if (completions.length > 0) {
            const leiUrl = completions[0]?.relationships?.["lei-records"]?.links?.related;
            if (leiUrl) {
              const leiR = await httpGet(leiUrl, 8000);
              if (leiR.ok && leiR.data) {
                const entity = (((leiR.data as Record<string, unknown>).data as Record<string, unknown>)?.[0] as Record<string, unknown>)?.attributes as Record<string, unknown>;
                if (entity) {
                  lead.foundingYear = lead.foundingYear || String((entity.entity as Record<string, unknown>)?.creationDate || "").slice(0, 4);
                  lead.enrichedData = { ...lead.enrichedData, lei: (((leiR.data as Record<string, unknown>).data as Record<string, unknown>)?.[0] as Record<string, unknown>)?.id };
                }
              }
            }
          }
        }
      } catch {}
    }

    // OpenCorporates verification
    if (lead.crNumber && !lead.enrichedData?.oc_verified) {
      const url = `https://api.opencorporates.com/v0.4/companies/sa/${lead.crNumber}`;
      const r = await httpGet(url, 8000);
      if (r.ok && r.data) {
        const co = ((r.data as Record<string, unknown>).results as Record<string, unknown>)?.company as Record<string, unknown>;
        if (co) {
          lead.companyName = lead.companyName || co.name as string;
          lead.foundingYear = lead.foundingYear || String(co.incorporation_date || "").slice(0, 4);
          lead.city = lead.city || (co.registered_address as Record<string, string>)?.locality || "";
          lead.enrichedData = { ...lead.enrichedData, oc_verified: true };
        }
      }
    }

    // Clearbit Logo CDN
    if (lead.domain && !lead.logoUrl) {
      lead.logoUrl = `https://logo.clearbit.com/${lead.domain}`;
    }

    // Deep: PowerScraper (4-layer: Cheerio→Playwright→Stealth→BS4) + NEXUS extract
    if (depth === "deep" && lead.domain && !lead.email) {
      try {
        const scraped = await scrapePage(`https://${lead.domain}`, {
          timeoutMs: 18000,
          minContentLength: 600,
          engines: depth === "deep" ? ["cheerio", "playwright", "playwright-stealth"] : ["cheerio", "playwright"],
        });
        if (scraped && scraped.text && scraped.text.length > 100) {
          const text = scraped.text.slice(0, 3500);
          // Pre-fill from scraper direct extractions
          if (!lead.email && scraped.emails?.[0]) lead.email = scraped.emails[0];
          if (!lead.phone && scraped.phones?.[0]) lead.phone = scraped.phones[0];
          // NEXUS extraction for remaining structured fields
          const extract = await nexusCall(
            `Extract company info from this website text. Return JSON: {companyName, email, phone, city, industry, description, employeeCount, foundingYear}\n\nText: ${text}`,
            "Extract factual company data only. Return valid JSON.",
          );
          const parsed = await parseJsonFromGemini(extract, {}) as RawLead;
          if (parsed) {
            lead.email = lead.email || parsed.email;
            lead.phone = lead.phone || parsed.phone;
            lead.city = lead.city || parsed.city;
            lead.industry = lead.industry || parsed.industry;
            lead.description = lead.description || parsed.description;
            lead.employeeCount = lead.employeeCount || parsed.employeeCount;
            lead.foundingYear = lead.foundingYear || parsed.foundingYear;
          }
        }
      } catch {}
    }

    enriched.push(lead);
    emit(emitter, { type: "lead_enriched", agent: 3, lead });
  }

  emit(emitter, { type: "agent_complete", agent: 3, label: "Deep Enrichment", count: enriched.length });
  return enriched;
}

// ─── Agent 4: Signal Intelligence ─────────────────────────────────────────────

async function agent4_signalIntelligence(
  leads: RawLead[],
  emitter: EventEmitter,
): Promise<RawLead[]> {
  emit(emitter, { type: "agent_start", agent: 4, label: "Signal Intelligence" });
  const signalled: RawLead[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = { ...leads[i] };
    emit(emitter, { type: "agent_progress", agent: 4, current: i + 1, total: leads.length });

    const name = lead.companyName || lead.domain || "";
    if (!name) { signalled.push(lead); continue; }

    try {
      // Scout full signals (news, sanctions, contracts, corporate events)
      const [fullSig, regSig] = await Promise.allSettled([
        scoutSignalsFull(name, { domain: lead.domain }),
        scoutSignalsRegulatory(name, {}),
      ]);

      if (fullSig.status === "fulfilled" && fullSig.value) {
        lead.signalData = { ...lead.signalData, full: fullSig.value };
        const sig = (fullSig.value as unknown) as Record<string, unknown>;
        const flags = (sig.negative_signals_count as number) || 0;
        if (flags > 0) emit(emitter, { type: "agent_log", agent: 4, message: `⚠ ${name}: ${flags} compliance flag(s)` });
      }

      if (regSig.status === "fulfilled" && regSig.value) {
        lead.signalData = { ...lead.signalData, regulatory: regSig.value };
      }

      // Buying signal classification
      const buyingSignals: string[] = [];
      const sig = (lead.signalData?.full as Record<string, unknown> | undefined) || {};
      if ((sig.news_recent as unknown[])?.length > 0) buyingSignals.push("recent_news");
      if ((sig.recent_contracts as unknown[])?.length > 0) buyingSignals.push("new_contracts");
      if ((sig.hiring_signals as Record<string, unknown>)?.active) buyingSignals.push("hiring");
      if ((sig as any)?.intent_signals?.score > 60) buyingSignals.push("intent");
      lead.enrichedData = { ...lead.enrichedData, buyingSignals };

      emit(emitter, { type: "agent_log", agent: 4, message: `Signals: ${name} — ${buyingSignals.join(", ") || "none"}` });
    } catch { /* continue */ }

    signalled.push(lead);
  }

  emit(emitter, { type: "agent_complete", agent: 4, label: "Signal Intelligence", count: signalled.length });
  return signalled;
}

// ─── Agent 5: Validate, Verify & Deduplicate ──────────────────────────────────

interface ValidationResult {
  status: "pass" | "warn" | "reject";
  reasons: string[];
  isDuplicate: boolean;
  duplicateOf?: string;
}

async function validateLead(lead: RawLead): Promise<ValidationResult> {
  const reasons: string[] = [];
  let status: "pass" | "warn" | "reject" = "pass";

  // ── Phone validation ──────────────────────────────────────────────────────
  if (lead.phone) {
    const p = normalisePhone(lead.phone);
    const isSaudiMobile = /^(05|9665|00966\s?5|966\s?5)\d{8}$/.test(p) || /^05\d{8}$/.test(p);
    const isSaudiLandline = /^(011|012|013|014|016|017|03|04|07)\d{7}$/.test(p) || /^966\s?1\d{8}$/.test(p);
    const isGCCMobile = /^(971|974|965|973|968|962|963|20|44|1)\d{7,12}$/.test(p);
    const isTooShort = p.replace(/\D/g, "").length < 7;
    const isPlaceholder = /^(0+|1234567|0501234567|0500000000|555\d{4,}|123456789)$/.test(p);
    const isSequential = /^(0123456789|9876543210|1111111111|2222222222|3333333333)/.test(p);

    if (isTooShort) { reasons.push("PHONE_TOO_SHORT"); status = "warn"; }
    else if (isPlaceholder || isSequential) { reasons.push("PHONE_PLACEHOLDER"); status = "warn"; }
    else if (!isSaudiMobile && !isSaudiLandline && !isGCCMobile) { reasons.push("PHONE_NON_GCC"); status = "warn"; }
  }

  // ── Email validation ─────────────────────────────────────────────────────
  if (lead.email) {
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(lead.email)) {
      reasons.push("EMAIL_INVALID_FORMAT"); status = "warn";
    } else {
      const [, domain] = lead.email.split("@");
      const blockedPrefixes = ["noreply", "no-reply", "donotreply", "mailer-daemon", "bounce"];
      const blockedDomains = ["test.com", "example.com", "placeholder.com", "dummy.com"];
      const genericPrefixes = ["info", "contact", "hello", "general", "admin", "support", "sales"];
      if (blockedPrefixes.some(p => lead.email!.toLowerCase().startsWith(p))) {
        reasons.push("EMAIL_NO_REPLY"); status = "warn";
      }
      if (blockedDomains.includes(domain)) {
        reasons.push("EMAIL_PLACEHOLDER_DOMAIN"); status = "reject";
      }
      if (genericPrefixes.some(p => lead.email!.toLowerCase().startsWith(p + "@"))) {
        reasons.push("EMAIL_GENERIC_ONLY");
        if (status === "pass") status = "warn";
      }
    }
  }

  // ── Company name validation ───────────────────────────────────────────────
  if (!lead.companyName || lead.companyName.trim().length < 3) {
    reasons.push("COMPANY_NAME_MISSING"); status = "reject";
  } else {
    const placeholderNames = ["company", "شركة", "test", "example", "sample", "lorem ipsum", "n/a", "null", "undefined"];
    if (placeholderNames.some(p => lead.companyName!.toLowerCase().trim() === p)) {
      reasons.push("COMPANY_NAME_PLACEHOLDER"); status = "reject";
    }
  }

  // ── CR number format validation ────────────────────────────────────────────
  if (lead.crNumber) {
    const cr = lead.crNumber.replace(/\D/g, "");
    if (cr.length !== 10 && (cr.length < 7 || cr.length > 12)) {
      reasons.push("CR_NUMBER_FORMAT_INVALID"); if (status === "pass") status = "warn";
    }
  }

  // ── Minimum data requirement ───────────────────────────────────────────────
  const hasContact = !!(lead.domain || lead.email || lead.phone || lead.crNumber || lead.linkedinUrl);
  if (!hasContact) {
    reasons.push("NO_CONTACT_DATA"); if (status === "pass") status = "warn";
  }

  // ── Description authenticity ──────────────────────────────────────────────
  if (lead.description) {
    const placeholderDesc = ["lorem ipsum", "company description", "we are a leading", "description goes here"];
    if (placeholderDesc.some(p => lead.description!.toLowerCase().includes(p))) {
      reasons.push("DESCRIPTION_PLACEHOLDER"); if (status === "pass") status = "warn";
    }
  }

  return { status, reasons, isDuplicate: false };
}

async function agent5_validateAndDeduplicate(
  leads: RawLead[],
  emitter: EventEmitter,
): Promise<Array<RawLead & ValidationResult>> {
  emit(emitter, { type: "agent_start", agent: 5, label: "Validate, Verify & Deduplicate" });

  // Load existing fingerprints from DB
  let existingFingerprints: { normalizedName?: string | null; domain?: string | null; phoneNormalized?: string | null; emailNormalized?: string | null; crNumber?: string | null }[] = [];
  try {
    existingFingerprints = await db.select().from(leadFingerprintsTable).limit(50000);
  } catch {}

  const processed: Array<RawLead & ValidationResult> = [];
  let passCount = 0, warnCount = 0, rejectCount = 0, dupCount = 0;

  for (let i = 0; i < leads.length; i++) {
    let lead = { ...leads[i] };
    emit(emitter, { type: "agent_progress", agent: 5, current: i + 1, total: leads.length });

    // ── Email trust gate: clear AI-guessed emails (not scraped from real source) ─
    if (lead.email && !lead.emailTrusted) {
      emit(emitter, { type: "agent_log", agent: 5, message: `Email excluded (unverified AI source): ${lead.companyName || lead.domain}` });
      lead = { ...lead, email: undefined };
    }

    const validation = await validateLead(lead);

    // Deduplication check
    if (validation.status !== "reject") {
      const domainKey = lead.domain?.toLowerCase();
      const crKey = lead.crNumber?.replace(/\D/g, "");
      const phoneKey = lead.phone ? normalisePhone(lead.phone) : "";
      const emailKey = lead.email?.toLowerCase();
      const nameKey = lead.companyName ? normaliseName(lead.companyName) : "";

      for (const fp of existingFingerprints) {
        let isDup = false;
        let dupKey = "";
        if (domainKey && fp.domain && domainKey === fp.domain) { isDup = true; dupKey = domainKey; }
        else if (crKey && fp.crNumber && crKey === fp.crNumber) { isDup = true; dupKey = crKey; }
        else if (phoneKey && fp.phoneNormalized && phoneKey === fp.phoneNormalized) { isDup = true; dupKey = phoneKey; }
        else if (emailKey && fp.emailNormalized && emailKey === fp.emailNormalized) { isDup = true; dupKey = emailKey; }
        else if (nameKey && fp.normalizedName && nameSimilarity(nameKey, fp.normalizedName) >= 0.88) { isDup = true; dupKey = nameKey; }

        if (isDup) {
          validation.isDuplicate = true;
          validation.duplicateOf = dupKey;
          validation.reasons.push("DUPLICATE_EXISTS");
          validation.status = "warn";
          dupCount++;
          break;
        }
      }

      // Add to in-memory fingerprint set to catch intra-batch dups
      existingFingerprints.push({
        normalizedName: nameKey || null,
        domain: domainKey || null,
        phoneNormalized: phoneKey || null,
        emailNormalized: emailKey || null,
        crNumber: crKey || null,
      });
    }

    if (validation.status === "pass") passCount++;
    else if (validation.status === "warn") warnCount++;
    else rejectCount++;

    processed.push({ ...lead, ...validation });

    // ── Active verification layer (DNS/MX, domain liveness, dummy detection,
    //    cross-source corroboration). Augments validation but doesn't override
    //    a clean PASS unless a hard failure is detected.
    if (validation.status !== "reject") {
      try {
        const signals = await verifyLead({
          companyName: lead.companyName,
          domain: lead.domain,
          email: lead.email,
          phone: lead.phone,
          crNumber: lead.crNumber,
          sourceUsed: lead.sourceUsed,
          rawData: lead.rawData as { sourcesAggregated?: string[] } | undefined,
        });
        // Persist signals into validation.reasons so downstream agents see them
        for (const n of signals.notes) validation.reasons.push(n);
        // Hard reject when the row looks dummy
        if (signals.appearsDummy) {
          validation.status = "reject";
          validation.reasons.push("DUMMY_DETECTED");
          rejectCount++; passCount = Math.max(0, passCount - (validation.status === "pass" ? 1 : 0));
        } else if (signals.confidence < 35) {
          // Low confidence → downgrade to warn
          if (validation.status === "pass") { validation.status = "warn"; passCount--; warnCount++; }
          validation.reasons.push(`LOW_CONFIDENCE:${signals.confidence}`);
        }
      } catch {
        /* validator failure should never break the pipeline */
      }
    }

    if (validation.status === "reject") {
      emit(emitter, { type: "lead_rejected", agent: 5, companyName: lead.companyName, reasons: validation.reasons });
    } else {
      emit(emitter, { type: "agent_log", agent: 5, message: `${validation.status.toUpperCase()}: ${lead.companyName || lead.domain} ${validation.reasons.length ? `(${validation.reasons.join(", ")})` : "✓"}` });
    }
  }

  emit(emitter, { type: "agent_log", agent: 5, message: `Validation summary — PASS: ${passCount} | WARN: ${warnCount} | REJECT: ${rejectCount} | DUPES: ${dupCount}` });
  emit(emitter, { type: "agent_complete", agent: 5, label: "Validate, Verify & Deduplicate", count: passCount + warnCount });
  return processed.filter(l => l.status !== "reject");
}

// ─── Agent 6: ICP Scoring + AI Copywriter ─────────────────────────────────────

interface ScoredLead extends RawLead {
  status: "pass" | "warn" | "reject";
  reasons: string[];
  isDuplicate: boolean;
  duplicateOf?: string;
  icpScore: number;
  priorityTier: string;
  buyingScore: number;
  riskScore: number;
  qualityScore: number;
  outreachEmail?: string;
  outreachLinkedin?: string;
  outreachWhatsapp?: string;
  openingAngle?: string;
  culturalNote?: string;
  conversationHook?: string;
}

async function agent6_scoreAndCopywrite(
  leads: Array<RawLead & ValidationResult>,
  brief: LeadFactoryBrief,
  emitter: EventEmitter,
): Promise<ScoredLead[]> {
  emit(emitter, { type: "agent_start", agent: 6, label: "ICP Scoring + AI Copywriter" });
  const scored: ScoredLead[] = [];

  const targetIndustries = (brief.industries || []).map(i => i.toLowerCase());
  const targetCities = (brief.cities || []).map(c => c.toLowerCase());
  const targetSizes = brief.companySizes || [];
  const targetSignals = brief.prioritySignals || [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    emit(emitter, { type: "agent_progress", agent: 6, current: i + 1, total: leads.length });

    // ── ICP Scoring (100 pts) ────────────────────────────────────────────────
    let score = 0;

    // Industry match (25 pts)
    if (targetIndustries.length === 0) score += 20;
    else if (lead.industry && targetIndustries.some(i => (lead.industry || "").toLowerCase().includes(i))) score += 25;
    else if (lead.description && targetIndustries.some(i => (lead.description || "").toLowerCase().includes(i))) score += 15;

    // Geography match (15 pts)
    if (targetCities.length === 0) score += 12;
    else if (lead.city && targetCities.some(c => (lead.city || "").toLowerCase().includes(c))) score += 15;
    else if ((lead.region || "").toLowerCase().includes("saudi") || (lead.country || "").toLowerCase().includes("sa")) score += 8;

    // Company size match (20 pts)
    if (targetSizes.length === 0) score += 16;
    else if (lead.employeeCount && targetSizes.some(s => {
      if (s === "1-50") return ["1-50", "startup", "micro"].some(k => (lead.employeeCount || "").includes(k));
      if (s === "51-200") return ["51-200", "small"].some(k => (lead.employeeCount || "").includes(k));
      if (s === "201-1000") return ["201-1000", "mid", "medium"].some(k => (lead.employeeCount || "").includes(k));
      if (s === "1000+") return ["1000+", "large", "enterprise"].some(k => (lead.employeeCount || "").includes(k));
      return false;
    })) score += 20;
    else score += 10;

    // Buying signal score (25 pts)
    const buyingSignals: string[] = (lead.enrichedData as Record<string, unknown>)?.buyingSignals as string[] || [];
    let buyingScore = 0;
    if (buyingSignals.includes("recent_news")) buyingScore += 10;
    if (buyingSignals.includes("new_contracts")) buyingScore += 15;
    if (buyingSignals.includes("hiring")) buyingScore += 10;
    if (buyingSignals.includes("intent")) buyingScore += 15;
    if (targetSignals.some(s => buyingSignals.includes(s))) buyingScore += 10;
    score += Math.min(25, buyingScore);

    // Contact completeness (15 pts)
    let contactScore = 0;
    if (lead.email) contactScore += 4;
    if (lead.phone) contactScore += 4;
    if (lead.domain) contactScore += 3;
    if (lead.linkedinUrl) contactScore += 2;
    if (lead.crNumber) contactScore += 2;
    score += contactScore;

    // Penalty for data quality issues
    if (lead.reasons?.includes("PHONE_NON_GCC")) score -= 5;
    if (lead.reasons?.includes("EMAIL_GENERIC_ONLY")) score -= 3;
    if (lead.isDuplicate) score -= 10;

    score = Math.max(0, Math.min(100, score));
    const tier = score >= 75 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "D";

    // Risk score from compliance signals
    const regData = (lead.signalData as Record<string, unknown>)?.regulatory as Record<string, unknown>;
    const fullData = (lead.signalData as Record<string, unknown>)?.full as Record<string, unknown>;
    let riskScore = 0;
    if (((regData?.summary as any)?.total_flags ?? 0) > 0) riskScore += 40;
    if ((fullData?.red_flags_count as number) > 0) riskScore += 30;
    if (lead.isDuplicate) riskScore += 10;
    riskScore = Math.min(100, riskScore);

    // Quality score
    const qualityScore = (contactScore / 15) * 40 + (score / 100) * 60;

    // ── AI Outreach Copy (Gemini) ────────────────────────────────────────────
    let outreachEmail = "";
    let outreachLinkedin = "";
    let outreachWhatsapp = "";
    let openingAngle = "";
    let culturalNote = "";
    let conversationHook = "";

    if (tier !== "D") {
      try {
        const signals = buyingSignals.join(", ") || "market presence";
        const copyPrompt = `You are a Saudi B2B outreach expert. Write personalised outreach for this company.

COMPANY: ${lead.companyName} (${lead.companyNameAr || ""})
Industry: ${lead.industry || "N/A"} | City: ${lead.city || "Saudi Arabia"} | Size: ${lead.employeeCount || "unknown"}
Recent signals: ${signals}
ICP brief: ${brief.icpDescription || (brief.industries || []).join(", ")}

Generate JSON with these exact keys:
{
  "outreachEmail": "Subject: [compelling subject]\\n\\n[3-4 paragraph personalised email. Reference Saudi Vision 2030 context. Bilingual closing: regards/مع التحية. Max 200 words]",
  "outreachLinkedin": "[1-2 sentence connection request. Mention specific signal or industry context. Max 50 words]",
  "outreachWhatsapp": "[Warm WhatsApp intro. Arabic greeting مرحباً. Business context. Max 80 words]",
  "openingAngle": "[One sentence: the strongest reason to reach out to this specific company right now]",
  "culturalNote": "[One sentence: Saudi business culture tip for this specific company/sector]",
  "conversationHook": "[One question to open a business conversation that shows intelligence about their situation]"
}`;

        const raw = await nexusSynthCall(copyPrompt, "Output only valid JSON. No markdown.");
        const copy = await parseJsonFromGemini(raw, {}) as Record<string, string>;
        if (copy) {
          outreachEmail = copy.outreachEmail || "";
          outreachLinkedin = copy.outreachLinkedin || "";
          outreachWhatsapp = copy.outreachWhatsapp || "";
          openingAngle = copy.openingAngle || "";
          culturalNote = copy.culturalNote || "";
          conversationHook = copy.conversationHook || "";
        }
      } catch {}
    }

    const scoredLead: ScoredLead = {
      ...lead,
      icpScore: score,
      priorityTier: tier,
      buyingScore: Math.min(100, buyingScore),
      riskScore,
      qualityScore,
      outreachEmail,
      outreachLinkedin,
      outreachWhatsapp,
      openingAngle,
      culturalNote,
      conversationHook,
    };

    scored.push(scoredLead);
    emit(emitter, { type: "lead_scored", agent: 6, lead: { ...scoredLead, icpScore: score, tier } });
    emit(emitter, { type: "agent_log", agent: 6, message: `Scored: ${lead.companyName} → Tier ${tier} (${score}/100)` });
  }

  // Sort by ICP score descending
  scored.sort((a, b) => b.icpScore - a.icpScore);

  emit(emitter, { type: "agent_complete", agent: 6, label: "ICP Scoring + AI Copywriter", count: scored.length });
  return scored;
}

// ─── Agent 7: Publish & Seed ──────────────────────────────────────────────────

async function agent7_publishAndSeed(
  leads: ScoredLead[],
  jobDbId: number,
  emitter: EventEmitter,
): Promise<{ published: number; companies: PublishedCompany[] }> {
  emit(emitter, { type: "agent_start", agent: 7, label: "Publish & Seed" });
  let published = 0;
  const publishedCompanies: PublishedCompany[] = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    emit(emitter, { type: "agent_progress", agent: 7, current: i + 1, total: leads.length });

    try {
      // Insert into lead_factory_results
      const [result] = await db.insert(leadFactoryResultsTable).values({
        jobId: jobDbId,
        companyName: lead.companyName,
        companyNameAr: lead.companyNameAr,
        domain: lead.domain,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        region: lead.region,
        industry: lead.industry,
        employeeCount: lead.employeeCount,
        revenue: lead.revenue,
        crNumber: lead.crNumber,
        entityType: lead.entityType,
        foundingYear: lead.foundingYear,
        description: lead.description,
        logoUrl: lead.logoUrl,
        linkedinUrl: lead.linkedinUrl,
        sourceUsed: lead.sourceUsed,
        rawData: lead.rawData as Record<string, unknown>,
        enrichedData: lead.enrichedData as Record<string, unknown>,
        signalData: lead.signalData as Record<string, unknown>,
        icpScore: lead.icpScore,
        priorityTier: lead.priorityTier,
        buyingScore: lead.buyingScore,
        riskScore: lead.riskScore,
        qualityScore: lead.qualityScore,
        validationStatus: lead.status,
        validationReasons: lead.reasons as string[],
        isDuplicate: lead.isDuplicate,
        duplicateOf: lead.duplicateOf,
        outreachEmail: lead.outreachEmail,
        outreachLinkedin: lead.outreachLinkedin,
        outreachWhatsapp: lead.outreachWhatsapp,
        openingAngle: lead.openingAngle,
        culturalNote: lead.culturalNote,
        conversationHook: lead.conversationHook,
      }).returning({ id: leadFactoryResultsTable.id });

      // Seed into leads table for A and B tier, non-duplicate
      let publishedLeadId: number | undefined;
      let publishedCompanyId: number | undefined;
      if (["A", "B"].includes(lead.priorityTier) && !lead.isDuplicate) {
        try {
          const [newLead] = await db.insert(leadsTable).values({
            email: lead.email || undefined,
            phone: lead.phone || undefined,
            linkedinUrl: lead.linkedinUrl || undefined,
            status: lead.priorityTier === "A" ? "hot" : "warm",
            notes: [
              lead.companyName ? `Company: ${lead.companyName}` : "",
              lead.description || "",
              lead.openingAngle ? `Opening angle: ${lead.openingAngle}` : "",
            ].filter(Boolean).join("\n"),
          }).returning({ id: leadsTable.id });
          publishedLeadId = newLead.id;
        } catch {}

        // Bridge into the unified `companies` pool so every other engine
        // (Signals, Company Intel, Relationship Intel, MeshBase) sees the
        // newly harvested company. Match by domain first, then by CR number,
        // then by normalised English name. Upsert — never duplicate.
        try {
          publishedCompanyId = await upsertCompanyFromLead(lead);
          if (publishedCompanyId) {
            await upsertExecutivesFromLead(lead, publishedCompanyId);
            publishedCompanies.push({
              companyId: publishedCompanyId,
              companyName: lead.companyName || "",
              companyNameAr: lead.companyNameAr,
              domain: lead.domain,
              crNumber: lead.crNumber,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emit(emitter, { type: "agent_log", agent: 7, message: `⚠ Pool bridge failed for ${lead.companyName}: ${msg}` });
        }
      }

      // Update result with published IDs
      if (publishedLeadId || publishedCompanyId) {
        await db.update(leadFactoryResultsTable)
          .set({
            ...(publishedLeadId ? { publishedLeadId } : {}),
            ...(publishedCompanyId ? { publishedCompanyId } : {}),
          })
          .where(eq(leadFactoryResultsTable.id, result.id));
      }

      // Write fingerprint
      if (lead.companyName || lead.domain || lead.crNumber) {
        await db.insert(leadFingerprintsTable).values({
          normalizedName: lead.companyName ? normaliseName(lead.companyName) : null,
          domain: lead.domain?.toLowerCase() || null,
          phoneNormalized: lead.phone ? normalisePhone(lead.phone) : null,
          emailNormalized: lead.email?.toLowerCase() || null,
          crNumber: lead.crNumber?.replace(/\D/g, "") || null,
          sourceTable: "lead_factory_results",
          sourceId: result.id,
        }).onConflictDoNothing();
      }

      published++;
      emit(emitter, { type: "lead_published", agent: 7, resultId: result.id, companyName: lead.companyName, tier: lead.priorityTier });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(emitter, { type: "agent_log", agent: 7, message: `⚠ Failed to publish ${lead.companyName}: ${msg}` });
    }
  }

  emit(emitter, { type: "agent_complete", agent: 7, label: "Publish & Seed", count: published });
  return { published, companies: publishedCompanies };
}

// ─── Companies/Executives Bridge Helpers ──────────────────────────────────────

/**
 * Upsert a published lead into the unified `companies` table.
 * Match priority: domain → CR number → English name (case-insensitive).
 * Returns the resulting companies.id, or undefined if nothing identifying
 * was available.
 */
async function upsertCompanyFromLead(lead: ScoredLead): Promise<number | undefined> {
  const domain = lead.domain?.toLowerCase()?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cr = lead.crNumber?.replace(/\D/g, "");
  const name = lead.companyName?.trim();
  if (!domain && !cr && !name) return undefined;

  // Try to find an existing row
  let existing: { id: number } | undefined;
  if (domain) {
    const rows = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(ilike(companiesTable.website, `%${domain}%`))
      .limit(1);
    existing = rows[0];
  }
  if (!existing && cr) {
    const rows = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.crNumber, cr))
      .limit(1);
    existing = rows[0];
  }
  if (!existing && name) {
    const rows = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(ilike(companiesTable.nameEn, name))
      .limit(1);
    existing = rows[0];
  }

  const values = {
    nameEn: name || null,
    nameAr: lead.companyNameAr || null,
    industry: lead.industry || null,
    city: lead.city || null,
    region: lead.region || null,
    website: lead.domain || null,
    phone: lead.phone || null,
    email: lead.email || null,
    description: lead.description || null,
    employeeCount: lead.employeeCount || null,
    revenue: lead.revenue || null,
    foundingYear: lead.foundingYear ? parseInt(lead.foundingYear, 10) || null : null,
    crNumber: cr || null,
    entityType: lead.entityType || null,
    logoUrl: lead.logoUrl || null,
    linkedinUrl: lead.linkedinUrl || null,
    enrichmentScore: lead.icpScore ?? null,
    enrichmentStatus: lead.enrichedData ? "enriched" : "pending",
    dataSource: "lead-factory",
  };

  if (existing) {
    // Update only fields we now have that aren't null; never overwrite with null
    const updateValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== null && v !== undefined) updateValues[k] = v;
    }
    if (Object.keys(updateValues).length > 0) {
      await db.update(companiesTable)
        .set(updateValues)
        .where(eq(companiesTable.id, existing.id));
    }
    return existing.id;
  }

  const [row] = await db.insert(companiesTable).values(values).returning({ id: companiesTable.id });
  return row.id;
}

/**
 * Attach any executive contacts present on the lead into the unified
 * `executives` table. Dedupes by (companyId + name). Best-effort.
 */
async function upsertExecutivesFromLead(lead: ScoredLead, companyId: number): Promise<void> {
  // Lead Factory may carry contacts inside enrichedData.executives or
  // enrichedData.contacts (shape varies by source). Pull both.
  const enriched = (lead.enrichedData as Record<string, unknown>) || {};
  const raw = (enriched.executives ?? enriched.contacts ?? []) as unknown;
  if (!Array.isArray(raw)) return;

  for (const exec of raw) {
    if (!exec || typeof exec !== "object") continue;
    const e = exec as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : undefined;
    if (!name) continue;

    // Skip if (companyId + name) already present
    const existing = await db.select({ id: executivesTable.id })
      .from(executivesTable)
      .where(and(eq(executivesTable.companyId, companyId), ilike(executivesTable.name, name)))
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(executivesTable).values({
      companyId,
      companyName: lead.companyName,
      name,
      nameAr: typeof e.nameAr === "string" ? e.nameAr : undefined,
      position: typeof e.position === "string" ? e.position : typeof e.title === "string" ? e.title : undefined,
      email: typeof e.email === "string" ? e.email : undefined,
      phone: typeof e.phone === "string" ? e.phone : undefined,
      linkedin: typeof e.linkedin === "string" ? e.linkedin : typeof e.linkedinUrl === "string" ? e.linkedinUrl : undefined,
      seniorityLevel: typeof e.seniority === "string" ? e.seniority : undefined,
      department: typeof e.department === "string" ? e.department : undefined,
      enrichmentStatus: "pending",
      dataSource: "lead-factory",
    }).catch(() => { /* best-effort */ });
  }
}

/**
 * Re-publish results from a previously-completed Lead Factory job into the
 * unified `companies`/`executives` pool. Idempotent — skips rows that already
 * carry a `publishedCompanyId`. Optionally seeds downstream (Signals +
 * Relationship/Network Intel).
 *
 * Backs the manual `POST /api/lead-factory/results/:jobId/publish` route.
 */
export async function publishExistingResults(
  jobDbId: number,
  opts: { autoEnrichDownstream?: boolean } = {},
): Promise<{ seededToPool: number; alreadyPublished: number; downstreamTriggered: boolean }> {
  const rows = await db.select().from(leadFactoryResultsTable).where(eq(leadFactoryResultsTable.jobId, jobDbId));

  let seededToPool = 0;
  let alreadyPublished = 0;
  const fresh: PublishedCompany[] = [];

  for (const r of rows) {
    if (r.publishedCompanyId) { alreadyPublished++; continue; }
    if (!["A", "B"].includes(r.priorityTier || "")) continue;
    if (r.isDuplicate) continue;

    // Reconstruct just the fields upsertCompanyFromLead reads.
    const synthetic: ScoredLead = {
      companyName: r.companyName || "",
      companyNameAr: r.companyNameAr || undefined,
      domain: r.domain || undefined,
      phone: r.phone || undefined,
      email: r.email || undefined,
      city: r.city || undefined,
      region: r.region || undefined,
      industry: r.industry || undefined,
      employeeCount: r.employeeCount || undefined,
      revenue: r.revenue || undefined,
      crNumber: r.crNumber || undefined,
      entityType: r.entityType || undefined,
      foundingYear: r.foundingYear || undefined,
      description: r.description || undefined,
      logoUrl: r.logoUrl || undefined,
      linkedinUrl: r.linkedinUrl || undefined,
      icpScore: r.icpScore ?? 0,
      priorityTier: (r.priorityTier as "A" | "B" | "C" | "D") || "C",
      buyingScore: r.buyingScore ?? 0,
      riskScore: r.riskScore ?? 0,
      qualityScore: r.qualityScore ?? 0,
      status: (r.validationStatus as ScoredLead["status"]) || "validated",
      reasons: (r.validationReasons as string[]) || [],
      isDuplicate: r.isDuplicate ?? false,
      duplicateOf: r.duplicateOf || undefined,
      enrichedData: (r.enrichedData as Record<string, unknown>) || undefined,
    } as ScoredLead;

    try {
      const companyId = await upsertCompanyFromLead(synthetic);
      if (!companyId) continue;
      await upsertExecutivesFromLead(synthetic, companyId);
      await db.update(leadFactoryResultsTable)
        .set({ publishedCompanyId: companyId })
        .where(eq(leadFactoryResultsTable.id, r.id));
      fresh.push({
        companyId,
        companyName: synthetic.companyName ?? "",
        companyNameAr: synthetic.companyNameAr,
        domain: synthetic.domain,
        crNumber: synthetic.crNumber,
      });
      seededToPool++;
    } catch { /* best-effort */ }
  }

  if (opts.autoEnrichDownstream && fresh.length > 0) {
    // Best-effort, in-process. No emitter — callers can poll signals/network.
    for (const c of fresh) {
      scanCompanySignals({
        companyName: c.companyName,
        companyNameAr: c.companyNameAr,
        companyId: c.companyId,
        domain: c.domain,
        runLlmClassification: true,
        saveToDB: true,
      }).catch(() => {});
      const relJobId = createRelationshipIntelJob();
      runRelationshipIntelPipeline(relJobId, {
        targetCompanyName: c.companyName,
        targetCompanyNameAr: c.companyNameAr,
        targetCrNumber: c.crNumber,
        targetWebsite: c.domain,
      }).catch(() => {});
    }
  }

  return {
    seededToPool,
    alreadyPublished,
    downstreamTriggered: !!opts.autoEnrichDownstream && fresh.length > 0,
  };
}

/**
 * Fire-and-forget Signals + Relationship/Network Intel for each newly-published
 * company. Best-effort: failures emit a log but never break the pipeline.
 */
async function seedDownstreamForCompanies(
  companies: PublishedCompany[],
  emitter: EventEmitter,
): Promise<void> {
  if (companies.length === 0) return;
  emit(emitter, { type: "agent_log", agent: 7, message: `▶ Seeding downstream for ${companies.length} companies (signals + network)` });

  for (const c of companies) {
    // Signals — writes to company_signals table, joined by domain
    scanCompanySignals({
      companyName: c.companyName,
      companyNameAr: c.companyNameAr,
      companyId: c.companyId,
      domain: c.domain,
      runLlmClassification: true,
      saveToDB: true,
    }).then(() => {
      emit(emitter, { type: "agent_log", agent: 7, message: `✓ Signals seeded for ${c.companyName}` });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      emit(emitter, { type: "agent_log", agent: 7, message: `⚠ Signals failed for ${c.companyName}: ${msg}` });
    });

    // Network / Relationship Intel — org chart + connections
    const relJobId = createRelationshipIntelJob();
    runRelationshipIntelPipeline(relJobId, {
      targetCompanyName: c.companyName,
      targetCompanyNameAr: c.companyNameAr,
      targetCrNumber: c.crNumber,
      targetWebsite: c.domain,
    }).then(() => {
      emit(emitter, { type: "agent_log", agent: 7, message: `✓ Network intel seeded for ${c.companyName}` });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      emit(emitter, { type: "agent_log", agent: 7, message: `⚠ Network intel failed for ${c.companyName}: ${msg}` });
    });
  }
}

// ─── Pipeline Orchestrator ────────────────────────────────────────────────────

export async function runLeadFactoryPipeline(
  jobId: string,
  brief: LeadFactoryBrief,
): Promise<void> {
  const emitter = jobEmitters.get(jobId);
  if (!emitter) return;

  // Heartbeat
  const heartbeat = setInterval(() => emit(emitter, { type: "heartbeat" }), 15000);

  // Create DB job record
  let jobDbId = 0;
  try {
    const [row] = await db.insert(leadFactoryJobsTable).values({
      status: "running",
      inputMode: brief.inputMode,
      brief: brief as unknown as Record<string, unknown>,
      targetCount: brief.targetCount || 50,
      agentProgress: {},
    }).returning({ id: leadFactoryJobsTable.id });
    jobDbId = row.id;
  } catch {}

  try {
    // Agent 1
    const { sourcePlan, searchQueries } = await agent1_mapICP(brief, emitter);

    // Agent 2
    const raw = await agent2_harvestLeads(brief, sourcePlan, searchQueries, emitter);
    if (jobDbId) await db.update(leadFactoryJobsTable).set({ totalDiscovered: raw.length }).where(eq(leadFactoryJobsTable.id, jobDbId));

    // Agent 3
    const enriched = await agent3_enrichLeads(raw, brief, emitter);
    if (jobDbId) await db.update(leadFactoryJobsTable).set({ totalEnriched: enriched.length }).where(eq(leadFactoryJobsTable.id, jobDbId));

    // Agent 4
    const signalled = await agent4_signalIntelligence(enriched, emitter);

    // Agent 5
    const validated = await agent5_validateAndDeduplicate(signalled, emitter);
    if (jobDbId) await db.update(leadFactoryJobsTable).set({ totalValidated: validated.length, totalRejected: raw.length - validated.length }).where(eq(leadFactoryJobsTable.id, jobDbId));

    // Agent 6
    const scored = await agent6_scoreAndCopywrite(validated, brief, emitter);

    // Agent 7
    const { published, companies: publishedCompanies } = await agent7_publishAndSeed(scored, jobDbId, emitter);
    if (jobDbId) await db.update(leadFactoryJobsTable).set({ totalPublished: published, status: "completed", completedAt: new Date() }).where(eq(leadFactoryJobsTable.id, jobDbId));

    emit(emitter, {
      type: "pipeline_complete",
      totalPublished: published,
      totalRejected: raw.length - published,
      jobId: jobDbId!,
    });

    // Optional downstream seeding (Signals + Network/Relationship Intel).
    // Fire-and-forget — never blocks the pipeline_complete event.
    if (brief.autoEnrichDownstream) {
      seedDownstreamForCompanies(publishedCompanies, emitter).catch(() => {});
    }

    // Layer 6 — Activepieces automation trigger (non-blocking)
    const tierBreakdown: Record<string, number> = {};
    for (const s of scored) {
      const t = (s as { priorityTier?: string }).priorityTier || "D";
      tierBreakdown[t] = (tierBreakdown[t] || 0) + 1;
    }
    onLeadFactoryComplete({
      jobId: String(jobDbId || jobId),
      totalPublished: published,
      totalRejected: raw.length - published,
      tierBreakdown,
      brief: brief as unknown as Record<string, unknown>,
      sampleLeads: (scored as Array<{ companyName?: string; icpScore?: number; priorityTier?: string; industry?: string; city?: string }>).slice(0, 5).map(l => ({
        companyName: l.companyName,
        icpScore: l.icpScore,
        priorityTier: l.priorityTier,
        industry: l.industry,
        city: l.city,
      })),
    }).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobDbId) await db.update(leadFactoryJobsTable).set({ status: "failed", errorMessage: msg }).where(eq(leadFactoryJobsTable.id, jobDbId));
    emit(emitter, { type: "agent_error", agent: 0, message: `Pipeline failed: ${msg}` });
  } finally {
    clearInterval(heartbeat);
    emitter.emit("done");
  }
}
