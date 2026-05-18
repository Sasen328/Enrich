/**
 * Scout Client — Node.js typed HTTP client for the Python Scout microservice.
 * Scout runs on port 8099 and provides:
 *  - Site intelligence (contacts, tech, social, CR/VAT)
 *  - OSINT harvest (subdomains, email patterns, DNS/WHOIS)
 *  - Social presence scan (Sherlock-style)
 *  - AI extraction (ScrapeGraphAI-style via Gemini)
 *  - Deep crawl (Scrapy-based)
 */

import { env } from "./config/env.js";

const SCOUT_BASE = env.SCOUT_URL;
const SCOUT_TIMEOUT_MS = 30_000;

async function scoutFetch<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCOUT_TIMEOUT_MS);
  try {
    const res = await fetch(`${SCOUT_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json() as { ok: boolean; data?: T; error?: string };
    return json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Scout unreachable: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SiteIntelResult {
  url: string;
  base_url: string;
  domain: string;
  ok: boolean;
  status_code: number | null;
  meta: {
    title?: string;
    description?: string;
    keywords?: string;
    og_image?: string;
    favicon?: string;
  };
  language: "arabic" | "bilingual" | "english" | "unknown";
  cms: string | null;
  tech_stack: string[];
  emails: string[];
  phones: string[];
  socials: Record<string, string>;
  cr_vat: { cr_number?: string; vat_number?: string };
  nav_links: string[];
  about_page: { emails?: string[]; phones?: string[]; text_snippet?: string };
  contact_page: { emails?: string[]; phones?: string[]; text_snippet?: string };
  raw_text_snippet: string;
  errors: string[];
}

export interface OsintHarvestResult {
  domain: string;
  subdomains_crtsh: string[];
  subdomains_brute: Array<{ subdomain: string; url: string; status: number; title: string }>;
  all_discovered_subdomains: string[];
  email_patterns: string[];
  mx_records: string[];
  whois: { registered?: string; expires?: string; registrar?: string; nameservers?: string[] };
  errors: string[];
}

export interface SocialPresenceResult {
  username: string;
  found: Array<{ platform: string; url: string; status: string; title: string; description: string }>;
  not_found: unknown[];
  errors: unknown[];
  total_checked: number;
  found_count: number;
}

export interface AiExtractResult {
  name_en?: string | null;
  name_ar?: string | null;
  description?: string | null;
  industry?: string | null;
  founded?: string | null;
  headquarters?: string | null;
  employees?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  cr_number?: string | null;
  vat_number?: string | null;
  services?: string[];
  clients?: string[];
  certifications?: string[];
  social_media?: { twitter?: string; linkedin?: string; instagram?: string };
  is_saudi_company?: string;
  is_vision2030_aligned?: string;
  error?: string;
}

export interface FullScanResult {
  url: string;
  domain: string;
  all_emails: string[];
  data: {
    site?: SiteIntelResult;
    osint?: OsintHarvestResult;
    social?: SocialPresenceResult;
    ai_extract?: AiExtractResult;
  };
}

// ── API Functions ──────────────────────────────────────────────────────────────

/** Full site intelligence scan — contacts, social, tech, CR/VAT */
export async function scoutSiteIntel(
  url: string,
  opts: { followSubpages?: boolean; timeout?: number } = {},
): Promise<SiteIntelResult | null> {
  const res = await scoutFetch<SiteIntelResult>("/scout/site-intel", {
    url,
    follow_subpages: opts.followSubpages ?? true,
    timeout: opts.timeout ?? 20,
  });
  return res.data ?? null;
}

/** Domain OSINT harvest — subdomains, email patterns, DNS/WHOIS */
export async function scoutOsintHarvest(
  domain: string,
  opts: { bruteSubdomains?: boolean; maxSubdomains?: number } = {},
): Promise<OsintHarvestResult | null> {
  const res = await scoutFetch<OsintHarvestResult>("/scout/osint/harvest", {
    domain,
    brute_subdomains: opts.bruteSubdomains ?? true,
    max_subdomains: opts.maxSubdomains ?? 25,
  });
  return res.data ?? null;
}

/** Social presence scan across 15+ platforms (Sherlock-style) */
export async function scoutSocialScan(
  username: string,
  platforms?: string[],
): Promise<SocialPresenceResult | null> {
  const res = await scoutFetch<SocialPresenceResult>("/scout/osint/social", {
    username,
    ...(platforms ? { platforms } : {}),
  });
  return res.data ?? null;
}

/** AI-powered structured extraction (ScrapeGraphAI-style) via Gemini 2.5 Flash */
export async function scoutAiExtract(
  url: string,
  pageText: string,
): Promise<AiExtractResult | null> {
  const res = await scoutFetch<AiExtractResult>("/scout/ai-extract", {
    url,
    page_text: pageText,
    auto_fetch: false,
  });
  return res.data ?? null;
}

/** Custom AI extraction with user-defined schema */
export async function scoutAiExtractCustom(
  url: string,
  pageText: string,
  extractionGoal: string,
  outputSchema: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await scoutFetch<Record<string, unknown>>("/scout/ai-extract", {
    url,
    page_text: pageText,
    extraction_goal: extractionGoal,
    output_schema: outputSchema,
    auto_fetch: false,
  });
  return res.data ?? null;
}

/** Full parallel scan: site-intel + OSINT + AI extraction in one shot */
export async function scoutFullScan(
  url: string,
  opts: {
    includeOsint?: boolean;
    includeAi?: boolean;
    includeSocial?: boolean;
    socialUsername?: string;
    timeout?: number;
  } = {},
): Promise<FullScanResult | null> {
  const res = await scoutFetch<FullScanResult>("/scout/full-scan", {
    url,
    include_osint: opts.includeOsint ?? true,
    include_ai: opts.includeAi ?? true,
    include_social: opts.includeSocial ?? false,
    social_username: opts.socialUsername,
    timeout: opts.timeout ?? 25,
  });
  return res.data ?? null;
}

/** Check if Scout microservice is healthy */
export async function isScoutAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${SCOUT_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Signal Intelligence Types ──────────────────────────────────────────────────

export interface NewsArticle {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published: string | null;
  category: "positive" | "negative" | "neutral" | "mixed";
  event_types: string[];
  positive_signals: Record<string, string>;
  negative_signals: Record<string, string>;
}

export interface NewsSignalResult {
  company: string;
  total_articles: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  event_type_summary: Record<string, number>;
  articles: NewsArticle[];
}

export interface SanctionsHit {
  list: string;
  matched_name: string;
  query_name: string;
  entity_type: string;
  program: string;
}

export interface SanctionsResult {
  name: string;
  is_sanctioned: boolean;
  hit_count: number;
  hits: SanctionsHit[];
  lists_checked: string[];
  risk_level: "HIGH" | "CLEAR";
}

export interface ContractSignal {
  title: string;
  description: string;
  url: string;
  published: string | null;
  contract_value: string | null;
  signal_type: "positive";
  event_type: "contract";
}

export interface ContractsResult {
  company: string;
  contract_signals_found: number;
  contracts: ContractSignal[];
}

export interface FullSignalResult {
  company: string;
  buying_score: number;
  risk_score: number;
  is_sanctioned: boolean;
  recommended_action: "prioritize" | "monitor" | "hold" | "disqualify";
  positive_signals_count: number;
  negative_signals_count: number;
  streams: {
    news?: NewsSignalResult;
    sanctions?: SanctionsResult;
    contracts?: ContractsResult;
  };
}

// ── Signal Intelligence Functions ──────────────────────────────────────────────

/** Fetch trigger event news from Google News RSS + Saudi business media */
export async function scoutSignalsNews(
  companyName: string,
  companyNameAr?: string,
  domain?: string,
  maxArticles = 20,
): Promise<NewsSignalResult | null> {
  const res = await scoutFetch<NewsSignalResult>("/scout/signals/news", {
    company_name: companyName,
    company_name_ar: companyNameAr,
    domain,
    max_articles: maxArticles,
  });
  return res.data ?? null;
}

/** Check company/person against OFAC SDN + UN sanctions lists */
export async function scoutSignalsSanctions(
  name: string,
  alsoCheck?: string[],
): Promise<SanctionsResult | null> {
  const res = await scoutFetch<SanctionsResult>("/scout/signals/sanctions", {
    name,
    also_check: alsoCheck,
  });
  return res.data ?? null;
}

/** Fetch government contract awards (positive buying signals) */
export async function scoutSignalsContracts(
  companyName: string,
  companyNameAr?: string,
): Promise<ContractsResult | null> {
  const res = await scoutFetch<ContractsResult>("/scout/signals/contracts", {
    company_name: companyName,
    company_name_ar: companyNameAr,
  });
  return res.data ?? null;
}

// ── Individual Signal Intelligence Types ──────────────────────────────────────

export interface IndividualArticle {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published: string | null;
  category: "positive" | "negative" | "neutral" | "mixed";
  event_types: string[];
  positive_signals: Record<string, string>;
  negative_signals: Record<string, string>;
  buying_score: number;
  risk_score: number;
  is_liquidity_event: boolean;
}

export interface IndividualSignalResult {
  subject: string;
  subject_ar: string | null;
  company: string | null;
  title: string | null;
  total_articles: number;
  positive_count: number;
  negative_count: number;
  liquidity_events_count: number;
  event_type_summary: Record<string, number>;
  buying_score: number;
  risk_score: number;
  recommended_action: "prioritize" | "monitor" | "hold" | "disqualify";
  liquidity_events: IndividualArticle[];
  articles: IndividualArticle[];
  sanctions_hit?: boolean;
  sanctions_detail?: SanctionsResult;
}

export interface IndividualFullResult {
  subject: string;
  subject_ar: string | null;
  company: string | null;
  buying_score: number;
  risk_score: number;
  is_sanctioned: boolean;
  recommended_action: "prioritize" | "monitor" | "hold" | "disqualify";
  liquidity_events_count: number;
  positive_count: number;
  negative_count: number;
  event_type_summary: Record<string, number>;
  top_signals: IndividualArticle[];
  sanctions: SanctionsResult;
}

// ── Saudi Regulatory Signal Types ─────────────────────────────────────────────

export interface RegulatoryRiskSignal {
  id: string;
  source: string;
  regulator: string;
  title: string;
  summary: string;
  url: string;
  published: string | null;
  event_type: string;
  risk_score: number;
  category: "negative";
}

export interface TadawulDisclosure {
  id: string;
  source: string;
  disclosure_type: string;
  title: string;
  summary: string;
  url: string;
  published: string | null;
  event_type: string;
  buying_score: number;
  category: "positive";
}

export interface RegulatorySignalResult {
  company: string;
  company_ar: string | null;
  risk_signals_found: number;
  positive_signals_found: number;
  max_risk_score: number;
  max_buying_score: number;
  recommended_action: "prioritize" | "monitor" | "hold" | "disqualify";
  risk_signals: RegulatoryRiskSignal[];
  positive_signals: TadawulDisclosure[];
}

// ── Individual Signal Functions ────────────────────────────────────────────────

/** Monitor personal trigger events for a named individual */
export async function scoutSignalsIndividual(
  fullName: string,
  opts: {
    fullNameAr?: string;
    companyName?: string;
    title?: string;
    checkSanctions?: boolean;
    maxArticles?: number;
  } = {},
): Promise<IndividualSignalResult | null> {
  const res = await scoutFetch<IndividualSignalResult>("/scout/signals/individual", {
    full_name: fullName,
    full_name_ar: opts.fullNameAr,
    company_name: opts.companyName,
    title: opts.title,
    check_sanctions: opts.checkSanctions ?? true,
    max_articles: opts.maxArticles ?? 20,
  });
  return res.data ?? null;
}

/** Full individual intelligence: news + sanctions in parallel */
export async function scoutSignalsIndividualFull(
  fullName: string,
  opts: {
    fullNameAr?: string;
    companyName?: string;
    title?: string;
    maxArticles?: number;
  } = {},
): Promise<IndividualFullResult | null> {
  const res = await scoutFetch<IndividualFullResult>("/scout/signals/individual-full", {
    full_name: fullName,
    full_name_ar: opts.fullNameAr,
    company_name: opts.companyName,
    title: opts.title,
    max_articles: opts.maxArticles ?? 20,
  });
  return res.data ?? null;
}

/** Fetch Saudi regulatory enforcement signals (CMA/SAMA/ZATCA/Tadawul) */
export async function scoutSignalsRegulatory(
  companyName: string,
  opts: {
    companyNameAr?: string;
    includeTadawul?: boolean;
  } = {},
): Promise<RegulatorySignalResult | null> {
  const res = await scoutFetch<RegulatorySignalResult>("/scout/signals/regulatory", {
    company_name: companyName,
    company_name_ar: opts.companyNameAr,
    include_tadawul: opts.includeTadawul ?? true,
  });
  return res.data ?? null;
}

/** Full signal scan: news + sanctions + contracts in parallel */
export async function scoutSignalsFull(
  companyName: string,
  opts: {
    companyNameAr?: string;
    domain?: string;
    includeNews?: boolean;
    includeSanctions?: boolean;
    includeContracts?: boolean;
    maxArticles?: number;
  } = {},
): Promise<FullSignalResult | null> {
  const res = await scoutFetch<FullSignalResult>("/scout/signals/full", {
    company_name: companyName,
    company_name_ar: opts.companyNameAr,
    domain: opts.domain,
    include_news: opts.includeNews ?? true,
    include_sanctions: opts.includeSanctions ?? true,
    include_contracts: opts.includeContracts ?? true,
    max_articles: opts.maxArticles ?? 20,
  });
  return res.data ?? null;
}
