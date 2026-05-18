/**
 * Signal Intelligence Engine
 * Event-driven lead intelligence — monitors positive and negative trigger events.
 *
 * Positive events → buying signal (+score): funding, IPO, contracts, dividends, expansion
 * Negative events → risk/disqualify (-score): lawsuits, sanctions, bankruptcy, layoffs
 *
 * Data sources (all free):
 *   - Google News RSS (Saudi/Arabic + English editions)
 *   - Arab News, Saudi Gazette, Argaam, Mubasher RSS
 *   - OFAC SDN + UN Security Council sanctions lists
 *   - Saudi government contracts via Etimad/news
 *
 * LLM classification: NEXUS extraction tier (DeepSeek) — ~$0.00001/call
 */

import { db, companySignalsTable } from "@workspace/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { nexusGenerate } from "./nexus/index.js";
import { googleNewsForCompany } from "./google-news-scraper.js";
import {
  scoutSignalsNews,
  scoutSignalsSanctions,
  scoutSignalsContracts,
  scoutSignalsIndividualFull,
  scoutSignalsRegulatory,
  type NewsSignalResult,
  type SanctionsResult,
  type ContractsResult,
} from "./scout-client.js";

// ── Score weights by event type ────────────────────────────────────────────────

const POSITIVE_SCORES: Record<string, { buying: number; relevance: number }> = {
  funding:     { buying: 9, relevance: 9 },
  ipo:         { buying: 10, relevance: 10 },
  acquisition: { buying: 8, relevance: 8 },
  contract:    { buying: 8, relevance: 9 },
  dividend:    { buying: 6, relevance: 5 },
  expansion:   { buying: 7, relevance: 7 },
  partnership: { buying: 6, relevance: 7 },
  executive:   { buying: 4, relevance: 6 },
  revenue:     { buying: 7, relevance: 7 },
};

const NEGATIVE_SCORES: Record<string, { risk: number; relevance: number }> = {
  lawsuit:     { risk: 7, relevance: 8 },
  fine:        { risk: 8, relevance: 8 },
  bankruptcy:  { risk: 10, relevance: 10 },
  sanctions:   { risk: 10, relevance: 10 },
  fraud:       { risk: 9, relevance: 9 },
  layoff:      { risk: 6, relevance: 7 },
  investigation: { risk: 7, relevance: 8 },
  breach:      { risk: 6, relevance: 6 },
  downgrade:   { risk: 7, relevance: 7 },
};

function _scoreArticle(article: {
  category: string;
  event_types: string[];
  positive_signals?: Record<string, string>;
  negative_signals?: Record<string, string>;
}): { buyingSignalScore: number; riskScore: number; relevanceScore: number; recommendedAction: string } {
  let buyingSignalScore = 0;
  let riskScore = 0;
  let relevanceScore = 3;

  for (const et of article.event_types || []) {
    if (POSITIVE_SCORES[et]) {
      buyingSignalScore = Math.max(buyingSignalScore, POSITIVE_SCORES[et].buying);
      relevanceScore = Math.max(relevanceScore, POSITIVE_SCORES[et].relevance);
    }
    if (NEGATIVE_SCORES[et]) {
      riskScore = Math.max(riskScore, NEGATIVE_SCORES[et].risk);
      relevanceScore = Math.max(relevanceScore, NEGATIVE_SCORES[et].relevance);
    }
  }

  let recommendedAction = "monitor";
  if (riskScore >= 9) recommendedAction = "disqualify";
  else if (riskScore >= 7) recommendedAction = "hold";
  else if (buyingSignalScore >= 8) recommendedAction = "prioritize";
  else if (buyingSignalScore >= 6) recommendedAction = "monitor";

  return { buyingSignalScore, riskScore, relevanceScore, recommendedAction };
}

// ── LLM classification via NEXUS (DeepSeek — cheap) ──────────────────────────

async function _classifyWithLLM(
  companyName: string,
  title: string,
  summary: string,
  category: string,
  eventTypes: string[],
): Promise<string> {
  const prompt = `Saudi Arabia B2B sales intelligence. Analyze this news about "${companyName}":

Headline: ${title}
Summary: ${summary.slice(0, 400)}
Pre-classified as: ${category} event (${eventTypes.join(", ")})

Write ONE sentence (max 20 words) explaining the sales significance:
- For positive events: why this is a buying opportunity
- For negative events: why this is a risk
- Focus on budget/buying capacity impact

Reply with ONLY the single sentence, no quotes, no extra text.`;

  try {
    const result = await nexusGenerate(prompt, { tier: "extraction", maxTokens: 60, temperature: 0.1 });
    return result.text.trim().replace(/^["']|["']$/g, "");
  } catch {
    return `${category === "positive" ? "Buying opportunity" : "Risk signal"}: ${eventTypes[0] || "event"} detected.`;
  }
}

// ── Main scan function ────────────────────────────────────────────────────────

export interface SignalScanResult {
  companyName: string;
  companyId?: number;
  totalSignals: number;
  positiveSignals: number;
  negativeSignals: number;
  sanctioned: boolean;
  sanctionsHits: Array<{ list: string; matchedName: string }>;
  topPositive: Array<{ title: string; eventType: string; buyingScore: number; llmSummary: string; url: string }>;
  topNegative: Array<{ title: string; eventType: string; riskScore: number; llmSummary: string; url: string }>;
  recommendedAction: "prioritize" | "monitor" | "hold" | "disqualify";
  overallBuyingScore: number;   // 0-10
  overallRiskScore: number;     // 0-10
  savedSignalIds: number[];
}

export async function scanCompanySignals(opts: {
  companyName: string;
  companyNameAr?: string;
  companyId?: number;
  domain?: string;
  runLlmClassification?: boolean;
  saveToDB?: boolean;
}): Promise<SignalScanResult> {
  const {
    companyName,
    companyNameAr,
    companyId,
    domain,
    runLlmClassification = true,
    saveToDB = true,
  } = opts;

  // ── Fetch all signals in parallel ─────────────────────────────────────────
  const [newsResult, sanctionsResult, contractsResult, googleNewsResult] = await Promise.allSettled([
    scoutSignalsNews(companyName, companyNameAr, domain),
    scoutSignalsSanctions(companyName, companyNameAr ? [companyNameAr] : undefined),
    scoutSignalsContracts(companyName, companyNameAr),
    // Free Google News RSS — adds outlets the Scout news endpoint may miss
    googleNewsForCompany(companyName, { limit: 15 }),
  ]);

  const news: NewsSignalResult | null = newsResult.status === "fulfilled" ? newsResult.value : null;
  const sanctions: SanctionsResult | null = sanctionsResult.status === "fulfilled" ? sanctionsResult.value : null;
  const contracts: ContractsResult | null = contractsResult.status === "fulfilled" ? contractsResult.value : null;
  const googleNewsHits = googleNewsResult.status === "fulfilled" ? googleNewsResult.value : [];

  // ── Merge all articles ─────────────────────────────────────────────────────
  const allArticles: Array<{
    title: string;
    summary: string;
    url: string;
    source: string;
    published: string | null;
    category: string;
    event_types: string[];
    positive_signals?: Record<string, string>;
    negative_signals?: Record<string, string>;
    contract_value?: string;
  }> = [];

  if (news?.articles) {
    allArticles.push(...news.articles);
  }
  // Merge Google News RSS hits, de-duplicating by URL against the Scout result
  if (googleNewsHits.length > 0) {
    const seenUrls = new Set(allArticles.map((a) => a.url));
    for (const hit of googleNewsHits) {
      if (seenUrls.has(hit.url)) continue;
      allArticles.push({
        title: hit.title,
        summary: hit.snippet || "",
        url: hit.url,
        source: hit.source || "Google News",
        published: hit.publishedAt || null,
        category: "neutral",
        event_types: ["news"],
      });
      seenUrls.add(hit.url);
    }
  }
  if (contracts?.contracts) {
    for (const c of contracts.contracts) {
      allArticles.push({
        title: c.title,
        summary: c.description || "",
        url: c.url,
        source: "Contracts Monitor",
        published: c.published || null,
        category: "positive",
        event_types: ["contract"],
        contract_value: c.contract_value || undefined,
      });
    }
  }

  // ── Score and classify each article ───────────────────────────────────────
  const savedIds: number[] = [];
  const topPositive: SignalScanResult["topPositive"] = [];
  const topNegative: SignalScanResult["topNegative"] = [];

  // LLM classification — run for top articles only (max 5 per category) to save cost
  const positiveArticles = allArticles.filter(a => a.category === "positive" || a.category === "mixed").slice(0, 5);
  const negativeArticles = allArticles.filter(a => a.category === "negative" || a.category === "mixed").slice(0, 5);

  const classifyBatch = [...positiveArticles, ...negativeArticles];
  const llmSummaries: string[] = runLlmClassification
    ? await Promise.all(
        classifyBatch.map(a =>
          _classifyWithLLM(companyName, a.title, a.summary, a.category, a.event_types)
        )
      )
    : classifyBatch.map(a => `${a.category} signal: ${a.event_types[0] || "event"} detected.`);

  for (let i = 0; i < classifyBatch.length; i++) {
    const article = classifyBatch[i];
    const llmSummary = llmSummaries[i] || "";
    const scores = _scoreArticle(article);

    if (saveToDB) {
      try {
        const [inserted] = await db.insert(companySignalsTable).values({
          companyId: companyId,
          companyName,
          companyNameAr: companyNameAr,
          domain,
          category: article.category,
          eventTypes: article.event_types,
          primaryEventType: article.event_types[0] || null,
          title: article.title,
          summary: article.summary?.slice(0, 1000) || null,
          sourceUrl: article.url,
          sourceName: article.source,
          publishedAt: article.published ? new Date(article.published) : null,
          llmSummary,
          buyingSignalScore: scores.buyingSignalScore,
          riskScore: scores.riskScore,
          relevanceScore: scores.relevanceScore,
          recommendedAction: scores.recommendedAction,
          isSanctioned: 0,
        }).returning({ id: companySignalsTable.id });
        if (inserted) savedIds.push(inserted.id);
      } catch { /* DB errors shouldn't crash the scan */ }
    }

    if (article.category === "positive" || (article.category === "mixed" && scores.buyingSignalScore >= scores.riskScore)) {
      topPositive.push({
        title: article.title,
        eventType: article.event_types[0] || "positive",
        buyingScore: scores.buyingSignalScore,
        llmSummary,
        url: article.url,
      });
    } else {
      topNegative.push({
        title: article.title,
        eventType: article.event_types[0] || "negative",
        riskScore: scores.riskScore,
        llmSummary,
        url: article.url,
      });
    }
  }

  // ── Handle sanctions ───────────────────────────────────────────────────────
  const sanctionsHits = (sanctions?.hits || []).map(h => ({ list: h.list, matchedName: h.matched_name || h.query_name }));
  const isSanctioned = sanctions?.is_sanctioned || false;

  if (isSanctioned && saveToDB) {
    try {
      const [inserted] = await db.insert(companySignalsTable).values({
        companyId,
        companyName,
        companyNameAr,
        domain,
        category: "negative",
        eventTypes: ["sanctions"],
        primaryEventType: "sanctions",
        title: `SANCTIONS MATCH: ${companyName} found on ${sanctionsHits[0]?.list || "watchlist"}`,
        summary: `Matched ${sanctionsHits.length} entries across ${[...new Set(sanctionsHits.map(h => h.list))].join(", ")}`,
        llmSummary: `CRITICAL: ${companyName} appears on international sanctions lists — do not engage.`,
        buyingSignalScore: 0,
        riskScore: 10,
        relevanceScore: 10,
        recommendedAction: "disqualify",
        isSanctioned: 1,
        sanctionsHits: sanctionsHits,
      }).returning({ id: companySignalsTable.id });
      if (inserted) savedIds.push(inserted.id);
    } catch { /* ignore */ }
  }

  // ── Compute overall scores ─────────────────────────────────────────────────
  const overallBuyingScore = topPositive.length > 0
    ? Math.round(topPositive.reduce((s, a) => s + a.buyingScore, 0) / topPositive.length)
    : 0;
  const overallRiskScore = isSanctioned
    ? 10
    : topNegative.length > 0
    ? Math.round(topNegative.reduce((s, a) => s + a.riskScore, 0) / topNegative.length)
    : 0;

  let recommendedAction: SignalScanResult["recommendedAction"] = "monitor";
  if (overallRiskScore >= 9 || isSanctioned) recommendedAction = "disqualify";
  else if (overallRiskScore >= 7) recommendedAction = "hold";
  else if (overallBuyingScore >= 7) recommendedAction = "prioritize";

  return {
    companyName,
    companyId,
    totalSignals: allArticles.length,
    positiveSignals: allArticles.filter(a => a.category === "positive").length,
    negativeSignals: allArticles.filter(a => a.category === "negative").length,
    sanctioned: isSanctioned,
    sanctionsHits,
    topPositive: topPositive.slice(0, 5),
    topNegative: topNegative.slice(0, 5),
    recommendedAction,
    overallBuyingScore,
    overallRiskScore,
    savedSignalIds: savedIds,
  };
}

// ── Individual Signal Scan ────────────────────────────────────────────────────

export interface IndividualScanResult {
  subject: string;
  subjectAr?: string;
  company?: string;
  buyingScore: number;
  riskScore: number;
  isPersonallySanctioned: boolean;
  recommendedAction: "prioritize" | "monitor" | "hold" | "disqualify";
  liquidityEventsCount: number;
  totalSignals: number;
  topLiquidityEvents: Array<{ title: string; eventType: string; buyingScore: number; url: string; isLiquidityEvent: boolean }>;
  topRiskSignals: Array<{ title: string; eventType: string; riskScore: number; url: string }>;
}

export async function scanIndividualSignals(opts: {
  fullName: string;
  fullNameAr?: string;
  companyName?: string;
  title?: string;
  maxArticles?: number;
}): Promise<IndividualScanResult> {
  const { fullName, fullNameAr, companyName, title, maxArticles = 20 } = opts;

  const result = await scoutSignalsIndividualFull(fullName, {
    fullNameAr,
    companyName,
    title,
    maxArticles,
  });

  if (!result) {
    return {
      subject: fullName,
      subjectAr: fullNameAr,
      company: companyName,
      buyingScore: 0,
      riskScore: 0,
      isPersonallySanctioned: false,
      recommendedAction: "monitor",
      liquidityEventsCount: 0,
      totalSignals: 0,
      topLiquidityEvents: [],
      topRiskSignals: [],
    };
  }

  const topLiquidityEvents = (result.top_signals || [])
    .filter(s => s.is_liquidity_event || s.buying_score >= 6)
    .slice(0, 5)
    .map(s => ({
      title: s.title,
      eventType: s.event_types?.[0] || "positive",
      buyingScore: s.buying_score,
      url: s.url,
      isLiquidityEvent: s.is_liquidity_event,
    }));

  const topRiskSignals = (result.top_signals || [])
    .filter(s => s.risk_score >= 5)
    .slice(0, 5)
    .map(s => ({
      title: s.title,
      eventType: s.event_types?.[0] || "negative",
      riskScore: s.risk_score,
      url: s.url,
    }));

  return {
    subject: fullName,
    subjectAr: fullNameAr,
    company: companyName,
    buyingScore: result.buying_score,
    riskScore: result.risk_score,
    isPersonallySanctioned: result.is_sanctioned,
    recommendedAction: result.recommended_action,
    liquidityEventsCount: result.liquidity_events_count,
    totalSignals: result.positive_count + result.negative_count,
    topLiquidityEvents,
    topRiskSignals,
  };
}

// ── Regulatory Signal Scan ────────────────────────────────────────────────────

export interface RegulatoryScanResult {
  company: string;
  maxRiskScore: number;
  maxBuyingScore: number;
  recommendedAction: "prioritize" | "monitor" | "hold" | "disqualify";
  regulatoryRisks: number;
  tadawulDisclosures: number;
  topRisks: Array<{ title: string; regulator: string; riskScore: number; url: string }>;
  topDisclosures: Array<{ title: string; disclosureType: string; buyingScore: number; url: string }>;
}

export async function scanRegulatorySignals(opts: {
  companyName: string;
  companyNameAr?: string;
  includeTadawul?: boolean;
}): Promise<RegulatoryScanResult> {
  const { companyName, companyNameAr, includeTadawul = true } = opts;

  const result = await scoutSignalsRegulatory(companyName, {
    companyNameAr,
    includeTadawul,
  });

  if (!result) {
    return {
      company: companyName,
      maxRiskScore: 0,
      maxBuyingScore: 0,
      recommendedAction: "monitor",
      regulatoryRisks: 0,
      tadawulDisclosures: 0,
      topRisks: [],
      topDisclosures: [],
    };
  }

  const topRisks = (result.risk_signals || []).slice(0, 5).map(s => ({
    title: s.title,
    regulator: s.regulator,
    riskScore: s.risk_score,
    url: s.url,
  }));

  const topDisclosures = (result.positive_signals || []).slice(0, 5).map(s => ({
    title: s.title,
    disclosureType: s.disclosure_type,
    buyingScore: s.buying_score,
    url: s.url,
  }));

  return {
    company: companyName,
    maxRiskScore: result.max_risk_score,
    maxBuyingScore: result.max_buying_score,
    recommendedAction: result.recommended_action,
    regulatoryRisks: result.risk_signals_found,
    tadawulDisclosures: result.positive_signals_found,
    topRisks,
    topDisclosures,
  };
}

// ── Read signals from DB ──────────────────────────────────────────────────────

export async function getCompanySignals(
  companyId: number,
  limit = 20,
): Promise<typeof companySignalsTable.$inferSelect[]> {
  return db
    .select()
    .from(companySignalsTable)
    .where(eq(companySignalsTable.companyId, companyId))
    .orderBy(desc(companySignalsTable.createdAt))
    .limit(limit);
}

export async function getSignalsByName(
  companyName: string,
  limit = 20,
): Promise<typeof companySignalsTable.$inferSelect[]> {
  return db
    .select()
    .from(companySignalsTable)
    .where(eq(companySignalsTable.companyName, companyName))
    .orderBy(desc(companySignalsTable.createdAt))
    .limit(limit);
}
