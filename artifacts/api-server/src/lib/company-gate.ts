// ─── Company Gate ────────────────────────────────────────────────────────────
// Mirrors lib/lead-gate.ts but for company-level inserts. Runs every direct
// INSERT through:
//   1. validateCompany() — format checks (name length, CR format, domain
//      sanity, dummy-data detection)
//   2. verifyLead()      — reused: DNS/MX + domain liveness + dummy detector
//   3. fingerprint dedup — checks lead_fingerprints by domain / CR / fuzzy
//      name match. Yes, we use the SAME fingerprint table for both leads and
//      companies — domain/CR uniqueness is the same across both.
//
// Caller decides what to do with "warn" rows. Default: insert with
// enrichmentStatus="unverified".

import { db, companiesTable, leadFingerprintsTable } from "@workspace/db";
import {
  normalisePhone,
  normaliseName,
  nameSimilarity,
} from "./lead-factory-engine.js";
import { verifyLead } from "./lead-validator.js";

export interface CompanyGateInput {
  nameEn?: string;
  nameAr?: string;
  industry?: string;
  city?: string;
  country?: string;
  website?: string;
  crNumber?: string;
  email?: string;
  phone?: string;
  description?: string;
  ownerName?: string;
  enrichmentStatus?: string;
  enrichmentScore?: number;
  dataSource?: string;
  [k: string]: unknown;
}

export interface CompanyGateResult {
  status: "pass" | "warn" | "reject";
  reasons: string[];
  isDuplicate: boolean;
  duplicateOf?: string;
  confidence?: number;
  fingerprint: {
    normalizedName: string | null;
    domain: string | null;
    crNumber: string | null;
    phoneNormalized: string | null;
    emailNormalized: string | null;
  };
}

function validateCompany(input: CompanyGateInput): { status: "pass" | "warn" | "reject"; reasons: string[] } {
  const reasons: string[] = [];
  let status: "pass" | "warn" | "reject" = "pass";

  const name = (input.nameEn || input.nameAr || "").trim();
  if (!name || name.length < 3) {
    reasons.push("COMPANY_NAME_MISSING"); status = "reject";
  } else if (/^(test|example|sample|n\/?a|null|undefined|company)$/i.test(name)) {
    reasons.push("COMPANY_NAME_PLACEHOLDER"); status = "reject";
  }

  if (input.crNumber) {
    const cr = String(input.crNumber).replace(/\D/g, "");
    if (cr.length !== 10 && (cr.length < 7 || cr.length > 12)) {
      reasons.push("CR_NUMBER_FORMAT_INVALID");
      if (status === "pass") status = "warn";
    }
  }

  if (input.website) {
    const w = String(input.website).toLowerCase();
    if (/example\.com|test\.com|placeholder/.test(w)) {
      reasons.push("DOMAIN_PLACEHOLDER"); status = "reject";
    }
  }

  if (input.description) {
    const placeholders = ["lorem ipsum", "company description", "we are a leading", "description goes here"];
    if (placeholders.some((p) => String(input.description).toLowerCase().includes(p))) {
      reasons.push("DESCRIPTION_PLACEHOLDER");
      if (status === "pass") status = "warn";
    }
  }

  return { status, reasons };
}

export async function gateCompany(input: CompanyGateInput): Promise<CompanyGateResult> {
  const name = (input.nameEn || input.nameAr || "").trim();
  const domain = input.website ? String(input.website).replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase() : null;
  const cr = input.crNumber ? String(input.crNumber).replace(/\D/g, "") : null;

  const fp = {
    normalizedName: name ? normaliseName(name) : null,
    domain: domain || null,
    crNumber: cr || null,
    phoneNormalized: input.phone ? normalisePhone(String(input.phone)) : null,
    emailNormalized: input.email ? String(input.email).toLowerCase() : null,
  };

  // 1. Format validation
  const v = validateCompany(input);
  const result: CompanyGateResult = { ...v, isDuplicate: false, fingerprint: fp };

  // 2. Dedup
  if (result.status !== "reject") {
    try {
      const existing = await db.select().from(leadFingerprintsTable).limit(50000);
      for (const e of existing) {
        let dup = false; let dupKey = "";
        if (fp.domain && e.domain && fp.domain === e.domain) { dup = true; dupKey = fp.domain; }
        else if (fp.crNumber && e.crNumber && fp.crNumber === e.crNumber) { dup = true; dupKey = fp.crNumber; }
        else if (fp.normalizedName && e.normalizedName && nameSimilarity(fp.normalizedName, e.normalizedName) >= 0.88) { dup = true; dupKey = fp.normalizedName; }
        if (dup) {
          result.isDuplicate = true;
          result.duplicateOf = dupKey;
          result.reasons.push("DUPLICATE_EXISTS");
          if (result.status === "pass") result.status = "warn";
          break;
        }
      }
    } catch { /* dedup failure shouldn't block */ }
  }

  // 3. Verification (DNS/MX, liveness, dummy)
  if (result.status !== "reject") {
    try {
      const signals = await verifyLead({
        companyName: name,
        domain: domain || undefined,
        email: input.email ? String(input.email) : undefined,
        phone: input.phone ? String(input.phone) : undefined,
        crNumber: cr || undefined,
      });
      result.confidence = signals.confidence;
      for (const n of signals.notes) result.reasons.push(n);
      if (signals.appearsDummy) {
        result.status = "reject"; result.reasons.push("DUMMY_DETECTED");
      } else if (signals.confidence < 35 && result.status === "pass") {
        result.status = "warn"; result.reasons.push(`LOW_CONFIDENCE:${signals.confidence}`);
      }
    } catch { /* verifier failure shouldn't block */ }
  }

  return result;
}

export interface InsertCompanyOptions {
  enrichmentStatus?: string;
  enrichmentScore?: number;
  dataSource?: string;
}

/** Gate + insert + fingerprint-write in one shot. */
export async function insertCompanyWithGate(
  input: CompanyGateInput,
  opts: InsertCompanyOptions = {},
): Promise<{ gate: CompanyGateResult; company?: typeof companiesTable.$inferSelect; inserted: boolean }> {
  const gate = await gateCompany(input);

  if (gate.status === "reject") return { gate, inserted: false };

  const enrichmentStatus = opts.enrichmentStatus ?? (gate.status === "warn" ? "unverified" : (input.enrichmentStatus || "partial"));

  const [company] = await db.insert(companiesTable).values({
    nameEn: input.nameEn || null,
    nameAr: input.nameAr || null,
    industry: input.industry || null,
    city: input.city || null,
    country: input.country || "Saudi Arabia",
    website: input.website || null,
    crNumber: input.crNumber || null,
    email: input.email || null,
    phone: input.phone || null,
    description: input.description || null,
    ownerName: input.ownerName || null,
    enrichmentStatus,
    enrichmentScore: opts.enrichmentScore ?? input.enrichmentScore ?? (gate.status === "warn" ? 20 : 80),
    dataSource: opts.dataSource ?? input.dataSource ?? "manual",
    // Preserve unknown fields the caller passed (revenue, profit, etc.)
    ...Object.fromEntries(
      Object.entries(input).filter(([k]) => ![
        "nameEn", "nameAr", "industry", "city", "country", "website",
        "crNumber", "email", "phone", "description", "ownerName",
        "enrichmentStatus", "enrichmentScore", "dataSource",
      ].includes(k)),
    ),
  } as typeof companiesTable.$inferInsert).returning();

  // Write fingerprint so subsequent companies can dedupe against this one
  try {
    await db.insert(leadFingerprintsTable).values({
      normalizedName: gate.fingerprint.normalizedName,
      domain: gate.fingerprint.domain,
      crNumber: gate.fingerprint.crNumber,
      phoneNormalized: gate.fingerprint.phoneNormalized,
      emailNormalized: gate.fingerprint.emailNormalized,
      sourceTable: "companies",
      sourceId: company?.id || null,
    });
  } catch { /* fingerprint failure shouldn't undo the insert */ }

  return { gate, company, inserted: true };
}
