// ─── MASAAR ENGINE — 5-Agent Saudi Corporate Intelligence Pipeline ──────────────
//
//  Agent 1 │ MC.gov.sa Registry        — stealth browser + CAPTCHA + Claude CR parse
//  Agent 2 │ Amaaly AOA Intelligence   — stealth search, latest AOA PDF, OCR, translate
//  Agent 3 │ Deep Research             — Perplexity×5, Gemini×4, Claude, GPT-4o + stubs
//  Agent 4 │ Compliance & Sanctions    — OFAC, UN SC, EU, CMA, SAMA, ZATCA, Maroof, Najiz
//  Agent 5 │ Bilingual Report Compiler — Claude (primary) + GPT-4o → EN + AR
//
// ─────────────────────────────────────────────────────────────────────────────────

import axios from "axios";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";
import { StealthBrowser, autoSolveCaptcha, HumanBehavior } from "./stealth-browser.js";
import { openai as sharedOpenai } from "./openai.js";
import { isGeminiConfigured, searchWithGemini } from "../gemini-search.js";
import { nexusExtract, nexusSynthesize } from "./nexus/index.js";
import { scoutSignalsRegulatory, scoutSiteIntel } from "./scout-client.js";
import { onMasaarComplete } from "./activepieces-client.js";
import { scrapePage } from "./power-scraper.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});
const openai = sharedOpenai;

// ─── Perplexity Helper ────────────────────────────────────────────────────────

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
async function perplexitySearch(query: string, maxTokens = 2000): Promise<string | null> {
  if (!PERPLEXITY_API_KEY) return null;
  const { canSpend, recordSpend } = await import("./paid-api-guard.js");
  if (!canSpend("perplexity")) return null;
  try {
    const r = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a Saudi Arabia B2B intelligence analyst specializing in corporate data mining. Provide precise, factual verified data. Include full names in both Arabic and English.",
          },
          { role: "user", content: query },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
        return_citations: true,
      },
      {
        headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
        timeout: 35000,
      },
    );
    recordSpend("perplexity");
    return r.data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ─── OpenRouter Stub ──────────────────────────────────────────────────────────
// Activate by setting OPENROUTER_API_KEY in environment variables.
// Supported models: deepseek/deepseek-r1, meta-llama/llama-3.3-70b-instruct, moonshot/moonshot-v1-8k

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

async function openRouterQuery(
  model: string,
  prompt: string,
  systemPrompt = "You are a Saudi Arabia B2B intelligence analyst. Provide factual verified data in both Arabic and English where applicable.",
  maxTokens = 2000,
): Promise<string | null> {
  if (!OPENROUTER_API_KEY) return null; // stub — activates when OPENROUTER_API_KEY is set
  try {
    const r = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://prospectsa.com",
          "X-Title": "ProspectSA Intelligence",
        },
        timeout: 45000,
      },
    );
    return r.data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ─── Groq Stub ────────────────────────────────────────────────────────────────
// Activate by setting GROQ_API_KEY in environment variables.

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function groqQuery(
  model: string,
  prompt: string,
  systemPrompt = "You are a Saudi Arabia B2B intelligence analyst. Provide factual verified data.",
  maxTokens = 2000,
): Promise<string | null> {
  if (!GROQ_API_KEY) return null; // stub — activates when GROQ_API_KEY is set
  try {
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,
      },
      {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 35000,
      },
    );
    return r.data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentEvent {
  type:
    | "agent_start"
    | "agent_log"
    | "agent_complete"
    | "agent_error"
    | "captcha_required"
    | "captcha_solved"
    | "stealth_solving"
    | "stealth_solved"
    | "stealth_session"
    | "job_complete"
    | "job_error";
  agentNum?: number;
  agentName?: string;
  message?: string;
  data?: Record<string, unknown>;
  report?: MasaarReport;
  captchaFor?: string;
  captchaScreenshot?: string;
  captchaLabel?: string;
  stealthMethod?: "ai" | "human" | "session";
  captchaCode?: string;
}

export interface ComplianceResult {
  ofac: { hit: boolean; entries: string[]; matchScore: string };
  unsc: { hit: boolean; entries: string[] };
  eu: { hit: boolean; entries: string[] };
  maroof: { verified: boolean; rating: string | null; data: string };
  saudiRegulatory: {
    cma: { hit: boolean; notes: string };
    sama: { hit: boolean; notes: string };
    zatca: { hit: boolean; notes: string };
    najiz: { agencies: Array<Record<string, string>>; found: boolean };
  };
  newsFlags: string[];
  overallRisk: "low" | "medium" | "high" | "unknown";
  riskSummary: string;
  checkedAt: string;
}

export interface MasaarReport {
  crNumber: string;
  fetchedAt: string;
  stealthMode: boolean;
  sources: {
    mcGovSa: Record<string, unknown>;
    emagazine: Record<string, unknown>;
    najiz: Record<string, unknown>;
  };
  parsed: {
    nameEn: string | null;
    nameAr: string | null;
    crNumber: string | null;
    legalForm: string | null;
    legalFormAr: string | null;
    headquarterCity: string | null;
    headquarterCityAr: string | null;
    foundingYear: string | null;
    fiscalYear: string | null;
    capitalAmount: string | null;
    capitalDistribution: string | null;
    estimatedRevenue: string | null;
    summaryEn: string | null;
    summaryAr: string | null;
    contactDetails: Record<string, string>;
    shareholders: Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>;
    managers: Array<{ nameEn: string; nameAr: string; nationalId: string; title?: string; appointmentTerm: string; powers: string }>;
    boardComposition: string | null;
    shareTransferRestrictions: string | null;
    profitDistributionRules: string | null;
    dissolutionConditions: string | null;
    amendmentProcedures: string | null;
  };
  aoa: Record<string, unknown>;
  compliance?: ComplianceResult;
  legalAgencies: Array<Record<string, unknown>>;
  conflicts: Array<{
    field: string;
    source1: string;
    value1: string;
    source2: string;
    value2: string;
    severity?: string;
    recommendation?: string;
  }>;
  reportAr: string;
  reportEn: string;
}

// ─── Job Registry ─────────────────────────────────────────────────────────────

interface JobState {
  emitter: EventEmitter;
  captchaResolvers: Map<string, (text: string) => void>;
  stealthMode: boolean;
  stealthBrowser?: StealthBrowser;
}

const jobs = new Map<string, JobState>();

export function getJobEmitter(jobId: string): EventEmitter | undefined {
  return jobs.get(jobId)?.emitter;
}

export function createJob(jobId: string, stealthMode = true): EventEmitter {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  jobs.set(jobId, { emitter, captchaResolvers: new Map(), stealthMode });
  setTimeout(async () => {
    const state = jobs.get(jobId);
    if (state?.stealthBrowser) {
      try { await state.stealthBrowser.stop(); } catch { /* ignore */ }
    }
    jobs.delete(jobId);
  }, 45 * 60 * 1000);
  return emitter;
}

export function submitCaptcha(jobId: string, captchaFor: string, captchaText: string): boolean {
  const state = jobs.get(jobId);
  if (!state) return false;
  const resolver = state.captchaResolvers.get(captchaFor);
  if (!resolver) return false;
  resolver(captchaText);
  state.captchaResolvers.delete(captchaFor);
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(emitter: EventEmitter, event: AgentEvent) {
  emitter.emit("event", event);
}

function log(emitter: EventEmitter, agentNum: number, agentName: string, message: string) {
  emit(emitter, { type: "agent_log", agentNum, agentName, message });
}

async function waitForCaptchaHuman(
  jobId: string,
  captchaFor: string,
  emitter: EventEmitter,
  screenshotBase64: string,
  label: string,
  timeoutMs = 180000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const state = jobs.get(jobId);
    if (!state) { reject(new Error("Job not found")); return; }
    const timer = setTimeout(() => {
      state.captchaResolvers.delete(captchaFor);
      reject(new Error("CAPTCHA timeout after 3 minutes — please try again"));
    }, timeoutMs);
    state.captchaResolvers.set(captchaFor, (text) => {
      clearTimeout(timer);
      resolve(text);
    });
    emit(emitter, { type: "captcha_required", captchaFor, captchaScreenshot: screenshotBase64, captchaLabel: label });
  });
}

async function resolveCaptcha(
  jobId: string,
  captchaFor: string,
  emitter: EventEmitter,
  browser: StealthBrowser,
  label: string,
  agentNum: number,
  agentName: string,
): Promise<string> {
  const state = jobs.get(jobId);
  if (!state) throw new Error("Job not found");

  if (state.stealthMode) {
    const siteHint =
      captchaFor === "mc_gov_sa"
        ? "Saudi Ministry of Commerce (mc.gov.sa)"
        : "emagazine.aamaly.sa Saudi business portal";

    emit(emitter, {
      type: "stealth_solving",
      agentNum,
      agentName,
      captchaFor,
      message: `🤖 Stealth AI analyzing CAPTCHA for ${siteHint}...`,
    });

    const result = await autoSolveCaptcha(browser, {
      maxAttempts: 3,
      hint: siteHint,
      onAttempt: (attempt, code, confidence) => {
        if (code) {
          log(emitter, agentNum, agentName, `🤖 AI CAPTCHA attempt ${attempt}: "${code}" (confidence: ${confidence})`);
        } else {
          log(emitter, agentNum, agentName, `🤖 AI attempt ${attempt}: CAPTCHA unclear — retrying...`);
        }
      },
      onFallback: async () => {
        log(emitter, agentNum, agentName, "⚠ AI could not solve CAPTCHA — requesting manual input as fallback");
        const screenshot = await browser.screenshot();
        return waitForCaptchaHuman(jobId, captchaFor, emitter, screenshot, label);
      },
    });

    if (result.code) {
      emit(emitter, {
        type: "stealth_solved",
        agentNum,
        agentName,
        captchaFor,
        stealthMethod: (result.method === "failed" ? undefined : result.method) as "ai" | "human" | "session" | undefined,
        captchaCode: result.code,
        message:
          result.method === "ai"
            ? `✓ CAPTCHA auto-solved by AI: "${result.code}" (${result.attempts} attempt${result.attempts > 1 ? "s" : ""})`
            : `✓ CAPTCHA solved via manual input: "${result.code}"`,
      });
      return result.code;
    }
    throw new Error("CAPTCHA solving failed after all attempts");
  } else {
    const screenshot = await browser.screenshot();
    return waitForCaptchaHuman(jobId, captchaFor, emitter, screenshot, label);
  }
}

// ─── Agent 1a: MC.gov.sa Stealth Browser ─────────────────────────────────────

async function agent1a_fetchMcGovSa(crNumber: string, jobId: string, emitter: EventEmitter): Promise<Record<string, unknown>> {
  const name = "MC.gov.sa Registry";
  emit(emitter, { type: "agent_start", agentNum: 1, agentName: name });

  const state = jobs.get(jobId)!;
  const stealthBrowser = new StealthBrowser((msg) => log(emitter, 1, name, msg));
  state.stealthBrowser = stealthBrowser;

  const result: Record<string, unknown> = { crNumber, rawText: "", rawHtml: "" };

  try {
    log(emitter, 1, name, `🥷 Launching stealth browser (anti-detection mode)...`);
    await stealthBrowser.start("mc.gov.sa");

    const targetUrl = "https://mc.gov.sa/ar/eservices/Pages/Commercial-data.aspx";
    log(emitter, 1, name, `Navigating to mc.gov.sa Arabic CR lookup portal...`);
    await stealthBrowser.goto(targetUrl);

    const challenge = await stealthBrowser.detectChallenge();
    if (challenge === "cloudflare") {
      await stealthBrowser.waitForCloudflare();
    }

    log(emitter, 1, name, `Page loaded — scanning for CAPTCHA...`);

    let captchaText = "";
    let searchSuccess = false;

    for (let attempt = 1; attempt <= 4; attempt++) {
      if (attempt > 1) {
        log(emitter, 1, name, `Reload attempt ${attempt} — fetching fresh CAPTCHA...`);
        await stealthBrowser.goto(targetUrl);
        await HumanBehavior.idle(1200, 2500);
      }

      captchaText = await resolveCaptcha(
        jobId, "mc_gov_sa", emitter, stealthBrowser,
        "Enter the verification code shown on the mc.gov.sa page", 1, name,
      );
      if (!captchaText) continue;

      const crSelectors = [
        'input[placeholder*="رقم"]', 'input[placeholder*="Search"]',
        'input[type="text"]:first-of-type', "#searchTxt", "#txtSearch",
        'input[name*="search" i]', 'input[id*="search" i]',
      ];
      const crFilled = await stealthBrowser.fillFirst(crSelectors, crNumber);
      if (!crFilled) {
        log(emitter, 1, name, "Using JS fallback to fill CR number field");
        await stealthBrowser.page?.evaluate((cr) => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='text'], input:not([type])"));
          const vis = inputs.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          if (vis[0]) { vis[0].value = cr; vis[0].dispatchEvent(new Event("input", { bubbles: true })); }
        }, crNumber);
      }

      await HumanBehavior.idle(200, 500);

      const captchaInputSelectors = [
        'input[id*="captcha" i]', 'input[name*="captcha" i]',
        'input[placeholder*="رمز"]', 'input[placeholder*="verification" i]',
        'input[placeholder*="code" i]',
      ];
      const captchaFilled = await stealthBrowser.fillFirst(captchaInputSelectors, captchaText);
      if (!captchaFilled) {
        await stealthBrowser.page?.evaluate((code) => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='text'], input:not([type])"));
          const vis = inputs.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          if (vis[1]) { vis[1].value = code; vis[1].dispatchEvent(new Event("input", { bubbles: true })); }
        }, captchaText);
      }

      await HumanBehavior.idle(300, 700);

      const btnSelectors = [
        'input[type="submit"]', 'button[type="submit"]', "button.btn-primary",
        '.btn-search', 'button:has-text("بحث")', 'button:has-text("Search")',
        'input[value*="بحث"]', 'input[value*="Search"]',
      ];
      await stealthBrowser.clickFirst(btnSelectors);

      log(emitter, 1, name, "Form submitted — waiting for results...");
      await HumanBehavior.idle(3500, 5000);

      const resultSS = await stealthBrowser.screenshot(true);
      result.resultScreenshot = resultSS;

      const pageContent = await stealthBrowser.getContent();
      const $ = cheerio.load(pageContent);
      $("script, style, header, footer, nav").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000);

      const gotResults =
        text.includes(crNumber) ||
        text.includes("السجل") ||
        text.includes("الشركة") ||
        text.includes("رأس المال") ||
        (text.length > 600 && !text.includes("لا توجد نتائج") && !text.includes("No Records"));

      if (gotResults) {
        result.rawText = text;
        result.rawHtml = pageContent.slice(0, 10000);
        result.success = true;
        log(emitter, 1, name, `✓ CR data retrieved (${text.length} chars, attempt ${attempt})`);
        searchSuccess = true;
        break;
      } else {
        log(emitter, 1, name, `⚠ No results on attempt ${attempt} — CAPTCHA may have been incorrect, retrying...`);
        result.rawText = text;
      }
    }

    if (!searchSuccess) {
      log(emitter, 1, name, "⚠ All CAPTCHA attempts exhausted — proceeding with available data");
      result.success = false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log(emitter, 1, name, `⚠ Error: ${msg}`);
    result.error = msg;
    result.success = false;
  }

  return result;
}

// ─── Agent 1b: Claude CR Intelligence (internal — emits under Agent 1) ────────

async function agent1b_parseCrFields(crNumber: string, rawData: Record<string, unknown>, emitter: EventEmitter): Promise<Record<string, unknown>> {
  const name = "CR Intelligence (Claude)";
  log(emitter, 1, name, "Parsing CR data with Claude Sonnet (bilingual)...");

  let rawText = String(rawData.rawText || "");

  if (!rawText || rawText.length < 100) {
    log(emitter, 1, name, `⚠ No web data from mc.gov.sa — trying Perplexity CR lookup for ${crNumber}...`);
    const perpCr = await perplexitySearch(
      `Saudi Arabia commercial registration CR number "${crNumber}": company name in Arabic and English, legal form, city, founding year, business activities, website, phone. Official registry data only.`,
      2000,
    ).catch(() => null);
    if (perpCr && perpCr.length > 80) {
      rawText = `[Perplexity CR Lookup]\n${perpCr}`;
      log(emitter, 1, name, `✓ Perplexity returned ${perpCr.length} chars for CR ${crNumber}`);
    } else {
      log(emitter, 1, name, "⚠ Perplexity also returned no data — Claude will infer from CR number");
    }
  }

  const prompt = `You are a Saudi commercial registration data analyst.
CR Number queried: ${crNumber}

Raw text extracted from mc.gov.sa (official Saudi Ministry of Commerce portal):
"""
${rawText.slice(0, 6000) || "(no web data available — synthesize from CR number if possible)"}
"""

Extract ALL available fields. Return ONLY valid JSON:
{
  "nameEn": "English name or null",
  "nameAr": "الاسم بالعربي — PRIMARY output, used for all subsequent agent lookups",
  "crNumber": "${crNumber}",
  "legalForm": "LLC / JSC / etc",
  "legalFormAr": "م.م.م / شركة مساهمة / etc",
  "headquarterCity": "City in English",
  "headquarterCityAr": "المدينة",
  "foundingYear": "YYYY or null",
  "issueDate": "date string or null",
  "expiryDate": "date string or null",
  "capitalAmount": "SAR amount or null",
  "registrationStatus": "Active / Inactive / etc",
  "registrationStatusAr": "نشط / منتهي",
  "mainActivity": "activity description",
  "mainActivityAr": "وصف النشاط",
  "branchCount": "number or null",
  "dataConfidence": "verified|inferred|unknown",
  "notes": "any relevant notes"
}`;

  // Agent 1 parse: Claude (primary) + NEXUS extraction (parallel, cheap fallback)
  let parsed: Record<string, unknown> = { crNumber };
  try {
    const [claudeResult, nexusResult] = await Promise.allSettled([
      anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
      nexusExtract(prompt, "Extract Saudi CR data as JSON. Return only the JSON object. No markdown.", { maxTokens: 2048, temperature: 0 }),
    ]);

    // Claude wins if successful; NEXUS fills gaps
    if (claudeResult.status === "fulfilled") {
      const text = claudeResult.value.content[0].type === "text" ? claudeResult.value.content[0].text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : parsed;
    } else if (nexusResult.status === "fulfilled") {
      const raw = nexusResult.value;
      parsed = typeof raw === "object" ? (raw as Record<string, unknown>) : parsed;
      log(emitter, 1, name, `ℹ Claude unavailable — used NEXUS extraction`);
    }

    // NEXUS fills any gaps Claude left empty
    if (claudeResult.status === "fulfilled" && nexusResult.status === "fulfilled") {
      const nexusRaw = nexusResult.value as Record<string, unknown>;
      for (const key of Object.keys(nexusRaw)) {
        if (!parsed[key] && nexusRaw[key]) parsed[key] = nexusRaw[key];
      }
    }

    log(emitter, 1, name, `✓ Parsed ${Object.keys(parsed).length} fields (confidence: ${String(parsed.dataConfidence || "unknown")})`);
    if (parsed.nameAr) log(emitter, 1, name, `Arabic name (feeds Agent 2): ${String(parsed.nameAr)} / ${String(parsed.nameEn || "—")}`);

    emit(emitter, { type: "agent_complete", agentNum: 1, agentName: "MC.gov.sa Registry", data: parsed });
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    log(emitter, 1, name, `⚠ Claude error: ${msg}`);
    emit(emitter, { type: "agent_complete", agentNum: 1, agentName: "MC.gov.sa Registry", data: { crNumber } });
    return { crNumber };
  }
}

// ─── AOA Document Scoring ─────────────────────────────────────────────────────

const AOA_PRIORITY_KEYWORDS = [
  "إعلان قرار الشركاء بتعديل النظام الأساسي",
  "تعديل النظام الأساسي",
  "قرار الشركاء",
  "موائمة شركة",
  "موائمة",
  "اصدار شركة",
  "إصدار شركة",
  "تحول",
  "عقد التأسيس",
  "النظام الأساسي",
  "نظام الشركة",
];

function scoreAoaDocument(title: string, excerpt: string): number {
  const text = `${title} ${excerpt}`;
  let score = 0;
  if (/إعلان قرار الشركاء.*النظام الأساسي/u.test(text)) score += 10;
  if (/تعديل النظام الأساسي/u.test(text)) score += 8;
  if (/موائمة/u.test(text)) score += 7;
  if (/اصدار شركة|إصدار شركة/u.test(text)) score += 7;
  if (/تحول/u.test(text)) score += 6;
  if (/عقد التأسيس/u.test(text)) score += 5;
  if (/النظام الأساسي/u.test(text)) score += 4;
  if (/نظام الشركة/u.test(text)) score += 3;
  for (const kw of AOA_PRIORITY_KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }
  return score;
}

function extractPageContent(html: string, baseUrl = "https://emagazine.aamaly.sa") {
  const $ = cheerio.load(html);
  $("script, style, nav, header").remove();

  const pdfUrls: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href.toLowerCase().includes(".pdf")) {
      const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
      if (!pdfUrls.includes(fullUrl)) pdfUrls.push(fullUrl);
    }
  });

  const articles: Array<{ title: string; excerpt: string; link: string; date: string; score: number; pdfUrl?: string }> = [];
  const selectors = ["article", ".article", ".post", ".item", "[class*='article']", "[class*='result']", ".entry", "li[class*='news']", "div[class*='news']"];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const title = $(el).find("h1,h2,h3,h4,.title,.heading").first().text().trim();
      const excerpt = $(el).find("p,.excerpt,.summary,.content,.desc").first().text().trim();
      const rawLink = $(el).find("a").first().attr("href") || "";
      const link = rawLink.startsWith("http") ? rawLink : rawLink ? `${baseUrl}${rawLink}` : "";
      const date = $(el).find("time,.date,[class*='date'],.published").first().text().trim();
      const pdfHref = $(el).find("a[href*='.pdf']").first().attr("href") || "";
      const pdfUrl = pdfHref ? (pdfHref.startsWith("http") ? pdfHref : `${baseUrl}${pdfHref}`) : undefined;
      if (title && title.length > 3) {
        const score = scoreAoaDocument(title, excerpt);
        articles.push({ title, excerpt: excerpt.slice(0, 300), link, date, score, ...(pdfUrl ? { pdfUrl } : {}) });
      }
    });
  }

  const rawText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);
  const nextPageLink = (() => {
    const candidates = ['a:contains("التالي")', 'a:contains("Next")', 'a[rel="next"]', '.pagination .next', '[aria-label="Next page"]', 'a[class*="next"]'];
    for (const sel of candidates) {
      try {
        const href = $(sel).first().attr("href");
        if (href) return href.startsWith("http") ? href : `${baseUrl}${href}`;
      } catch { /* skip */ }
    }
    return null;
  })();

  return { pdfUrls, articles, rawText, nextPageLink };
}

// ─── Agent 2: Amaaly AOA Intelligence ────────────────────────────────────────
// Searches emagazine.aamaly.sa using Arabic name → finds latest AOA PDF
// → OCRs the Arabic PDF → Claude translates & extracts all corporate fields

async function agent2_aoaIntelligence(
  nameAr: string,
  nameEn: string,
  crData: Record<string, unknown>,
  jobId: string,
  emitter: EventEmitter,
): Promise<Record<string, unknown>> {
  const name = "Amaaly AOA Intelligence";
  emit(emitter, { type: "agent_start", agentNum: 2, agentName: name });

  const searchQuery = nameAr || nameEn || "";
  log(emitter, 2, name, `Searching emagazine.aamaly.sa for: "${searchQuery}" (Arabic name priority)`);

  const result: Record<string, unknown> = { articles: [], pdfUrls: [], searchQuery, pdfFound: false, aoa: {} };

  if (!searchQuery) {
    log(emitter, 2, name, "⚠ No company name available — skipping Amaaly search");
    emit(emitter, { type: "agent_complete", agentNum: 2, agentName: name, data: result });
    return result;
  }

  // NEXUS additional layer (power-scraper) — best-effort text extraction for enrichment evidence
  // This runs *beside* the StealthBrowser flow (not replacing it).
  try {
    const nexusSearchUrl = `https://emagazine.aamaly.sa/search?q=${encodeURIComponent(searchQuery)}`;
    log(emitter, 2, name, `🧠 power-scraper preflight ✓ ${nexusSearchUrl}`);
    const r = await scrapePage(nexusSearchUrl, {
      engines: ["cheerio", "playwright", "playwright-stealth"],
      minContentLength: 200,
      timeoutMs: 20000,
    });
    if (r && !r.blocked && !r.error && r.text && r.text.trim().length >= 200) {
      // Seed rawText so later agents have extra context even if StealthBrowser pages are blocked/limited
      const seed = r.text.trim().slice(0, 4000);
      result.rawText = seed;
      log(emitter, 2, name, `✓ power-scraper seeded enrichment rawText (${seed.length} chars)`);
    }
  } catch (err) {
    // non-fatal; StealthBrowser remains the primary path
    log(emitter, 2, name, `⚠ power-scraper preflight failed — continuing with StealthBrowser`);
  }

  let stealthBrowser: StealthBrowser | null = null;
  let browserWorking = true;

  try {
    stealthBrowser = new StealthBrowser((msg) => log(emitter, 2, name, msg));
    log(emitter, 2, name, "🥷 Launching stealth browser → emagazine.aamaly.sa/search");
    await stealthBrowser.start("emagazine.aamaly.sa").catch(async (launchErr: unknown) => {
      log(emitter, 2, name, `⚠ Browser launch failed: ${launchErr instanceof Error ? launchErr.message : String(launchErr)} — will use HTTP + Perplexity fallback`);
      browserWorking = false;
    });
    if (!browserWorking) throw Object.assign(new Error("browser_unavailable"), { isBrowserUnavailable: true });

    const searchPageUrl = "https://emagazine.aamaly.sa/search";
    log(emitter, 2, name, `→ Navigating to ${searchPageUrl}`);
    await stealthBrowser.goto(searchPageUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await HumanBehavior.idle(1500, 2500);

    const cf = await stealthBrowser.detectChallenge();
    if (cf === "cloudflare") {
      log(emitter, 2, name, "⏳ Cloudflare challenge — waiting...");
      await stealthBrowser.waitForCloudflare();
      await HumanBehavior.idle(1000, 2000);
    }

    const searchInputSelectors = [
      'input[placeholder*="اكتب كلمة البحث"]',
      'input[placeholder*="بحث"]',
      'input[placeholder*="كلمة"]',
      'input[type="search"]',
      'input[name="q"]',
      'input[name="search"]',
      'input[name="keyword"]',
      'input[id*="search" i]',
      'input[class*="search" i]',
      'form input[type="text"]',
    ];

    let searchTyped = false;
    for (const sel of searchInputSelectors) {
      try {
        const el = await stealthBrowser.page?.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await HumanBehavior.idle(150, 300);
          await stealthBrowser.humanType(sel, searchQuery);
          await HumanBehavior.idle(400, 700);
          log(emitter, 2, name, `✓ Typed "${searchQuery}" in search box (${sel})`);
          searchTyped = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!searchTyped) {
      log(emitter, 2, name, "⚠ Could not find search input — trying JS injection");
      try {
        await stealthBrowser.page?.evaluate((q: string) => {
          const inputs = Array.from(document.querySelectorAll("input"));
          for (const inp of inputs) {
            if (inp.type !== "hidden" && inp.type !== "radio" && inp.type !== "checkbox") {
              inp.focus(); inp.value = q;
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              break;
            }
          }
        }, searchQuery);
        searchTyped = true;
      } catch { /* non-fatal */ }
    }

    const submitSelectors = [
      'button[type="submit"]', 'input[type="submit"]',
      'button:has-text("بحث")', 'button:has-text("Search")',
      '.search-btn', '[class*="search-button"]',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const el = await stealthBrowser.page?.$(sel);
        if (el) { await el.click(); submitted = true; log(emitter, 2, name, `✓ Clicked search button (${sel})`); break; }
      } catch { /* try next */ }
    }
    if (!submitted) {
      await stealthBrowser.page?.keyboard.press("Enter");
      log(emitter, 2, name, "✓ Pressed Enter to submit search");
    }

    await HumanBehavior.idle(2500, 4000);

    log(emitter, 2, name, '→ Applying "الشركات" filter');
    const companiesFilterSelectors = [
      'input[type="radio"][value*="شركات"]',
      'input[type="radio"][value*="companies" i]',
      'label:has-text("الشركات") input[type="radio"]',
      'label:has-text("الشركات")',
    ];
    let filterApplied = false;
    for (const sel of companiesFilterSelectors) {
      try {
        const el = await stealthBrowser.page?.$(sel);
        if (el) { await el.click(); filterApplied = true; log(emitter, 2, name, `✓ "الشركات" filter clicked`); await HumanBehavior.idle(1500, 2500); break; }
      } catch { /* try next */ }
    }
    if (!filterApplied) {
      try {
        await stealthBrowser.page?.evaluate(() => {
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
        filterApplied = true;
        await HumanBehavior.idle(1500, 2500);
        log(emitter, 2, name, '✓ "الشركات" filter applied via JS');
      } catch { log(emitter, 2, name, '⚠ Could not apply "الشركات" filter — continuing'); }
    }

    const pageContentCheck = await stealthBrowser.getContent();
    const hasCaptcha = /captcha|verification|robot|تحقق/i.test(pageContentCheck);
    if (hasCaptcha) {
      log(emitter, 2, name, "🛡 CAPTCHA detected — engaging stealth solver...");
      const captchaText = await resolveCaptcha(jobId, "emagazine", emitter, stealthBrowser, "Enter the verification code shown on emagazine.aamaly.sa", 2, name);
      if (captchaText) {
        const captchaInputSelectors = ['input[id*="captcha" i]', 'input[name*="captcha" i]', 'input[type="text"]:last-of-type'];
        await stealthBrowser.fillFirst(captchaInputSelectors, captchaText);
        await stealthBrowser.clickFirst(['button[type="submit"]', 'input[type="submit"]', 'button:has-text("بحث")', 'button:has-text("Submit")']);
        await HumanBehavior.idle(3000, 5000);
      }
    }

    const allPdfUrls: string[] = [];
    const allArticles: Array<{ title: string; excerpt: string; link: string; date: string; score: number; pdfUrl?: string }> = [];
    const visitedUrls = new Set<string>();
    const MAX_PAGES = 6;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await stealthBrowser.getContent();
      const { pdfUrls, articles, nextPageLink } = extractPageContent(html);

      for (const url of pdfUrls) { if (!allPdfUrls.includes(url)) allPdfUrls.push(url); }
      for (const art of articles) { if (art.title && !allArticles.find(a => a.title === art.title)) allArticles.push(art); }

      log(emitter, 2, name, `Page ${page}: found ${articles.length} articles, ${pdfUrls.length} PDFs`);

      const highPriorityArticles = allArticles
        .filter(a => a.score >= 4 && a.link && !visitedUrls.has(a.link) && !a.pdfUrl)
        .slice(0, 3);

      for (const art of highPriorityArticles) {
        visitedUrls.add(art.link);
        try {
          log(emitter, 2, name, `📄 Visiting AOA article: "${art.title.slice(0, 60)}"...`);
          await stealthBrowser.goto(art.link, { waitUntil: "domcontentloaded", timeout: 8000 });
          await HumanBehavior.idle(800, 1500);
          const detailHtml = await stealthBrowser.getContent();
          const { pdfUrls: detailPdfs } = extractPageContent(detailHtml);
          for (const url of detailPdfs) {
            if (!allPdfUrls.includes(url)) {
              allPdfUrls.push(url);
              art.pdfUrl = url;
              log(emitter, 2, name, `✓ Found PDF in article detail: ${url}`);
            }
          }
          await stealthBrowser.page?.goBack({ waitUntil: "domcontentloaded" });
          await HumanBehavior.idle(800, 1200);
        } catch { /* non-fatal */ }
      }

      if (!nextPageLink || page === MAX_PAGES) break;
      if (visitedUrls.has(nextPageLink)) break;
      visitedUrls.add(nextPageLink);

      let navigated = false;
      try {
        const nextClicked = await stealthBrowser.clickFirst([
          'a:has-text("التالي")', 'a:has-text("Next")', '[rel="next"]', '.pagination .next', 'a[class*="next"]',
        ]);
        if (nextClicked) { await HumanBehavior.idle(2000, 3500); navigated = true; log(emitter, 2, name, `➡ Page ${page + 1} via next button`); }
      } catch { /* fall through */ }

      if (!navigated) {
        try {
          await stealthBrowser.goto(nextPageLink, { waitUntil: "domcontentloaded", timeout: 10000 });
          await HumanBehavior.idle(2000, 3000);
          log(emitter, 2, name, `➡ Page ${page + 1} via URL`);
        } catch { log(emitter, 2, name, `⚠ Could not navigate to page ${page + 1}`); break; }
      }
    }

    allArticles.sort((a, b) => b.score - a.score);
    const aoaArticles = allArticles.filter(a => a.score >= 4);
    const otherArticles = allArticles.filter(a => a.score < 4);

    result.pdfUrls = allPdfUrls.slice(0, 20);
    result.articles = allArticles.slice(0, 20);
    result.aoaArticles = aoaArticles.slice(0, 10);
    result.otherArticles = otherArticles.slice(0, 10);
    result.rawText = allArticles.map(a => `${a.title}: ${a.excerpt}`).join("\n").slice(0, 5000);

    log(emitter, 2, name, `✓ Multi-page scan: ${allArticles.length} articles (${aoaArticles.length} AOA priority), ${allPdfUrls.length} PDFs`);
    if (aoaArticles.length > 0) {
      log(emitter, 2, name, `📜 Top AOA docs: ${aoaArticles.slice(0, 3).map(a => a.title.slice(0, 50)).join(" | ")}`);
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "unknown";
    const isBrowserUnavailable = (err as { isBrowserUnavailable?: boolean }).isBrowserUnavailable === true;
    if (isBrowserUnavailable) {
      log(emitter, 2, name, "🔄 Browser unavailable — switching to HTTP + Perplexity fallback");
    } else {
      log(emitter, 2, name, `⚠ Browser error: ${errMsg} — trying HTTP fallback`);
    }

    try {
      const httpUrl = `https://emagazine.aamaly.sa/search?q=${encodeURIComponent(searchQuery)}`;
      log(emitter, 2, name, `→ HTTP fallback: ${httpUrl}`);
      const httpRes = await axios.get(httpUrl, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.5",
        },
      });
      if (httpRes.data && String(httpRes.data).length > 300) {
        const { pdfUrls: httpPdfs, articles: httpArticles } = extractPageContent(String(httpRes.data));
        result.pdfUrls = httpPdfs.slice(0, 10);
        result.articles = httpArticles.slice(0, 10);
        result.aoaArticles = httpArticles.filter(a => a.score >= 4).slice(0, 5);
        log(emitter, 2, name, `✓ HTTP fallback: ${httpArticles.length} articles, ${httpPdfs.length} PDFs`);
      }
    } catch { /* fall through */ }

    if (!result.rawText || String(result.rawText).length < 100) {
      try {
        log(emitter, 2, name, "→ Perplexity fallback for emagazine.aamaly.sa...");
        const perpResult = await perplexitySearch(
          `site:emagazine.aamaly.sa "${searchQuery}" عقد تأسيس OR نظام أساسي OR مساهمون شركة`,
          2000,
        );
        if (perpResult && perpResult.length > 100) {
          result.rawText = perpResult.slice(0, 3000);
          log(emitter, 2, name, `✓ Perplexity fallback: ${perpResult.length} chars`);
        }
      } catch { log(emitter, 2, name, "⚠ Perplexity fallback also failed"); }
    }
  } finally {
    if (stealthBrowser) await stealthBrowser.stop().catch(() => {});
  }

  // ── AOA PDF Download + OCR + Translation ─────────────────────────────────
  log(emitter, 2, name, "Searching for best AOA PDF to download and OCR...");

  const directPdfUrls = (result.pdfUrls as string[]) || [];
  const aoaArticles2 = (result.aoaArticles as Array<{ pdfUrl?: string }>) || [];
  const articlePdfs = aoaArticles2.filter(a => a.pdfUrl).map(a => a.pdfUrl!);
  const allPdfCandidates = [...new Set([...directPdfUrls, ...articlePdfs])];

  let pdfText = "";
  let usedPdfUrl = "";

  if (allPdfCandidates.length > 0) {
    log(emitter, 2, name, `Found ${allPdfCandidates.length} PDF candidate(s) — downloading latest AOA...`);
    for (const pdfUrl of allPdfCandidates.slice(0, 8)) {
      try {
        log(emitter, 2, name, `Downloading: ${pdfUrl}`);
        const res = await axios.get(pdfUrl, {
          responseType: "arraybuffer",
          timeout: 40000,
          headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ar-SA,ar;q=0.9" },
        });
        const buf = Buffer.from(res.data as ArrayBuffer);
        const pdfParseModule = await import("pdf-parse"); const pdfParse = (pdfParseModule as any).default || pdfParseModule;
        const parsed = await pdfParse(buf);
        const text = parsed.text.trim().slice(0, 18000);
        if (text.length > 200) {
          pdfText = text;
          usedPdfUrl = pdfUrl;
          result.pdfFound = true;
          result.pdfUrl = pdfUrl;
          result.pageCount = parsed.numpages;
          log(emitter, 2, name, `✓ AOA PDF downloaded and parsed: ${pdfText.length} chars, ${parsed.numpages} pages`);
          break;
        }
      } catch (err) {
        log(emitter, 2, name, `PDF failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
  }

  if (pdfText) {
    result.pdfText = pdfText.slice(0, 4000);
    log(emitter, 2, name, "📖 Translating Arabic AOA PDF with Claude Sonnet...");
  } else {
    log(emitter, 2, name, "📭 No AOA PDF found — Claude will extract from available CR registry data");
    result.pdfText = "";
  }

  // ── Claude: Extract + Translate AOA fields ────────────────────────────────
  const companyNameAr = String(crData.nameAr || "");
  const companyNameEn = String(crData.nameEn || "");
  const crNum = String(crData.crNumber || "");

  const pdfContext = pdfText
    ? `Raw Arabic text from AOA PDF (emagazine.aamaly.sa — ${usedPdfUrl}):\n"""\n${pdfText}\n"""`
    : `No AOA PDF found on emagazine.aamaly.sa.\n\nUse the CR registry data below to infer corporate structure:\n${JSON.stringify(crData, null, 2).slice(0, 2000)}`;

  const aoaPrompt = `You are a Saudi corporate intelligence analyst specializing in Arabic Articles of Association (عقود التأسيس / النظام الأساسي).

Company: ${companyNameAr} / ${companyNameEn}
CR Number: ${crNum}

${pdfContext}

${pdfText
  ? "Extract ALL fields from the Arabic AOA PDF above. Translate accurately to English. Do not summarize — extract exact values including shareholder IDs, ownership percentages, manager appointments, and all governance provisions."
  : "No AOA PDF exists. Extract all available data from CR registry data. Mark dataSource as \"cr-inferred\"."
}

Return ONLY valid JSON:
{
  "companyNameAr": "اسم الشركة بالعربي",
  "companyNameEn": "Company Name in English",
  "crNumber": "${crNum}",
  "foundingYear": "YYYY or null",
  "legalForm": "LLC|JSC|Sole Proprietorship|etc or null",
  "legalFormAr": "ش.م.م | ش.م.س | etc or null",
  "headquarterCity": "City in English or null",
  "headquarterCityAr": "المدينة بالعربي or null",
  "fiscalYear": "fiscal year dates or null",
  "capitalAmount": "SAR amount or null",
  "capitalDistribution": "how capital is divided among shareholders or null",
  "estimatedRevenue": "revenue estimate if found or null",
  "employees": "headcount if mentioned or null",
  "companySummaryEn": "3-4 sentence company summary in English",
  "companySummaryAr": "ملخص 3-4 جمل بالعربي",
  "contactDetails": { "address": "physical address or null", "phone": "phone number or null", "email": "email or null", "website": "website URL or null" },
  "shareholders": [{ "nameEn": "Full Name", "nameAr": "الاسم بالعربي", "nationalId": "ID or null", "ownershipPct": "percentage", "nationality": "Saudi|etc" }],
  "managers": [{ "nameEn": "Full Name", "nameAr": "الاسم بالعربي", "nationalId": "ID or null", "title": "CEO|GM|CFO|etc", "appointmentTerm": "term or null", "powers": "powers or null" }],
  "boardComposition": "board structure or null",
  "shareTransferRestrictions": "transfer rules from AOA or null",
  "profitDistributionRules": "profit distribution from AOA or null",
  "dissolutionConditions": "dissolution conditions from AOA or null",
  "amendmentProcedures": "amendment rules from AOA or null",
  "dataSource": "${pdfText ? "aoa-pdf" : "cr-inferred"}"
}`;

  // Agent 2 parse: Claude (primary) + NEXUS extraction (parallel)
  try {
    const [claudeAoaResult, nexusAoaResult] = await Promise.allSettled([
      anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 4096, messages: [{ role: "user", content: aoaPrompt }] }),
      nexusExtract(aoaPrompt, "Extract AOA/ownership data as JSON. Return only the JSON object.", { maxTokens: 3000, temperature: 0 }),
    ]);

    let aoa: Record<string, unknown> = {};
    if (claudeAoaResult.status === "fulfilled") {
      const text = claudeAoaResult.value.content[0].type === "text" ? claudeAoaResult.value.content[0].text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      aoa = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } else if (nexusAoaResult.status === "fulfilled") {
      const raw = nexusAoaResult.value;
      aoa = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      log(emitter, 2, name, `ℹ Claude unavailable — used NEXUS extraction for AOA`);
    }

    // NEXUS fills AOA gaps
    if (claudeAoaResult.status === "fulfilled" && nexusAoaResult.status === "fulfilled") {
      const nexusAoa = nexusAoaResult.value as Record<string, unknown>;
      for (const key of Object.keys(nexusAoa)) {
        if (!aoa[key] && nexusAoa[key]) aoa[key] = nexusAoa[key];
      }
    }

    result.aoa = aoa;

    const shareholders = (aoa.shareholders as unknown[]) || [];
    const managers = (aoa.managers as unknown[]) || [];
    log(emitter, 2, name, `✓ AOA intelligence complete: ${shareholders.length} shareholders, ${managers.length} managers${pdfText ? " (from PDF)" : " (from CR data)"}`);
    if (shareholders.length > 0) {
      const shNames = (shareholders as Array<{ nameEn?: string; nameAr?: string }>)
        .slice(0, 3).map(s => s.nameEn || s.nameAr || "—").join(", ");
      log(emitter, 2, name, `Shareholders: ${shNames}`);
    }
  } catch (err) {
    log(emitter, 2, name, `⚠ AOA extraction error: ${err instanceof Error ? err.message : "unknown"}`);
    result.aoa = {};
  }

  emit(emitter, { type: "agent_complete", agentNum: 2, agentName: name, data: result });
  return result;
}

// ─── Agent 3: Deep Research Intelligence ─────────────────────────────────────
// ALWAYS fires — even when AOA PDF found.
// Perplexity×5 + Gemini×4 + Claude + GPT-4o + OpenRouter stubs + Groq stub
// Total active: 12 engines | Stub engines: DeepSeek-R1, Llama-3.3, Kimi, Groq

async function agent3_deepResearch(
  companyName: string,
  crNumber: string,
  nameAr: string,
  emitter: EventEmitter,
): Promise<string> {
  const agentNum = 3;
  const agentName = "Deep Research Intelligence";
  emit(emitter, { type: "agent_start", agentNum, agentName });

  const crRef = crNumber ? ` CR ${crNumber}` : "";
  const arRef = nameAr ? ` (${nameAr})` : "";
  const companyRef = `"${companyName}"${arRef}`;
  const activeStubs = [
    OPENROUTER_API_KEY ? "OpenRouter(DeepSeek+Llama+Kimi)" : null,
    GROQ_API_KEY ? "Groq(Llama)" : null,
  ].filter(Boolean);

  log(emitter, agentNum, agentName, `🔭 Firing ALL research engines for ${companyRef}${crRef}...`);
  log(emitter, agentNum, agentName, `Active: Perplexity×5 + Gemini×4 + Claude + GPT-4o${activeStubs.length ? " + " + activeStubs.join(" + ") : ""} | Stubs waiting: ${activeStubs.length === 0 ? "OpenRouter(DeepSeek/Llama/Kimi), Groq" : "none"}`);

  const parts: string[] = [];

  const [
    // ── Perplexity × 5 ──────────────────────────────────────────────────────
    perp1, perp2, perp3, perp4, perp5,
    // ── Gemini × 4 ──────────────────────────────────────────────────────────
    gemini1, gemini2, gemini3, gemini4,
    // ── Claude (comprehensive) ───────────────────────────────────────────────
    claudeDeep,
    // ── GPT-4o (financial + competitive) ────────────────────────────────────
    gpt4oDeep,
    // ── OpenRouter stubs (DeepSeek / Llama / Kimi) ───────────────────────────
    deepseekDeep, llamaDeep, kimiDeep,
    // ── Groq stub ────────────────────────────────────────────────────────────
    groqDeep,
  ] = await Promise.allSettled([
    // Perplexity 1 — general profile & contact
    perplexitySearch(`Saudi company ${companyRef}${crRef}: official website, phone, email, physical address, paid-up capital SAR, employee count, founding year, main business activities, description. Verified public data only.`, 2000),
    // Perplexity 2 — executive team & leadership
    perplexitySearch(`"${companyName}" ${nameAr ? `"${nameAr}"` : ""} Saudi Arabia CEO chairman general manager CFO COO board of directors executives مدير عام رئيس تنفيذي — full names English AND Arabic with titles 2024 2025`, 2000),
    // Perplexity 3 — shareholders & ownership
    perplexitySearch(`"${companyName}" ${nameAr ? `"${nameAr}"` : ""} Saudi Arabia shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — full names English and Arabic with ownership %`, 2000),
    // Perplexity 4 — financial profile
    perplexitySearch(`"${companyName}" Saudi Arabia revenue SAR annual turnover profit margin paid-up capital employees 2022 2023 2024 إيرادات أرباح رأس المال — estimated financial data`, 2000),
    // Perplexity 5 — news & recent developments
    perplexitySearch(`"${companyName}" ${nameAr ? `"${nameAr}"` : ""} Saudi Arabia 2024 2025 أحدث الأخبار توسعات contracts mergers acquisitions expansions awards latest news`, 2000),

    // Gemini 1 — shareholders & ownership (Google Search grounding)
    isGeminiConfigured()
      ? searchWithGemini(`Saudi company ${companyRef}${crRef} shareholders ownership structure board of directors مساهمون ملاك هيئة مديرين — verified public records 2024 2025`)
      : Promise.resolve(null),
    // Gemini 2 — financial profile
    isGeminiConfigured()
      ? searchWithGemini(`${companyRef}${crRef} Saudi Arabia revenue employees founding year paid-up capital industry website address annual report financial performance`)
      : Promise.resolve(null),
    // Gemini 3 — latest news & developments
    isGeminiConfigured()
      ? searchWithGemini(`${companyRef} أخبار 2024 2025 أحدث الأخبار توسعات استثمارات عقود نتائج مالية Saudi company latest news expansions contracts`)
      : Promise.resolve(null),
    // Gemini 4 — competitive & market intelligence
    isGeminiConfigured()
      ? searchWithGemini(`${companyRef} Saudi Arabia market position competitors clients projects sector ranking strengths weaknesses Vision 2030 related activities`)
      : Promise.resolve(null),

    // Claude — comprehensive bilingual corporate intelligence
    (async () => {
      try {
        const msg = await Promise.race([
          anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2500,
            messages: [{
              role: "user",
              content: `You are a senior Saudi corporate intelligence analyst. Research Saudi company ${companyRef}${crRef}.

Provide ALL of the following that you know with high confidence:
1. Shareholders — full names (EN+AR), ownership %, nationalities
2. Board of Directors — all members with names (EN+AR), roles/titles
3. Senior executives — CEO, CFO, COO, GM, Managing Director (EN+AR names)
4. Financial profile — revenue estimate SAR, paid-up capital, founding year, employees
5. Business activities — sector, products/services, market position
6. Contact information — website, phone, email, physical address in Saudi Arabia
7. Recent news 2024–2025 — expansions, contracts, leadership changes

If you don't know something with confidence, say so clearly. Only include verified, publicly documented information.`,
            }],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
        ]);
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      } catch { return null; }
    })(),

    // GPT-4o — financial & competitive intelligence
    (async () => {
      try {
        const r = await Promise.race([
          openai.chat.completions.create({
            model: "gpt-4o",
            max_completion_tokens: 2000,
            messages: [
              { role: "system", content: "You are a Gulf region B2B intelligence expert specializing in Saudi corporate research. Only provide verified, factual data." },
              { role: "user", content: `Deep intelligence on Saudi company ${companyRef}${crRef}:\n1. Shareholder names & ownership % (EN+AR)\n2. Board of Directors with names (EN+AR)\n3. CEO/GM/CFO with full names (EN+AR)\n4. Revenue SAR, headcount, capital\n5. Website, phone, email, address\n6. Business sector and key activities\n7. News 2024–2025\nVerified public data only.` },
            ],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 30000)),
        ]);
        return r.choices[0]?.message?.content || null;
      } catch { return null; }
    })(),

    // OpenRouter — DeepSeek R1 (stub — activates when OPENROUTER_API_KEY is set)
    openRouterQuery(
      "deepseek/deepseek-r1",
      `Saudi company ${companyRef}${crRef}. Research: shareholders (names EN+AR, %), board, CEO/GM, revenue SAR, employees, website, phone, address, sector, news 2024-2025. Arabic and English data.`,
      "You are a Saudi corporate intelligence expert. Provide verified, factual data in both Arabic and English.",
      2000,
    ),

    // OpenRouter — Llama 3.3 70B (stub — activates when OPENROUTER_API_KEY is set)
    openRouterQuery(
      "meta-llama/llama-3.3-70b-instruct",
      `Research Saudi Arabia company ${companyRef}${crRef}. Extract: shareholder names & %, board members, executives (CEO, GM, CFO) with EN+AR names, financial data (revenue, capital, employees), contact info, recent news 2024-2025.`,
      "You are a Saudi Arabia business intelligence analyst.",
      2000,
    ),

    // OpenRouter — Kimi (stub — activates when OPENROUTER_API_KEY is set)
    openRouterQuery(
      "moonshot/moonshot-v1-8k",
      `أبحث عن معلومات شاملة عن شركة ${nameAr || companyName} في المملكة العربية السعودية (${crRef}). المساهمون مع النسب، مجلس الإدارة، المديرين التنفيذيين، الإيرادات، الموظفين، معلومات الاتصال، أحدث الأخبار 2024-2025.`,
      "أنت محلل ذكاء تجاري متخصص في الشركات السعودية.",
      2000,
    ),

    // Groq — Llama 70B fast (stub — activates when GROQ_API_KEY is set)
    groqQuery(
      "llama-3.3-70b-versatile",
      `Fast Saudi company research for ${companyRef}${crRef}: shareholders (EN+AR names, %), board, CEO/GM/CFO names (EN+AR), revenue SAR estimate, employees, website, phone, address, industry, latest news 2024-2025.`,
      "You are a Saudi Arabia B2B intelligence analyst. Provide factual data only.",
      2000,
    ),
  ]);

  // Collect successful results
  if (perp1.status === "fulfilled" && perp1.value) parts.push(`[Perplexity 1: General Profile]\n${perp1.value.slice(0, 2500)}`);
  if (perp2.status === "fulfilled" && perp2.value) parts.push(`[Perplexity 2: Leadership & Executives]\n${perp2.value.slice(0, 2000)}`);
  if (perp3.status === "fulfilled" && perp3.value) parts.push(`[Perplexity 3: Shareholders & Ownership]\n${perp3.value.slice(0, 2000)}`);
  if (perp4.status === "fulfilled" && perp4.value) parts.push(`[Perplexity 4: Financial Profile]\n${perp4.value.slice(0, 2000)}`);
  if (perp5.status === "fulfilled" && perp5.value) parts.push(`[Perplexity 5: News & Developments]\n${perp5.value.slice(0, 2000)}`);
  if (gemini1.status === "fulfilled" && gemini1.value) parts.push(`[Gemini 1: Shareholders & Ownership]\n${String(gemini1.value).slice(0, 2500)}`);
  if (gemini2.status === "fulfilled" && gemini2.value) parts.push(`[Gemini 2: Financial Profile]\n${String(gemini2.value).slice(0, 2500)}`);
  if (gemini3.status === "fulfilled" && gemini3.value) parts.push(`[Gemini 3: News & Developments]\n${String(gemini3.value).slice(0, 2000)}`);
  if (gemini4.status === "fulfilled" && gemini4.value) parts.push(`[Gemini 4: Market Intelligence]\n${String(gemini4.value).slice(0, 2000)}`);
  if (claudeDeep.status === "fulfilled" && claudeDeep.value) parts.push(`[Claude: Comprehensive Intelligence]\n${claudeDeep.value.slice(0, 3000)}`);
  if (gpt4oDeep.status === "fulfilled" && gpt4oDeep.value) parts.push(`[GPT-4o: Corporate Intelligence]\n${gpt4oDeep.value.slice(0, 2500)}`);
  if (deepseekDeep.status === "fulfilled" && deepseekDeep.value) parts.push(`[DeepSeek R1: Corporate Research]\n${deepseekDeep.value.slice(0, 2000)}`);
  if (llamaDeep.status === "fulfilled" && llamaDeep.value) parts.push(`[Llama 3.3: Corporate Research]\n${llamaDeep.value.slice(0, 2000)}`);
  if (kimiDeep.status === "fulfilled" && kimiDeep.value) parts.push(`[Kimi: Arabic Corporate Research]\n${kimiDeep.value.slice(0, 2000)}`);
  if (groqDeep.status === "fulfilled" && groqDeep.value) parts.push(`[Groq: Fast Research]\n${groqDeep.value.slice(0, 2000)}`);

  const successCount = parts.length;
  const total = 12 + (OPENROUTER_API_KEY ? 3 : 0) + (GROQ_API_KEY ? 1 : 0);
  log(emitter, agentNum, agentName, `✓ Deep research complete: ${successCount}/${total} engines returned data`);

  const combined = parts.join("\n\n---\n\n");
  emit(emitter, { type: "agent_complete", agentNum, agentName, data: { researchText: combined.slice(0, 500), enginesUsed: successCount } });
  return combined;
}

// ─── Agent 4: Compliance & Sanctions ─────────────────────────────────────────
// Checks: OFAC SDN, UN Security Council, EU Consolidated, CMA, SAMA, ZATCA,
//         Maroof.sa, Najiz.sa + Perplexity/Gemini news flags

async function agent4_complianceSanctions(
  companyNameEn: string,
  companyNameAr: string,
  crNumber: string,
  emitter: EventEmitter,
): Promise<ComplianceResult> {
  const agentNum = 4;
  const agentName = "Compliance & Sanctions";
  emit(emitter, { type: "agent_start", agentNum, agentName });
  log(emitter, agentNum, agentName, `Running compliance checks: OFAC, UN SC, EU, CMA, SAMA, ZATCA, Maroof, Najiz...`);

  const result: ComplianceResult = {
    ofac: { hit: false, entries: [], matchScore: "none" },
    unsc: { hit: false, entries: [] },
    eu: { hit: false, entries: [] },
    maroof: { verified: false, rating: null, data: "" },
    saudiRegulatory: {
      cma: { hit: false, notes: "" },
      sama: { hit: false, notes: "" },
      zatca: { hit: false, notes: "" },
      najiz: { agencies: [], found: false },
    },
    newsFlags: [],
    overallRisk: "unknown",
    riskSummary: "",
    checkedAt: new Date().toISOString(),
  };

  const searchName = companyNameEn || companyNameAr;

  // Scout regulatory scan (runs in parallel with all other checks)
  const scoutRegulatoryPromise = scoutSignalsRegulatory(searchName, {
    companyNameAr: companyNameAr || undefined,
    includeTadawul: true,
  }).catch(() => null);

  // Scout site intel for direct contact verification
  const scoutSitePromise = (async () => {
    const websiteGuess = companyNameEn
      ? `https://www.${companyNameEn.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "")}.com`
      : null;
    if (!websiteGuess) return null;
    return scoutSiteIntel(websiteGuess, { followSubpages: false }).catch(() => null);
  })();

  const [
    ofacResult, unscResult, euResult, maroofResult,
    najizResult, saudiRegResult, newsFlagsResult,
  ] = await Promise.allSettled([

    // ── OFAC SDN Check ──────────────────────────────────────────────────────
    (async () => {
      try {
        const url = `https://sanctionssearch.ofac.treas.gov/DesktopModules/Sanctions/API/SdnList/search?name=${encodeURIComponent(searchName)}&type=name&program=&list=&country=&npn=&score=80`;
        log(emitter, agentNum, agentName, `→ OFAC SDN: checking "${searchName}"...`);
        const r = await axios.get(url, { timeout: 15000, headers: { "Accept": "application/json" } });
        const entries: string[] = [];
        const sdnList = r.data?.sdnList?.sdnEntry || [];
        if (Array.isArray(sdnList) && sdnList.length > 0) {
          for (const entry of sdnList.slice(0, 5)) {
            const entryName = entry.lastName || entry.firstName || entry.entityName || "Unknown";
            entries.push(`${entryName} (Score: ${entry.score || "?"}, Program: ${entry.programList?.program?.[0] || "?"})`);
          }
        }
        return { hit: entries.length > 0, entries, matchScore: entries.length > 0 ? "≥80%" : "none" };
      } catch {
        // Fallback: Perplexity OFAC check
        const perpOfac = await perplexitySearch(
          `Is the Saudi company "${searchName}" ${companyNameAr ? `(${companyNameAr})` : ""} on the US OFAC SDN sanctions list? What is their OFAC status?`,
          500,
        );
        const hit = perpOfac ? /sanctioned|SDN list|OFAC hit|restricted/i.test(perpOfac) : false;
        return { hit, entries: hit && perpOfac ? [perpOfac.slice(0, 200)] : [], matchScore: "perplexity-inferred" };
      }
    })(),

    // ── UN Security Council Check ────────────────────────────────────────────
    (async () => {
      try {
        log(emitter, agentNum, agentName, `→ UN Security Council: checking "${searchName}"...`);
        const perpUn = await perplexitySearch(
          `Is Saudi company "${searchName}" ${companyNameAr ? `(${companyNameAr})` : ""} on the United Nations Security Council consolidated sanctions list? UN SC sanctions status.`,
          600,
        );
        const hit = perpUn ? /sanctioned|UN list|Security Council|designated|1267 committee|prohibited/i.test(perpUn) : false;
        return { hit, entries: hit && perpUn ? [perpUn.slice(0, 200)] : [] };
      } catch { return { hit: false, entries: [] }; }
    })(),

    // ── EU Consolidated Sanctions Check ──────────────────────────────────────
    (async () => {
      try {
        log(emitter, agentNum, agentName, `→ EU Consolidated Sanctions: checking "${searchName}"...`);
        const euUrl = `https://www.sanctionsmap.eu/api/v1/case?filter[search]=${encodeURIComponent(searchName)}&include=regime,subject`;
        const r = await axios.get(euUrl, { timeout: 12000, headers: { Accept: "application/json" } });
        const data = r.data;
        const cases = data?.data || [];
        const entries = Array.isArray(cases)
          ? cases.slice(0, 3).map((c: Record<string, unknown>) => String(c.subject_name || c.name || ""))
          : [];
        return { hit: entries.length > 0, entries };
      } catch {
        const perpEu = await perplexitySearch(
          `Is Saudi company "${searchName}" on the EU consolidated sanctions list? European Union sanctions status.`,
          500,
        ).catch(() => null);
        const hit = perpEu ? /EU sanctions|European sanctions|sanctioned|restricted|asset freeze/i.test(perpEu) : false;
        return { hit, entries: hit && perpEu ? [perpEu.slice(0, 200)] : [] };
      }
    })(),

    // ── Maroof.sa Business Verification ─────────────────────────────────────
    (async () => {
      try {
        log(emitter, agentNum, agentName, `→ Maroof.sa: verifying business registration...`);
        const maroofQuery = companyNameAr || companyNameEn;
        const r = await axios.get(
          `https://maroof.sa/api/v3.0/Establishments/Search?q=${encodeURIComponent(maroofQuery)}&pageNumber=1&pageSize=5`,
          { timeout: 12000, headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Accept-Language": "ar-SA" } },
        );
        const items = r.data?.data?.items || r.data?.items || [];
        if (Array.isArray(items) && items.length > 0) {
          const match = items.find((item: Record<string, unknown>) =>
            String(item.name || item.arabicName || "").includes(maroofQuery.slice(0, 5))
          ) || items[0];
          const rating = String(match?.rating || match?.ratingLevel || "");
          const data = JSON.stringify(match || {}).slice(0, 500);
          return { verified: true, rating: rating || null, data };
        }
        return { verified: false, rating: null, data: "Not found on Maroof.sa" };
      } catch {
        return { verified: false, rating: null, data: "Maroof.sa check unavailable" };
      }
    })(),

    // ── Najiz.sa Legal Agencies ──────────────────────────────────────────────
    (async () => {
      const agencies: Array<Record<string, string>> = [];
      const urlsToTry = [
        `https://www.najiz.sa/applications/search?q=${encodeURIComponent(companyNameAr || companyNameEn)}`,
        `https://najiz.sa/general/search?entityName=${encodeURIComponent(companyNameAr || companyNameEn)}`,
      ];
      if (crNumber) urlsToTry.push(`https://www.najiz.sa/applications/individual?crNumber=${crNumber}`);

      for (const url of urlsToTry) {
        try {
          log(emitter, agentNum, agentName, `→ Najiz.sa: ${url.slice(0, 80)}...`);
          const res = await axios.get(url, { timeout: 12000, headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ar-SA" } });
          const html = String(res.data || "");
          if (html.length > 300) {
            const $ = cheerio.load(html);
            $("script, style").remove();
            $("tr, [class*='result'], [class*='agency']").each((_, el) => {
              const t = $(el).text().trim();
              if (t.length > 10 && t.length < 500) agencies.push({ text: t });
            });
            if (agencies.length > 0) {
              log(emitter, agentNum, agentName, `✓ Najiz.sa: ${agencies.length} agency records found`);
              return { agencies: agencies.slice(0, 20), found: true };
            }
          }
        } catch { /* try next */ }
      }
      log(emitter, agentNum, agentName, "⚠ Najiz.sa: requires government auth or no records found");
      return { agencies: [], found: false };
    })(),

    // ── Saudi Regulatory (CMA, SAMA, ZATCA) ─────────────────────────────────
    (async () => {
      const [cmaR, samaR, zatcaR] = await Promise.allSettled([
        perplexitySearch(`Has Saudi company "${searchName}" ${companyNameAr ? `(${companyNameAr})` : ""} been fined, penalized, or cited by the Capital Market Authority (CMA هيئة السوق المالية) Saudi Arabia? Any CMA violations or sanctions?`, 600),
        perplexitySearch(`Has Saudi company "${searchName}" ${companyNameAr ? `(${companyNameAr})` : ""} been fined, penalized, or cited by SAMA Saudi Arabian Monetary Authority (مؤسسة النقد العربي السعودي)? Any banking or insurance violations?`, 600),
        perplexitySearch(`Has Saudi company "${searchName}" ${companyNameAr ? `(${companyNameAr})` : ""} had any ZATCA (Zakat Tax and Customs Authority هيئة الزكاة والضريبة والجمارك) violations, tax disputes, or customs issues in Saudi Arabia?`, 600),
      ]);

      const cmaText = cmaR.status === "fulfilled" ? (cmaR.value || "") : "";
      const samaText = samaR.status === "fulfilled" ? (samaR.value || "") : "";
      const zatcaText = zatcaR.status === "fulfilled" ? (zatcaR.value || "") : "";

      return {
        cma: {
          hit: /violation|penalty|fine|cited|enforcement|sanctioned|مخالفة|غرامة/i.test(cmaText),
          notes: cmaText.slice(0, 300),
        },
        sama: {
          hit: /violation|penalty|fine|revoked|suspended|sanctioned|مخالفة|غرامة/i.test(samaText),
          notes: samaText.slice(0, 300),
        },
        zatca: {
          hit: /dispute|violation|penalty|tax issue|customs|مخالفة|غرامة|نزاع/i.test(zatcaText),
          notes: zatcaText.slice(0, 300),
        },
      };
    })(),

    // ── News-based Compliance Flags ──────────────────────────────────────────
    (async () => {
      const flags: string[] = [];
      try {
        const [geminiNews, perpNews] = await Promise.allSettled([
          isGeminiConfigured()
            ? searchWithGemini(`"${searchName}" ${companyNameAr || ""} Saudi Arabia fraud scandal lawsuit corruption legal issues regulatory violations بلاغات قضايا احتيال فساد`)
            : Promise.resolve(null),
          perplexitySearch(
            `"${searchName}" ${companyNameAr ? `"${companyNameAr}"` : ""} Saudi Arabia news: legal issues, lawsuits, fraud, corruption, regulatory violations, regulatory fines, money laundering, financial crime 2020-2025`,
            800,
          ),
        ]);

        const newsText = [
          geminiNews.status === "fulfilled" && geminiNews.value ? String(geminiNews.value) : "",
          perpNews.status === "fulfilled" && perpNews.value ? perpNews.value : "",
        ].join(" ");

        if (/fraud|احتيال/i.test(newsText)) flags.push("Potential fraud mention in news");
        if (/corruption|فساد/i.test(newsText)) flags.push("Potential corruption mention in news");
        if (/lawsuit|قضية/i.test(newsText)) flags.push("Legal proceedings mentioned");
        if (/money.?laundering|غسيل.*أموال/i.test(newsText)) flags.push("Money laundering mention in news");
        if (/bankrupt|إفلاس/i.test(newsText)) flags.push("Bankruptcy mention in news");
        if (/arrest|اعتقال|detained/i.test(newsText)) flags.push("Executive arrest/detention mention");
      } catch { /* non-fatal */ }
      return flags;
    })(),
  ]);

  // Assemble results
  if (ofacResult.status === "fulfilled") result.ofac = ofacResult.value;
  if (unscResult.status === "fulfilled") result.unsc = unscResult.value;
  if (euResult.status === "fulfilled") result.eu = euResult.value;
  if (maroofResult.status === "fulfilled") result.maroof = maroofResult.value;
  if (najizResult.status === "fulfilled") result.saudiRegulatory.najiz = najizResult.value;
  if (saudiRegResult.status === "fulfilled") {
    result.saudiRegulatory.cma = saudiRegResult.value.cma;
    result.saudiRegulatory.sama = saudiRegResult.value.sama;
    result.saudiRegulatory.zatca = saudiRegResult.value.zatca;
  }
  if (newsFlagsResult.status === "fulfilled") result.newsFlags = newsFlagsResult.value;

  // ── Scout regulatory intelligence — augment existing checks ───────────────
  const [scoutRegData, scoutSiteData] = await Promise.all([scoutRegulatoryPromise, scoutSitePromise]);
  if (scoutRegData) {
    const scoutRisks = scoutRegData.risk_signals || [];
    const highScoutRisks = scoutRisks.filter(s => s.risk_score >= 7);
    if (highScoutRisks.length > 0) {
      const regulatorHit = highScoutRisks.find(s => s.event_type === "cma_action");
      const samaHit = highScoutRisks.find(s => s.event_type === "sama_action");
      const zatcaHit = highScoutRisks.find(s => s.event_type === "zatca_action");
      const bankruptcyHit = highScoutRisks.find(s => s.event_type === "bankruptcy");
      const fraudHit = highScoutRisks.find(s => s.event_type === "fraud_complaint");
      if (regulatorHit && !result.saudiRegulatory.cma.hit) {
        result.saudiRegulatory.cma.hit = true;
        result.saudiRegulatory.cma.notes = `Scout: ${regulatorHit.title.slice(0, 200)}`;
      }
      if (samaHit && !result.saudiRegulatory.sama.hit) {
        result.saudiRegulatory.sama.hit = true;
        result.saudiRegulatory.sama.notes = `Scout: ${samaHit.title.slice(0, 200)}`;
      }
      if (zatcaHit && !result.saudiRegulatory.zatca.hit) {
        result.saudiRegulatory.zatca.hit = true;
        result.saudiRegulatory.zatca.notes = `Scout: ${zatcaHit.title.slice(0, 200)}`;
      }
      if (bankruptcyHit) result.newsFlags.push(`Bankruptcy/insolvency signal: ${bankruptcyHit.title.slice(0, 100)}`);
      if (fraudHit) result.newsFlags.push(`Fraud/complaint signal: ${fraudHit.title.slice(0, 100)}`);
    }
    // Add Tadawul disclosures as news context
    const tadawulItems = (scoutRegData.positive_signals || []).slice(0, 3);
    for (const td of tadawulItems) {
      log(emitter, agentNum, agentName, `✓ Tadawul: ${td.title.slice(0, 80)}`);
    }
    log(emitter, agentNum, agentName, `✓ Scout regulatory: ${scoutRegData.risk_signals_found} risk signals, ${scoutRegData.positive_signals_found} Tadawul disclosures`);
  }
  if (scoutSiteData?.emails?.length) {
    log(emitter, agentNum, agentName, `✓ Scout site: ${scoutSiteData.emails.length} contact email(s) found`);
  }

  // ── Overall risk assessment ──────────────────────────────────────────────
  const highRisk = result.ofac.hit || result.unsc.hit || result.eu.hit;
  const medRisk =
    result.saudiRegulatory.cma.hit ||
    result.saudiRegulatory.sama.hit ||
    result.saudiRegulatory.zatca.hit ||
    result.newsFlags.length >= 2;
  const lowRisk = result.maroof.verified && !medRisk && !highRisk;

  result.overallRisk = highRisk ? "high" : medRisk ? "medium" : lowRisk ? "low" : "unknown";

  const riskParts: string[] = [];
  if (result.ofac.hit) riskParts.push("OFAC SDN match");
  if (result.unsc.hit) riskParts.push("UN Security Council match");
  if (result.eu.hit) riskParts.push("EU Consolidated Sanctions match");
  if (result.saudiRegulatory.cma.hit) riskParts.push("CMA regulatory action noted");
  if (result.saudiRegulatory.sama.hit) riskParts.push("SAMA regulatory action noted");
  if (result.saudiRegulatory.zatca.hit) riskParts.push("ZATCA tax/customs issue noted");
  if (result.newsFlags.length > 0) riskParts.push(`News flags: ${result.newsFlags.join(", ")}`);
  if (result.maroof.verified) riskParts.push(`Maroof.sa verified${result.maroof.rating ? ` (rating: ${result.maroof.rating})` : ""}`);
  if (result.saudiRegulatory.najiz.found) riskParts.push(`Najiz: ${result.saudiRegulatory.najiz.agencies.length} legal agency record(s)`);

  result.riskSummary = riskParts.length > 0
    ? `Risk: ${result.overallRisk.toUpperCase()} — ${riskParts.join("; ")}`
    : `Risk: ${result.overallRisk.toUpperCase()} — No compliance issues found`;

  log(emitter, agentNum, agentName, `✓ Compliance check complete: ${result.riskSummary}`);
  emit(emitter, { type: "agent_complete", agentNum, agentName, data: { ...result } as unknown as Record<string, unknown> });
  return result;
}

// ─── Agent 5: Bilingual Report Compiler ──────────────────────────────────────
// Step A: Claude generates English report as plain text (no JSON wrapping)
// Step B: Claude translates English → Arabic in a separate call
// Split calls eliminate the JSON-parse failure that was silently dropping Arabic

async function agent5_compileReport(
  crNumber: string,
  crData: Record<string, unknown>,
  aoaResult: Record<string, unknown>,
  deepResearch: string,
  compliance: ComplianceResult,
  stealthMode: boolean,
  emitter: EventEmitter,
): Promise<{ reportEn: string; reportAr: string }> {
  const agentNum = 5;
  const agentName = "Bilingual Report Compiler";
  emit(emitter, { type: "agent_start", agentNum, agentName });
  log(emitter, agentNum, agentName, "Compiling English intelligence report (Step A)...");

  const aoa = (aoaResult.aoa || {}) as Record<string, unknown>;

  const complianceSummary = `
Compliance Status: ${compliance.overallRisk.toUpperCase()}
${compliance.riskSummary}
OFAC SDN: ${compliance.ofac.hit ? "⚠ HIT — " + compliance.ofac.entries.join("; ") : "✓ Clear"}
UN Security Council: ${compliance.unsc.hit ? "⚠ HIT" : "✓ Clear"}
EU Consolidated: ${compliance.eu.hit ? "⚠ HIT" : "✓ Clear"}
Maroof.sa: ${compliance.maroof.verified ? "✓ Verified" : "Not verified"} ${compliance.maroof.rating ? `(Rating: ${compliance.maroof.rating})` : ""}
CMA (Capital Market Authority): ${compliance.saudiRegulatory.cma.hit ? "⚠ Action noted" : "✓ Clear"}
SAMA: ${compliance.saudiRegulatory.sama.hit ? "⚠ Action noted" : "✓ Clear"}
ZATCA: ${compliance.saudiRegulatory.zatca.hit ? "⚠ Issue noted" : "✓ Clear"}
Najiz Legal Agencies: ${compliance.saudiRegulatory.najiz.found ? `${compliance.saudiRegulatory.najiz.agencies.length} record(s) found` : "No records / auth required"}
News Flags: ${compliance.newsFlags.length > 0 ? compliance.newsFlags.join(", ") : "None"}
`;

  const dataContext = `CR Number: ${crNumber}
Company: ${String(crData.nameAr || aoa.companyNameAr || "Unknown")} / ${String(crData.nameEn || aoa.companyNameEn || "")}
Data Collection Method: ${stealthMode ? "Stealth Agent (AI-automated, 5-agent pipeline)" : "Manual"}

─── CR Registry Data ───
${JSON.stringify(crData).slice(0, 2000)}

─── AOA / Articles of Association ───
${JSON.stringify(aoa).slice(0, 3000)}

─── Deep Research Intelligence ───
${deepResearch.slice(0, 5000)}

─── Compliance & Sanctions ───
${complianceSummary}`;

  const enPrompt = `You are a Saudi business intelligence analyst. Write a comprehensive English intelligence report using all data below.

${dataContext}

Include ALL of these sections with full detail:

1. Executive Summary (company overview, key highlights, risk assessment)
2. Company Identity (names EN+AR, CR number, legal form, registration status)
3. Incorporation Details (founding year, fiscal year, paid-up capital)
4. Shareholder Structure (names EN+AR, IDs, %, nationalities, ownership type)
5. Management & Governance (CEO/GM/CFO, board members, appointment terms, powers)
6. Operations (business activities, HQ city, branches, contacts, website, phone)
7. Financial Profile (revenue estimate SAR, capital, employees, profitability signals)
8. Legal Framework (AOA provisions, transfer restrictions, dissolution, amendments)
9. Compliance & Risk Assessment (OFAC, UN, EU, CMA, SAMA, ZATCA, Maroof, news flags)
10. Legal Agency Records (Najiz findings or note if auth required)
11. Intelligence Confidence (data quality, sources used, verified vs inferred)

Return the report as plain markdown text. Start with: ## Company Intelligence Report — [Company Name]`;

  // ── Step A: English report ────────────────────────────────────────────────
  let reportEn = "";

  const [claudeEnResult, gptEnResult] = await Promise.allSettled([
    anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: enPrompt }],
    }),
    openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: "You are a Saudi business intelligence analyst. Write comprehensive English intelligence reports." },
        { role: "user", content: enPrompt },
      ],
    }),
  ]);

  if (claudeEnResult.status === "fulfilled") {
    const text = claudeEnResult.value.content[0].type === "text" ? claudeEnResult.value.content[0].text : "";
    if (text.length > 200) reportEn = text;
  }
  if (!reportEn && gptEnResult.status === "fulfilled") {
    const text = gptEnResult.value.choices[0]?.message?.content || "";
    if (text.length > 200) reportEn = text;
  }

  if (!reportEn) {
    log(emitter, agentNum, agentName, "⚠ Both Claude and GPT-4o failed to compile English report");
    emit(emitter, { type: "agent_complete", agentNum, agentName, data: {} });
    return {
      reportEn: "Report compilation failed — please try again.",
      reportAr: "فشل إنشاء التقرير — يرجى المحاولة مرة أخرى.",
    };
  }

  log(emitter, agentNum, agentName, `✓ English report compiled (${reportEn.length} chars) — translating to Arabic (Step B)...`);

  // ── Step B: Arabic translation — separate call, plain text ───────────────
  let reportAr = "";

  const arPrompt = `You are a Saudi business Arabic translation specialist. Translate the following English company intelligence report into professional formal Arabic (Modern Standard Arabic / اللغة العربية الفصحى).

Rules:
- Translate ALL section headings and body text fully into Arabic
- Keep company names, CR numbers, ISINs, URLs, phone numbers, and financial figures as-is
- Use proper RTL Arabic business terminology
- Preserve all data — do not omit or summarize any section
- Start with: ## تقرير الاستخبارات التجارية — [اسم الشركة]

English Report to translate:
${reportEn}`;

  // Arabic translation: Claude + NEXUS arabic tier (orpheus-arabic-saudi) in parallel
  const arSystem = "You are a Saudi Arabic business translation specialist. Translate reports into formal Modern Standard Arabic.";
  try {
    const [claudeArResult, nexusArResult] = await Promise.allSettled([
      anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 8192, messages: [{ role: "user", content: arPrompt }] }),
      nexusSynthesize(arPrompt, arSystem, { tier: "arabic" as const, maxTokens: 6000 } as Parameters<typeof nexusSynthesize>[2]),
    ]);

    if (claudeArResult.status === "fulfilled") {
      const arText = claudeArResult.value.content[0].type === "text" ? claudeArResult.value.content[0].text : "";
      if (arText.length > 200) reportAr = arText;
    }
    // NEXUS arabic tier (Orpheus-Arabic-Saudi → Qwen → Gemini) as supplement or fallback
    if (!reportAr && nexusArResult.status === "fulfilled" && nexusArResult.value.text.length > 200) {
      reportAr = nexusArResult.value.text;
      log(emitter, agentNum, agentName, `ℹ Arabic translation via NEXUS ${nexusArResult.value.provider}/${nexusArResult.value.model}`);
    }
  } catch (arErr) {
    log(emitter, agentNum, agentName, `⚠ Arabic translation failed: ${arErr instanceof Error ? arErr.message : "unknown"} — trying GPT-4o...`);
  }

  if (!reportAr) {
    try {
      const gptAr = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: 4000,
        messages: [
          { role: "system", content: arSystem },
          { role: "user", content: arPrompt },
        ],
      });
      const arText = gptAr.choices[0]?.message?.content || "";
      if (arText.length > 200) reportAr = arText;
    } catch { /* non-fatal */ }
  }

  if (!reportAr) {
    log(emitter, agentNum, agentName, "⚠ Arabic translation unavailable — English report only");
    reportAr = "فشل ترجمة التقرير — يرجى المحاولة مرة أخرى.";
  }

  log(emitter, agentNum, agentName, `✓ Report compiled — EN: ${reportEn.length} chars, AR: ${reportAr.length} chars`);
  emit(emitter, { type: "agent_complete", agentNum, agentName, data: { reportEnLength: reportEn.length, reportArLength: reportAr.length } });
  return { reportEn, reportAr };
}

// ─── Structured Field Extractor ───────────────────────────────────────────────
// Runs after Agent 5 to populate parsed{} from the compiled report + deep research
// when Agents 1 & 2 failed to provide structured data (CAPTCHA / Cloudflare blocks)

async function extractStructuredFromReport(
  crNumber: string,
  reportEn: string,
  deepResearch: string,
  existing: MasaarReport["parsed"],
): Promise<Partial<MasaarReport["parsed"]>> {
  const hasData =
    (existing.nameEn && existing.nameEn.length > 1) ||
    (existing.nameAr && existing.nameAr.length > 1) ||
    (existing.foundingYear && existing.foundingYear.length > 1) ||
    (existing.shareholders && existing.shareholders.length > 0);

  if (hasData) return {};

  const prompt = `Extract structured data from the intelligence report below for CR number "${crNumber}".

Report:
${reportEn.slice(0, 7000)}

Additional Research:
${deepResearch.slice(0, 2000)}

Return ONLY valid JSON with these exact fields (use null for any unknown field):
{
  "nameEn": "Company name in English or null",
  "nameAr": "اسم الشركة بالعربي or null",
  "legalForm": "LLC / JSC / etc or null",
  "legalFormAr": "م.م.م / شركة مساهمة / etc or null",
  "headquarterCity": "City in English or null",
  "headquarterCityAr": "المدينة or null",
  "foundingYear": "YYYY or null",
  "fiscalYear": "e.g. Jan-Dec or null",
  "capitalAmount": "SAR amount or null",
  "capitalDistribution": "description or null",
  "estimatedRevenue": "SAR amount or null",
  "summaryEn": "2-3 sentence company summary in English or null",
  "summaryAr": "ملخص الشركة بالعربي or null",
  "contactDetails": { "phone": "...", "email": "...", "website": "..." },
  "shareholders": [{ "nameEn": "...", "nameAr": "...", "nationalId": "...", "ownershipPct": "...", "nationality": "..." }],
  "managers": [{ "nameEn": "...", "nameAr": "...", "nationalId": "...", "title": "...", "appointmentTerm": "...", "powers": "..." }],
  "boardComposition": "description or null",
  "shareTransferRestrictions": "description or null",
  "profitDistributionRules": "description or null",
  "dissolutionConditions": "description or null",
  "amendmentProcedures": "description or null"
}`;

  // extractStructuredFromReport: NEXUS extraction (cheap) + Claude Haiku fallback
  try {
    const nexusStructured = await nexusExtract(prompt, "Extract structured company data as JSON. Return only the JSON object matching the schema exactly.", { maxTokens: 3000, temperature: 0 });
    if (typeof nexusStructured === "object" && nexusStructured !== null && Object.keys(nexusStructured).length > 2) {
      return nexusStructured as Partial<MasaarReport["parsed"]>;
    }
  } catch { /* fall through to Claude */ }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    return JSON.parse(jsonMatch[0]) as Partial<MasaarReport["parsed"]>;
  } catch {
    return {};
  }
}

// ─── Pipeline: CR-based ───────────────────────────────────────────────────────

export async function runMasaarPipeline(crNumber: string, jobId: string): Promise<void> {
  const state = jobs.get(jobId);
  if (!state) return;
  const { emitter, stealthMode } = state;

  try {
    const modeLabel = stealthMode
      ? "🥷 STEALTH MODE (AI auto-solves CAPTCHAs)"
      : "👤 MANUAL MODE (human CAPTCHA input)";
    emit(emitter, { type: "agent_log", message: `🚀 Masaar 5-Agent Pipeline — CR: ${crNumber} — ${modeLabel}` });

    // ── Agent 1: MC.gov.sa browser + Claude CR parse ──────────────────────
    const mcRawData = await agent1a_fetchMcGovSa(crNumber, jobId, emitter);
    const crData = await agent1b_parseCrFields(crNumber, mcRawData, emitter);

    const nameAr = String(crData.nameAr || "");
    const nameEn = String(crData.nameEn || "");
    const companyName = nameEn || nameAr || `CR-${crNumber}`;

    emit(emitter, { type: "agent_log", message: `📋 Agent 1 complete — Arabic name: "${nameAr}" → feeding Agents 2 & 3` });

    // ── Agents 2 + 3 run in parallel ─────────────────────────────────────
    // Agent 2: Amaaly AOA Intelligence (Amaaly search + AOA PDF OCR + translate)
    // Agent 3: Deep Research Intelligence (ALWAYS fires — all 12 engines in parallel)
    const [aoaResult, deepResearch] = await Promise.all([
      agent2_aoaIntelligence(nameAr, nameEn, crData, jobId, emitter),
      agent3_deepResearch(companyName, crNumber, nameAr, emitter),
    ]);

    // ── Agent 4: Compliance & Sanctions ──────────────────────────────────
    const compliance = await agent4_complianceSanctions(nameEn, nameAr, crNumber, emitter);

    // ── Agent 5: Bilingual Report ─────────────────────────────────────────
    const { reportEn, reportAr } = await agent5_compileReport(
      crNumber, crData, aoaResult, deepResearch, compliance, stealthMode, emitter,
    );

    const aoa = (aoaResult.aoa || {}) as Record<string, unknown>;

    // Build parsed struct from Agents 1 & 2 first
    const baseParsed: MasaarReport["parsed"] = {
      nameEn: String(crData.nameEn || aoa.companyNameEn || ""),
      nameAr: String(crData.nameAr || aoa.companyNameAr || ""),
      crNumber,
      legalForm: String(crData.legalForm || aoa.legalForm || ""),
      legalFormAr: String(crData.legalFormAr || aoa.legalFormAr || ""),
      headquarterCity: String(crData.headquarterCity || aoa.headquarterCity || ""),
      headquarterCityAr: String(crData.headquarterCityAr || aoa.headquarterCityAr || ""),
      foundingYear: String(crData.foundingYear || aoa.foundingYear || ""),
      fiscalYear: String(aoa.fiscalYear || ""),
      capitalAmount: String(crData.capitalAmount || aoa.capitalAmount || ""),
      capitalDistribution: String(aoa.capitalDistribution || ""),
      estimatedRevenue: String(aoa.estimatedRevenue || ""),
      summaryEn: String(aoa.companySummaryEn || ""),
      summaryAr: String(aoa.companySummaryAr || ""),
      contactDetails: (aoa.contactDetails as Record<string, string>) || {},
      shareholders: (aoa.shareholders as MasaarReport["parsed"]["shareholders"]) || [],
      managers: (aoa.managers as MasaarReport["parsed"]["managers"]) || [],
      boardComposition: String(aoa.boardComposition || ""),
      shareTransferRestrictions: String(aoa.shareTransferRestrictions || ""),
      profitDistributionRules: String(aoa.profitDistributionRules || ""),
      dissolutionConditions: String(aoa.dissolutionConditions || ""),
      amendmentProcedures: String(aoa.amendmentProcedures || ""),
    };

    // If Agents 1 & 2 returned no data (CAPTCHA/Cloudflare failures), extract
    // structured fields from the compiled report + deep research (Agent 3 data)
    const extracted = await extractStructuredFromReport(crNumber, reportEn, deepResearch, baseParsed);
    const parsed: MasaarReport["parsed"] = {
      nameEn: baseParsed.nameEn || String(extracted.nameEn || ""),
      nameAr: baseParsed.nameAr || String(extracted.nameAr || ""),
      crNumber,
      legalForm: baseParsed.legalForm || String(extracted.legalForm || ""),
      legalFormAr: baseParsed.legalFormAr || String(extracted.legalFormAr || ""),
      headquarterCity: baseParsed.headquarterCity || String(extracted.headquarterCity || ""),
      headquarterCityAr: baseParsed.headquarterCityAr || String(extracted.headquarterCityAr || ""),
      foundingYear: baseParsed.foundingYear || String(extracted.foundingYear || ""),
      fiscalYear: baseParsed.fiscalYear || String(extracted.fiscalYear || ""),
      capitalAmount: baseParsed.capitalAmount || String(extracted.capitalAmount || ""),
      capitalDistribution: baseParsed.capitalDistribution || String(extracted.capitalDistribution || ""),
      estimatedRevenue: baseParsed.estimatedRevenue || String(extracted.estimatedRevenue || ""),
      summaryEn: baseParsed.summaryEn || String(extracted.summaryEn || ""),
      summaryAr: baseParsed.summaryAr || String(extracted.summaryAr || ""),
      contactDetails: Object.keys(baseParsed.contactDetails || {}).length > 0 ? baseParsed.contactDetails : (extracted.contactDetails || {}),
      shareholders: baseParsed.shareholders?.length ? baseParsed.shareholders : (extracted.shareholders || []),
      managers: baseParsed.managers?.length ? baseParsed.managers : (extracted.managers || []),
      boardComposition: baseParsed.boardComposition || String(extracted.boardComposition || ""),
      shareTransferRestrictions: baseParsed.shareTransferRestrictions || String(extracted.shareTransferRestrictions || ""),
      profitDistributionRules: baseParsed.profitDistributionRules || String(extracted.profitDistributionRules || ""),
      dissolutionConditions: baseParsed.dissolutionConditions || String(extracted.dissolutionConditions || ""),
      amendmentProcedures: baseParsed.amendmentProcedures || String(extracted.amendmentProcedures || ""),
    };

    const report: MasaarReport = {
      crNumber,
      fetchedAt: new Date().toISOString(),
      stealthMode,
      sources: {
        mcGovSa: crData,
        emagazine: aoaResult,
        najiz: { agencies: compliance.saudiRegulatory.najiz.agencies, found: compliance.saudiRegulatory.najiz.found },
      },
      parsed,
      aoa,
      compliance,
      legalAgencies: (compliance.saudiRegulatory.najiz.agencies as Array<Record<string, unknown>>) || [],
      conflicts: [],
      reportAr,
      reportEn,
    };

    emit(emitter, { type: "job_complete", report });

    // Layer 6 — Activepieces (non-blocking)
    onMasaarComplete({
      crNumber: report.crNumber || "",
      companyName: (report.parsed as Record<string, unknown>)?.nameEn as string | undefined,
      companyNameAr: (report.parsed as Record<string, unknown>)?.nameAr as string | undefined,
      reportSections: [report.reportEn, report.reportAr].filter(Boolean).length,
      conflictsFound: (report.conflicts as unknown[])?.length || 0,
      hasAOA: !!(report.aoa as Record<string, unknown>)?.found,
      hasNajiz: !!(report.compliance as any)?.saudiRegulatory?.najiz?.found,
    }).catch(() => {});
  } catch (err) {
    const s = jobs.get(jobId);
    if (s?.stealthBrowser) {
      try { await s.stealthBrowser.stop(); } catch { /* ignore */ }
    }
    emit(emitter, { type: "job_error", message: err instanceof Error ? err.message : "Masaar 5-agent pipeline failed" });
  }
}

// ─── Pipeline: Name-based (skips Agent 1 — no CR lookup needed) ──────────────

export async function runMasaarPipelineByName(nameAr: string, nameEn: string, jobId: string): Promise<void> {
  const state = jobs.get(jobId);
  if (!state) return;
  const { emitter, stealthMode } = state;

  try {
    emit(emitter, { type: "agent_log", message: `🚀 Masaar 5-Agent Pipeline (Name Mode) — "${nameAr || nameEn}" — Agents 1 & 2 adapted` });

    const crStub: Record<string, unknown> = { nameAr, nameEn, crNumber: "" };
    const companyName = nameEn || nameAr;

    emit(emitter, { type: "agent_start", agentNum: 1, agentName: "MC.gov.sa Registry" });
    emit(emitter, { type: "agent_log", agentNum: 1, agentName: "MC.gov.sa Registry", message: `Name-based mode: skipping mc.gov.sa browser — using provided names` });
    emit(emitter, { type: "agent_complete", agentNum: 1, agentName: "MC.gov.sa Registry", data: crStub });

    // Agents 2 + 3 in parallel
    const [aoaResult, deepResearch] = await Promise.all([
      agent2_aoaIntelligence(nameAr, nameEn, crStub, jobId, emitter),
      agent3_deepResearch(companyName, "", nameAr, emitter),
    ]);

    // Agent 4: Compliance
    const compliance = await agent4_complianceSanctions(nameEn, nameAr, "", emitter);

    // Agent 5: Report
    const { reportEn, reportAr } = await agent5_compileReport(
      "", crStub, aoaResult, deepResearch, compliance, stealthMode, emitter,
    );

    const aoa = (aoaResult.aoa || {}) as Record<string, unknown>;

    // Build parsed struct from Agents 1 & 2 first (nameAr/nameEn always available in name-based mode)
    const baseParsedN: MasaarReport["parsed"] = {
      nameEn: String(crStub.nameEn || aoa.companyNameEn || ""),
      nameAr: String(crStub.nameAr || aoa.companyNameAr || ""),
      crNumber: String(aoa.crNumber || ""),
      legalForm: String(aoa.legalForm || ""),
      legalFormAr: String(aoa.legalFormAr || ""),
      headquarterCity: String(aoa.headquarterCity || ""),
      headquarterCityAr: String(aoa.headquarterCityAr || ""),
      foundingYear: String(aoa.foundingYear || ""),
      fiscalYear: String(aoa.fiscalYear || ""),
      capitalAmount: String(aoa.capitalAmount || ""),
      capitalDistribution: String(aoa.capitalDistribution || ""),
      estimatedRevenue: String(aoa.estimatedRevenue || ""),
      summaryEn: String(aoa.companySummaryEn || ""),
      summaryAr: String(aoa.companySummaryAr || ""),
      contactDetails: (aoa.contactDetails as Record<string, string>) || {},
      shareholders: (aoa.shareholders as MasaarReport["parsed"]["shareholders"]) || [],
      managers: (aoa.managers as MasaarReport["parsed"]["managers"]) || [],
      boardComposition: String(aoa.boardComposition || ""),
      shareTransferRestrictions: String(aoa.shareTransferRestrictions || ""),
      profitDistributionRules: String(aoa.profitDistributionRules || ""),
      dissolutionConditions: String(aoa.dissolutionConditions || ""),
      amendmentProcedures: String(aoa.amendmentProcedures || ""),
    };

    // Fill any empty fields from the compiled report + deep research
    const extractedN = await extractStructuredFromReport("", reportEn, deepResearch, baseParsedN);
    const parsedN: MasaarReport["parsed"] = {
      nameEn: baseParsedN.nameEn || String(extractedN.nameEn || ""),
      nameAr: baseParsedN.nameAr || String(extractedN.nameAr || ""),
      crNumber: baseParsedN.crNumber || String(extractedN.crNumber || ""),
      legalForm: baseParsedN.legalForm || String(extractedN.legalForm || ""),
      legalFormAr: baseParsedN.legalFormAr || String(extractedN.legalFormAr || ""),
      headquarterCity: baseParsedN.headquarterCity || String(extractedN.headquarterCity || ""),
      headquarterCityAr: baseParsedN.headquarterCityAr || String(extractedN.headquarterCityAr || ""),
      foundingYear: baseParsedN.foundingYear || String(extractedN.foundingYear || ""),
      fiscalYear: baseParsedN.fiscalYear || String(extractedN.fiscalYear || ""),
      capitalAmount: baseParsedN.capitalAmount || String(extractedN.capitalAmount || ""),
      capitalDistribution: baseParsedN.capitalDistribution || String(extractedN.capitalDistribution || ""),
      estimatedRevenue: baseParsedN.estimatedRevenue || String(extractedN.estimatedRevenue || ""),
      summaryEn: baseParsedN.summaryEn || String(extractedN.summaryEn || ""),
      summaryAr: baseParsedN.summaryAr || String(extractedN.summaryAr || ""),
      contactDetails: Object.keys(baseParsedN.contactDetails || {}).length > 0 ? baseParsedN.contactDetails : (extractedN.contactDetails || {}),
      shareholders: baseParsedN.shareholders?.length ? baseParsedN.shareholders : (extractedN.shareholders || []),
      managers: baseParsedN.managers?.length ? baseParsedN.managers : (extractedN.managers || []),
      boardComposition: baseParsedN.boardComposition || String(extractedN.boardComposition || ""),
      shareTransferRestrictions: baseParsedN.shareTransferRestrictions || String(extractedN.shareTransferRestrictions || ""),
      profitDistributionRules: baseParsedN.profitDistributionRules || String(extractedN.profitDistributionRules || ""),
      dissolutionConditions: baseParsedN.dissolutionConditions || String(extractedN.dissolutionConditions || ""),
      amendmentProcedures: baseParsedN.amendmentProcedures || String(extractedN.amendmentProcedures || ""),
    };

    const report: MasaarReport = {
      crNumber: "",
      fetchedAt: new Date().toISOString(),
      stealthMode,
      sources: {
        mcGovSa: crStub,
        emagazine: aoaResult,
        najiz: { agencies: compliance.saudiRegulatory.najiz.agencies, found: compliance.saudiRegulatory.najiz.found },
      },
      parsed: parsedN,
      aoa,
      compliance,
      legalAgencies: (compliance.saudiRegulatory.najiz.agencies as Array<Record<string, unknown>>) || [],
      conflicts: [],
      reportAr,
      reportEn,
    };

    emit(emitter, { type: "job_complete", report });

    // Layer 6 — Activepieces (non-blocking)
    onMasaarComplete({
      crNumber: report.crNumber || "",
      companyName: (report.parsed as Record<string, unknown>)?.nameEn as string | undefined,
      companyNameAr: (report.parsed as Record<string, unknown>)?.nameAr as string | undefined,
      reportSections: [report.reportEn, report.reportAr].filter(Boolean).length,
      conflictsFound: (report.conflicts as unknown[])?.length || 0,
      hasAOA: !!(report.aoa as Record<string, unknown>)?.found,
      hasNajiz: !!(report.compliance as any)?.saudiRegulatory?.najiz?.found,
    }).catch(() => {});
  } catch (err) {
    const s = jobs.get(jobId);
    if (s?.stealthBrowser) {
      try { await s.stealthBrowser.stop(); } catch { /* ignore */ }
    }
    emit(emitter, { type: "job_error", message: err instanceof Error ? err.message : "Masaar pipeline (name-based) failed" });
  }
}
