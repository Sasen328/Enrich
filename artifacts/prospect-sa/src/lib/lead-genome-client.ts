// Lead Genome + Harvest AI client — wraps the new backend endpoints (PR #72).
// Use these instead of raw fetch calls so every caller is consistent.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type LeadSource =
  | "lead-factory" | "prosengine" | "ai-chat" | "manual"
  | "executives" | "masaar" | "builder" | "meshbase";

export interface SaveLeadInput {
  firstName?: string;
  lastName?: string;
  firstNameAr?: string;
  lastNameAr?: string;
  title?: string;
  titleAr?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  department?: string;
  seniority?: string;
  companyId?: number;
  source?: LeadSource;
  notes?: string;
}

export async function saveToLeadGenome(input: SaveLeadInput) {
  const r = await fetch(`${BASE}/api/lead-genome/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
  return r.json();
}

export interface HuntLeadsInput {
  q?: string;
  title?: string;
  department?: string;
  seniority?: string;
  source?: LeadSource;
  limit?: number;
}

export async function huntLeadGenome(input: HuntLeadsInput = {}) {
  const r = await fetch(`${BASE}/api/lead-genome/hunt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 50, ...input }),
  });
  if (!r.ok) throw new Error(`hunt failed: ${r.status}`);
  return r.json() as Promise<{ leads: any[]; count: number }>;
}

export async function leadGenomeStats() {
  const r = await fetch(`${BASE}/api/lead-genome/stats`);
  if (!r.ok) throw new Error(`stats failed: ${r.status}`);
  return r.json() as Promise<{ total: number; bySource: Record<string, number> }>;
}

export async function harvestAiStats() {
  const r = await fetch(`${BASE}/api/harvest-ai/stats`);
  if (!r.ok) throw new Error(`harvest stats failed: ${r.status}`);
  return r.json() as Promise<{
    masaarCompanies: number; builderCompanies: number;
    masaarJobs: number; combined: number;
  }>;
}

export async function personSuggest(q: string) {
  if (q.trim().length < 2) return { suggestions: [] };
  const r = await fetch(`${BASE}/api/lead-factory/person-suggest?q=${encodeURIComponent(q)}`);
  if (!r.ok) return { suggestions: [] };
  return r.json() as Promise<{ suggestions: any[] }>;
}

export async function companySuggest(q: string) {
  if (q.trim().length < 2) return { suggestions: [] };
  const r = await fetch(`${BASE}/api/lead-factory/company-suggest?q=${encodeURIComponent(q)}`);
  if (!r.ok) return { suggestions: [] };
  return r.json() as Promise<{ suggestions: any[] }>;
}
