// ─── Lead Validator ──────────────────────────────────────────────────────────
// Active verification layer on top of Agent 5's deterministic dedup checks.
// Performs:
//   1. DNS / MX lookup        — does the email domain accept mail?
//   2. Domain liveness check  — does the website actually respond?
//   3. Cross-source check     — does the company appear in 2+ trusted sources?
//   4. Dummy / placeholder    — does it look fake/seeded (lorem-ipsum,
//                                "Example Co", repeated digits in phone)?
//   5. Confidence scoring     — 0-100 composite from the above signals.
//
// Wired into Agent 5 in lead-factory-engine.ts. Each check is bounded with a
// short timeout so a flaky external service can't stall the pipeline.

import dns from "node:dns/promises";
import axios from "axios";

export interface LeadInput {
  companyName?: string;
  domain?: string;
  email?: string;
  phone?: string;
  crNumber?: string;
  sourceUsed?: string;
  rawData?: { sourcesAggregated?: string[] } | Record<string, unknown>;
}

export interface ValidationSignals {
  mxValid: boolean | null;        // null = could not check (no email)
  domainLive: boolean | null;
  crossSourceCount: number;        // distinct trusted sources that mention this entity
  appearsDummy: boolean;
  confidence: number;              // 0-100 composite
  notes: string[];
}

// ── DNS / MX lookup ──────────────────────────────────────────────────────────
const MX_CACHE = new Map<string, boolean>();
const MX_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const MX_CACHE_TIMESTAMPS = new Map<string, number>();

async function hasMX(domain: string): Promise<boolean> {
  const ts = MX_CACHE_TIMESTAMPS.get(domain);
  if (ts && Date.now() - ts < MX_CACHE_TTL_MS && MX_CACHE.has(domain)) {
    return MX_CACHE.get(domain)!;
  }
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("dns timeout")), 4000)),
    ]);
    const valid = Array.isArray(records) && records.length > 0;
    MX_CACHE.set(domain, valid);
    MX_CACHE_TIMESTAMPS.set(domain, Date.now());
    return valid;
  } catch {
    MX_CACHE.set(domain, false);
    MX_CACHE_TIMESTAMPS.set(domain, Date.now());
    return false;
  }
}

// ── Domain liveness ──────────────────────────────────────────────────────────
const LIVENESS_CACHE = new Map<string, boolean>();
const LIVENESS_TIMESTAMPS = new Map<string, number>();

async function isDomainLive(domain: string): Promise<boolean> {
  const ts = LIVENESS_TIMESTAMPS.get(domain);
  if (ts && Date.now() - ts < MX_CACHE_TTL_MS && LIVENESS_CACHE.has(domain)) {
    return LIVENESS_CACHE.get(domain)!;
  }
  for (const scheme of ["https://", "http://"]) {
    try {
      const r = await axios.head(`${scheme}${domain}`, {
        timeout: 4000,
        maxRedirects: 3,
        validateStatus: (s) => s >= 200 && s < 500,
      });
      const live = r.status >= 200 && r.status < 500;
      LIVENESS_CACHE.set(domain, live);
      LIVENESS_TIMESTAMPS.set(domain, Date.now());
      if (live) return true;
    } catch { /* try next */ }
  }
  LIVENESS_CACHE.set(domain, false);
  LIVENESS_TIMESTAMPS.set(domain, Date.now());
  return false;
}

// ── Dummy / placeholder detection ────────────────────────────────────────────
const DUMMY_PATTERNS = [
  /lorem\s*ipsum/i,
  /^example\s+(co|company|corp|inc)\.?$/i,
  /^test\s+(company|corp|inc)/i,
  /^foo\s*bar/i,
  /^acme\s+(corp|inc|co)\.?$/i,
  /^company\s*\d+$/i,
  /^xxx+$/i,
  /^undefined$/i,
  /^null$/i,
];

const DUMMY_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.com", "test.org",
  "tempmail.com", "mailinator.com", "yopmail.com", "guerrillamail.com",
  "fakeinbox.com", "10minutemail.com",
]);

function isPhoneSuspect(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return true;
  // All-zero, all-same-digit, sequential
  if (/^(.)\1+$/.test(digits)) return true;
  if (digits === "01234567" || digits === "12345678" || digits === "1234567890") return true;
  return false;
}

function detectDummy(lead: LeadInput, notes: string[]): boolean {
  let dummy = false;
  if (lead.companyName) {
    for (const p of DUMMY_PATTERNS) {
      if (p.test(lead.companyName)) {
        dummy = true;
        notes.push(`DUMMY_NAME: matches ${p.toString()}`);
        break;
      }
    }
  }
  if (lead.domain) {
    const d = lead.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
    if (DUMMY_DOMAINS.has(d)) { dummy = true; notes.push(`DUMMY_DOMAIN: ${d}`); }
  }
  if (lead.email) {
    const at = lead.email.indexOf("@");
    if (at > 0) {
      const dom = lead.email.slice(at + 1).toLowerCase();
      if (DUMMY_DOMAINS.has(dom)) { dummy = true; notes.push(`DUMMY_EMAIL: ${dom}`); }
    }
  }
  if (lead.phone && isPhoneSuspect(lead.phone)) {
    dummy = true; notes.push("DUMMY_PHONE: sequential/repeating digits");
  }
  return dummy;
}

// ── Cross-source corroboration ───────────────────────────────────────────────
// Trusted sources we accept as corroboration. `sourceUsed` is the single
// last-write source; `rawData.sourcesAggregated` may contain a list of all
// providers that contributed to the row.
const TRUSTED_SOURCES = new Set([
  "GLEIF", "OpenCorporates", "Wikidata", "Tadawul", "Argaam",
  "Maroof", "Wathq", "MISA", "MODON", "Monshaat", "ZATCA", "SAMA",
  "Apollo", "Hunter", "Explorium", "Scout", "Perplexity", "Gemini",
  "Tavily", "FreeWebSearch", "Bluepages",
]);

function countCrossSources(lead: LeadInput): number {
  const set = new Set<string>();
  if (lead.sourceUsed) {
    for (const s of lead.sourceUsed.split(/[,;]+/)) {
      const trimmed = s.trim();
      if (trimmed && TRUSTED_SOURCES.has(trimmed)) set.add(trimmed);
    }
  }
  const agg = (lead.rawData as { sourcesAggregated?: string[] } | undefined)?.sourcesAggregated;
  if (Array.isArray(agg)) {
    for (const s of agg) {
      if (typeof s === "string" && TRUSTED_SOURCES.has(s)) set.add(s);
    }
  }
  return set.size;
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function verifyLead(lead: LeadInput): Promise<ValidationSignals> {
  const notes: string[] = [];
  const appearsDummy = detectDummy(lead, notes);

  // Run network checks in parallel
  const emailDomain = lead.email?.split("@")[1]?.toLowerCase();
  const websiteDomain = lead.domain
    ? lead.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0]
    : undefined;

  const [mxValid, domainLive] = await Promise.all([
    emailDomain ? hasMX(emailDomain) : Promise.resolve<boolean | null>(null),
    websiteDomain ? isDomainLive(websiteDomain) : Promise.resolve<boolean | null>(null),
  ]);

  if (mxValid === false) notes.push(`MX_LOOKUP_FAILED: ${emailDomain}`);
  if (domainLive === false) notes.push(`DOMAIN_UNREACHABLE: ${websiteDomain}`);

  const crossSourceCount = countCrossSources(lead);
  if (crossSourceCount === 0) notes.push("NO_TRUSTED_SOURCE");

  // Confidence scoring (0-100). Weights chosen so any single weak signal
  // can't push above 40, and a strongly-verified row reaches 90+.
  let score = 30; // base
  if (mxValid === true) score += 20;
  if (mxValid === false) score -= 10;
  if (domainLive === true) score += 25;
  if (domainLive === false) score -= 15;
  if (lead.crNumber && lead.crNumber.replace(/\D/g, "").length >= 9) score += 10;
  if (lead.phone && !isPhoneSuspect(lead.phone)) score += 5;
  score += Math.min(crossSourceCount * 5, 20); // up to +20 for 4+ sources
  if (appearsDummy) score = Math.min(score, 15); // hard cap when dummy

  const confidence = Math.max(0, Math.min(100, Math.round(score)));

  return { mxValid, domainLive, crossSourceCount, appearsDummy, confidence, notes };
}
