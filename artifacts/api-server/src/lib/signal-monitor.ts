// ─── Signal Monitor — Push all monitoring sources and return structured signals ─
//
//  Sources: Argaam RSS, Arab News RSS, Tadawul Disclosures, Etimad Tenders,
//           Saudi Gazette, Mubasher, Perplexity AI (real-time market signals)
// ──────────────────────────────────────────────────────────────────────────────

import axios from "axios";
import * as cheerio from "cheerio";
import { EventEmitter } from "events";
import { generateWithGemini } from "../gemini-search.js";
import { nexusGenerate } from "./nexus/index.js";
import { onSignalPushComplete } from "./activepieces-client.js";

// NEXUS extraction adapter — routes through OpenRouter→Groq→Gemini with fallback
async function nexusCall(prompt: string, system?: string): Promise<string | null> {
  try {
    const result = await nexusGenerate(prompt, { tier: "extraction", systemPrompt: system });
    return result.text ?? null;
  } catch {
    try { return await generateWithGemini(prompt, system); } catch { return null; }
  }
}

export interface SignalAlert {
  source: string;
  headline: string;
  company?: string;
  companyAr?: string;
  signalType: "news" | "tender" | "contract" | "hiring" | "regulatory" | "market";
  summary: string;
  url?: string;
  timestamp: string;
}

async function httpGet(url: string, timeoutMs = 12000): Promise<{ ok: boolean; data?: unknown; text?: string }> {
  try {
    const r = await axios.get(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProspectSA/1.0; +https://prospectsa.com/bot)",
        Accept: "application/json, text/html, application/rss+xml, */*",
        "Accept-Language": "ar,en;q=0.9",
      },
    });
    if (typeof r.data === "string") return { ok: true, text: r.data };
    return { ok: true, data: r.data };
  } catch { return { ok: false }; }
}

async function parseJsonFromGemini(raw: string | null, fallback: unknown = null): Promise<unknown> {
  if (!raw) return fallback;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) { try { return JSON.parse(match[1] || match[0]); } catch {} }
  try { return JSON.parse(raw); } catch {}
  return fallback;
}

import { JobRegistry } from "./job-registry.js";

const registry = new JobRegistry({
  idPrefix: "sm",
  maxEntries: 100,
  maxListeners: 10,
  ttlMs: 2 * 60 * 60 * 1000,
});
const jobEmitters = registry; // legacy alias for internal .get() calls

export function createSignalJob(): string {
  return registry.create().jobId;
}

export function getSignalEmitter(jobId: string): EventEmitter | undefined {
  return jobEmitters.get(jobId);
}

/** Cancel a running signal-monitor job. */
export function cancelSignalJob(jobId: string): boolean {
  return registry.cancel(jobId);
}

export async function runSignalMonitor(jobId: string): Promise<void> {
  const emitter = jobEmitters.get(jobId);
  if (!emitter) return;

  const signals: SignalAlert[] = [];
  const now = new Date().toISOString();

  const heartbeat = setInterval(() => emitter?.emit("event", { type: "heartbeat" }), 15000);

  function addSignal(s: Omit<SignalAlert, "timestamp">) {
    const alert: SignalAlert = { ...s, timestamp: now };
    signals.push(alert);
    emitter?.emit("event", { type: "signal", data: alert });
  }

  function log(msg: string) {
    emitter?.emit("event", { type: "log", message: msg });
  }

  // ── Argaam RSS ────────────────────────────────────────────────────────────────
  async function scanArgaam() {
    try {
      const rssUrls = [
        "https://www.argaam.com/ar/rss/latest-news.aspx",
        "https://www.argaam.com/en/rss/latest-news.aspx",
      ];
      const headlines: string[] = [];
      for (const url of rssUrls) {
        const r = await httpGet(url, 10000);
        if (r.ok && r.text) {
          const $ = cheerio.load(r.text, { xmlMode: true });
          $("item").each((_, el) => {
            const t = $(el).find("title").text().trim();
            if (t) headlines.push(t);
          });
        }
      }
      if (headlines.length === 0) return;
      log(`Argaam RSS: ${headlines.length} headlines → extracting signals…`);
      const raw = await nexusCall(
        `These are Argaam (Saudi financial news) headlines. Extract structured business signals. Return JSON array: [{source:"Argaam", headline, company, companyAr, signalType, summary}] where signalType ∈ [news, tender, contract, hiring, regulatory, market]. Only include relevant company/market signals.\n\nHeadlines:\n${headlines.slice(0, 35).join("\n")}`,
        "Return only a valid JSON array. No markdown.",
      );
      const parsed = await parseJsonFromGemini(raw, []) as SignalAlert[];
      if (Array.isArray(parsed)) {
        for (const s of parsed.slice(0, 20)) {
          addSignal({ source: "Argaam", headline: s.headline || "", company: s.company, companyAr: s.companyAr, signalType: s.signalType || "news", summary: s.summary || s.headline || "" });
        }
      }
    } catch (e) { log(`Argaam error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Arab News RSS ─────────────────────────────────────────────────────────────
  async function scanArabNews() {
    try {
      const rssUrls = [
        "https://www.arabnews.com/rss.xml",
        "https://www.arabnews.com/taxonomy/term/317/0/feed",
      ];
      const headlines: string[] = [];
      for (const url of rssUrls) {
        const r = await httpGet(url, 10000);
        if (r.ok && r.text) {
          const $ = cheerio.load(r.text, { xmlMode: true });
          $("item").each((_, el) => {
            const t = $(el).find("title").text().trim();
            if (t) headlines.push(t);
          });
        }
      }
      if (headlines.length === 0) return;
      log(`Arab News RSS: ${headlines.length} headlines → extracting signals…`);
      const raw = await nexusCall(
        `Extract Saudi business signals from these Arab News headlines. Return JSON array: [{source:"Arab News", headline, company, signalType, summary}] where signalType ∈ [news, contract, market, regulatory].\n\nHeadlines:\n${headlines.slice(0, 30).join("\n")}`,
        "Return only a valid JSON array.",
      );
      const parsed = await parseJsonFromGemini(raw, []) as SignalAlert[];
      if (Array.isArray(parsed)) {
        for (const s of parsed.slice(0, 15)) {
          addSignal({ source: "Arab News", headline: s.headline || "", company: s.company, signalType: s.signalType || "news", summary: s.summary || s.headline || "" });
        }
      }
    } catch (e) { log(`Arab News error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Tadawul Disclosures ───────────────────────────────────────────────────────
  async function scanTadawul() {
    try {
      const urls = [
        "https://api.saudiexchange.sa/v2/main/GetAllNewsAnnouncements?lang=en&page=1&pageSize=20",
        "https://api.saudiexchange.sa/v2/main/GetAllSecurities?lang=en",
      ];
      const r = await httpGet(urls[0], 12000);
      if (r.ok && r.data) {
        const items = Array.isArray(r.data) ? r.data : ((r.data as Record<string, unknown>).data as unknown[] || []);
        for (const item of (items as Record<string, string>[]).slice(0, 15)) {
          const headline = item.title || item.subject || item.headlineEn || item.headline || "";
          const company = item.companyNameEn || item.issuer || item.company || "";
          if (headline) {
            addSignal({
              source: "Tadawul",
              headline,
              company,
              signalType: headline.toLowerCase().includes("contract") ? "contract" : headline.toLowerCase().includes("dividend") || headline.toLowerCase().includes("financial") ? "market" : "regulatory",
              summary: headline,
              url: item.url || undefined,
            });
          }
        }
        log(`Tadawul: ${items.length} exchange disclosures scanned`);
      }
    } catch (e) { log(`Tadawul error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Etimad Government Tenders ─────────────────────────────────────────────────
  async function scanEtimad() {
    try {
      const r = await httpGet("https://etimad.sa/Tender/AllTendersForVisitor", 15000);
      if (r.ok && r.text) {
        const $ = cheerio.load(r.text);
        $("script, style").remove();
        const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);
        if (bodyText.length > 200) {
          const raw = await nexusCall(
            `Extract government tender signals from this Etimad page. Return JSON array: [{headline, company, signalType:"tender", summary}].\n\nText: ${bodyText.slice(0, 3500)}`,
            "Return only a valid JSON array.",
          );
          const parsed = await parseJsonFromGemini(raw, []) as SignalAlert[];
          if (Array.isArray(parsed)) {
            for (const s of parsed.slice(0, 15)) {
              addSignal({ source: "Etimad", headline: s.headline || s.summary || "", company: s.company, signalType: "tender", summary: s.summary || s.headline || "" });
            }
          }
        }
        log("Etimad: government tenders scanned");
      }
    } catch (e) { log(`Etimad error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Saudi Gazette ─────────────────────────────────────────────────────────────
  async function scanSaudiGazette() {
    try {
      const r = await httpGet("https://saudigazette.com.sa/rss-feed", 10000);
      if (r.ok && r.text) {
        const $ = cheerio.load(r.text, { xmlMode: true });
        const headlines: string[] = [];
        $("item").each((_, el) => {
          const t = $(el).find("title").text().trim();
          if (t) headlines.push(t);
        });
        for (const h of headlines.slice(0, 12)) {
          addSignal({ source: "Saudi Gazette", headline: h, signalType: "news", summary: h });
        }
        log(`Saudi Gazette: ${headlines.length} articles scanned`);
      }
    } catch (e) { log(`Saudi Gazette error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Mubasher Market ───────────────────────────────────────────────────────────
  async function scanMubasher() {
    try {
      const urls = ["https://mubasher.info/rss", "https://mubasher.info/news/rss"];
      for (const url of urls) {
        const r = await httpGet(url, 10000);
        if (r.ok && r.text) {
          const $ = cheerio.load(r.text, { xmlMode: true });
          $("item").each((_, el) => {
            const t = $(el).find("title").text().trim();
            if (t) addSignal({ source: "Mubasher", headline: t, signalType: "market", summary: t });
          });
          log("Mubasher: market signals scanned");
          break;
        }
      }
    } catch (e) { log(`Mubasher error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Perplexity AI (real-time market intelligence) ─────────────────────────────
  async function scanPerplexity() {
    const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
    if (!PERPLEXITY_API_KEY) { log("Perplexity not configured — skipping AI signals"); return; }
    try {
      const res = await axios.post("https://api.perplexity.ai/chat/completions", {
        model: "sonar",
        messages: [
          { role: "system", content: "You are a Saudi B2B market analyst. Return JSON array only." },
          { role: "user", content: "List the top 12 significant Saudi B2B business events from the past 7 days: contract awards, regulatory changes, new company registrations, funding rounds, executive changes, government tenders. Return JSON array: [{source, headline, company, signalType, summary}] where signalType ∈ [news, tender, contract, hiring, regulatory, market]." },
        ],
        max_tokens: 2500,
        temperature: 0.1,
      }, { headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}` }, timeout: 35000 });
      const content = res.data?.choices?.[0]?.message?.content || "";
      const parsed = await parseJsonFromGemini(content, []) as SignalAlert[];
      if (Array.isArray(parsed)) {
        for (const s of parsed.slice(0, 15)) {
          addSignal({ source: s.source || "Perplexity", headline: s.headline || "", company: s.company, signalType: s.signalType || "news", summary: s.summary || s.headline || "" });
        }
      }
      log(`Perplexity: ${parsed && Array.isArray(parsed) ? parsed.length : 0} AI market signals collected`);
    } catch (e) { log(`Perplexity error: ${e instanceof Error ? e.message : String(e)}`); }
  }

  try {
    log("Signal monitor starting — scanning all sources in parallel…");
    emitter?.emit("event", { type: "monitor_start", sources: ["Argaam", "Arab News", "Tadawul", "Saudi Gazette", "Mubasher", "Etimad", "Perplexity"] });

    await Promise.allSettled([
      scanArgaam(),
      scanArabNews(),
      scanTadawul(),
      scanSaudiGazette(),
      scanMubasher(),
    ]);
    await Promise.allSettled([
      scanEtimad(),
      scanPerplexity(),
    ]);

    log(`Signal monitor complete — ${signals.length} alerts collected across all sources`);
    emitter?.emit("event", { type: "monitor_complete", total: signals.length, signals });

    // Layer 6 — Activepieces automation trigger (non-blocking)
    const sourceBreakdown: Record<string, number> = {};
    for (const s of signals) { sourceBreakdown[s.source] = (sourceBreakdown[s.source] || 0) + 1; }
    onSignalPushComplete({
      jobId,
      totalSignals: signals.length,
      sourceBreakdown,
      highPrioritySignals: signals.filter(s => s.signalType === "contract" || s.signalType === "regulatory").slice(0, 5),
    }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    emitter?.emit("done");
  }
}
