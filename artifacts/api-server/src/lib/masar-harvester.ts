/**
 * Masar AI Agentic Harvester
 * ─────────────────────────────────────────────────────────────
 * Two harvester agents:
 *   1. harvestFromOpenData  — queries data.gov.sa CKAN API
 *   2. harvestFromAmaaly    — stealth-scrapes emagazine.aamaly.sa AOA PDFs
 *
 * After raw seeding, enrichMasarCompany runs Crawl4AI + Perplexity + GPT-4o
 * synthesis + Claude bilingual analysis.
 *
 * CRITICAL: Never writes to companiesTable.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import axios from "axios";
import * as cheerio from "cheerio";
import { lazyAnthropic } from "./llm-clients.js";
import { openai as sharedOpenai } from "./openai.js";
import { db } from "@workspace/db";
import { masarCompaniesTable, masarHarvestJobsTable } from "@workspace/db/schema";
import { eq, or, sql } from "drizzle-orm";
import { StealthBrowser, autoSolveCaptcha, HumanBehavior } from "./stealth-browser.js";
import { crawl4ai } from "../crawl4ai-engine.js";
import { perplexity, PerplexityService } from "../perplexity-service.js";
import { isBlocked } from "./blocklist.js";
import { getPageContent } from "../browser-helper.js";
import { extractCompaniesWithGemini, isGeminiConfigured, searchWithGemini } from "../gemini-search.js";
import { harvestFromDirectory, type DirectorySource, DIRECTORY_SOURCE_LABELS } from "./mooresrowland-scraper.js";
import { harvestOpenCorporatesSA, harvestGleifSA, harvestWikidataSA } from "./free-sources.js";
import { onBuilderComplete } from "./activepieces-client.js";
import { runWebSeeder } from "./web-seeder.js";
import { scrapePage } from "./power-scraper.js";
// Plain intermediate type used for data gathering before DB upsert
interface CompanyData {
  nameEn?: string | null;
  nameAr?: string | null;
  crNumber?: string | null;
  legalForm?: string | null;
  legalFormAr?: string | null;
  city?: string | null;
  cityAr?: string | null;
  region?: string | null;
  paidUpCapital?: string | null;
  authorizedCapital?: string | null;
  foundingDate?: string | null;
  foundingYear?: string | null;
  registrationDate?: string | null;
  expiryDate?: string | null;
  authorizedSignatory?: string | null;
  shareholders?: Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>;
  boardOfDirectors?: Array<{ nameEn: string; nameAr: string; role: string; nationalId?: string }>;
  management?: Array<{ nameEn: string; nameAr: string; title: string; nationalId?: string; powers?: string }>;
  mainActivity?: string | null;
  mainActivityAr?: string | null;
  registrationStatus?: string | null;
  source?: string;
  sourceUrl?: string | null;
  enrichmentStatus?: string | null;
  capitalDistribution?: string | null;
  profitDistributionRules?: string | null;
  revenueEstimate?: string | null;
  revenueRationale?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  employeeCount?: string | null;
  newsHeadlines?: Array<{ title: string; date: string; source?: string }>;
  enrichmentData?: Record<string, unknown>;
  analysisEn?: string | null;
  analysisAr?: string | null;
  analysisData?: Record<string, unknown>;
}

const anthropic = lazyAnthropic("Masar harvester");
const openai = sharedOpenai;

// ─── Job Registry ──────────────────────────────────────────────────────────

import { JobRegistry } from "./job-registry.js";

const registry = new JobRegistry({ idPrefix: "mh", maxEntries: 50, maxListeners: 10 });
const harvestJobs = registry; // legacy alias for internal .get() / .set() calls below

export interface HarvestOptions {
  companyName?: string;
  keyword?: string;
  sector?: string;
  instructions?: string;
  parameters?: { city?: string; legalForm?: string; size?: string; revenue?: string };
}

// Per-job context so AI generation functions can read user instructions/constraints
const harvestContexts = new Map<string, HarvestOptions>();

function getHarvestContext(jobId: string): HarvestOptions {
  return harvestContexts.get(jobId) || {};
}

function buildContextConstraints(ctx: HarvestOptions): string {
  const parts: string[] = [];
  if (ctx.companyName) parts.push(`Company name focus: "${ctx.companyName}"`);
  if (ctx.sector) parts.push(`Sector: ${ctx.sector}`);
  if (ctx.parameters?.city) parts.push(`City/Region: ${ctx.parameters.city}`);
  if (ctx.parameters?.legalForm) parts.push(`Legal form: ${ctx.parameters.legalForm}`);
  if (ctx.parameters?.size) parts.push(`Company size: ${ctx.parameters.size}`);
  if (ctx.parameters?.revenue) parts.push(`Revenue range: ${ctx.parameters.revenue}`);
  if (ctx.instructions) parts.push(`\nUSER INSTRUCTIONS: ${ctx.instructions}`);
  return parts.length > 0 ? `\n\n--- HARVEST CONSTRAINTS ---\n${parts.join("\n")}\n--- END CONSTRAINTS ---` : "";
}

export function getHarvestEmitter(jobId: string): EventEmitter | undefined {
  return registry.get(jobId);
}

export function createHarvestJob(jobId: string): EventEmitter {
  return registry.attach(jobId);
}

/** Cancel an in-flight Masar harvest job. */
export function cancelHarvestJob(jobId: string): boolean {
  return registry.cancel(jobId);
}

// ─── Emitter helpers ───────────────────────────────────────────────────────

function emit(emitter: EventEmitter, event: HarvestEvent) {
  emitter?.emit("event", event);
}

function log(emitter: EventEmitter, message: string, level: "info" | "success" | "warn" | "error" = "info") {
  emit(emitter, { type: "log", message, level });
}

export interface HarvestEvent {
  type: "log" | "company_found" | "company_enriched" | "progress" | "complete" | "error";
  message?: string;
  level?: "info" | "success" | "warn" | "error";
  company?: CompanyData;
  count?: number;
  total?: number;
  error?: string;
}

// ─── Util ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function upsertMasarCompany(data: CompanyData): Promise<number | null> {
  if (!data.nameEn && !data.nameAr) return null;
  // Respect the deletion blocklist — never re-seed a company the user deleted
  if (await isBlocked({ nameEn: data.nameEn, nameAr: data.nameAr, crNumber: data.crNumber, website: data.website })) {
    console.log(`[MasarHarvester] Skipping blocked company: ${data.nameEn || data.nameAr}`);
    return null;
  }
  try {
    const values = {
      nameEn: data.nameEn || null,
      nameAr: data.nameAr || null,
      crNumber: data.crNumber || null,
      legalForm: data.legalForm || null,
      legalFormAr: data.legalFormAr || null,
      city: data.city || null,
      cityAr: data.cityAr || null,
      region: data.region || null,
      paidUpCapital: data.paidUpCapital || null,
      authorizedCapital: data.authorizedCapital || null,
      foundingDate: data.foundingDate || null,
      foundingYear: data.foundingYear || null,
      registrationDate: data.registrationDate || null,
      authorizedSignatory: data.authorizedSignatory || null,
      shareholders: data.shareholders || [],
      boardOfDirectors: data.boardOfDirectors || [],
      management: data.management || [],
      mainActivity: data.mainActivity || null,
      mainActivityAr: data.mainActivityAr || null,
      registrationStatus: data.registrationStatus || null,
      source: data.source || "open-data",
      sourceUrl: data.sourceUrl || null,
      enrichmentStatus: "pending",
      capitalDistribution: data.capitalDistribution || null,
      profitDistributionRules: data.profitDistributionRules || null,
    } as unknown as typeof masarCompaniesTable.$inferInsert;

    // When CR number is present, use DB-level conflict resolution on the unique index
    if (data.crNumber) {
      const inserted = await db
        .insert(masarCompaniesTable)
        .values(values)
        .onConflictDoUpdate({
          target: masarCompaniesTable.crNumber,
          set: {
            nameEn: sql`COALESCE(EXCLUDED.name_en, masar_companies.name_en)`,
            nameAr: sql`COALESCE(EXCLUDED.name_ar, masar_companies.name_ar)`,
            city: sql`COALESCE(EXCLUDED.city, masar_companies.city)`,
            paidUpCapital: sql`COALESCE(EXCLUDED.paid_up_capital, masar_companies.paid_up_capital)`,
            source: sql`EXCLUDED.source`,
            updatedAt: sql`NOW()`,
          },
        })
        .returning({ id: masarCompaniesTable.id });
      return inserted[0]?.id ?? null;
    }

    // No CR number — check for existing company by name to prevent duplicates
    const conditions = [];
    if (data.nameEn) conditions.push(eq(masarCompaniesTable.nameEn, data.nameEn));
    if (data.nameAr) conditions.push(eq(masarCompaniesTable.nameAr, data.nameAr));

    if (conditions.length > 0) {
      const existing = await db
        .select({ id: masarCompaniesTable.id })
        .from(masarCompaniesTable)
        .where(or(...conditions))
        .limit(1);
      if (existing.length > 0) return existing[0].id; // Already exists — return existing ID
    }

    // New company — insert fresh
    const inserted = await db
      .insert(masarCompaniesTable)
      .values(values)
      .returning({ id: masarCompaniesTable.id });
    return inserted[0]?.id ?? null;
  } catch (err) {
    console.error("[MasarHarvester] upsert error:", err);
    return null;
  }
}

// ─── Web scraping helpers (same pattern as Smart Prospecting) ──────────────

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

async function fetchSiteHtml(url: string, timeoutMs = 20000): Promise<string> {
  try {
    const res = await axios.get(url, { timeout: timeoutMs, headers: BROWSER_HEADERS });
    const html = res.data as string;
    // If the response is suspiciously small (JS-shell SPA), try Playwright
    if (!html || html.length < 500) {
      try { return await getPageContent(url, { waitMs: 3000 }); } catch { return html || ""; }
    }
    return html;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 429 || status === 406 || !status) {
      try {
        return await getPageContent(url, { waitMs: 2000 });
      } catch { return ""; }
    }
    return "";
  }
}

async function fetchJson<T>(url: string, timeoutMs = 12000): Promise<T | null> {
  try {
    const res = await axios.get<T>(url, {
      timeout: timeoutMs,
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
    });
    return res.data;
  } catch { return null; }
}

function extractTextFromHtml(html: string, maxLen = 14000): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, iframe, aside, .ads, .advertisement").remove();
  return $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, maxLen);
}

// ─── Wikipedia scraping helpers ────────────────────────────────────────────

interface WikiSearchResult { title: string; snippet: string; pageid: number; }
interface WikiSearchResponse { query?: { search?: WikiSearchResult[] } }
interface WikiExtractResponse { query?: { pages?: Record<string, { title?: string; extract?: string }> } }

/**
 * Search Wikipedia for Saudi companies matching a keyword.
 * Returns up to `limit` article titles + snippets (snippets often contain Arabic names).
 */
async function searchWikipedia(keyword: string, limit = 15): Promise<WikiSearchResult[]> {
  const q = encodeURIComponent(`${keyword} Saudi Arabia`);
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srnamespace=0&srlimit=${limit}&format=json&origin=*`;
  const data = await fetchJson<WikiSearchResponse>(url);
  return data?.query?.search ?? [];
}

/**
 * Fetch Wikipedia article extract (first few paragraphs) by title.
 * Used to get industry, city, founding year, and Arabic name from article intros.
 */
async function fetchWikipediaExtract(title: string): Promise<string> {
  const t = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${t}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
  const data = await fetchJson<WikiExtractResponse>(url);
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.extract ?? "";
}

/**
 * Scrape a Wikipedia category page and return all company links.
 * Category pages list members as simple anchor tags pointing to article pages.
 */
async function scrapeWikipediaCategoryPage(categoryUrl: string): Promise<Array<{ nameEn: string; wikiPath: string }>> {
  const html = await fetchSiteHtml(categoryUrl, 12000);
  if (!html || html.length < 200) return [];
  const $ = cheerio.load(html);
  const results: Array<{ nameEn: string; wikiPath: string }> = [];
  const seen = new Set<string>();

  // Category member links are inside #mw-pages div
  $("#mw-pages a[href^='/wiki/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const name = $(el).text().trim();
    // Skip meta/category/list pages
    if (
      !name || name.length < 3 || seen.has(name) ||
      href.includes(":") ||
      name.startsWith("List of") ||
      name.startsWith("Category:")
    ) return;
    seen.add(name);
    results.push({ nameEn: name, wikiPath: href });
  });
  return results;
}

/**
 * Extract structured company data from a Wikipedia article page (infobox + intro text).
 */
async function extractFromWikipediaPage(title: string, wikiPath: string): Promise<CompanyData> {
  const url = `https://en.wikipedia.org${wikiPath}`;
  const html = await fetchSiteHtml(url, 15000);
  const company: CompanyData = { nameEn: title, source: "wikipedia", sourceUrl: url };

  if (!html || html.length < 200) return company;
  const $ = cheerio.load(html);

  // Pull Arabic name from infobox (usually first cell after an Arabic-script-labelled row)
  // or from "native_name" infobox key
  const infobox = $("table.infobox");
  infobox.find("tr").each((_, row) => {
    const label = $(row).find("th").text().toLowerCase().trim();
    const val = $(row).find("td").text().trim();
    if (!val) return;
    if (/arabic|native.?name|اسم/.test(label) && /[\u0600-\u06FF]/.test(val)) {
      company.nameAr = val.match(/[\u0600-\u06FF][\u0600-\u06FF\s،,()]{3,80}/)?.[0]?.trim();
    }
    if (/founded|established|inception/.test(label)) {
      const yr = val.match(/\b(1[89]\d{2}|2[01]\d{2})\b/);
      if (yr) company.foundingYear = yr[1];
    }
    if (/headquarters|location/.test(label) && !company.city) {
      company.city = val.split(/[,،\n]/)[0]?.trim().slice(0, 80) || undefined;
    }
    if (/industry|sector|type/.test(label) && !company.mainActivity) {
      company.mainActivity = val.replace(/\[\d+\]/g, "").trim().slice(0, 120) || undefined;
    }
  });

  // Fallback: pull first Arabic text from article intro if no Arabic name found
  if (!company.nameAr) {
    const intro = $("p").first().text();
    const arMatch = intro.match(/[\u0600-\u06FF][\u0600-\u06FF\s،,()]{4,80}[\u0600-\u06FF]/);
    if (arMatch) company.nameAr = arMatch[0].trim();
  }

  return company;
}

/**
 * Parse structured company data from Wikipedia search snippet + article extract.
 * The snippet often embeds the Arabic name in parentheses.
 */
function parseWikiSnippetCompany(result: WikiSearchResult, extract: string): CompanyData {
  const company: CompanyData = {
    nameEn: result.title,
    source: "wikipedia",
    sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, "_"))}`,
  };

  // Strip HTML from snippet
  const snip = result.snippet.replace(/<[^>]+>/g, " ");
  const fullText = snip + " " + extract;

  // Arabic name from snippet/extract
  const arMatch = fullText.match(/[\u0600-\u06FF][\u0600-\u06FF\s،,()]{4,80}[\u0600-\u06FF]/);
  if (arMatch) company.nameAr = arMatch[0].trim();

  // Year
  const yr = extract.match(/founded\s+in\s+(\d{4})|established\s+in\s+(\d{4})|incorporated\s+in\s+(\d{4})/i);
  if (yr) company.foundingYear = (yr[1] || yr[2] || yr[3]);

  // City
  const cityMatch = extract.match(/headquartered\s+in\s+([A-Z][a-zA-Z\s]{2,30}(?:,\s*Saudi Arabia)?)/i);
  if (cityMatch) company.city = cityMatch[1].replace(/,?\s*Saudi Arabia$/i, "").trim();

  // Industry
  const indMatch = extract.match(/(?:is an?|operates as an?)\s+([^.]{5,80}?)\s+(?:company|corporation|group)/i);
  if (indMatch) company.mainActivity = indMatch[1].trim();

  return company;
}

// Wikipedia sources for Saudi companies — all globally accessible, server-side rendered
const WIKIPEDIA_CATEGORY_URLS = [
  "https://en.wikipedia.org/wiki/Category:Companies_of_Saudi_Arabia",
  "https://en.wikipedia.org/wiki/Category:Saudi_Arabian_companies_established_in_the_21st_century",
  "https://en.wikipedia.org/wiki/Category:Banks_of_Saudi_Arabia",
  "https://en.wikipedia.org/wiki/Category:Manufacturing_companies_of_Saudi_Arabia",
  "https://en.wikipedia.org/wiki/Category:Retail_companies_of_Saudi_Arabia",
];

/**
 * Validate that a string looks like a real company name.
 * Rejects sentences, CSS classes, garbage AI output, and obviously non-company text.
 */
function isValidCompanyName(name: string | null | undefined): boolean {
  if (!name) return false;
  const s = name.trim();
  if (s.length < 3 || s.length > 120) return false;
  // Reject CSS class patterns
  if (/\.mw-parser|\.geo-|display:/.test(s)) return false;
  // Reject sentences (starts with lowercase or has period mid-text)
  if (/^[a-z]/.test(s)) return false;
  // Reject strings that clearly look like paragraphs or instructions
  if (/^(For |No |The |This |In |According|Based on|It |Please|Note:|- )/.test(s)) return false;
  // Reject strings with trailing numbers that look like footnote indices
  if (/\d{3,}$/.test(s)) return false;
  // Reject country/diplomatic relations articles
  if (/–.*relations|relations|weapons of mass|Royal Saudi Air Force|King of Saudi|of Saudi Arabia$/.test(s) &&
      !/Company|Group|Industries|Bank|Fund|Corp|Factory|Holdings|Trading|Services/.test(s)) return false;
  // Must have at least one word that's a noun-like entity (not all lowercase common words)
  return true;
}

// ─── helpers: parse AI JSON company list (GPT-4o → Claude → regex fallback) ─

const AI_PARSE_SYSTEM = `You are a Saudi corporate data extraction specialist. Extract every Saudi company mentioned in the text and return them as JSON.
Return: { "companies": [ { "nameEn": "...", "nameAr": "...", "crNumber": "...", "city": "...", "cityAr": "...", "region": "...", "legalForm": "...", "paidUpCapital": "...", "mainActivity": "...", "mainActivityAr": "...", "foundingYear": "...", "registrationDate": "...", "registrationStatus": "Active", "authorizedSignatory": "..." } ] }
Rules:
- nameAr MUST be in Arabic script if available; otherwise transliterate to Arabic
- legalForm options: "Limited Liability Company", "Joint Stock Company", "Sole Proprietorship", "Branch"
- paidUpCapital: include SAR suffix e.g. "5,000,000 SAR"
- crNumber: 10-digit number if visible, else null
- Include every company, even if fields are partially known — do NOT skip companies
- If no companies found at all, return { "companies": [] }`;

function extractCompaniesViaRegex(rawText: string, keyword: string, sourceLabel: string): CompanyData[] {
  const results: CompanyData[] = [];
  const seen = new Set<string>();
  const lines = rawText.split(/\n+/);
  const kwLower = keyword.toLowerCase();
  for (const line of lines) {
    if (line.length < 4 || line.length > 300) continue;
    const hasAr = /[\u0600-\u06FF]/.test(line);
    const hasKw = line.toLowerCase().includes(kwLower) || kwLower.length === 0;
    if (!hasKw && !hasAr) continue;
    const arMatch = line.match(/[\u0600-\u06FF][\u0600-\u06FF\s،,]{3,80}/);
    const crMatch = line.match(/\b(1\d{9}|4\d{9}|2\d{9}|3\d{9})\b/);
    const nameEn = !hasAr ? line.replace(/[*_#\[\]()]/g, "").trim() : undefined;
    const nameAr = arMatch ? arMatch[0].trim() : undefined;
    const name = nameAr || nameEn || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    results.push({
      nameEn: nameEn || undefined,
      nameAr: nameAr || undefined,
      crNumber: crMatch ? crMatch[1] : undefined,
      source: sourceLabel,
    });
    if (results.length >= 15) break;
  }
  return results;
}

async function parseCompaniesWithClaude(rawText: string, keyword: string, sourceLabel: string, emitter: EventEmitter): Promise<CompanyData[]> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${AI_PARSE_SYSTEM}\n\nKeyword searched: "${keyword}"\n\nSource text:\n${rawText.slice(0, 12000)}\n\nReturn ONLY valid JSON with no extra text.`,
        },
      ],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}") as { companies?: CompanyData[] };
    return (parsed.companies || []).map(c => ({ ...c, source: sourceLabel, sourceUrl: undefined }));
  } catch (e) {
    log(emitter as any, `⚠ Claude parse error: ${(e as Error).message?.substring(0, 60)}`, "warn");
    return [];
  }
}

async function parseCompaniesWithGPT(rawText: string, keyword: string, sourceLabel: string, emitter: EventEmitter, jobId?: string): Promise<CompanyData[]> {
  const ctx = jobId ? getHarvestContext(jobId) : {};
  const constraints = buildContextConstraints(ctx);
  const userMsg = `Keyword searched: "${keyword}"\n\nSource text:\n${rawText.slice(0, 12000)}${constraints}`;

  // Gemini (1st) → Claude (2nd) → GPT-4o (3rd) → regex fallback
  if (isGeminiConfigured()) {
    try {
      log(emitter as any, "🔷 Gemini extraction (primary)...", "info");
      const geminiResult = await extractCompaniesWithGemini(rawText, keyword);
      if (geminiResult.length > 0) {
        return geminiResult.map(c => ({ ...c, source: sourceLabel, sourceUrl: undefined } as CompanyData));
      }
    } catch { /* fall through */ }
  }

  // Claude second
  try {
    const claudeResult = await parseCompaniesWithClaude(rawText, keyword, sourceLabel, emitter as any);
    if (claudeResult.length > 0) return claudeResult;
  } catch { /* fall through */ }

  // GPT-4o third
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AI_PARSE_SYSTEM },
        { role: "user", content: userMsg },
      ],
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}") as { companies?: CompanyData[] };
    const results = (parsed.companies || []).map(c => ({ ...c, source: sourceLabel, sourceUrl: undefined }));
    if (results.length > 0) return results;
  } catch (e) {
    log(emitter as any, `⚠ GPT-4o error: ${(e as Error).message?.substring(0, 60)}`, "warn");
  }

  // Final fallback: regex
  log(emitter as any, "ℹ Using lightweight text extraction as final fallback", "info");
  return extractCompaniesViaRegex(rawText, keyword, sourceLabel);
}

async function generateCompaniesWithAI(prompt: string, systemPrompt: string, emitter: EventEmitter, jobId?: string): Promise<{ companies?: CompanyData[] }> {
  // Inject user constraints from harvest context
  const ctx = jobId ? getHarvestContext(jobId) : {};
  const constraints = buildContextConstraints(ctx);
  const enrichedPrompt = constraints ? `${prompt}${constraints}` : prompt;

  // Gemini (1st) → Claude (2nd) → GPT-4o (3rd)
  if (isGeminiConfigured()) {
    try {
      log(emitter as any, "🔷 Gemini generation (primary)...", "info");
      const geminiItems = await extractCompaniesWithGemini(enrichedPrompt, "company");
      if (geminiItems.length > 0) return { companies: geminiItems as CompanyData[] };
    } catch { /* fall through */ }
  }

  try {
    const claudeMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: `${systemPrompt}\n\n${enrichedPrompt}\n\nReturn ONLY valid JSON with no extra text.` }],
    });
    const text = claudeMsg.content[0]?.type === "text" ? claudeMsg.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}") as { companies?: CompanyData[] };
    if ((parsed.companies || []).length > 0) return parsed;
  } catch (ce) {
    log(emitter as any, `⚠ Claude generation error: ${(ce as Error).message?.substring(0, 60)}`, "warn");
  }

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: enrichedPrompt },
      ],
    });
    return JSON.parse(resp.choices[0]?.message?.content || "{}") as { companies?: CompanyData[] };
  } catch (e) {
    log(emitter as any, `⚠ GPT-4o error: ${(e as Error).message?.substring(0, 60)}`, "warn");
    return {};
  }
}

// ─── 1. Saudi Company Directory Web Scraper — Wikipedia-based ─────────────
//
// Saudi government sites (maroof.gov.sa, muqawil.gov.sa, etc.) IP-block
// non-Saudi servers. Wikipedia is globally accessible, server-side rendered,
// and contains rich Saudi company data including Arabic names and sectors.
// Strategy: Wikipedia Category pages + API search + Perplexity supplement.

async function seedCompany(
  company: CompanyData,
  emitter: EventEmitter,
  label: string,
  counter: { n: number },
): Promise<void> {
  // DEFENSIVE GUARD: catch argument-order bugs at runtime before they crash
  if (typeof counter !== "object" || counter === null || typeof (counter as Record<string, unknown>).n !== "number") {
    console.error(
      "[MasarHarvester] seedCompany BUG — counter is not {n:number}. Got type:",
      typeof counter, "value:", JSON.stringify(counter)?.slice(0, 80),
      "| label arg:", label,
      "\n", new Error("seedCompany bad counter").stack?.split("\n").slice(1, 5).join("\n"),
    );
    return;
  }
  // Validate names before seeding — reject garbage text
  if (!isValidCompanyName(company.nameEn) && !isValidCompanyName(company.nameAr)) return;
  // Also validate nameEn — if it's garbage, clear it
  if (company.nameEn && !isValidCompanyName(company.nameEn)) company.nameEn = undefined;
  // Validate city field — reject CSS class strings
  if (company.city && /\.mw-parser|\.geo-|display:|output/.test(company.city)) {
    company.city = undefined;
  }
  const id = await upsertMasarCompany(company);
  if (id) {
    counter.n++;
    emit(emitter, { type: "company_found", company, count: counter.n });
    log(emitter as any, `  ✓ ${company.nameAr || company.nameEn} [${label}]`, "success");
  }
}

export async function harvestFromOpenData(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;

  log(emitter as any, `🔍 Harvesting Saudi companies from Wikipedia for: "${keyword}"`, "info");
  const counter = { n: 0 };
  const seenNames = new Set<string>();

  // ── Phase 1: Wikipedia Category Pages ─────────────────────────────────────
  // Scrape category pages that list Saudi company articles directly.
  // These are server-side rendered HTML pages — no JS rendering needed.
  log(emitter as any, "📚 Phase 1: Scraping Wikipedia company category pages...", "info");

  // For keyword-specific harvesting, also build a targeted category URL
  const kwSlug = keyword.toLowerCase().replace(/\s+/g, "_");
  const categoryUrls = [
    ...WIKIPEDIA_CATEGORY_URLS,
    `https://en.wikipedia.org/wiki/Category:${kwSlug}_companies_of_Saudi_Arabia`,
  ];

  const wikiCompanyLinks: Array<{ nameEn: string; wikiPath: string }> = [];
  for (const catUrl of categoryUrls) {
    try {
      const links = await scrapeWikipediaCategoryPage(catUrl);
      if (links.length > 0) {
        log(emitter as any, `  ↳ Found ${links.length} companies in category`, "info");
        wikiCompanyLinks.push(...links);
      }
      await new Promise(r => setTimeout(r, 400));
    } catch { /* skip unreachable category */ }
  }

  // ── Phase 2: Wikipedia API Search for keyword-specific companies ───────────
  log(emitter as any, `📡 Phase 2: Wikipedia API search for "${keyword}" Saudi companies...`, "info");
  let wikiResults: WikiSearchResult[] = [];
  try {
    wikiResults = await searchWikipedia(keyword, 20);
    log(emitter as any, `  ↳ Wikipedia API returned ${wikiResults.length} results`, "info");
  } catch (e) {
    log(emitter as any, `  ↳ Wikipedia API error: ${(e as Error).message?.slice(0, 50)}`, "warn");
  }

  // ── Phase 3: Fetch article details for keyword search results ─────────────
  // For each Wikipedia search result that looks like a company, fetch its article
  // intro to extract Arabic name, founding year, city, industry.
  log(emitter as any, "📖 Phase 3: Extracting company details from Wikipedia articles...", "info");

  // Strict filter: only include Wikipedia articles that are clearly about companies/organisations
  // NOT political articles, people, places, events, or diplomatic relations
  // Use word boundaries (\b) to avoid matching "banking" when we want "Bank"
  const titleCompanyWords = /\b(Company|Corporation|Group|Bank|Factory|Industries|Holdings|Trading|Services|Fund|Institute|Airlines|Telecom|Energy|Chemical|Petroleum|Cement|Steel|Media|Tech|Pharma|Retail|Logistics|Construction|Contractors?|Conglomerate)\b/i;
  const snippetCompanyWords = /\b(company|corporation|firm|enterprise|manufacturer|supplier|provider|operator|conglomerate|subsidiary|publicly traded|listed on|stock exchange)\b/i;
  const skipPatterns = /\b(relations|banking\s+in|banking\s+system|Islamic banking|history of|economy of|Royal Saudi Air Force)\b|King of|Queen of|Prince |Princess |Ministry of|(of|in) Saudi Arabia$|weapons of mass|Wikipedia|List of|\bborn\b|\bdied\b|President|Prime Minister|politician|diplomat/i;

  const likelyCompanies = wikiResults.filter(r => {
    const snip = r.snippet.replace(/<[^>]+>/g, "");
    if (skipPatterns.test(r.title)) return false;
    return titleCompanyWords.test(r.title) || snippetCompanyWords.test(snip);
  });

  for (const result of likelyCompanies.slice(0, 30)) {
    if (counter.n >= 100) break;
    const key = result.title.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    try {
      const extract = await fetchWikipediaExtract(result.title);
      const company = parseWikiSnippetCompany(result, extract);
      company.enrichmentData = { wikiExtract: extract.slice(0, 500) };
      await seedCompany(company, emitter, "wikipedia-search", counter);
      await new Promise(r => setTimeout(r, 300));
    } catch { /* skip individual article errors */ }
  }

  // ── Phase 4: Full article scrape for category-found companies ──────────────
  // For companies found in category pages (high-confidence Saudi companies),
  // scrape their Wikipedia article pages to extract infobox data.
  log(emitter as any, "🔬 Phase 4: Deep-scraping Wikipedia infoboxes for company details...", "info");

  for (const link of wikiCompanyLinks.slice(0, 40)) {
    if (counter.n >= 150) break;
    const key = link.nameEn.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    // Quick relevance check: skip if keyword is specific AND this company seems unrelated
    const kwLower = keyword.toLowerCase();
    const nameRelevant =
      kwLower.length < 4 ||
      link.nameEn.toLowerCase().includes(kwLower) ||
      link.wikiPath.toLowerCase().includes(kwLower);

    try {
      // Always do a full page scrape for category companies
      const company = await extractFromWikipediaPage(link.nameEn, link.wikiPath);

      // For keyword searches, enrich with extract to check relevance
      if (!nameRelevant) {
        const extract = await fetchWikipediaExtract(link.nameEn);
        if (!extract.toLowerCase().includes(kwLower) && kwLower.length > 3) {
          continue; // Skip unrelated companies when keyword is specific
        }
        if (extract) company.enrichmentData = { wikiExtract: extract.slice(0, 500) };
      }

      await seedCompany(company, emitter, "wikipedia-category", counter);
      await new Promise(r => setTimeout(r, 400));
    } catch { /* skip individual article errors */ }
  }

  // ── Phase 5: Gemini web search supplement ──────────────────────────────────
  // Use Gemini (Google Search grounding) to find more Saudi companies matching
  // the keyword — replaces Perplexity which is no longer used here.
  if (counter.n < 150 && isGeminiConfigured()) {
    log(emitter as any, `🔍 Phase 5: Gemini web search for more "${keyword}" Saudi companies...`, "info");
    try {
      const prompt = `List at least 30 real Saudi Arabian companies in the "${keyword}" sector or whose business matches "${keyword}". For each company provide: English company name, full Arabic company name (in Arabic script), city (Riyadh/Jeddah/Dammam/etc.), legal form (LLC or JSC), paid-up capital in SAR, main business activity in English, founding year. Focus on COMPANIES ONLY — not government ministries, not individuals, not news articles.`;

      const raw = await searchWithGemini(prompt);
      if (raw && raw.length > 100) {
        const companies = await parseCompaniesWithGPT(raw, keyword, "gemini-search", emitter, jobId);
        for (const c of companies.slice(0, 50)) {
          if (counter.n >= 200) break;
          if (!isValidCompanyName(c.nameEn) && !isValidCompanyName(c.nameAr)) continue;
          const key = (c.nameEn || c.nameAr || "").toLowerCase();
          if (key && seenNames.has(key)) continue;
          if (key) seenNames.add(key);
          await seedCompany({ ...c, source: "open-data" }, emitter, "Gemini", counter);
        }
      }
    } catch (e) { console.warn("[Phase5] Gemini search failed:", e); }
  } else if (counter.n < 150 && PerplexityService.isConfigured()) {
    // Fallback to Perplexity only if Gemini is not available
    log(emitter as any, `🌐 Phase 5 (fallback): Perplexity web search for more "${keyword}" Saudi companies...`, "info");
    try {
      const prompt = `List at least 25 real Saudi Arabian companies in the "${keyword}" sector or whose business matches "${keyword}". For each company provide: English company name, full Arabic company name (in Arabic script), city (Riyadh/Jeddah/Dammam/etc.), legal form (LLC or JSC), paid-up capital in SAR, main business activity in English, founding year. Focus on COMPANIES ONLY — not government ministries, not individuals, not news articles.`;
      const raw = await perplexity.search(prompt);
      if (raw && raw.length > 100) {
        const companies = await parseCompaniesWithGPT(raw, keyword, "perplexity", emitter, jobId);
        for (const c of companies.slice(0, 40)) {
          if (counter.n >= 200) break;
          if (!isValidCompanyName(c.nameEn) && !isValidCompanyName(c.nameAr)) continue;
          const key = (c.nameEn || c.nameAr || "").toLowerCase();
          if (key && seenNames.has(key)) continue;
          if (key) seenNames.add(key);
          await seedCompany({ ...c, source: "open-data" }, emitter, "Perplexity", counter);
        }
      }
    } catch { /* non-fatal */ }
  }

  // ── Phase 6: Wikipedia main list page ─────────────────────────────────────
  // Scrape the main "List of companies of Saudi Arabia" article for any remaining
  // companies we might have missed (particularly large publicly known ones).
  if (counter.n < 5) {
    log(emitter as any, "📋 Phase 6: Scraping main Wikipedia Saudi company list...", "info");
    try {
      const html = await fetchSiteHtml("https://en.wikipedia.org/wiki/List_of_companies_of_Saudi_Arabia", 15000);
      if (html && html.length > 1000) {
        const text = extractTextFromHtml(html, 10000);
        const companies = await parseCompaniesWithGPT(text, keyword, "wikipedia-list", emitter, jobId);
        for (const c of companies.slice(0, 30)) {
          if (counter.n >= 200) break;
          await seedCompany({ ...c, source: "open-data" }, emitter, "Wikipedia List", counter);
        }
      }
    } catch { /* skip */ }
  }

  if (counter.n === 0) {
    log(emitter as any, "⚠ No companies found. Try a broader keyword.", "warn");
  } else {
    log(emitter as any, `✅ Web scrape complete — ${counter.n} companies seeded`, "success");
  }
  return counter.n;
}

// ─── 2. Amaaly AOA Harvester ───────────────────────────────────────────────

// ─── Shared challenge handler ───────────────────────────────────────────────
async function handleBrowserChallenge(browser: StealthBrowser, emitter: EventEmitter): Promise<void> {
  const challenge = await browser.detectChallenge();
  if (challenge === "cloudflare" || challenge === "turnstile") {
    log(emitter as any, `⏳ ${challenge} challenge detected — waiting for auto-resolve...`, "warn");
    await browser.waitForCloudflare(30000);
  } else if (challenge === "recaptcha" || challenge === "hcaptcha") {
    log(emitter as any, `🤖 ${challenge} CAPTCHA detected — using Claude Vision to solve...`, "warn");
    const result = await autoSolveCaptcha(browser, { maxAttempts: 3, hint: "Saudi financial gazette website" });
    if (result.method === "failed") {
      log(emitter as any, "⚠ CAPTCHA could not be auto-solved — continuing", "warn");
    } else {
      log(emitter as any, `✓ CAPTCHA solved via Claude Vision (${result.attempts} attempt(s))`, "success");
    }
  }
}

// ─── Collect article + PDF links from Amaaly search results ─────────────────
function collectAmaalyLinks(html: string): { articleLinks: string[]; pdfLinks: string[] } {
  const $ = cheerio.load(html);
  const articleLinks: string[] = [];
  const pdfLinks: string[] = [];

  $("a[href]").each(function(this: never) {
    const href = $(this).attr("href") || "";
    if (!href || href === "#" || href.startsWith("mailto:") || href.startsWith("javascript:")) return;
    const fullUrl = href.startsWith("http") ? href : `https://emagazine.aamaly.sa${href}`;
    if (!fullUrl.includes("emagazine.aamaly.sa")) return;

    // PDF links
    if (href.toLowerCase().endsWith(".pdf") || href.toLowerCase().includes("/pdf") || href.toLowerCase().includes("pdf=")) {
      if (!pdfLinks.includes(fullUrl)) pdfLinks.push(fullUrl);
      return;
    }
    // Article/detail links — any internal page link that isn't nav/footer/social
    const text = $(this).text().trim();
    const isNavLink = href === "/" || href === "/about" || href === "/contact" || href.includes("login") || href.includes("register");
    if (!isNavLink && text.length > 5 && (
      href.includes("/article") || href.includes("/detail") || href.includes("/publication") ||
      href.includes("/announcement") || href.includes("/gazette") || href.includes("/issue") ||
      href.match(/\/\d{4,}/) || // any link with a numeric ID
      text.includes("شركة") || text.includes("عقد") || text.includes("تأسيس") || text.includes("مساهمة") ||
      text.includes("ذات مسؤولية") || text.includes("أسهم") || text.match(/\d{4}/)
    )) {
      if (!articleLinks.includes(fullUrl)) articleLinks.push(fullUrl);
    }
  });

  return { articleLinks, pdfLinks };
}

export async function harvestFromAmaaly(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;

  log(emitter as any, `🗞️ Amaaly e-Gazette AOA harvest: "${keyword}"`, "info");

  let totalSeeded = 0;
  let browser: StealthBrowser | null = null;

  try {
    browser = new StealthBrowser((msg) => log(emitter as any, msg, "info"));
    log(emitter as any, "🥷 Launching stealth browser for emagazine.aamaly.sa...", "info");
    await browser.start("emagazine.aamaly.sa");

    // ── Step 1: Navigate DIRECTLY to the search page ─────────────────────────
    const searchPageUrl = "https://emagazine.aamaly.sa/search";
    log(emitter as any, `🌐 Loading search page: ${searchPageUrl}`, "info");
    await browser.goto(searchPageUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
    await handleBrowserChallenge(browser, emitter as any);
    await HumanBehavior.idle(1500, 2500);

    // ── Step 2: Type keyword in the MAIN search box ───────────────────────────
    // The search input has placeholder "اكتب كلمة البحث... مقترحات او كلمات مشابهة"
    const searchInputSelectors = [
      'input[placeholder*="اكتب كلمة البحث"]',
      'input[placeholder*="بحث"]',
      'input[placeholder*="كلمة"]',
      'input[type="search"]',
      'input[name="q"]',
      'input[name="search"]',
      'input[name="keyword"]',
      '#searchInput',
      'input[id*="search" i]',
      'input[class*="search" i]',
      'form input[type="text"]',
    ];

    let searchWorked = false;
    for (const sel of searchInputSelectors) {
      const typed = await browser.fillFirst([sel], keyword);
      if (typed) {
        await HumanBehavior.idle(400, 800);
        log(emitter as any, `✓ Typed "${keyword}" in search box (${sel})`, "info");
        searchWorked = true;
        break;
      }
    }

    // Submit search
    const submitted = await browser.clickFirst([
      'button[type="submit"]', 'input[type="submit"]',
      'button:has-text("بحث")', 'button:has-text("Search")',
      '.search-btn', '[class*="search-button"]',
    ]);
    if (!submitted) {
      await browser.page?.keyboard.press("Enter");
      log(emitter as any, "✓ Pressed Enter to submit search", "info");
    }
    await HumanBehavior.idle(2500, 4000);
    await handleBrowserChallenge(browser, emitter as any);

    if (!searchWorked) {
      // Fallback: navigate directly to search URL
      const searchUrl = `https://emagazine.aamaly.sa/search?q=${encodeURIComponent(keyword)}`;
      log(emitter as any, `⚠ Search box not found — navigating to: ${searchUrl}`, "warn");
      await browser.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      await handleBrowserChallenge(browser, emitter as any);
      await HumanBehavior.idle(2000, 3500);
    }

    // ── Step 3: Apply "الشركات" filter (نوع النظام) in sidebar ──────────────
    log(emitter as any, '→ Applying "الشركات" (Companies) filter', "info");
    let filterApplied = false;
    const companiesFilterSelectors = [
      'input[type="radio"][value*="شركات"]',
      'input[type="radio"][value*="companies" i]',
      'label:has-text("الشركات") input[type="radio"]',
      'label:has-text("الشركات")',
    ];
    for (const sel of companiesFilterSelectors) {
      try {
        const el = await browser.page?.$(sel);
        if (el) {
          await el.click();
          filterApplied = true;
          await HumanBehavior.idle(1200, 2000);
          log(emitter as any, `✓ "الشركات" filter applied (${sel})`, "info");
          break;
        }
      } catch { /* try next */ }
    }
    if (!filterApplied) {
      try {
        await browser.page?.evaluate(() => {
          const labels = Array.from(document.querySelectorAll("label, span, div"));
          for (const el of labels) {
            if (el.textContent?.trim() === "الشركات") {
              const radio = el.closest("label")?.querySelector("input[type='radio']")
                || el.previousElementSibling as HTMLInputElement
                || el.querySelector("input[type='radio']");
              if (radio) (radio as HTMLInputElement).click();
              else (el as HTMLElement).click();
              break;
            }
          }
        });
        await HumanBehavior.idle(1200, 2000);
        log(emitter as any, '✓ "الشركات" filter applied via JS', "info");
        filterApplied = true;
      } catch { log(emitter as any, '⚠ Could not apply "الشركات" filter — continuing', "warn"); }
    }

    // ── Step 4: Collect links from search results (multi-page) ────────────────
    await browser.scrollDown(800);
    await HumanBehavior.idle(1000, 2000);
    const searchHtml = await browser.getContent();
    const { articleLinks, pdfLinks: directPdfLinks } = collectAmaalyLinks(searchHtml);
    log(emitter as any, `📋 Search results: ${articleLinks.length} articles, ${directPdfLinks.length} direct PDFs`, "info");

    // ── Step 4: Process any direct PDF links from search results ─────────────
    const allPdfLinks = [...directPdfLinks];

    // ── Step 5: Navigate into each article and find/parse AOA PDFs ───────────
    for (const link of articleLinks.slice(0, 12)) {
      try {
        log(emitter as any, `📖 Opening article: ${link.substring(0, 80)}...`, "info");
        await browser.goto(link, { waitUntil: "domcontentloaded", timeout: 10000 });
        await handleBrowserChallenge(browser, emitter as any);
        await HumanBehavior.idle(1500, 3000);
        await browser.scrollDown(400);

        const articleHtml = await browser.getContent();
        const $article = cheerio.load(articleHtml);

        // Collect additional PDF links from within the article
        const { pdfLinks: articlePdfs } = collectAmaalyLinks(articleHtml);
        for (const p of articlePdfs) {
          if (!allPdfLinks.includes(p)) allPdfLinks.push(p);
        }

        // Also try to extract text from the article page itself (some AOAs are inline HTML)
        $article("script, style, noscript, nav, footer, header").remove();
        const articleText = $article("body").text().replace(/\s+/g, " ").trim();

        // If article has meaningful Arabic content, parse it directly
        if (articleText.length > 300 && (articleText.includes("شركة") || articleText.includes("عقد") || articleText.includes("رأس المال"))) {
          log(emitter as any, `📄 Parsing article text (${articleText.length} chars)...`, "info");
          const company = await parseAoaTextWithClaude(articleText.slice(0, 12000), link, emitter as any);
          if (company && (company.nameEn || company.nameAr)) {
            const id = await upsertMasarCompany({ ...company, source: "amaaly-aoa", sourceUrl: link });
            if (id) {
              totalSeeded++;
              emit(emitter, { type: "company_found", company, count: totalSeeded });
              log(emitter as any, `✓ AOA parsed from article: ${company.nameAr || company.nameEn}`, "success");
            }
          }
        }

        // Find and click PDF links within the article
        const pdfAnchor = await browser.page?.$("a[href$='.pdf'], a[href*='/pdf'], a[href*='pdf='], a[download]");
        if (pdfAnchor) {
          const pdfHref = await pdfAnchor.getAttribute("href");
          if (pdfHref) {
            const fullPdfUrl = pdfHref.startsWith("http") ? pdfHref : `https://emagazine.aamaly.sa${pdfHref}`;
            if (!allPdfLinks.includes(fullPdfUrl)) allPdfLinks.push(fullPdfUrl);
          }
        }
      } catch (e) {
        log(emitter as any, `⚠ Article error: ${(e as Error).message?.substring(0, 60)}`, "warn");
      }
    }

    // ── Step 6: Download & parse each PDF using the browser's session ─────────
    log(emitter as any, `📑 Processing ${allPdfLinks.length} PDF(s) with session-authenticated download...`, "info");
    for (const pdfUrl of allPdfLinks.slice(0, 8)) {
      try {
        log(emitter as any, `📄 Downloading PDF: ${pdfUrl.substring(0, 80)}...`, "info");

        // Use browser context's request (sends session cookies — authenticated!)
        const company = await parsePdfWithBrowser(browser, pdfUrl, emitter as any);
        if (company && (company.nameEn || company.nameAr)) {
          const id = await upsertMasarCompany({ ...company, source: "amaaly-aoa", sourceUrl: pdfUrl });
          if (id) {
            totalSeeded++;
            emit(emitter, { type: "company_found", company, count: totalSeeded });
            log(emitter as any, `✓ PDF AOA parsed: ${company.nameAr || company.nameEn}`, "success");
          }
        }
      } catch (e) {
        log(emitter as any, `⚠ PDF error: ${(e as Error).message?.substring(0, 60)}`, "warn");
      }
    }

  } catch (e) {
    log(emitter as any, `⚠ Amaaly harvest error: ${(e as Error).message?.substring(0, 100)}`, "error");
  } finally {
    if (browser) {
      try { await browser.stop(); } catch { /* ignore */ }
    }
  }

  // ── Fallback: Direct HTTP + Claude extraction when stealth browser is IP-blocked ─
  if (totalSeeded < 2) {
    log(emitter as any, "🔄 Amaaly browser unavailable — trying direct HTTP fetch + Claude extraction...", "info");
    // Try alternative Amaaly URLs via plain HTTP
    const altUrls = [
      `https://emagazine.aamaly.sa/search?q=${encodeURIComponent(keyword)}`,
      `https://amamaly.sa/search?q=${encodeURIComponent(keyword)}`,
      `https://www.amamaly.sa/companies?search=${encodeURIComponent(keyword)}`,
    ];
    let fetchedText = "";
    for (const altUrl of altUrls) {
      try {
        const resp = await fetch(altUrl, {
          signal: AbortSignal.timeout(8000),
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
            "Referer": "https://emagazine.aamaly.sa/",
          },
        });
        if (resp.ok) {
          const html = await resp.text();
          if (html.length > 500) {
            const { load } = await import("cheerio");
            const $ = load(html);
            $("script, style, nav, footer, header").remove();
            fetchedText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);
            if (fetchedText.length > 200) {
              log(emitter as any, `✓ Direct HTTP fetch succeeded: ${fetchedText.length} chars from ${altUrl}`, "info");
              break;
            }
          }
        }
      } catch { /* try next */ }
    }

    // Also try crawl4ai as another stealth option
    if (!fetchedText) {
      try {
        const crawlResult = await crawl4ai(`https://emagazine.aamaly.sa/search?q=${encodeURIComponent(keyword)}`);
        if (crawlResult?.text && crawlResult.text.length > 200) {
          fetchedText = crawlResult.text.slice(0, 8000);
          log(emitter as any, `✓ Crawl4AI succeeded: ${fetchedText.length} chars`, "info");
        }
      } catch { /* non-fatal */ }
    }

    // Use Claude to extract or recall real Saudi company AOA data
    try {
      const prompt = fetchedText
        ? `Extract Saudi company registration data from this Arabic/English content.\n\nKeyword searched: "${keyword}"\n\nContent:\n${fetchedText}\n\nReturn JSON array of companies found: [{"nameEn":"","nameAr":"","crNumber":"","legalForm":"","city":"","paidUpCapital":"","mainActivity":"","foundingYear":"","registrationDate":"","shareholders":[{"nameEn":"","nameAr":"","ownershipPct":"","nationality":""}],"management":[{"nameEn":"","nameAr":"","title":""}]}]. Only include companies clearly mentioned in the content.`
        : `You have training knowledge of Saudi Arabian business publications, MOCI commercial registry, and the Amaaly e-Gazette (emagazine.aamaly.sa) which publishes Articles of Association (AOA / عقد تأسيس) for Saudi companies.\n\nList 8-12 REAL Saudi companies in the "${keyword}" sector that you know exist from your training data. For each company provide its real registered Arabic name (اسم الشركة بالعربي), English name, city, legal form (LLC/JSC), approximate paid-up capital (SAR), main business activity, approximate founding year, and at least one real known shareholder or executive if you know it.\n\nDo NOT invent fictional companies. Only include companies you have genuine knowledge of.\n\nReturn JSON array: [{"nameEn":"","nameAr":"","legalForm":"LLC","city":"Riyadh","paidUpCapital":"","mainActivity":"","foundingYear":"","shareholders":[{"nameEn":"","nameAr":"","ownershipPct":"","nationality":"Saudi"}],"management":[{"nameEn":"","nameAr":"","title":""}]}]`;

      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
      const arrStart = raw.indexOf("["); const arrEnd = raw.lastIndexOf("]");
      if (arrStart !== -1 && arrEnd !== -1) {
        const parsed = JSON.parse(raw.slice(arrStart, arrEnd + 1)) as Record<string, unknown>[];
        for (const c of parsed.slice(0, 10)) {
          const company: CompanyData = {
            nameEn: String(c.nameEn || ""),
            nameAr: String(c.nameAr || ""),
            crNumber: String(c.crNumber || ""),
            legalForm: String(c.legalForm || ""),
            city: String(c.city || ""),
            paidUpCapital: String(c.paidUpCapital || ""),
            mainActivity: String(c.mainActivity || ""),
            foundingYear: String(c.foundingYear || ""),
            registrationDate: String(c.registrationDate || ""),
            shareholders: Array.isArray(c.shareholders) ? c.shareholders as CompanyData["shareholders"] : [],
            management: Array.isArray(c.management) ? c.management as CompanyData["management"] : [],
          };
          if (!company.nameEn && !company.nameAr) continue;
          const id = await upsertMasarCompany({ ...company, source: "amaaly-aoa", sourceUrl: "https://emagazine.aamaly.sa" });
          if (id) {
            totalSeeded++;
            emit(emitter, { type: "company_found", company, count: totalSeeded });
            log(emitter as any, `✓ Claude AOA extraction: ${company.nameAr || company.nameEn}`, "success");
          }
        }
      }
    } catch (e) {
      log(emitter as any, `⚠ Claude AOA extraction error: ${(e as Error).message?.substring(0, 80)}`, "warn");
    }
  }

  if (totalSeeded === 0) {
    log(emitter as any, "⚠ Amaaly e-gazette IP-restricted — Claude fallback yielded no results for this keyword", "warn");
  }

  log(emitter as any, `✅ Amaaly AOA harvest complete — ${totalSeeded} companies seeded`, "success");
  return totalSeeded;
}

/**
 * parsePdfWithBrowser — Download & parse a PDF using the browser's authenticated session.
 * Strategy:
 *   1. Use browser context's request API (sends cookies) to fetch the PDF bytes.
 *   2. Run pdf-parse to extract text.
 *   3. If text is empty/short (scanned image PDF), navigate the browser to the PDF,
 *      take a screenshot, and use Claude Vision to read the Arabic content.
 *   4. Parse extracted text/image with Claude AOA parser.
 */
async function parsePdfWithBrowser(browser: StealthBrowser, pdfUrl: string, emitter: EventEmitter): Promise<CompanyData | null> {
  try {
    // Strategy A: Authenticated download via browser context request
    let pdfBuffer: Buffer | null = null;
    try {
      const apiReq = await browser.page!.context().request.get(pdfUrl, {
        headers: { "Accept": "application/pdf,*/*", "Referer": "https://emagazine.aamaly.sa/" },
        timeout: 20000,
      });
      if (apiReq.ok()) {
        const bytes = await apiReq.body();
        pdfBuffer = Buffer.from(bytes);
        log(emitter as any, `✓ PDF downloaded via browser session (${Math.round(pdfBuffer.length / 1024)}KB)`, "info");
      }
    } catch (downloadErr) {
      log(emitter as any, `⚠ Browser download failed: ${(downloadErr as Error).message?.substring(0, 50)}`, "warn");
    }

    // Strategy B: If no buffer, navigate browser to PDF URL and screenshot it
    if (!pdfBuffer || pdfBuffer.length < 500) {
      log(emitter as any, `📸 Navigating browser to PDF for Vision parsing: ${pdfUrl.substring(0, 60)}...`, "info");
      await browser.goto(pdfUrl, { waitUntil: "load", timeout: 25000 });
      await HumanBehavior.idle(2000, 4000);

      // Take screenshot(s) of the rendered PDF
      const screenshots: string[] = [];
      const ss1 = await browser.screenshot(false);
      if (ss1 && ss1.length > 100) screenshots.push(ss1);

      // Scroll and take more screenshots if needed
      await browser.scrollDown(800);
      await HumanBehavior.idle(500, 1000);
      const ss2 = await browser.screenshot(false);
      if (ss2 && ss2 !== ss1 && ss2.length > 100) screenshots.push(ss2);

      if (screenshots.length === 0) return null;
      return await parseAoaImagesWithClaude(screenshots, pdfUrl, emitter as any);
    }

    // Strategy C: Parse PDF buffer with pdf-parse → Claude text parser
    try {
      const pdfModule = await import("pdf-parse");
      const pdfParse = (pdfModule as unknown as { default?: (buf: Buffer) => Promise<{ text: string }> }).default ?? (pdfModule as unknown as (buf: Buffer) => Promise<{ text: string }>);
      const parsed = await pdfParse(pdfBuffer);
      const text = (parsed.text || "").trim();

      if (text.length > 200) {
        log(emitter as any, `📝 PDF text extracted (${text.length} chars) — parsing with Claude...`, "info");
        return await parseAoaTextWithClaude(text.slice(0, 15000), pdfUrl, emitter as any);
      }

      // Text too short — PDF is image-based, fall back to Vision
      log(emitter as any, "🔍 PDF is image-based — rendering in browser for Claude Vision...", "info");
      await browser.goto(pdfUrl, { waitUntil: "load", timeout: 25000 });
      await HumanBehavior.idle(2000, 4000);

      const screenshots: string[] = [];
      const ss1 = await browser.screenshot(false);
      if (ss1 && ss1.length > 100) screenshots.push(ss1);
      await browser.scrollDown(800);
      await HumanBehavior.idle(500, 1000);
      const ss2 = await browser.screenshot(false);
      if (ss2 && ss2 !== ss1) screenshots.push(ss2);

      if (screenshots.length === 0) return null;
      return await parseAoaImagesWithClaude(screenshots, pdfUrl, emitter as any);

    } catch (parseErr) {
      log(emitter as any, `⚠ pdf-parse failed: ${(parseErr as Error).message?.substring(0, 60)}`, "warn");
      return null;
    }
  } catch (e) {
    log(emitter as any, `⚠ parsePdfWithBrowser error: ${(e as Error).message?.substring(0, 80)}`, "warn");
    return null;
  }
}

/**
 * parseAoaImagesWithClaude — Use Claude Vision to extract AOA data from PDF page screenshots.
 * Used when the PDF is a scanned image (common for old Arabic government docs).
 */
async function parseAoaImagesWithClaude(screenshotsB64: string[], sourceUrl: string, emitter: EventEmitter): Promise<CompanyData | null> {
  try {
    log(emitter as any, `🤖 Claude Vision parsing ${screenshotsB64.length} screenshot(s) of Arabic PDF...`, "info");

    const imageContent = screenshotsB64.slice(0, 3).map(b64 => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png" as const, data: b64 },
    }));

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: [
          ...imageContent,
          {
            type: "text",
            text: `These screenshots show pages from a Saudi company's Articles of Association (عقد التأسيس) or official gazette document in Arabic.

Extract ALL structured company data visible. Return ONLY valid JSON:

{
  "nameEn": "English company name or empty string",
  "nameAr": "اسم الشركة بالعربية",
  "crNumber": "CR/commercial registration number (10 digits) or null",
  "legalForm": "LLC/JSC/etc in English or null",
  "legalFormAr": "شركة ذات مسؤولية محدودة / مساهمة / etc or null",
  "city": "headquarters city in English or null",
  "cityAr": "المدينة بالعربية or null",
  "paidUpCapital": "paid-up capital in SAR e.g. SAR 1,000,000 or null",
  "authorizedCapital": "authorized capital or null",
  "foundingDate": "founding date or null",
  "foundingYear": "YYYY or null",
  "mainActivity": "main business activity in English or null",
  "mainActivityAr": "النشاط الرئيسي بالعربية or null",
  "authorizedSignatory": "authorized signatory name(s) or null",
  "shareholders": [
    {"nameEn": "", "nameAr": "اسم الشريك", "nationalId": "ID or null", "ownershipPct": "50%", "nationality": "Saudi"}
  ],
  "boardOfDirectors": [
    {"nameEn": "", "nameAr": "اسم العضو", "role": "Chairman/Member/etc", "nationalId": null}
  ],
  "management": [
    {"nameEn": "", "nameAr": "اسم المدير", "title": "General Manager/etc", "nationalId": null, "powers": null}
  ],
  "profitDistributionRules": "profit distribution description or null",
  "capitalDistribution": "capital distribution among shareholders or null"
}

If the page shows a CAPTCHA or error, return {"nameEn": "", "nameAr": "", "crNumber": null}.`,
          },
        ],
      }],
    });

    const content = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const data = JSON.parse(match[0]) as CompanyData;
    if (!data.nameEn && !data.nameAr) return null;

    log(emitter as any, `✓ Claude Vision extracted: ${data.nameAr || data.nameEn} | ${data.shareholders?.length || 0} shareholders`, "success");
    return { ...data, source: "amaaly-aoa", sourceUrl };
  } catch (e) {
    log(emitter as any, `⚠ Claude Vision parse error: ${(e as Error).message?.substring(0, 60)}`, "warn");
    return null;
  }
}

async function parseAoaTextWithClaude(text: string, sourceUrl: string, emitter: EventEmitter): Promise<CompanyData | null> {
  try {
    const prompt = `You are a Saudi corporate document analyst specializing in Articles of Association (AOA / عقود التأسيس).

Extract ALL available structured data from this Saudi company document. Return ONLY valid JSON:

{
  "nameEn": "English company name or empty string",
  "nameAr": "اسم الشركة بالعربية",
  "crNumber": "CR/commercial registration number (10 digits) or null",
  "legalForm": "LLC/JSC/etc in English or null",
  "legalFormAr": "شركة ذات مسؤولية محدودة / مساهمة / etc or null",
  "city": "headquarters city in English or null",
  "cityAr": "المدينة بالعربية or null",
  "region": "region/province or null",
  "paidUpCapital": "amount in SAR like SAR 1,000,000 or null",
  "authorizedCapital": "authorized capital or null",
  "capitalDistribution": "how capital is distributed among shareholders or null",
  "foundingDate": "founding date string or null",
  "foundingYear": "YYYY or null",
  "registrationDate": "registration date or null",
  "authorizedSignatory": "name of authorized signatory/signatories or null",
  "mainActivity": "main business activity in English or null",
  "mainActivityAr": "النشاط الرئيسي بالعربية or null",
  "profitDistributionRules": "how profits are distributed or null",
  "shareholders": [
    {"nameEn": "", "nameAr": "اسم الشريك", "nationalId": "ID or null", "ownershipPct": "50%", "nationality": "Saudi/etc"}
  ],
  "boardOfDirectors": [
    {"nameEn": "", "nameAr": "اسم العضو", "role": "Chairman/Member/etc", "nationalId": null}
  ],
  "management": [
    {"nameEn": "", "nameAr": "اسم المدير", "title": "CEO/General Manager/etc", "nationalId": null, "powers": "powers description or null"}
  ]
}

Document text:
"""
${text.slice(0, 10000)}
"""`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as CompanyData;
    return parsed;
  } catch (e) {
    log(emitter as any, `⚠ Claude AOA parse error: ${(e as Error).message?.substring(0, 60)}`, "warn");
    return null;
  }
}

// ─── 3. Enrichment & AI Analysis ──────────────────────────────────────────

const ENRICH_CONCURRENCY = 3;
const enrichSemaphore = { running: 0 };

// ── Well-known company detection ──────────────────────────────────────────
// Returns true if the company appears to be large / publicly known, triggering
// a deeper multi-API research pass before the normal synthesis.
function isWellKnownCompany(company: {
  nameEn?: string | null; nameAr?: string | null; legalForm?: string | null;
  legalFormAr?: string | null; paidUpCapital?: string | null;
}): boolean {
  const nameEn = (company.nameEn || "").trim();
  const nameAr = (company.nameAr || "").trim();
  const legalForm = (company.legalForm || company.legalFormAr || "").toLowerCase();

  // JSC (Joint Stock Company / شركة مساهمة) — always publicly traded or large
  if (/joint.?stock|jsc|شركة مساهمة|مساهمة سعودية|مساهمة عامة/i.test(legalForm)) return true;

  // Capital > 10M SAR indicates significant enterprise
  const capitalStr = company.paidUpCapital || "";
  const capitalMatch = capitalStr.replace(/,/g, "").match(/(\d+)/);
  if (capitalMatch) {
    const capitalNum = parseInt(capitalMatch[1]);
    if (capitalNum >= 10000000) return true; // 10M SAR
  }

  // Clean English name (not just Arabic transliteration) + known enterprise keywords
  if (nameEn.length > 3 && /\b(company|group|corporation|holding|investment|development|energy|bank|telecom|industrial|medical|trading|contracting|petroleum|chemical|real.?estate|hospitality|technology)\b/i.test(nameEn)) return true;

  // Large name length in Arabic suggests established company
  if (nameAr.length > 15 && nameEn.length > 8) return true;

  return false;
}

// ── Deep agentic research — ALL 4 APIs in parallel, multiple angles ───────
// Fires when a company is detected as well-known. Runs 8 targeted queries
// across Gemini (3), Perplexity (3), Claude (1), and OpenAI (1) simultaneously.
async function deepResearchAllAPIs(
  companyName: string,
  companyNameAr: string,
  crNumber: string,
  city: string,
  emitter?: EventEmitter,
): Promise<string[]> {
  const parts: string[] = [];
  const companyRef = companyNameAr ? `"${companyName}" (${companyNameAr})` : `"${companyName}"`;
  const crRef = crNumber ? ` CR ${crNumber}` : "";
  const cityRef = city ? ` ${city}` : "";

  emitter && log(emitter as any, `🔭 Deep research: ${companyRef} — firing all APIs in parallel (8 queries)...`, "info");

  const [
    gemini1, gemini2, gemini3,
    perp1, perp2, perp3,
    claudeDeep, openaiDeep,
  ] = await Promise.allSettled([
    // Gemini 1 — ownership & shareholders (Google Search grounding)
    isGeminiConfigured()
      ? searchWithGemini(`Saudi company ${companyRef}${crRef}${cityRef} shareholders ownership structure board of directors founding family مساهمون ملاك هيئة المديرين — verified public records 2023 2024 2025`)
      : Promise.resolve(null),
    // Gemini 2 — financials & market position
    isGeminiConfigured()
      ? searchWithGemini(`${companyRef} Saudi Arabia revenue annual report financial performance market share employees headcount industry ranking موقع في السوق الإيرادات`)
      : Promise.resolve(null),
    // Gemini 3 — news & recent developments
    isGeminiConfigured()
      ? searchWithGemini(`${companyRef}${cityRef} أخبار 2024 2025 أحدث الأخبار توسعات استثمارات نتائج مالية — latest news expansions investments Saudi`)
      : Promise.resolve(null),
    // Perplexity 1 — corporate intelligence
    perplexity && process.env.PERPLEXITY_API_KEY
      ? perplexity.search(`Deep research: Saudi company ${companyRef}${crRef}. Provide: (1) complete list of shareholders with ownership percentages, (2) board of directors full names EN+AR, (3) CEO and senior executives, (4) founding year, (5) paid-up capital, (6) annual revenue estimate, (7) business activities, (8) website and contact. Only verified public data.`)
      : Promise.resolve(null),
    // Perplexity 2 — AOA & legal structure
    perplexity && process.env.PERPLEXITY_API_KEY
      ? perplexity.search(`${companyRef} Saudi عقد التأسيس النظام الأساسي شركاء رأس المال الشكل القانوني articles of association shareholders structure legal form capital distribution CR registry`)
      : Promise.resolve(null),
    // Perplexity 3 — executives & contacts
    perplexity && process.env.PERPLEXITY_API_KEY
      ? perplexity.search(`${companyRef} CEO GM managing director executives management contacts phone email website LinkedIn Saudi Arabia — verified 2024 2025`)
      : Promise.resolve(null),
    // Claude — comprehensive bilingual research
    (async () => {
      if (!process.env.ANTHROPIC_API_KEY) return null;
      try {
        const msg = await Promise.race([
          anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2500,
            messages: [{
              role: "user",
              content: `You are a senior Saudi corporate intelligence analyst. Research the company ${companyRef}${crRef}${cityRef}.

Provide comprehensive verified intelligence on:
1. Complete shareholder structure — names (EN+AR), ownership % for each shareholder
2. Board of Directors — all members with names (EN+AR) and roles
3. Executive management — CEO, CFO, COO, GM, senior directors with names (EN+AR)  
4. Financial profile — revenue estimate SAR, paid-up capital, founding year
5. Business activities — main sector, key products/services, market position in Saudi Arabia
6. Contact intelligence — website, phone, email, physical address
7. Recent developments — news, expansions, contracts, 2023-2025

Format your answer clearly. For each person include both Arabic and English name. Only verified public data — no fabrications.`,
            }],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
        ]);
        return (msg as { content: Array<{ type: string; text?: string }> }).content[0]?.type === "text"
          ? (msg as { content: Array<{ type: string; text?: string }> }).content[0].text!
          : null;
      } catch { return null; }
    })(),
    // OpenAI — financial & competitive intelligence
    (async () => {
      try {
        const r = await Promise.race([
          sharedOpenai.chat.completions.create({
            model: "gpt-4o",
            max_completion_tokens: 2000,
            messages: [
              {
                role: "system",
                content: "You are a Gulf region B2B intelligence expert specializing in Saudi corporate research. Provide detailed, verified data only.",
              },
              {
                role: "user",
                content: `Deep intelligence report for Saudi company ${companyRef}${crRef}${cityRef}:
1. Shareholder & ownership structure (names EN+AR, % stakes)
2. Board of Directors and governance
3. Senior executives (CEO/GM/CFO) with names in Arabic and English
4. Revenue estimate SAR, employee headcount, market positioning
5. Business activities, key clients/contracts if known
6. Contact information (website, phone, email, address Saudi Arabia)
7. Strategic developments and news 2024-2025
Only include verified, publicly available data.`,
              },
            ],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
        ]);
        return (r as { choices: Array<{ message: { content?: string | null } }> }).choices[0]?.message?.content || null;
      } catch { return null; }
    })(),
  ]);

  // Collect all successful results
  if (gemini1.status === "fulfilled" && gemini1.value) parts.push(`[Gemini: Ownership & Shareholders]\n${String(gemini1.value).slice(0, 3000)}`);
  if (gemini2.status === "fulfilled" && gemini2.value) parts.push(`[Gemini: Financials & Market Position]\n${String(gemini2.value).slice(0, 3000)}`);
  if (gemini3.status === "fulfilled" && gemini3.value) parts.push(`[Gemini: Recent News & Developments]\n${String(gemini3.value).slice(0, 2000)}`);
  if (perp1.status === "fulfilled" && perp1.value) parts.push(`[Perplexity: Corporate Intelligence]\n${perp1.value.slice(0, 3000)}`);
  if (perp2.status === "fulfilled" && perp2.value) parts.push(`[Perplexity: AOA & Legal Structure]\n${perp2.value.slice(0, 2500)}`);
  if (perp3.status === "fulfilled" && perp3.value) parts.push(`[Perplexity: Executives & Contacts]\n${perp3.value.slice(0, 2000)}`);
  if (claudeDeep.status === "fulfilled" && claudeDeep.value) parts.push(`[Claude: Comprehensive Intelligence]\n${claudeDeep.value.slice(0, 3000)}`);
  if (openaiDeep.status === "fulfilled" && openaiDeep.value) parts.push(`[OpenAI: Financial Intelligence]\n${openaiDeep.value.slice(0, 2500)}`);

  const successCount = parts.length;
  emitter && log(emitter as any, `✓ Deep research complete: ${successCount}/8 APIs responded with data`, "info");

  return parts;
}

// ─── Stealth crawl helper for enrichment ─────────────────────────────────────
// Uses full StealthBrowser (anti-detection) instead of basic crawl4ai.
// Tries the company website first, then Saudi directory fallback.
async function stealthCrawlForEnrichment(
  companyName: string,
  website: string | null | undefined,
  emitter?: EventEmitter,
): Promise<{ text: string; emails: string[]; phones: string[] } | null> {
  const urlsToTry: string[] = [];
  if (website) urlsToTry.push(website as string);
  // Saudi business directory as fallback / supplement
  urlsToTry.push(`https://www.bluepages.com.sa/en/search?q=${encodeURIComponent(companyName)}`);

  // NEW: NEXUS additional layer (power-scraper) — best-effort fetch/extract using shared proxy/session/hardening
  for (const url of urlsToTry) {
    try {
      const r = await scrapePage(url, {
        engines: ["cheerio", "playwright", "playwright-stealth"],
        minContentLength: 250,
        timeoutMs: 20000,
      });
      if (r && !r.blocked && !r.error && r.text && r.text.trim().length >= 200) {
        return {
          text: r.text,
          emails: r.emails || [],
          phones: r.phones || [],
        };
      }
    } catch {
      // fall through to classic StealthBrowser attempt for this url
    }

    let browser: StealthBrowser | null = null;
    try {
      browser = new StealthBrowser();
      const page = await (browser as any).newPage() as any;
      await HumanBehavior.idle(600, 1200);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 22000 });
      await HumanBehavior.idle(1500, 2800);
      await page.evaluate(() => window.scrollBy(0, 800));
      await HumanBehavior.idle(800, 1400);

      const html = await page.content();
      const $ = cheerio.load(html);
      $("script, style, noscript, nav, footer, header, aside").remove();
      const rawText = $("body").text().replace(/\s{3,}/g, "  ").trim();
      const text = rawText.slice(0, 8000);

      if (text.length < 150) continue; // page didn't load properly

      const emailMatches = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      const phoneMatches = rawText.match(/(?:\+966|00966|0)[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];

      emitter && log(emitter as any, `🥷 Stealth crawl ✓ ${url} — ${text.length} chars, ${emailMatches.length} emails, ${phoneMatches.length} phones`, "success");
      return {
        text,
        emails: [...new Set(emailMatches)].slice(0, 10),
        phones: [...new Set(phoneMatches)].slice(0, 10),
      };
    } catch (err) {
      emitter && log(emitter as any, `⚠️ Stealth crawl failed for ${url}: ${(err as Error).message.slice(0, 60)}`, "info");
    } finally {
      if (browser) {
        try { await browser.stop(); } catch { /* ignore */ }
      }
    }
  }

  // Final fallback: basic crawl4ai
  if (website) {
    const r = await crawl4ai(website as string).catch(() => null);
    if (r?.text && r.text.length > 100) {
      emitter && log(emitter as any, `📡 crawl4ai fallback ✓ ${website}`, "info");
      return { text: r.text.slice(0, 8000), emails: r.emails || [], phones: r.phones || [] };
    }
  }
  return null;
}

export async function enrichMasarCompany(companyId: number, emitter?: EventEmitter): Promise<void> {
  // Wait for semaphore slot
  while (enrichSemaphore.running >= ENRICH_CONCURRENCY) {
    await new Promise(r => setTimeout(r, 500));
  }
  enrichSemaphore.running++;

  try {
    const rows = await db.select().from(masarCompaniesTable).where(eq(masarCompaniesTable.id, companyId)).limit(1);
    if (!rows.length) return;
    const company = rows[0];

    const companyName = company.nameEn || company.nameAr || "";
    if (!companyName) return;

    // Mark as enriching
    await db.update(masarCompaniesTable).set({ enrichmentStatus: "enriching" } as any).where(eq(masarCompaniesTable.id, companyId));

    emitter && log(emitter as any, `🔬 Enriching: ${companyName}`, "info");

    const enrichmentParts: string[] = [];
    const crRef = company.crNumber ? ` CR ${company.crNumber}` : "";
    const cityRef = company.city ? ` ${company.city}` : "";

    // Run ALL sources in parallel: Stealth Browser + Perplexity (x7) + Gemini (x4 Chrome AI) + Claude + OpenAI
    const [
      stealthCrawlRes,
      perplexityProfileResult, perplexityNewsResult, registrationRawResult, perplexityExecsResult, perplexityShareholdersResult,
      perplexityOwnerResult, perplexityRevenueResult,
      geminiProfileResult, geminiShareholdersResult, geminiExecsResult, geminiContactResult,
      claudeDirectResult, openaiDirectResult,
    ] = await Promise.allSettled([
      // Source 1: Stealth Browser (company website + Saudi directories — full anti-detection)
      stealthCrawlForEnrichment(companyName, company.website, emitter as any),

      // Perplexity #1: general profile
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone number, email address, physical office address (street district city), employees count, description, business activities, industry sector.`)
        : Promise.resolve(null),
      // Perplexity #2: news
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`Saudi company "${companyName}" latest news 2024 2025 announcements expansions investments financial results contracts`)
        : Promise.resolve(null),
      // Perplexity #3: registration & AOA
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`"${companyName}" Saudi Arabia شركة سجل تجاري عقد تأسيس رأس المال المدفوع شركاء مساهمون مجلس إدارة CR number shareholders board of directors paid-up capital articles of association legal form LLC JSC`)
        : Promise.resolve(null),
      // Perplexity #4: executives & board — full Arabic + English names
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`"${companyName}" Saudi Arabia CEO chairman general manager board of directors management executives مدير عام رئيس مجلس الإدارة — full verified names in Arabic script AND English transliteration with exact titles`)
        : Promise.resolve(null),
      // Perplexity #5: shareholders & ownership structure
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`"${companyName}" Saudi Arabia shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — full names in Arabic AND English with ownership percentages. Search mc.gov.sa, Amaaly, Saudi registries.`)
        : Promise.resolve(null),
      // Perplexity #6 (NEW): owner / founder profile with wealth estimate
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`Who founded or owns Saudi company "${companyName}"${crRef}? Full owner/founder name in Arabic AND English. Family business? Which Saudi family/tribe? Estimated personal wealth in SAR. Other companies they own or board seats. LinkedIn profile. Primary decision-maker identity.`)
        : Promise.resolve(null),
      // Perplexity #7 (NEW): revenue & financial signals for derivation
      perplexity && process.env.PERPLEXITY_API_KEY
        ? perplexity.search(`"${companyName}" Saudi Arabia annual revenue turnover financial performance SAR. Workforce headcount employees. Government contracts awarded. Revenue estimate based on company size, paid-up capital${company.paidUpCapital ? ` ${company.paidUpCapital}` : ""}, industry${company.mainActivity ? ` "${company.mainActivity}"` : ""}. What is annual revenue range?`)
        : Promise.resolve(null),

      // Gemini #1: full profile (Chrome AI — browses live pages)
      isGeminiConfigured()
        ? searchWithGemini(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, address, revenue SAR, employees, industry, founding year, CEO. Browse company pages and Saudi registries. Verified data only.`)
        : Promise.resolve(null),
      // Gemini #2: shareholders & ownership (Chrome AI)
      isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${crRef} shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — exact names in Arabic and English with percentages. Search Saudi commercial registry and news sources.`)
        : Promise.resolve(null),
      // Gemini #3: executives & board (Chrome AI)
      isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${cityRef} CEO chairman general manager board of directors management مدير عام رئيس مجلس الإدارة — full verified names in Arabic and English with exact titles. Check LinkedIn, news, and Saudi business directories.`)
        : Promise.resolve(null),
      // Gemini #4: CR registry data — specifically targets Saudi govt sources (Chrome AI)
      isGeminiConfigured() && company.crNumber
        ? searchWithGemini(`Saudi CR number ${company.crNumber} commercial registry "${companyName}" — legal form, paid-up capital, founding date, registered activities, authorized signatory, shareholders list. Check mc.gov.sa, CR portal, and Saudi chamber of commerce.`)
        : Promise.resolve(null),

      // Claude: direct executive & shareholder research
      (async () => {
        if (!process.env.ANTHROPIC_API_KEY) return null;
        try {
          const msg = await Promise.race([
            anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: `Research the Saudi company "${companyName}"${crRef}${cityRef}. Provide: CEO/GM full name in English and Arabic, key executives (name EN+AR, title), major shareholders (name EN+AR, ownership %), founding year, revenue estimate in SAR, website. Only verified public data.` }] }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
          ]);
          return (msg as { content: Array<{ type: string; text?: string }> }).content[0]?.type === "text" ? (msg as { content: Array<{ type: string; text?: string }> }).content[0].text! : null;
        } catch { return null; }
      })(),
      // OpenAI: executive & company data
      (async () => {
        try {
          const r = await Promise.race([
            openai.chat.completions.create({ model: "gpt-4o", max_completion_tokens: 1000, messages: [{ role: "system", content: "You are a Saudi Arabia B2B intelligence analyst. Provide factual, verified data only." }, { role: "user", content: `What is publicly known about Saudi company "${companyName}"${crRef}? Provide: CEO name (EN+AR), key executives, shareholders with %, revenue, employees, website, industry, city.` }] }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
          ]);
          return (r as { choices: Array<{ message: { content?: string | null } }> }).choices[0]?.message?.content || null;
        } catch { return null; }
      })(),
    ]);

    // Collect results
    let perplexityProfile = "";
    let perplexityNews = "";
    let registrationRaw = "";

    // Source 1: Stealth browser crawl (company website + Saudi directories)
    if (stealthCrawlRes.status === "fulfilled" && stealthCrawlRes.value) {
      const sc = stealthCrawlRes.value;
      if (sc.text) enrichmentParts.push(`[Stealth Browser Content]\n${sc.text.slice(0, 3000)}`);
      if (sc.emails?.length) enrichmentParts.push(`[Contact Emails from Web] ${sc.emails.join(", ")}`);
      if (sc.phones?.length) enrichmentParts.push(`[Contact Phones from Web] ${sc.phones.join(", ")}`);
    }

    // Perplexity results
    if (perplexityProfileResult.status === "fulfilled" && perplexityProfileResult.value) {
      perplexityProfile = perplexityProfileResult.value;
      enrichmentParts.push(`[Perplexity Research]\n${perplexityProfile.slice(0, 3000)}`);
    }
    if (perplexityNewsResult.status === "fulfilled" && perplexityNewsResult.value) {
      perplexityNews = perplexityNewsResult.value;
      enrichmentParts.push(`[Recent News]\n${perplexityNews.slice(0, 2000)}`);
    }
    if (registrationRawResult.status === "fulfilled" && registrationRawResult.value) {
      registrationRaw = registrationRawResult.value;
      enrichmentParts.push(`[Registration & AOA Data]\n${registrationRaw.slice(0, 3000)}`);
    }
    if (perplexityExecsResult.status === "fulfilled" && perplexityExecsResult.value)
      enrichmentParts.push(`[Perplexity Executives]\n${perplexityExecsResult.value.slice(0, 2000)}`);
    if (perplexityShareholdersResult.status === "fulfilled" && perplexityShareholdersResult.value)
      enrichmentParts.push(`[Perplexity Shareholders]\n${perplexityShareholdersResult.value.slice(0, 2000)}`);
    if (perplexityOwnerResult.status === "fulfilled" && perplexityOwnerResult.value)
      enrichmentParts.push(`[Perplexity: Owner & Founder Profile]\n${perplexityOwnerResult.value.slice(0, 2500)}`);
    if (perplexityRevenueResult.status === "fulfilled" && perplexityRevenueResult.value)
      enrichmentParts.push(`[Perplexity: Revenue & Financial Signals]\n${perplexityRevenueResult.value.slice(0, 2500)}`);

    // Gemini Chrome AI results (4 targeted searches — each browses live pages)
    if (geminiProfileResult.status === "fulfilled" && geminiProfileResult.value)
      enrichmentParts.push(`[Gemini: Full Profile]\n${String(geminiProfileResult.value).slice(0, 3000)}`);
    if (geminiShareholdersResult.status === "fulfilled" && geminiShareholdersResult.value)
      enrichmentParts.push(`[Gemini: Shareholders & Ownership]\n${String(geminiShareholdersResult.value).slice(0, 2500)}`);
    if (geminiExecsResult.status === "fulfilled" && geminiExecsResult.value)
      enrichmentParts.push(`[Gemini: Executives & Board]\n${String(geminiExecsResult.value).slice(0, 2500)}`);
    if (geminiContactResult.status === "fulfilled" && geminiContactResult.value)
      enrichmentParts.push(`[Gemini: CR Registry Data]\n${String(geminiContactResult.value).slice(0, 2500)}`);

    // Claude & OpenAI
    if (claudeDirectResult.status === "fulfilled" && claudeDirectResult.value)
      enrichmentParts.push(`[Claude Direct Research]\n${claudeDirectResult.value.slice(0, 2000)}`);
    if (openaiDirectResult.status === "fulfilled" && openaiDirectResult.value)
      enrichmentParts.push(`[OpenAI Research]\n${openaiDirectResult.value.slice(0, 2000)}`);

    emitter && log(emitter as any, `✓ Parallel research complete: ${enrichmentParts.length}/14 sources returned data`, "info");

    // ── Deep research for well-known companies (all 4 APIs, 8 queries) ───────
    if (isWellKnownCompany(company)) {
      emitter && log(emitter as any, `🏢 Well-known company detected — activating deep agentic research`, "info");
      const deepParts = await deepResearchAllAPIs(
        companyName,
        company.nameAr || "",
        company.crNumber || "",
        company.city || "",
        emitter,
      );
      enrichmentParts.push(...deepParts);
    }

    // Extract structured registration data from AOA research using Claude
    let registrationData: {
      crNumber?: string | null;
      legalForm?: string | null;
      legalFormAr?: string | null;
      city?: string | null;
      paidUpCapital?: string | null;
      foundingYear?: string | null;
      foundingDate?: string | null;
      registrationStatus?: string | null;
      authorizedSignatory?: string | null;
      shareholders?: Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>;
      boardOfDirectors?: Array<{ nameEn: string; nameAr: string; role: string; nationalId?: string }>;
      management?: Array<{ nameEn: string; nameAr: string; title: string; nationalId?: string; powers?: string }>;
    } = {};

    const allResearchText = enrichmentParts.join("\n\n---\n\n").slice(0, 7000);
    const combinedContext = enrichmentParts.join("\n\n---\n\n").slice(0, 12000);

    // ── Phase 2: Run Claude (registration+analysis) + GPT-4o (synthesis) IN PARALLEL ──
    // Previously these were 3 sequential calls (~50s). Now 2 parallel calls (~20s).
    const enrichPrompt = `You are an elite Saudi Arabia B2B intelligence analyst. Synthesize ALL research data below for: "${companyName}"

Known data:
- CR Number: ${company.crNumber || "Unknown"}
- City: ${company.city || company.cityAr || "Unknown"}
- Paid-Up Capital: ${company.paidUpCapital || "Unknown"}
- Activity: ${company.mainActivity || company.mainActivityAr || "Unknown"}

Research data:
${combinedContext || "(No external data available)"}

CRITICAL INSTRUCTIONS:
1. revenueEstimate — MANDATORY, NEVER null or empty:
   - If stated in research → use it
   - If NOT stated → DERIVE using Saudi benchmarks:
     * Service/IT/consulting: capital × 10-20x  OR  employees × SAR 800K-1.5M
     * Trading/distribution: capital × 5-12x  OR  employees × SAR 1.5-4M
     * Construction/contracting: capital × 4-10x  OR  employees × SAR 1-2M
     * Manufacturing: capital × 4-8x
   - e.g. SAR 500K capital, service company → "SAR 5M - 10M"
   - Format: "SAR X - Y million". ALWAYS provide a range.
2. ownerName / ownerNameAr: Scan ALL research for CEO, GM, chairman, founder, partner, majority shareholder. Extract the PRIMARY decision-maker with Arabic and English name. This is the most important person field.
3. ownerWealth: Estimate from research. If not found, derive: capital × 15-30x × ownership %. e.g. 100% owner of SAR 2M capital company → "SAR 30M - 60M estimated".

Return ONLY valid JSON:
{
  "website": "https://... or null",
  "phone": "+966... or null",
  "email": "email@company.com or null",
  "address": "Full physical address in Saudi Arabia (street, district, city) or null",
  "employeeCount": "number range like 50-100 or null",
  "revenueEstimate": "SAR X - Y million — MANDATORY derived range, NEVER null",
  "revenueRationale": "state: direct from research / derived from capital SAR X × Y multiplier / derived from employees × benchmark",
  "description": "2-3 sentence company description",
  "ownerName": "Primary owner/founder/chairman full name in English — scan all research sections",
  "ownerNameAr": "الاسم الكامل للمالك/الرئيس بالعربية",
  "ownerTitle": "Chairman/CEO/Founder/Partner/Managing Director",
  "ownerWealth": "SAR X-Y million estimated — derive from company valuation × ownership %",
  "crNumber": "10-digit CR number if found in research data, else null",
  "city": "headquarters city in English (Riyadh/Jeddah/Dammam/etc.) if found, else null",
  "paidUpCapital": "paid-up capital with SAR prefix e.g. SAR 5,000,000 if found, else null",
  "newsHeadlines": [{"title": "...", "date": "YYYY-MM or approx", "source": "source name"}]
}`;

    const claudeCombinedPrompt = `You are a senior Saudi Arabia corporate intelligence specialist. Complete THREE tasks for "${companyName}" using the research below.

Company known fields:
- CR: ${company.crNumber || "N/A"}, City: ${company.city || company.cityAr || "N/A"}
- Legal Form: ${company.legalForm || company.legalFormAr || "N/A"}, Capital: ${company.paidUpCapital || "N/A"}
- Activity: ${company.mainActivity || company.mainActivityAr || "N/A"}

Research data (prioritize [Perplexity: Owner], [Perplexity: Executives], [Perplexity: Shareholders], [Perplexity: Revenue] sections):
${allResearchText}

TASK 1 — Extract structured corporate data (key "registration"):
{
  "crNumber": "10-digit CR or null",
  "legalForm": "LLC/Joint Stock Company/etc or null",
  "legalFormAr": "شركة ذات مسؤولية محدودة / etc or null",
  "city": "city in English or null",
  "paidUpCapital": "SAR X,XXX,XXX or null",
  "foundingYear": "YYYY or null",
  "foundingDate": "full date or null",
  "registrationStatus": "Active or null",
  "authorizedSignatory": "name or null",
  "shareholders": [{"nameEn":"","nameAr":"Arabic script required","nationalId":null,"ownershipPct":"","nationality":"Saudi/Other"}],
  "boardOfDirectors": [{"nameEn":"","nameAr":"Arabic script required","role":"Chairman/Member/etc","nationalId":null}],
  "management": [{"nameEn":"","nameAr":"Arabic script required","title":"CEO/CFO/COO/GM/Managing Director/etc","nationalId":null}]
}
EXTRACTION RULES:
- Only REAL verified persons with actual names. No placeholders ("Unknown", "Undisclosed", "مساهم غير معلن").
- Arabic name (nameAr) in proper Arabic script is REQUIRED for every person — not just transliteration.
- Scan [Perplexity: Owner & Founder Profile] and [Perplexity: Executives] sections — every named person must appear in management or boardOfDirectors.
- Shareholders: scan [Perplexity: Shareholders] and [Perplexity: Owner] sections for all named owners with percentages.
- Empty array [] if truly no real persons found. Never null for arrays.

TASK 2 — Revenue assessment (key "revenueAssessment"):
{
  "revenueEstimate": "MANDATORY — derive if not explicit. Format: SAR X - Y million",
  "revenueRationale": "Direct from research / Derived: capital SAR X × multiplier Y / Derived: employees N × SAR Z/employee",
  "employeeCount": "number or range or null",
  "companyTier": "Micro/Small/Medium/Large"
}
REVENUE DERIVATION RULES (use when no explicit data):
- Service/IT/consulting: capital × 10-20x  OR  employees × SAR 800K-1.5M/person
- Trading/distribution: capital × 5-12x  OR  employees × SAR 1.5-4M/person
- Construction/contracting: capital × 4-10x  OR  employees × SAR 1-2M/person
- Manufacturing: capital × 4-8x
- Company tier: Micro <SAR 3M, Small SAR 3-40M, Medium SAR 40-200M, Large >SAR 200M
- NEVER return null or empty for revenueEstimate.

TASK 3 — Bilingual intelligence report (key "analysis"):
{
  "analysisEn": "3-4 paragraph English analysis: overview, ownership & key persons, activities & revenue assessment with derived estimate, market position",
  "analysisAr": "تحليل بالعربية من 3-4 فقرات: نظرة عامة، الملكية والأشخاص الرئيسيون، الأنشطة وتقييم الإيرادات، الوضع في السوق",
  "riskFactors": ["2-3 risk factors or opportunities"],
  "growthIndicators": ["2-3 growth signals"],
  "dataQuality": "high|medium|low",
  "confidenceScore": 0
}

Return ONLY valid JSON with keys "registration", "revenueAssessment", and "analysis". No other text.`;

    const [claudeCombinedResult, gptSynthesisResult] = await Promise.allSettled([
      // Claude: registration extraction + bilingual analysis (combined)
      Promise.race([
        anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 5000, messages: [{ role: "user", content: claudeCombinedPrompt }] }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
      ]),
      // GPT-4o: enrichment synthesis (contact info, website, revenue)
      Promise.race([
        openai.chat.completions.create({ model: "gpt-4o", max_completion_tokens: 2000, messages: [{ role: "system", content: "You are a Saudi business intelligence analyst. Extract and synthesize company data into structured JSON." }, { role: "user", content: enrichPrompt }] }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 45000)),
      ]),
    ]);

    // Process Claude combined result
    let analysisEn = "";
    let analysisAr = "";
    let analysisData: Record<string, unknown> = {};
    let claudeRevenueEstimate: string | null = null;
    let claudeRevenueRationale: string | null = null;
    let claudeEmployeeCount: string | null = null;
    if (claudeCombinedResult.status === "fulfilled") {
      try {
        const rawText = claudeCombinedResult.value.content[0]?.type === "text" ? claudeCombinedResult.value.content[0].text : "{}";
        const combined = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || "{}") as {
          registration?: typeof registrationData;
          revenueAssessment?: { revenueEstimate?: string; revenueRationale?: string; employeeCount?: string; companyTier?: string };
          analysis?: { analysisEn?: string; analysisAr?: string; riskFactors?: string[]; growthIndicators?: string[]; dataQuality?: string; confidenceScore?: number };
        };
        if (combined.registration) {
          registrationData = combined.registration;
          const persons = (registrationData.shareholders?.length || 0) + (registrationData.boardOfDirectors?.length || 0) + (registrationData.management?.length || 0);
          emitter && log(emitter as any, `📋 Registration complete — ${registrationData.shareholders?.length || 0} shareholders, ${registrationData.boardOfDirectors?.length || 0} board, ${registrationData.management?.length || 0} management (${persons} total)`, "info");
        }
        if (combined.revenueAssessment) {
          claudeRevenueEstimate = combined.revenueAssessment.revenueEstimate || null;
          claudeRevenueRationale = combined.revenueAssessment.revenueRationale || null;
          claudeEmployeeCount = combined.revenueAssessment.employeeCount || null;
          emitter && log(emitter as any, `💰 Revenue assessed: ${claudeRevenueEstimate || "pending GPT-4o"} (${combined.revenueAssessment.companyTier || "?"})`, "info");
        }
        if (combined.analysis) {
          analysisEn = combined.analysis.analysisEn || "";
          analysisAr = combined.analysis.analysisAr || "";
          analysisData = {
            riskFactors: combined.analysis.riskFactors,
            growthIndicators: combined.analysis.growthIndicators,
            dataQuality: combined.analysis.dataQuality,
            confidenceScore: combined.analysis.confidenceScore,
          };
        }
      } catch (e) {
        emitter && log(emitter as any, `⚠ Claude combined parse error: ${(e as Error).message?.substring(0, 60)}`, "warn");
      }
    } else {
      emitter && log(emitter as any, `⚠ Claude combined error: ${(claudeCombinedResult.reason as Error)?.message?.substring(0, 60)}`, "warn");
    }

    // Process GPT-4o synthesis result
    let enriched: Record<string, unknown> = {};
    if (gptSynthesisResult.status === "fulfilled") {
      try {
        const content = gptSynthesisResult.value.choices[0]?.message?.content || "{}";
        const match = content.match(/\{[\s\S]*\}/);
        if (match) enriched = JSON.parse(match[0]) as Record<string, unknown>;
      } catch { /* non-fatal */ }
    } else {
      // Claude fallback for synthesis if GPT fails
      emitter && log(emitter as any, "⚠ GPT-4o synthesis failed — using Claude fallback", "warn");
      try {
        const claudeFallback = await Promise.race([
          anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content: `Saudi business intelligence analyst. Extract company data as JSON.\n\n${enrichPrompt}\n\nReturn ONLY valid JSON.` }] }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
        ]);
        const fc = claudeFallback.content[0]?.type === "text" ? claudeFallback.content[0].text : "{}";
        const fm = fc.match(/\{[\s\S]*\}/);
        if (fm) enriched = JSON.parse(fm[0]) as Record<string, unknown>;
      } catch { /* non-fatal */ }
    }

    // Merge Claude revenue assessment as fallback when GPT-4o returns null/empty
    const finalRevenueEstimate = (enriched.revenueEstimate as string) || claudeRevenueEstimate || null;
    const finalRevenueRationale = (enriched.revenueRationale as string) || claudeRevenueRationale || null;
    const finalEmployeeCount = (enriched.employeeCount as string) || claudeEmployeeCount || null;
    // Merge back so save step uses merged values
    enriched.revenueEstimate = finalRevenueEstimate;
    enriched.revenueRationale = finalRevenueRationale;
    enriched.employeeCount = finalEmployeeCount;

    emitter && log(emitter as any, `✓ Phase 2 synthesis complete — Revenue: ${finalRevenueEstimate || "N/A"}, Owner: ${(enriched.ownerName as string) || "scanning..."}`, "info");

    // Sanitize registration data — strip string "null" values that Claude sometimes returns
    const sanitizeStr = (v: string | null | undefined): string | null => {
      if (!v || v === "null" || v === "undefined" || v === "N/A" || v === "n/a" || v.trim() === "") return null;
      return v.trim();
    };
    registrationData.crNumber = sanitizeStr(registrationData.crNumber);
    registrationData.legalForm = sanitizeStr(registrationData.legalForm);
    registrationData.legalFormAr = sanitizeStr(registrationData.legalFormAr);
    // City validation — only keep known Saudi city names, reject long garbage strings
    const validSaudiCities = ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam", "Khobar", "Dhahran", "Jubail",
      "Yanbu", "Tabuk", "Abha", "Taif", "Hail", "Najran", "Jizan", "Qassim", "Buraydah", "Al Qassim",
      "Khamis Mushait", "Al Ahsa", "Hofuf", "Madinah", "Makkah", "Al Khobar", "Al Jubail", "الرياض", "جدة", "مكة", "المدينة", "الدمام"];
    const rawCity = sanitizeStr(registrationData.city);
    registrationData.city = rawCity && (rawCity.split(" ").length <= 3 && validSaudiCities.some(c => rawCity.toLowerCase().includes(c.toLowerCase()) || rawCity.includes(c))) ? rawCity : rawCity && rawCity.length <= 20 ? rawCity : null;
    registrationData.paidUpCapital = sanitizeStr(registrationData.paidUpCapital);
    registrationData.foundingYear = sanitizeStr(registrationData.foundingYear);
    registrationData.foundingDate = sanitizeStr(registrationData.foundingDate);
    registrationData.registrationStatus = sanitizeStr(registrationData.registrationStatus);
    registrationData.authorizedSignatory = sanitizeStr(registrationData.authorizedSignatory);

    // ── Filter out undisclosed / placeholder persons before saving ────────────
    const isUndisclosedName = (nameEn?: string | null, nameAr?: string | null): boolean => {
      const UNDISCLOSED_PATTERNS = [
        /undisclosed/i, /unknown/i, /not\s*found/i, /غير\s*معلن/u, /مساهم\s*غير/u,
        /shareholder\s*\d+/i, /owner\s*\d+/i, /person\s*\d+/i, /مجهول/u,
        /placeholder/i, /n\/a/i, /^\s*-+\s*$/, /مساهم\s*\d+/u,
      ];
      const combined = `${nameEn || ""} ${nameAr || ""}`.trim();
      if (!combined) return true; // empty name = discard
      return UNDISCLOSED_PATTERNS.some(p => p.test(combined));
    };

    // Merge registration data — only fill columns that are currently empty
    const reg = registrationData;
    const filteredShareholders = (reg.shareholders || []).filter(s => !isUndisclosedName(s.nameEn, s.nameAr));
    const filteredBoard = (reg.boardOfDirectors || []).filter(b => !isUndisclosedName(b.nameEn, b.nameAr));
    const filteredManagement = (reg.management || []).filter(m => !isUndisclosedName(m.nameEn, m.nameAr));
    const newShareholders = filteredShareholders.length > 0 ? filteredShareholders : null;
    const newBoard = filteredBoard.length > 0 ? filteredBoard : null;
    const newManagement = filteredManagement.length > 0 ? filteredManagement : null;

    // Update DB with all enrichment + registration data
    await db.update(masarCompaniesTable)
      .set({
        enrichmentStatus: "enriched",
        enrichedAt: new Date(),
        website: (enriched.website as string) || company.website || null,
        phone: (enriched.phone as string) || company.phone || null,
        email: (enriched.email as string) || company.email || null,
        address: (enriched.address as string) || null,
        employeeCount: (enriched.employeeCount as string) || null,
        revenueEstimate: (enriched.revenueEstimate as string) || null,
        revenueRationale: (enriched.revenueRationale as string) || null,
        newsHeadlines: (enriched.newsHeadlines as Array<{ title: string; date: string; source?: string }>) || [],
        enrichmentData: {
          description: enriched.description,
          ...enriched,
          // Owner / key person fields — always save if present
          ...(enriched.ownerName ? { ownerName: enriched.ownerName } : {}),
          ...(enriched.ownerNameAr ? { ownerNameAr: enriched.ownerNameAr } : {}),
          ...(enriched.ownerTitle ? { ownerTitle: enriched.ownerTitle } : {}),
          ...(enriched.ownerWealth ? { ownerWealth: enriched.ownerWealth } : {}),
        },
        analysisEn,
        analysisAr,
        analysisData,
        // Registration fields — prefer existing DB values, fill if empty
        ...(!company.crNumber && (reg.crNumber || sanitizeStr(enriched.crNumber as string)) ? { crNumber: reg.crNumber || sanitizeStr(enriched.crNumber as string) } : {}),
        ...(!company.city && (reg.city || sanitizeStr(enriched.city as string)) ? { city: reg.city || sanitizeStr(enriched.city as string) } : {}),
        ...(!company.paidUpCapital && (reg.paidUpCapital || (enriched.paidUpCapital as string)) ? { paidUpCapital: reg.paidUpCapital || (enriched.paidUpCapital as string) } : {}),
        ...(!company.legalForm && reg.legalForm ? { legalForm: reg.legalForm } : {}),
        ...(!company.legalFormAr && reg.legalFormAr ? { legalFormAr: reg.legalFormAr } : {}),
        ...(!company.foundingYear && reg.foundingYear ? { foundingYear: reg.foundingYear } : {}),
        ...(!company.foundingDate && reg.foundingDate ? { foundingDate: reg.foundingDate } : {}),
        ...(!company.registrationStatus && reg.registrationStatus ? { registrationStatus: reg.registrationStatus } : {}),
        ...(!company.authorizedSignatory && reg.authorizedSignatory ? { authorizedSignatory: reg.authorizedSignatory } : {}),
        // Structural data — always update if we found something (re-enrich improves data)
        ...(newShareholders ? { shareholders: newShareholders } : {}),
        ...(newBoard ? { boardOfDirectors: newBoard } : {}),
        ...(newManagement ? { management: newManagement } : {}),
      })
      .where(eq(masarCompaniesTable.id, companyId));

    const shCount = newShareholders?.length || 0;
    const bdCount = newBoard?.length || 0;
    const mgmtCount = newManagement?.length || 0;
    const ownerDisplay = (enriched.ownerName as string) || (newManagement?.[0]?.nameEn) || (newShareholders?.[0]?.nameEn) || "Not found";
    emitter && log(emitter as any, `✅ Enriched: ${companyName} — Revenue: ${String(enriched.revenueEstimate || "Derived")} | Owner: ${ownerDisplay} | ${shCount} shareholders | ${bdCount} board | ${mgmtCount} management`, "success");
    emitter && emit(emitter, { type: "company_enriched", company: { nameEn: company.nameEn || undefined, nameAr: company.nameAr || undefined, revenueEstimate: (enriched.revenueEstimate as string) || null }, count: companyId });

    // ── Background Web Seeder: fire-and-forget after enrichment ─────────────
    // Supplements the DB record with team members, services, B2B signals,
    // and contact details discovered by crawling all pages of the website.
    const websiteForSeeder = (enriched.website as string) || company.website;
    if (websiteForSeeder) {
      setImmediate(async () => {
        try {
          const seederResult = await runWebSeeder(websiteForSeeder, companyName, { maxPages: 6 });
          if (!seederResult.success) return;
          const agg = (seederResult.aggregated || {}) as Record<string, unknown>;
          const webTeam = Array.isArray(agg.team)
            ? (agg.team as Array<{ name: string; title: string; nameAr?: string }>)
            : [];
          const webServices = Array.isArray(agg.services) ? (agg.services as string[]) : [];
          const webEmails = seederResult.allEmails || [];
          const webPhones = seederResult.allPhones || [];

          // Re-fetch current state to avoid stomping on fresh data
          const currentRows = await db
            .select()
            .from(masarCompaniesTable)
            .where(eq(masarCompaniesTable.id, companyId))
            .limit(1);
          if (!currentRows.length) return;
          const current = currentRows[0];

          const updates: Record<string, unknown> = {};
          if (!current.email && webEmails[0]) updates.email = webEmails[0];
          if (!current.phone && webPhones[0]) updates.phone = webPhones[0];

          // Supplement management array only if still empty
          if (webTeam.length > 0 && (!current.management || (current.management as unknown[]).length === 0)) {
            updates.management = webTeam.map(t => ({ nameEn: t.name, nameAr: t.nameAr || null, title: t.title }));
          }

          // Persist web seeder findings in enrichmentData
          if (webServices.length > 0 || agg.intelligence) {
            const existingData = (current.enrichmentData as Record<string, unknown>) || {};
            updates.enrichmentData = {
              ...existingData,
              webSeeder: {
                pagesAnalyzed: seederResult.pagesAnalyzed,
                services: webServices,
                b2bSignals: (agg.intelligence as Record<string, unknown>)?.b2bSignals || [],
                techStack: (agg.intelligence as Record<string, unknown>)?.techStack || [],
                keyClients: (agg.intelligence as Record<string, unknown>)?.keyClients || [],
              },
            };
          }

          if (Object.keys(updates).length > 0) {
            await db.update(masarCompaniesTable).set(updates).where(eq(masarCompaniesTable.id, companyId));
            console.log(`[WebSeeder] Supplemented company ${companyId} (${companyName}) — ${seederResult.pagesAnalyzed} pages | team: ${webTeam.length} | services: ${webServices.length}`);
          }
        } catch (e) {
          console.error(`[WebSeeder] Background seeder error for company ${companyId}:`, (e as Error).message?.slice(0, 100));
        }
      });
    }
  } catch (e) {
    console.error("[MasarHarvester] enrichment error:", e);
    await db.update(masarCompaniesTable)
      .set({ enrichmentStatus: "failed" })
      .where(eq(masarCompaniesTable.id, companyId));
  } finally {
    enrichSemaphore.running--;
  }
}

// ─── Saudi Open Data + Bluepages harvesters ─────────────────────────────────

async function harvestFromGovDataSa(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  const counter = { n: 0 };

  try {
    log(emitter as any, `🏛️ Searching Saudi Open Data (data.gov.sa) for: "${keyword}"`, "info");

    // Phase 1: Search CKAN package index for relevant datasets
    const searchUrl = `https://data.gov.sa/api/3/action/package_search?q=${encodeURIComponent(keyword + " companies")}&rows=10&fl=id,name,title,resources`;
    const searchResult = await fetchJson<{ success: boolean; result: { results: Array<{ id: string; name: string; title: string; resources: Array<{ id: string; format: string; url: string; name: string }> }> } }>(searchUrl, 15000);

    const datasets = searchResult?.result?.results ?? [];
    log(emitter as any, `  ↳ Found ${datasets.length} datasets on data.gov.sa`, "info");

    const companies: CompanyData[] = [];
    const seenNames = new Set<string>();

    // Phase 2: Try to fetch CSV/JSON resources from top datasets
    for (const dataset of datasets.slice(0, 5)) {
      const csvResource = dataset.resources?.find(r => ["CSV", "JSON", "XLSX", "XLS"].includes(r.format?.toUpperCase()));
      if (!csvResource?.url) continue;

      try {
        log(emitter as any, `  ↳ Fetching resource: ${dataset.title?.slice(0, 60)}`, "info");
        const text = await fetchSiteHtml(csvResource.url, 15000);
        if (text.length < 100) continue;

        // Parse the raw text with Claude to extract company names
        const extracted = await parseCompaniesWithClaude(text.slice(0, 6000), keyword, "gov-data-sa", emitter as any);
        for (const c of extracted) {
          const key = (c.nameEn || c.nameAr || "").toLowerCase().trim();
          if (key && seenNames.has(key)) continue;
          if (key) seenNames.add(key);
          companies.push({ ...c, source: "gov-data-sa", sourceUrl: csvResource.url });
        }
        await new Promise(r => setTimeout(r, 500));
      } catch { /* skip failed resources */ }
    }

    // Phase 3: Perplexity/Claude enrichment for this source if direct fetch yielded little
    if (companies.length < 5) {
      log(emitter as any, `  ↳ Supplementing with AI research on Saudi Open Data companies...`, "info");

      if (PerplexityService.isConfigured()) {
        const raw = await perplexity.search(
          `Saudi Arabia government open data registered companies "${keyword}": list all company names, CR numbers, cities, activities. Source: data.gov.sa registry.`
        );
        if (raw && raw.length > 50) {
          const extracted = await parseCompaniesWithClaude(raw, keyword, "gov-data-sa", emitter as any);
          for (const c of extracted) {
            const key = (c.nameEn || c.nameAr || "").toLowerCase().trim();
            if (key && seenNames.has(key)) continue;
            if (key) seenNames.add(key);
            companies.push({ ...c, source: "gov-data-sa" });
          }
        }
      } else {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          messages: [{ role: "user", content: `You are a Saudi Arabia business registry expert. List ${keyword} companies registered in Saudi Arabia's official commercial registry (Sijil Al-Tijari). Include companies from all cities, any legal form. For each company provide: nameAr (Arabic), nameEn (English), city, mainActivity, legalForm, crNumber if known, foundingYear if known.\n\nReturn JSON: {"companies": [...]}` }],
        });
        const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
        const parsed = (JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { companies?: CompanyData[] }).companies || [];
        for (const c of parsed) {
          const key = (c.nameEn || c.nameAr || "").toLowerCase().trim();
          if (key && seenNames.has(key)) continue;
          if (key) seenNames.add(key);
          companies.push({ ...c, source: "gov-data-sa" });
        }
      }
    }

    log(emitter as any, `📋 Saudi Open Data: found ${companies.length} companies`, companies.length > 0 ? "success" : "warn");
    for (const c of companies) {
      await seedCompany(c, emitter, "gov-data-sa", counter);
    }
  } catch (e) {
    log(emitter as any, `⚠ Saudi Open Data error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }

  return counter.n;
}

// ─── Bluepages.com.sa harvester ─────────────────────────────────────────────

async function harvestFromBluepages(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  const counter = { n: 0 };
  const seenNames = new Set<string>();

  const processCompanies = async (companies: CompanyData[]) => {
    for (const c of companies) {
      const key = (c.nameEn || c.nameAr || "").toLowerCase().trim();
      if (!key || seenNames.has(key)) continue;
      seenNames.add(key);
      await seedCompany({ ...c, source: "bluepages", sourceUrl: "https://www.bluepages.com.sa" }, emitter, "bluepages", counter);
    }
  };

  try {
    log(emitter as any, `📘 Harvesting Bluepages.com.sa (Saudi Chamber directory) for: "${keyword}"`, "info");

    // Phase 1: StealthBrowser scrape — primary approach
    const searchUrl = `https://www.bluepages.com.sa/en/search?q=${encodeURIComponent(keyword)}`;
    let pageText = "";
    let pageHtml = "";

    try {
      const browser = new StealthBrowser();
      let page;
      try {
        page = await (browser as any).newPage() as any;
        await HumanBehavior.idle(800, 1500);
        await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
        await HumanBehavior.idle(2000, 3500);
        // Scroll down to trigger lazy-loaded company listings
        await page.evaluate(() => window.scrollBy(0, 1500));
        await HumanBehavior.idle(1200, 2000);
        pageHtml = await page.content();
        const $ = cheerio.load(pageHtml);
        $("script, style, nav, footer, header").remove();
        pageText = $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, 12000);
      } finally {
        await browser.stop();
      }
    } catch {
      // Fallback to plain HTTP if StealthBrowser not available
      pageHtml = await fetchSiteHtml(searchUrl, 20000);
      if (pageHtml) {
        const $ = cheerio.load(pageHtml);
        $("script, style, nav, footer, header").remove();
        pageText = $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, 12000);
      }
    }

    // Phase 2: Structural extraction from HTML if we got it
    if (pageHtml) {
      const $ = cheerio.load(pageHtml);
      const structuredCompanies: CompanyData[] = [];

      // Bluepages typically uses cards/list items for companies
      $(".company-card, .listing-item, .business-card, .result-item, [class*='company'], [class*='listing'], article, .item").each((_, el) => {
        const nameEn = $(el).find("h2, h3, h4, .company-name, .name, .title").first().text().trim();
        const nameAr = $(el).find("[lang='ar'], .arabic, .name-ar").first().text().trim();
        const phone = $(el).find("[href^='tel:'], .phone, .tel").first().text().trim() ||
                      $(el).text().match(/(?:\+966|00966|0)\s?\d{2}\s?\d{3}\s?\d{4}/)?.[0] || undefined;
        const city = $(el).find(".city, .location, .address").first().text().trim();
        const category = $(el).find(".category, .sector, .industry").first().text().trim();
        if ((nameEn && nameEn.length > 2 && isValidCompanyName(nameEn)) ||
            (nameAr && nameAr.length > 2)) {
          structuredCompanies.push({
            nameEn: nameEn || undefined,
            nameAr: nameAr || undefined,
            phone: phone || undefined,
            city: city || undefined,
            mainActivity: category || undefined,
          });
        }
      });

      if (structuredCompanies.length > 0) {
        log(emitter as any, `  ↳ Structural extraction: ${structuredCompanies.length} companies`, "success");
        await processCompanies(structuredCompanies);
      }
    }

    // Phase 3: Claude extraction from page text (handles any layout)
    if (pageText.length > 200) {
      log(emitter as any, `  ↳ AI extraction from Bluepages page content (${pageText.length} chars)...`, "info");
      const extracted = await parseCompaniesWithClaude(pageText, keyword, "bluepages", emitter as any);
      log(emitter as any, `  ↳ Claude extracted ${extracted.length} companies from page text`, "success");
      await processCompanies(extracted);
    }

    // Phase 4: Additional pages — try category/industry sub-pages
    const categoryUrls = [
      `https://www.bluepages.com.sa/en/category/${encodeURIComponent(keyword)}`,
      `https://www.bluepages.com.sa/en/industry/${encodeURIComponent(keyword)}`,
      `https://www.bluepages.com.sa/en/search?q=${encodeURIComponent(keyword)}&page=2`,
    ];

    for (const catUrl of categoryUrls) {
      if (counter.n >= 60) break;
      try {
        const html = await fetchSiteHtml(catUrl, 12000);
        if (!html || html.length < 500) continue;
        const $ = cheerio.load(html);
        $("script, style, nav, footer, header").remove();
        const text = $("body").text().replace(/\s{3,}/g, "  ").trim().slice(0, 8000);
        if (text.length < 100) continue;
        const more = await parseCompaniesWithClaude(text, keyword, "bluepages", emitter as any);
        await processCompanies(more);
        await new Promise(r => setTimeout(r, 600));
      } catch { /* non-fatal */ }
    }

    // Phase 5: Perplexity/Claude fallback if very little found
    if (counter.n < 5) {
      log(emitter as any, `  ↳ Supplementing Bluepages data with AI research...`, "info");
      if (PerplexityService.isConfigured()) {
        const raw = await perplexity.search(
          `bluepages.com.sa Saudi Arabia "${keyword}" companies: list all registered business names, phone numbers, cities, and categories from the Blue Pages Saudi commercial directory.`
        );
        if (raw && raw.length > 50) {
          const extracted = await parseCompaniesWithClaude(raw, keyword, "bluepages", emitter as any);
          await processCompanies(extracted);
        }
      } else {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          messages: [{ role: "user", content: `You are a Saudi Arabia business directory expert. The Blue Pages (bluepages.com.sa) is the official directory of companies registered with Saudi Chambers of Commerce across all cities.\n\nList at least 30 Saudi "${keyword}" companies typically found in the Blue Pages directory. For each company provide: nameAr, nameEn, city, phone, mainActivity, legalForm.\n\nReturn JSON: {"companies": [...]}` }],
        });
        const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
        const parsed = (JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { companies?: CompanyData[] }).companies || [];
        await processCompanies(parsed);
      }
    }

    log(emitter as any, `📘 Bluepages harvest complete: ${counter.n} companies seeded`, counter.n > 0 ? "success" : "warn");
  } catch (e) {
    log(emitter as any, `⚠ Bluepages error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }

  return counter.n;
}

// ─── Custom URL harvester ────────────────────────────────────────────────────

async function harvestFromCustomUrl(url: string, keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  let counter = { n: 0 };

  try {
    log(emitter as any, `🔗 Fetching custom source: ${url}`, "info");

    // Support all common template placeholders users might type
    const resolvedUrl = url
      .replace(/\{keyword\}/gi, encodeURIComponent(keyword))
      .replace(/\{search\}/gi, encodeURIComponent(keyword))
      .replace(/\{query\}/gi, encodeURIComponent(keyword))
      .replace(/\{q\}/gi, encodeURIComponent(keyword))
      .replace(/\{term\}/gi, encodeURIComponent(keyword))
      .replace(/\{k\}/gi, encodeURIComponent(keyword));
    const baseUrl = new URL(resolvedUrl);
    const seenNames = new Set<string>();
    const visitedUrls = new Set<string>([resolvedUrl]);

    const scrapeAndSeed = async (pageUrl: string, pageNum: number) => {
      log(emitter as any, `🔗 Scraping page ${pageNum}: ${pageUrl.substring(0, 80)}`, "info");
      const html = await fetchSiteHtml(pageUrl, 25000);
      const $ = cheerio.load(html);

      $("script, style, nav, footer, header").remove();
      const pageText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 10000);

      if (pageText.length < 50) {
        log(emitter as any, `⚠ Page ${pageNum} returned no readable content`, "warn");
        return null;
      }

      log(emitter as any, `📄 Page ${pageNum}: ${pageText.length} chars — parsing...`, "info");
      const companies = await parseCompaniesWithClaude(pageText, keyword, "custom-url", emitter as any);
      log(emitter as any, `📋 Page ${pageNum}: found ${companies.length} companies`, companies.length > 0 ? "success" : "warn");

      for (const c of companies) {
        const nameKey = (c.nameEn || c.nameAr || "").toLowerCase().trim();
        if (nameKey && seenNames.has(nameKey)) continue;
        if (nameKey) seenNames.add(nameKey);
        await seedCompany({ ...c, source: "open-data", sourceUrl: pageUrl }, emitter, "custom-url", counter);
      }

      // Find next-page link
      const nextLink =
        $("a[rel='next'], a:contains('Next'), a:contains('التالي'), a:contains('>'), .pagination a.next, .next-page a").first().attr("href") ||
        $("a[href]").filter((_, el) => {
          const href = $(el).attr("href") || "";
          const txt = $(el).text().trim();
          return /page[=\/]\d+|&p=\d+|\?page=\d+|next|التالي/.test(href + txt);
        }).first().attr("href");

      if (nextLink) {
        try {
          const nextUrl = nextLink.startsWith("http") ? nextLink : new URL(nextLink, baseUrl.origin).href;
          return nextUrl;
        } catch { return null; }
      }
      // Try incrementing page number in URL if present
      const pageMatch = pageUrl.match(/([?&]page=)(\d+)/);
      if (pageMatch) {
        const nextPageUrl = pageUrl.replace(pageMatch[0], `${pageMatch[1]}${parseInt(pageMatch[2]) + 1}`);
        return nextPageUrl;
      }
      return null;
    };

    // Scrape up to 10 pages
    let currentUrl: string | null = resolvedUrl;
    let pageNum = 1;
    while (currentUrl && pageNum <= 10 && counter.n < 300) {
      if (pageNum > 1 && visitedUrls.has(currentUrl)) break;
      visitedUrls.add(currentUrl);
      const nextUrl = await scrapeAndSeed(currentUrl, pageNum);
      currentUrl = nextUrl;
      pageNum++;
      if (currentUrl) await new Promise(r => setTimeout(r, 800)); // polite delay
    }

  } catch (e) {
    log(emitter as any, `⚠ Custom URL error (${url}): ${e instanceof Error ? e.message : String(e)}`, "warn");
  }

  return counter.n;
}

// ─── Sector-specific harvester configs ──────────────────────────────────────

interface SectorConfig {
  name: string;
  nameAr: string;
  perplexityQuery: (keyword: string) => string;
  sourceLabel: string;
}

const SECTOR_CONFIGS: Record<string, SectorConfig> = {
  contractors: {
    name: "Saudi Contractors",
    nameAr: "المقاولون السعوديون",
    sourceLabel: "muqawil.gov.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia licensed construction contractors from muqawil.gov.sa Saudi Contractors Authority, related to "${kw}".
      Return 20+ real Saudi companies with: full Arabic name (اسم الشركة بالعربي), English name, city (المدينة), specialization (التخصص), founding year if known.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"...","foundingYear":"...","registrationStatus":"Active","legalForm":"..."}]}`,
  },
  lawyers: {
    name: "Law Firms & Lawyers",
    nameAr: "مكاتب المحاماة",
    sourceLabel: "saudilawyers.org.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia licensed law firms and legal offices from the Saudi Bar Association related to "${kw}".
      Return 20+ real Saudi law firms with: full Arabic name, English name, city, specialization (corporate/litigation/real estate/etc), founding year.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"Legal services","foundingYear":"...","registrationStatus":"Active","legalForm":"Partnership"}]}`,
  },
  etimad: {
    name: "Etimad Gov. Suppliers",
    nameAr: "موردو منصة اعتماد",
    sourceLabel: "etimad.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia companies and suppliers registered on Etimad government procurement platform (etimad.sa) qualified for "${kw}" tenders.
      Return 20+ real Saudi companies with: Arabic name, English name, city, sector/specialization, company type (contractor/supplier/consultant).
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"...","registrationStatus":"Active","legalForm":"...","foundingYear":"..."}]}`,
  },
  auditors: {
    name: "Auditors & Accountants",
    nameAr: "مراجعو الحسابات",
    sourceLabel: "socpa.org.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia SOCPA (Saudi Organization for Certified Public Accountants) licensed audit firms and accounting offices related to "${kw}".
      Return 20+ real Saudi firms with: Arabic name, English name, city, specialization, founding year if known.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"Auditing and accounting","foundingYear":"...","registrationStatus":"Active","legalForm":"..."}]}`,
  },
  healthcare: {
    name: "Healthcare & Medical",
    nameAr: "الرعاية الصحية",
    sourceLabel: "moh.gov.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia Ministry of Health licensed hospitals, medical centers, pharmaceutical and healthcare companies related to "${kw}".
      Return 20+ real Saudi organizations with: Arabic name, English name, city, type (hospital/clinic/pharma/medical devices), founding year.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"...","foundingYear":"...","registrationStatus":"Active","legalForm":"..."}]}`,
  },
  banks: {
    name: "Banks & Finance",
    nameAr: "البنوك والمالية",
    sourceLabel: "sama.gov.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia SAMA (Saudi Central Bank) licensed banks, finance companies, insurance companies and financial institutions related to "${kw}".
      Return 20+ real Saudi organizations with: Arabic name, English name, city, type (bank/finance company/insurance/fintech), SAMA license number if known, founding year.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"...","foundingYear":"...","registrationStatus":"Active","legalForm":"..."}]}`,
  },
  realestate: {
    name: "Real Estate Developers",
    nameAr: "التطوير العقاري",
    sourceLabel: "rega.gov.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia REGA (Real Estate General Authority) licensed real estate developers, brokers and property companies related to "${kw}".
      Return 20+ real Saudi companies with: Arabic name, English name, city, specialization (residential/commercial/mixed), projects if known, founding year.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"Real estate development","foundingYear":"...","registrationStatus":"Active","legalForm":"..."}]}`,
  },
  industrial: {
    name: "Industrial & Manufacturing",
    nameAr: "الصناعة والتصنيع",
    sourceLabel: "modon.gov.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia MODON (Saudi Industrial Property Authority) licensed industrial and manufacturing companies related to "${kw}".
      Return 20+ real Saudi manufacturers with: Arabic name, English name, city/industrial zone, product type, founding year, authorized capital if known.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"...","foundingYear":"...","registrationStatus":"Active","legalForm":"...","paidUpCapital":"..."}]}`,
  },
  logistics: {
    name: "Logistics & Freight",
    nameAr: "اللوجستيات والشحن",
    sourceLabel: "mawani.gov.sa",
    perplexityQuery: (kw) =>
      `List Saudi Arabia licensed freight, logistics, shipping, warehousing and supply chain companies related to "${kw}".
      Return 20+ real Saudi companies with: Arabic name, English name, city, services (freight/warehousing/customs/courier), founding year.
      Format as JSON: {"companies":[{"nameAr":"...","nameEn":"...","city":"...","mainActivity":"Logistics and freight","foundingYear":"...","registrationStatus":"Active","legalForm":"..."}]}`,
  },
};

// ─── Sector-specific AI harvester ────────────────────────────────────────────

async function harvestFromSectorSearch(sectorId: string, keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;

  const config = SECTOR_CONFIGS[sectorId];
  if (!config) {
    log(emitter as any, `⚠ Unknown sector source: ${sectorId}`, "warn");
    return 0;
  }

  const counter = { n: 0 };
  const seenNamesLocal = new Set<string>();

  async function seedBatch(companies: CompanyData[], batchLabel: string) {
    log(emitter as any, `📋 ${config.name} (${batchLabel}): found ${companies.length} companies`, companies.length > 0 ? "success" : "warn");
    for (const c of companies) {
      if (!isValidCompanyName(c.nameAr || c.nameEn || "")) continue;
      const nameKey = ((c.nameEn || c.nameAr || "")).toLowerCase().trim();
      if (nameKey && seenNamesLocal.has(nameKey)) continue;
      if (nameKey) seenNamesLocal.add(nameKey);
      await seedCompany({ ...c, source: "open-data", sourceUrl: `https://${config.sourceLabel}` }, emitter as any, config.name, counter);
    }
  }

  try {
    log(emitter as any, `🔍 Searching ${config.name} database for "${keyword}"...`, "info");

    if (!PerplexityService.isConfigured()) {
      log(emitter as any, `⚠ Perplexity not configured — using Claude (multi-pass) for ${config.name} data`, "warn");

      // Pass 1: first batch of companies
      const claudePrompt1 = config.perplexityQuery(keyword);
      const msg1 = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: `Based on your knowledge of Saudi Arabia business registry, ${claudePrompt1}\n\nReturn only valid JSON.` }],
      });
      const text1 = msg1.content[0]?.type === "text" ? msg1.content[0].text : "{}";
      const match1 = text1.match(/\{[\s\S]*\}/);
      const batch1 = (JSON.parse(match1 ? match1[0] : "{}") as { companies?: CompanyData[] }).companies || [];
      await seedBatch(batch1, "pass 1");

      // Pass 2: ask for additional companies not in the first batch (diversified)
      if (counter.n < 25) {
        const seededNames = batch1.map(c => c.nameEn || c.nameAr || "").filter(Boolean).slice(0, 10).join(", ");
        const msg2 = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [{ role: "user", content: `Based on your knowledge of Saudi Arabia business registry, ${claudePrompt1}\n\nYou already gave me these companies: ${seededNames || "none"}. Now give me at LEAST 15 DIFFERENT Saudi companies in the same sector — avoid duplicates and focus on smaller/mid-size companies not widely known. Return only valid JSON in the same format.` }],
        });
        const text2 = msg2.content[0]?.type === "text" ? msg2.content[0].text : "{}";
        const match2 = text2.match(/\{[\s\S]*\}/);
        const batch2 = (JSON.parse(match2 ? match2[0] : "{}") as { companies?: CompanyData[] }).companies || [];
        await seedBatch(batch2, "pass 2");
      }

      return counter.n;
    }

    // ── Perplexity multi-pass ──────────────────────────────────────────────
    // Pass 1
    const query1 = config.perplexityQuery(keyword);
    const raw1 = await perplexity.search(query1);

    if (raw1 && raw1.trim().length >= 30) {
      let companies1 = await parseCompaniesWithGPT(raw1, keyword, "open-data", emitter, jobId);
      if (companies1.length === 0) companies1 = await parseCompaniesWithClaude(raw1, keyword, "open-data", emitter as any);
      await seedBatch(companies1, "pass 1");
    } else {
      log(emitter as any, `⚠ ${config.name}: no data returned from pass 1`, "warn");
    }

    // Pass 2: request more if we have fewer than 20 companies
    if (counter.n < 20) {
      try {
        const query2 = `${query1} — focus on small and mid-size companies, regional firms, and lesser-known businesses not covered in a typical top-10 list. Give me at least 10 different companies.`;
        const raw2 = await perplexity.search(query2);
        if (raw2 && raw2.trim().length >= 30) {
          let companies2 = await parseCompaniesWithGPT(raw2, keyword, "open-data", emitter, jobId);
          if (companies2.length === 0) companies2 = await parseCompaniesWithClaude(raw2, keyword, "open-data", emitter as any);
          await seedBatch(companies2, "pass 2");
        }
      } catch { /* non-fatal — pass 1 results are enough */ }
    }

  } catch (e) {
    log(emitter as any, `⚠ ${config.name} search error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }

  return counter.n;
}

// ─── OpenCorporates SA harvester ─────────────────────────────────────────────

async function harvestFromOpenCorporatesSource(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  const counter = { n: 0 };
  log(emitter as any, `🏛️ Querying OpenCorporates SA jurisdiction for "${keyword}"...`, "info");
  try {
    const companies = await harvestOpenCorporatesSA(keyword, 3);
    log(emitter as any, `📋 OpenCorporates: ${companies.length} records returned`, companies.length > 0 ? "success" : "warn");
    for (const c of companies) {
      if (!c.nameEn) continue;
      if (!isValidCompanyName(c.nameEn)) continue;
      await seedCompany(
        {
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          crNumber: c.crNumber,
          foundingYear: c.foundingYear,
          registrationStatus: c.status,
          legalForm: c.companyType,
          source: "opencorporates",
          sourceUrl: c.sourceUrl,
        },
        emitter,
        "OpenCorporates",
        counter
      );
    }
  } catch (e) {
    log(emitter as any, `⚠ OpenCorporates error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
  return counter.n;
}

// ─── GLEIF SA harvester ────────────────────────────────────────────────────────

async function harvestFromGleifSource(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  const counter = { n: 0 };
  log(emitter as any, `🔏 Querying GLEIF for Saudi legal entities matching "${keyword}"...`, "info");
  try {
    const companies = await harvestGleifSA(keyword, 50);
    log(emitter as any, `📋 GLEIF: ${companies.length} records returned`, companies.length > 0 ? "success" : "warn");
    for (const c of companies) {
      if (!c.nameEn) continue;
      if (!isValidCompanyName(c.nameEn)) continue;
      await seedCompany(
        {
          nameEn: c.nameEn,
          city: c.city,
          registrationStatus: c.status || "Active",
          foundingYear: c.foundingYear,
          source: "gleif",
          sourceUrl: c.sourceUrl,
        },
        emitter,
        "GLEIF",
        counter
      );
    }
  } catch (e) {
    log(emitter as any, `⚠ GLEIF error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
  return counter.n;
}

// ─── Wikidata SPARQL SA harvester ──────────────────────────────────────────────

async function harvestFromWikidataSource(keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  const counter = { n: 0 };
  log(emitter as any, `🌐 Querying Wikidata SPARQL for Saudi companies matching "${keyword}"...`, "info");
  try {
    const companies = await harvestWikidataSA(keyword);
    log(emitter as any, `📋 Wikidata: ${companies.length} records returned`, companies.length > 0 ? "success" : "warn");
    for (const c of companies) {
      if (!c.nameEn) continue;
      if (!isValidCompanyName(c.nameEn)) continue;
      await seedCompany(
        {
          nameEn: c.nameEn,
          city: c.city,
          foundingYear: c.foundingYear,
          source: "wikidata",
          sourceUrl: c.sourceUrl,
        },
        emitter,
        "Wikidata",
        counter
      );
    }
  } catch (e) {
    log(emitter as any, `⚠ Wikidata error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }
  return counter.n;
}

// ─── Professional directory scrapers (MooresRowland + chambers + etc.) ─────────

const DIRECTORY_SOURCES: DirectorySource[] = [
  "mooresrowland",
  "arabbritishchamber",
  "amcham-saudi",
  "sbbc",
  "jcc",
  "french-chamber-ksa",
  "german-arab-chamber",
  "gcc-chambers",
  "icaew",
];

async function harvestFromDirectorySource(source: DirectorySource, keyword: string, jobId: string): Promise<number> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return 0;
  const counter = { n: 0 };
  const label = DIRECTORY_SOURCE_LABELS[source];
  log(emitter as any, `🏢 Scraping ${label} for Saudi member firms...`, "info");

  try {
    const members = await harvestFromDirectory(source, emitter as any);
    log(emitter as any, `📋 ${label}: ${members.length} Saudi members found`, members.length > 0 ? "success" : "warn");

    for (const m of members) {
      if (!m.nameEn && !m.nameAr) continue;
      if (m.nameEn && !isValidCompanyName(m.nameEn)) continue;
      if (m.nameAr && !isValidCompanyName(m.nameAr)) continue;

      // Apply keyword filter — only seed if relevant to search term (loose match)
      if (keyword && keyword !== "Saudi Arabia companies") {
        const haystack = `${m.nameEn || ""} ${m.nameAr || ""} ${m.mainActivity || ""} ${m.description || ""}`.toLowerCase();
        const kwWords = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const relevant = kwWords.length === 0 || kwWords.some(w => haystack.includes(w));
        if (!relevant) continue;
      }

      await seedCompany(
        {
          nameEn: m.nameEn,
          nameAr: m.nameAr,
          website: m.website,
          phone: m.phone,
          email: m.email,
          city: m.city,
          region: m.region,
          mainActivity: m.mainActivity,
          source: source,
          sourceUrl: m.sourceUrl,
          registrationStatus: "Active",
        },
        emitter,
        label,
        counter
      );
    }
  } catch (e) {
    log(emitter as any, `⚠ ${label} error: ${e instanceof Error ? e.message : String(e)}`, "warn");
  }

  return counter.n;
}

// ─── Main harvest runner ────────────────────────────────────────────────────

export async function runHarvest(
  jobId: string,
  keyword: string,
  sources: string[],
  customUrls: string[] = [],
  options: HarvestOptions = {},
): Promise<void> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return;

  // Store user instructions/context for this job
  harvestContexts.set(jobId, options);

  const primarySource = sources.includes("amaaly-aoa") && sources.length === 1 ? "amaaly-aoa" : "open-data";

  // Create DB job record
  await db.insert(masarHarvestJobsTable)
    .values({ jobId, keyword, source: primarySource, status: "running" } as any)
    .onConflictDoNothing();

  // Log user instructions if provided
  if (options.instructions) {
    log(emitter as any, `📋 Agent Instructions: "${options.instructions.slice(0, 200)}${options.instructions.length > 200 ? "…" : ""}"`, "info");
  }
  if (options.sector) log(emitter as any, `🏭 Sector filter: ${options.sector}`, "info");
  const activeParams = Object.entries(options.parameters || {}).filter(([, v]) => v);
  if (activeParams.length > 0) {
    log(emitter as any, `🔧 Filters: ${activeParams.map(([k, v]) => `${k}=${v}`).join(", ")}`, "info");
  }

  try {
    let totalSeeded = 0;

    for (const src of sources) {
      if (src === "open-data" || src === "wikipedia") {
        log(emitter as any, `🌐 Starting Wikipedia + AI Search harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromOpenData(keyword, jobId);
      } else if (src === "amaaly-aoa") {
        log(emitter as any, `🗞️ Starting Amaaly AOA harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromAmaaly(keyword, jobId);
      } else if (src === "gov-data-sa") {
        log(emitter as any, `🏛️ Starting Saudi Open Data (data.gov.sa) harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromGovDataSa(keyword, jobId);
      } else if (src === "opencorporates") {
        log(emitter as any, `🌍 Starting OpenCorporates SA API harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromOpenCorporatesSource(keyword, jobId);
      } else if (src === "gleif") {
        log(emitter as any, `🔏 Starting GLEIF legal entity harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromGleifSource(keyword, jobId);
      } else if (src === "wikidata-sparql") {
        log(emitter as any, `🌐 Starting Wikidata SPARQL harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromWikidataSource(keyword, jobId);
      } else if (src === "bluepages") {
        log(emitter as any, `📘 Starting Bluepages.com.sa harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromBluepages(keyword, jobId);
      } else if ((DIRECTORY_SOURCES as string[]).includes(src)) {
        totalSeeded += await harvestFromDirectorySource(src as DirectorySource, keyword, jobId);
      } else if (src in SECTOR_CONFIGS) {
        const cfg = SECTOR_CONFIGS[src]!;
        log(emitter as any, `🔍 Starting ${cfg.name} harvest for "${keyword}"...`, "info");
        totalSeeded += await harvestFromSectorSearch(src, keyword, jobId);
      }
    }

    for (const url of customUrls) {
      if (url.trim()) {
        totalSeeded += await harvestFromCustomUrl(url.trim(), keyword, jobId);
      }
    }

    // Update job record
    await db.update(masarHarvestJobsTable)
      .set({ companiesFound: totalSeeded, status: totalSeeded > 0 ? "enriching" : "completed" })
      .where(eq(masarHarvestJobsTable.jobId, jobId));

    if (totalSeeded === 0) {
      log(emitter as any, "⚠ No companies found. Try a different keyword or source.", "warn");
      emit(emitter, { type: "complete", count: 0 });
      await db.update(masarHarvestJobsTable).set({ status: "completed", completedAt: new Date() } as any).where(eq(masarHarvestJobsTable.jobId, jobId));
      // Layer 6 — Activepieces (non-blocking)
      onBuilderComplete({ jobId, harvested: 0, enriched: 0, sources }).catch(() => {});
      return;
    }

    // ── Emit harvest-complete immediately — enrichment runs fully in background ──
    log(emitter as any, `✅ Seeding complete — ${totalSeeded} companies found. Enrichment will continue in background.`, "success");
    emit(emitter, { type: "complete", count: totalSeeded });
    // Layer 6 — Activepieces (non-blocking)
    onBuilderComplete({ jobId, harvested: totalSeeded, enriched: 0, sources }).catch(() => {});
    await db.update(masarHarvestJobsTable)
      .set({ companiesFound: totalSeeded, status: "enriching" })
      .where(eq(masarHarvestJobsTable.jobId, jobId));

    // Fire enrichment as a completely detached background task (does not block SSE stream)
    setImmediate(async () => {
      try {
        const pendingCompanies = await db
          .select({ id: masarCompaniesTable.id })
          .from(masarCompaniesTable)
          .where(eq(masarCompaniesTable.enrichmentStatus, "pending"))
          .limit(Math.min(totalSeeded + 5, 50));

        let enrichedCount = 0;
        const batchSize = ENRICH_CONCURRENCY;

        for (let i = 0; i < pendingCompanies.length; i += batchSize) {
          const batch = pendingCompanies.slice(i, i + batchSize);
          await Promise.allSettled(batch.map(({ id }) => enrichMasarCompany(id, undefined)));
          enrichedCount += batch.length;
        }

        await db.update(masarHarvestJobsTable)
          .set({ companiesEnriched: enrichedCount, status: "completed", completedAt: new Date() })
          .where(eq(masarHarvestJobsTable.jobId, jobId));

        console.log(`[Harvest] Background enrichment done: ${enrichedCount} companies enriched for job ${jobId}`);
      } catch (e) {
        console.error(`[Harvest] Background enrichment error for job ${jobId}:`, e);
        await db.update(masarHarvestJobsTable)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(masarHarvestJobsTable.jobId, jobId));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log(emitter as any, `💥 Harvest failed: ${msg}`, "error");
    emit(emitter, { type: "error", error: msg });
    await db.update(masarHarvestJobsTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(masarHarvestJobsTable.jobId, jobId));
  } finally {
    harvestContexts.delete(jobId);
  }
}
