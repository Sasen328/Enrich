// ─── Lead Gate ───────────────────────────────────────────────────────────────
// Reusable validation + dedup + verification gate for manual lead pushes.
// Same checks the 7-agent pipeline (Agent 5) runs, exposed as a callable
// function so any route (POST /api/leads, POST /api/leads/push-from-company,
// future bulk-import flows) gates input through identical logic.
//
// Flow:
//   1. validateLead()              — phone/email/CR/company format checks
//   2. verifyLead()                — DNS/MX + domain liveness + dummy detection
//   3. fingerprint dedup           — checks lead_fingerprints for existing matches
//   4. (optional) writeFingerprint — persists the fingerprint for future dedup
//
// Returns a verdict: pass | warn | reject + reasons. Caller decides whether
// to insert when status === "warn" (current policy: insert with status="unverified").

import { db, leadFingerprintsTable, leadsTable } from "@workspace/db";
import {
  validateLead,
  normalisePhone,
  normaliseName,
  nameSimilarity,
  type RawLead,
} from "./lead-factory-engine.js";
import { verifyLead, type LeadInput as VerifyInput } from "./lead-validator.js";

export interface GateInput {
  companyName?: string;
  domain?: string;
  phone?: string;
  email?: string;
  emailTrusted?: boolean;
  crNumber?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  department?: string;
  seniority?: string;
}

export interface GateResult {
  status: "pass" | "warn" | "reject";
  reasons: string[];
  isDuplicate: boolean;
  duplicateOf?: string;
  confidence?: number;
  fingerprint: {
    normalizedName: string | null;
    domain: string | null;
    phoneNormalized: string | null;
    emailNormalized: string | null;
    crNumber: string | null;
  };
}

/** Run a lead through validate + verify + dedup. Does NOT insert. */
export async function gateLead(input: GateInput): Promise<GateResult> {
  const raw: RawLead = {
    companyName: input.companyName,
    domain: input.domain,
    phone: input.phone,
    email: input.email,
    emailTrusted: input.emailTrusted,
    crNumber: input.crNumber,
    linkedinUrl: input.linkedinUrl,
  };

  // 1. Format validation
  const validation = await validateLead(raw);

  // 2. Compute fingerprint keys
  const fp = {
    normalizedName: input.companyName ? normaliseName(input.companyName) : null,
    domain: input.domain?.toLowerCase() || null,
    phoneNormalized: input.phone ? normalisePhone(input.phone) : null,
    emailNormalized: input.email?.toLowerCase() || null,
    crNumber: input.crNumber?.replace(/\D/g, "") || null,
  };

  // 3. Dedup against existing fingerprints
  if (validation.status !== "reject") {
    try {
      const existing = await db.select().from(leadFingerprintsTable).limit(50000);
      for (const e of existing) {
        let dup = false;
        let dupKey = "";
        if (fp.domain && e.domain && fp.domain === e.domain) { dup = true; dupKey = fp.domain; }
        else if (fp.crNumber && e.crNumber && fp.crNumber === e.crNumber) { dup = true; dupKey = fp.crNumber; }
        else if (fp.phoneNormalized && e.phoneNormalized && fp.phoneNormalized === e.phoneNormalized) { dup = true; dupKey = fp.phoneNormalized; }
        else if (fp.emailNormalized && e.emailNormalized && fp.emailNormalized === e.emailNormalized) { dup = true; dupKey = fp.emailNormalized; }
        else if (fp.normalizedName && e.normalizedName && nameSimilarity(fp.normalizedName, e.normalizedName) >= 0.88) { dup = true; dupKey = fp.normalizedName; }

        if (dup) {
          validation.isDuplicate = true;
          validation.duplicateOf = dupKey;
          validation.reasons.push("DUPLICATE_EXISTS");
          validation.status = "warn";
          break;
        }
      }
    } catch { /* dedup failure shouldn't block insert */ }
  }

  // 4. Active verification (DNS/MX, domain liveness, dummy detection)
  let confidence: number | undefined;
  if (validation.status !== "reject") {
    try {
      const verifyInput: VerifyInput = {
        companyName: input.companyName,
        domain: input.domain,
        email: input.email,
        phone: input.phone,
        crNumber: input.crNumber,
      };
      const signals = await verifyLead(verifyInput);
      confidence = signals.confidence;
      for (const n of signals.notes) validation.reasons.push(n);
      if (signals.appearsDummy) {
        validation.status = "reject";
        validation.reasons.push("DUMMY_DETECTED");
      } else if (signals.confidence < 35 && validation.status === "pass") {
        validation.status = "warn";
        validation.reasons.push(`LOW_CONFIDENCE:${signals.confidence}`);
      }
    } catch { /* verifier failure shouldn't block */ }
  }

  return {
    status: validation.status,
    reasons: validation.reasons,
    isDuplicate: validation.isDuplicate,
    duplicateOf: validation.duplicateOf,
    confidence,
    fingerprint: fp,
  };
}

/** Persist a lead's fingerprint so subsequent gateLead() calls see it as a dup. */
export async function writeFingerprint(
  fp: GateResult["fingerprint"],
  leadId?: number,
): Promise<void> {
  try {
    await db.insert(leadFingerprintsTable).values({
      normalizedName: fp.normalizedName,
      domain: fp.domain,
      phoneNormalized: fp.phoneNormalized,
      emailNormalized: fp.emailNormalized,
      crNumber: fp.crNumber,
      sourceTable: "leads",
      sourceId: leadId || null,
    });
  } catch { /* fingerprint write failure shouldn't block the insert */ }
}

export interface InsertLeadOptions {
  companyId?: number | null;
  status?: string;
  notes?: string;
}

/** Gate + insert in one shot. Returns the gate result + (if inserted) the lead row. */
export async function insertLeadWithGate(
  input: GateInput,
  opts: InsertLeadOptions = {},
): Promise<{ gate: GateResult; lead?: typeof leadsTable.$inferSelect; inserted: boolean }> {
  const gate = await gateLead(input);

  // Hard reject → do not insert
  if (gate.status === "reject") {
    return { gate, inserted: false };
  }

  // pass or warn → insert; warn gets status="unverified" unless caller overrode
  const status = opts.status ?? (gate.status === "warn" ? "unverified" : "new");
  const [lead] = await db.insert(leadsTable).values({
    companyId: opts.companyId ?? null,
    firstName: input.firstName || null,
    lastName: input.lastName || null,
    title: input.title || null,
    email: input.email || null,
    phone: input.phone || null,
    linkedinUrl: input.linkedinUrl || null,
    department: input.department || null,
    seniority: input.seniority || null,
    notes: opts.notes ?? (gate.reasons.length ? `gate:${gate.reasons.join("|")}` : null),
    status,
  }).returning();

  await writeFingerprint(gate.fingerprint, lead?.id);

  return { gate, lead, inserted: true };
}
