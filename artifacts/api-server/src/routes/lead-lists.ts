import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, leadListsTable, leadListItemsTable,
  companiesTable, executivesTable,
  masarCompaniesTable, builderCompaniesTable, prospectingResultsTable,
  saMarketShareholdersTable, saMarketExecutivesTable,
  prosengineResearchTable,
} from "@workspace/db";
import { eq, ilike, and, or, sql, isNull } from "drizzle-orm";
import * as XLSX from "xlsx";
import { lazyAnthropic, lazyOpenAI } from "../lib/llm-clients.js";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const router: IRouter = Router();

const openai = lazyOpenAI("Lead lists");
const anthropic = lazyAnthropic("Lead lists");

// ─── Criteria ─────────────────────────────────────────────────────────────────
interface LeadCriteria {
  name: string;
  industries: string[];
  cities: string[];
  revenueRange: "any" | "under1m" | "1m-10m" | "10m-100m" | "100m+";
  employeeMin: number;
  employeeMax: number;
  personTypes: string[];
  compensationRange: "any" | "under50k" | "50k-200k" | "200k-500k" | "500k+";
  requiredPersonFields: string[];
  requiredCompanyFields: string[];
  sources: string[];
  maxLeads: number;
  freeText?: string;
}

type LeadCandidate = {
  personName: string;
  personNameAr?: string | null;
  personTitle: string;
  personType: string;
  seniority?: string | null;
  department?: string | null;
  nationality?: string | null;
  linkedin?: string | null;
  estimatedSalary?: number | null;
  biography?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  companyName: string;
  companyNameAr?: string | null;
  industry?: string | null;
  city?: string | null;
  companyRevenue?: string | null;
  companyEmployees?: string | null;
  crNumber?: string | null;
  ownershipPct?: string | null;
  source: string;
  sourceId: string;
  matchScore: number;
};

// ─── Rule-based pre-filter score ──────────────────────────────────────────────
// sourceClass: "structured" = OrcBase (has rich contact data, hard-filter on requirements)
//              "cr"         = Masaar/Builder (CR-sourced, typically no per-person contact — penalise, don't eliminate)
function preScore(candidate: LeadCandidate, criteria: LeadCriteria, sourceClass: "structured" | "cr" = "structured"): number {
  let score = 30; // base

  const industry = (candidate.industry || "").toLowerCase();
  const city = (candidate.city || "").toLowerCase();
  const employees = parseInt(candidate.companyEmployees || "0") || 0;
  const salary = candidate.estimatedSalary || 0;

  // Industry
  if (criteria.industries.length > 0) {
    const match = criteria.industries.some(i => industry.includes(i.toLowerCase()) || i.toLowerCase().includes(industry.split(" ")[0]));
    score += match ? 20 : -5;
  } else { score += 10; }

  // City
  if (criteria.cities.length > 0) {
    const match = criteria.cities.some(c => city.includes(c.toLowerCase()) || c.toLowerCase().includes(city));
    score += match ? 15 : -3;
  } else { score += 5; }

  // Employee range
  if (criteria.employeeMin > 0 || criteria.employeeMax < 99999) {
    if (employees >= criteria.employeeMin && employees <= criteria.employeeMax) score += 10;
  } else { score += 5; }

  // Revenue (rough keyword check)
  const rev = (candidate.companyRevenue || "").toLowerCase();
  if (criteria.revenueRange !== "any" && rev) {
    const hasRev = rev.includes("m") || rev.includes("b") || rev.includes("million") || rev.includes("billion");
    if (hasRev) score += 8;
  }

  // Compensation
  if (criteria.compensationRange !== "any" && salary > 0) {
    const ok =
      (criteria.compensationRange === "under50k"  && salary < 50000) ||
      (criteria.compensationRange === "50k-200k"  && salary >= 50000  && salary < 200000) ||
      (criteria.compensationRange === "200k-500k" && salary >= 200000 && salary < 500000) ||
      (criteria.compensationRange === "500k+"     && salary >= 500000);
    score += ok ? 12 : 0;
  }

  // Required person contact fields
  if (criteria.requiredPersonFields.length > 0) {
    const hasAny = criteria.requiredPersonFields.some(field => {
      if (field === "phone")    return !!candidate.phone;
      if (field === "email")    return !!candidate.email;
      if (field === "linkedin") return !!candidate.linkedin;
      return false;
    });
    if (!hasAny) {
      // OrcBase has full contact data — hard-reject if contact required
      // Masaar/Builder are CR-sourced: contacts are at company level, not per-person — penalise only
      if (sourceClass === "structured") return 0;
      else score -= 15; // penalty but still include — person intel can enrich later
    }
  }

  // Required company fields — each selected field is independently required (AND)
  if (criteria.requiredCompanyFields.includes("revenue")   && !candidate.companyRevenue)  return 0;
  if (criteria.requiredCompanyFields.includes("employees") && !candidate.companyEmployees) return 0;
  if (criteria.requiredCompanyFields.includes("crNumber")  && !candidate.crNumber)        return 0;

  // Bonus for having contact
  if (candidate.phone)    score += 5;
  if (candidate.email)    score += 5;
  if (candidate.linkedin) score += 5;

  return Math.min(Math.max(score, 1), 100); // CR-sourced leads always get at least 1 so they pass
}

// ─── AI batch scoring — Anthropic primary, OpenAI fallback ───────────────────
function buildScoringPrompt(batch: LeadCandidate[], criteria: LeadCriteria): string {
  return `You are a B2B lead qualification expert for the Saudi Arabian market.

Criteria the user wants:
- Industries: ${criteria.industries.length > 0 ? criteria.industries.join(", ") : "Any"}
- Cities: ${criteria.cities.length > 0 ? criteria.cities.join(", ") : "Any Saudi Arabia"}
- Person types wanted: ${criteria.personTypes.join(", ")}
- Company revenue range: ${criteria.revenueRange}
- Compensation range: ${criteria.compensationRange}
- Additional notes: ${criteria.freeText || "None"}

Rate each lead from 0-100 based on how well they match the criteria.
Consider: role relevance, company fit, contact availability, industry match, seniority.

Return a JSON array with exactly ${batch.length} objects, one per lead, in order:
[{"score": 0-100, "reason": "1-sentence reason"}]

Leads:
${batch.map((c, idx) => `${idx + 1}. ${c.personName} — ${c.personTitle} at ${c.companyName} (${c.industry || "unknown industry"}, ${c.city || "no city"}) Phone:${c.phone ? "yes" : "no"} Email:${c.email ? "yes" : "no"} LinkedIn:${c.linkedin ? "yes" : "no"}`).join("\n")}`;
}

function parseScoreResponse(raw: string, batchLen: number, fallbackScores: number[]): Array<{ aiScore: number; aiReasoning: string }> {
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]") + 1;
  if (jsonStart === -1 || jsonEnd === 0) throw new Error("No JSON array found");
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd)) as Array<{ score: number; reason: string }>;
  return Array.from({ length: batchLen }, (_, j) => ({
    aiScore: Math.round(Number(parsed[j]?.score ?? fallbackScores[j] ?? 50)),
    aiReasoning: String(parsed[j]?.reason ?? ""),
  }));
}

async function aiScoreBatch(candidates: LeadCandidate[], criteria: LeadCriteria): Promise<Array<{ aiScore: number; aiReasoning: string }>> {
  const batchSize = 10;
  const results: Array<{ aiScore: number; aiReasoning: string }> = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const prompt = buildScoringPrompt(batch, criteria);
    const fallback = batch.map(c => c.matchScore);

    // Try Anthropic first
    const anthropicAvailable = !!process.env.ANTHROPIC_API_KEY;
    if (anthropicAvailable) {
      try {
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });
        const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
        results.push(...parseScoreResponse(raw, batch.length, fallback));
        continue;
      } catch (e) {
        console.warn("[LeadLists] Anthropic scoring error, trying OpenAI:", (e as Error).message);
      }
    }

    // Fallback to OpenAI
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = response.choices[0]?.message?.content || "[]";
      results.push(...parseScoreResponse(raw, batch.length, fallback));
    } catch (e) {
      console.warn("[LeadLists] OpenAI scoring error:", (e as Error).message);
      for (const c of batch) results.push({ aiScore: c.matchScore, aiReasoning: "" });
    }
  }
  return results;
}

// ─── Fetch people from all sources ───────────────────────────────────────────
async function fetchPeople(criteria: LeadCriteria): Promise<LeadCandidate[]> {
  const results: LeadCandidate[] = [];

  const wantsExec        = criteria.personTypes.includes("executive") || criteria.personTypes.length === 0;
  const wantsOwner       = criteria.personTypes.includes("owner")       || criteria.personTypes.length === 0;
  const wantsShareholder = criteria.personTypes.includes("shareholder") || criteria.personTypes.length === 0;
  const wantsBoard       = criteria.personTypes.includes("board_member") || criteria.personTypes.length === 0;
  const wantsManagement  = criteria.personTypes.includes("management")  || criteria.personTypes.length === 0;

  // Expand each wizard industry label to its underlying keywords so ILIKE matches DB values
  const INDUSTRY_KEYWORDS: Record<string, string[]> = {
    "Technology":              ["Technology", "IT Solutions", "information technology", "Software", "Tech", "Digital"],
    "Banking & Finance":       ["Bank", "Finance", "Financial"],
    "Construction":            ["Construction"],
    "Healthcare":              ["Healthcare", "Health", "Medical", "Pharmaceutical"],
    "Energy & Oil":            ["Energy", "Oil", "Gas", "Petroleum", "Petrochemical"],
    "Logistics & Transport":   ["Logistics", "Transport", "Shipping", "Freight", "Airline"],
    "Retail":                  ["Retail", "E-commerce", "Ecommerce"],
    "Manufacturing":           ["Manufacturing", "Industrial", "Capital Goods"],
    "Food & Beverage":         ["Food", "Beverage", "Tobacco", "Bakery"],
    "Media & Marketing":       ["Media", "Marketing", "Advertising"],
    "Telecom":                 ["Telecom", "Telecommunications", "Communication"],
    "Real Estate":             ["Real Estate"],
    "Insurance":               ["Insurance"],
    "Consulting":              ["Consulting", "Advisory"],
    "Education":               ["Education"],
    "Agriculture":             ["Agriculture"],
    "Mining & Materials":      ["Mining", "Materials", "Chemicals"],
    "Government":              ["Government", "Public Sector", "government administration"],
  };
  const industryFilter = (col: Parameters<typeof ilike>[0]) => {
    if (criteria.industries.length === 0) return undefined;
    const keywords = criteria.industries.flatMap(i => INDUSTRY_KEYWORDS[i] ?? [i]);
    // Also include rows where industry is NULL/blank so we don't lose untagged leads
    return or(...keywords.map(k => ilike(col, `%${k}%`)), isNull(col), ilike(col, ""));
  };

  // City filter: include matching cities PLUS records with no city data (NULL or blank)
  // so we never lose leads just because their city wasn't recorded
  const cityFilter = (col: Parameters<typeof ilike>[0]) =>
    criteria.cities.length > 0
      ? or(...criteria.cities.map(c => ilike(col, `%${c}%`)), isNull(col), ilike(col, ""))
      : undefined;

  // ── OrcBase Executives (single JOIN query — no N+1) ───────────────────────
  if (criteria.sources.includes("orcbase") && wantsExec) {
    try {
      const conditions: (ReturnType<typeof ilike> | ReturnType<typeof or> | undefined)[] = [];
      const indFilter = industryFilter(companiesTable.industry);
      if (indFilter) conditions.push(indFilter);
      const ctFilter = cityFilter(companiesTable.city);
      if (ctFilter) conditions.push(ctFilter);

      const rows = await db.select({
        execId:          executivesTable.id,
        execName:        executivesTable.name,
        execNameAr:      executivesTable.nameAr,
        execPosition:    executivesTable.position,
        execSeniority:   executivesTable.seniorityLevel,
        execDepartment:  executivesTable.department,
        execLinkedin:    executivesTable.linkedinUrl,
        execLinkedin2:   executivesTable.linkedin,
        execSalary:      executivesTable.estimatedSalary,
        execBio:         executivesTable.biography,
        execPhone:       executivesTable.phone,
        execEmail:       executivesTable.email,
        execLocation:    executivesTable.location,
        compNameEn:      companiesTable.nameEn,
        compNameAr:      companiesTable.nameAr,
        compIndustry:    companiesTable.industry,
        compCity:        companiesTable.city,
        compRevenue:     companiesTable.revenue,
        compEmployees:   companiesTable.employeeCount,
        compCr:          companiesTable.crNumber,
        compPhone:       companiesTable.phone,
        compEmail:       companiesTable.email,
        compWebsite:     companiesTable.website,
      }).from(executivesTable)
        .innerJoin(companiesTable, eq(executivesTable.companyId, companiesTable.id))
        .where(conditions.length > 0 ? and(...conditions.filter(Boolean) as Parameters<typeof and>) : undefined)
        .limit(5000);

      for (const row of rows) {
        if (!row.execName) continue;
        const candidate: LeadCandidate = {
          personName: row.execName,
          personNameAr: row.execNameAr,
          personTitle: row.execPosition || "Executive",
          personType: "executive",
          seniority: row.execSeniority,
          department: row.execDepartment,
          linkedin: row.execLinkedin || row.execLinkedin2,
          estimatedSalary: row.execSalary,
          biography: row.execBio,
          phone: row.execPhone || row.compPhone,
          email: row.execEmail || row.compEmail,
          website: row.compWebsite,
          companyName: row.compNameEn || row.compNameAr || "",
          companyNameAr: row.compNameAr,
          industry: row.compIndustry,
          city: row.compCity || row.execLocation,
          companyRevenue: row.compRevenue,
          companyEmployees: row.compEmployees ? String(row.compEmployees) : null,
          crNumber: row.compCr,
          source: "orcbase",
          sourceId: `exec_${row.execId}`,
          matchScore: 0,
        };
        candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
        if (candidate.matchScore > 0) results.push(candidate);
      }
    } catch (e) { console.warn("[LeadLists] OrcBase exec error:", e); }
  }

  // ── Masaar Shareholders / Board / Management ──────────────────────────────
  if (criteria.sources.includes("masaar")) {
    try {
      const masaarConditions: any[] = [];
      const ctFilter = cityFilter(masarCompaniesTable.city);
      if (ctFilter) masaarConditions.push(ctFilter);
      const indFilter = industryFilter(masarCompaniesTable.mainActivity);
      if (indFilter) masaarConditions.push(indFilter);

      const companies = await db.select().from(masarCompaniesTable)
        .where(masaarConditions.length > 0 ? and(...(masaarConditions as any)) : undefined)
        .limit(3000);

      for (const company of companies) {
        // Shareholders
        if (wantsShareholder && Array.isArray(company.shareholders)) {
          for (const sh of company.shareholders as Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>) {
            if (!sh.nameEn && !sh.nameAr) continue;
            const candidate: LeadCandidate = {
              personName: sh.nameEn || sh.nameAr,
              personNameAr: sh.nameAr,
              personTitle: `Shareholder (${sh.ownershipPct || "?"}%)`,
              personType: "shareholder",
              nationality: sh.nationality,
              ownershipPct: sh.ownershipPct,
              phone: company.phone,
              email: company.email,
              website: company.website,
              companyName: company.nameEn || company.nameAr || "",
              companyNameAr: company.nameAr,
              industry: company.mainActivity,
              city: company.city,
              companyRevenue: company.revenueEstimate,
              crNumber: company.crNumber,
              source: "masaar",
              sourceId: `sh_${company.id}_${sh.nationalId || sh.nameEn}`,
              matchScore: 0,
            };
            candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
            if (candidate.matchScore > 0) results.push(candidate);
          }
        }

        // Board of directors
        if (wantsBoard && Array.isArray(company.boardOfDirectors)) {
          for (const bd of company.boardOfDirectors as Array<{ nameEn: string; nameAr: string; role: string; nationalId?: string }>) {
            if (!bd.nameEn && !bd.nameAr) continue;
            const candidate: LeadCandidate = {
              personName: bd.nameEn || bd.nameAr,
              personNameAr: bd.nameAr,
              personTitle: bd.role || "Board Member",
              personType: "board_member",
              phone: company.phone,
              email: company.email,
              website: company.website,
              companyName: company.nameEn || company.nameAr || "",
              companyNameAr: company.nameAr,
              industry: company.mainActivity,
              city: company.city,
              companyRevenue: company.revenueEstimate,
              crNumber: company.crNumber,
              source: "masaar",
              sourceId: `bd_${company.id}_${bd.nationalId || bd.nameEn}`,
              matchScore: 0,
            };
            candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
            if (candidate.matchScore > 0) results.push(candidate);
          }
        }

        // Management
        if (wantsManagement && Array.isArray(company.management)) {
          for (const mgmt of company.management as Array<{ nameEn: string; nameAr: string; title: string; nationalId?: string }>) {
            if (!mgmt.nameEn && !mgmt.nameAr) continue;
            const candidate: LeadCandidate = {
              personName: mgmt.nameEn || mgmt.nameAr,
              personNameAr: mgmt.nameAr,
              personTitle: mgmt.title || "Manager",
              personType: "management",
              phone: company.phone,
              email: company.email,
              website: company.website,
              companyName: company.nameEn || company.nameAr || "",
              companyNameAr: company.nameAr,
              industry: company.mainActivity,
              city: company.city,
              companyRevenue: company.revenueEstimate,
              crNumber: company.crNumber,
              source: "masaar",
              sourceId: `mgmt_${company.id}_${mgmt.nationalId || mgmt.nameEn}`,
              matchScore: 0,
            };
            candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
            if (candidate.matchScore > 0) results.push(candidate);
          }
        }

        // Authorized signatory (single person text field in CR data)
        if ((wantsExec || wantsManagement) && company.authorizedSignatory?.trim()) {
          const sigName = company.authorizedSignatory.trim();
          if (sigName.length > 2) {
            const candidate: LeadCandidate = {
              personName: sigName,
              personTitle: "Authorized Signatory",
              personType: "executive",
              phone: company.phone,
              email: company.email,
              website: company.website,
              companyName: company.nameEn || company.nameAr || "",
              companyNameAr: company.nameAr,
              industry: company.mainActivity,
              city: company.city,
              companyRevenue: company.revenueEstimate,
              crNumber: company.crNumber,
              source: "masaar",
              sourceId: `sig_${company.id}`,
              matchScore: 0,
            };
            candidate.matchScore = preScore(candidate, criteria, "cr");
            if (candidate.matchScore > 0) results.push(candidate);
          }
        }
      }
    } catch (e) { console.warn("[LeadLists] Masaar people error:", e); }
  }

  // ── Builder company owners + key executives ───────────────────────────────
  if (criteria.sources.includes("builder")) {
    try {
      const builderConditions: any[] = [];
      const indFilter = industryFilter(builderCompaniesTable.industry);
      if (indFilter) builderConditions.push(indFilter);
      const ctFilter = cityFilter(builderCompaniesTable.city);
      if (ctFilter) builderConditions.push(ctFilter);

      const companies = await db.select().from(builderCompaniesTable)
        .where(builderConditions.length > 0 ? and(...(builderConditions as any)) : undefined)
        .limit(3000);

      for (const company of companies) {
        // Owner
        if (wantsOwner && company.ownerName) {
          const candidate: LeadCandidate = {
            personName: company.ownerName,
            personNameAr: company.ownerNameAr,
            personTitle: company.ownerTitle || "Owner",
            personType: "owner",
            linkedin: company.ownerLinkedin,
            phone: company.ownerPhone || company.phone,
            email: company.ownerEmail || company.email,
            website: company.website,
            companyName: company.nameEn || company.nameAr || "",
            companyNameAr: company.nameAr,
            industry: company.industry,
            city: company.city,
            companyRevenue: company.revenue,
            companyEmployees: company.employeeCount ? String(company.employeeCount) : null,
            crNumber: company.crNumber,
            source: "builder",
            sourceId: `owner_${company.id}`,
            matchScore: 0,
          };
          candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
          if (candidate.matchScore > 0) results.push(candidate);
        }

        // Key executives from JSON
        if (wantsExec && company.keyExecutives) {
          try {
            const execs = JSON.parse(company.keyExecutives) as Array<{ name: string; title?: string; email?: string; phone?: string; linkedin?: string }>;
            for (const exec of (Array.isArray(execs) ? execs : [])) {
              if (!exec.name) continue;
              const candidate: LeadCandidate = {
                personName: exec.name,
                personTitle: exec.title || "Executive",
                personType: "executive",
                linkedin: exec.linkedin,
                phone: exec.phone || company.phone,
                email: exec.email || company.email,
                website: company.website,
                companyName: company.nameEn || company.nameAr || "",
                companyNameAr: company.nameAr,
                industry: company.industry,
                city: company.city,
                companyRevenue: company.revenue,
                companyEmployees: company.employeeCount ? String(company.employeeCount) : null,
                crNumber: company.crNumber,
                source: "builder",
                sourceId: `exec_${company.id}_${exec.name}`,
                matchScore: 0,
              };
              candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
              if (candidate.matchScore > 0) results.push(candidate);
            }
          } catch {}
        }

        // Shareholders from JSON (if present)
        if (wantsShareholder && (company as Record<string, unknown>).shareholders) {
          try {
            const shareholders = JSON.parse(String((company as Record<string, unknown>).shareholders)) as Array<{ name?: string; nameAr?: string; percentage?: number; type?: string }>;
            for (const sh of (Array.isArray(shareholders) ? shareholders : [])) {
              if (!sh.name) continue;
              const candidate: LeadCandidate = {
                personName: sh.name,
                personNameAr: sh.nameAr,
                personTitle: `Shareholder${sh.percentage != null ? ` (${sh.percentage}%)` : ""}`,
                personType: "shareholder",
                ownershipPct: sh.percentage != null ? String(sh.percentage) : null,
                phone: company.phone,
                email: company.email,
                website: company.website,
                companyName: company.nameEn || company.nameAr || "",
                companyNameAr: company.nameAr,
                industry: company.industry,
                city: company.city,
                companyRevenue: company.revenue,
                companyEmployees: company.employeeCount ? String(company.employeeCount) : null,
                crNumber: company.crNumber,
                source: "builder",
                sourceId: `sh_${company.id}_${sh.name}`,
                matchScore: 0,
              };
              candidate.matchScore = preScore(candidate, criteria, "cr");
              if (candidate.matchScore > 0) results.push(candidate);
            }
          } catch {}
        }
      }
    } catch (e) { console.warn("[LeadLists] Builder people error:", e); }
  }

  // ── SA Market Shareholders ────────────────────────────────────────────────
  if (criteria.sources.includes("sa_market") && wantsShareholder) {
    try {
      const shConditions: any[] = [];
      const indFilter = industryFilter(saMarketShareholdersTable.sector);
      if (indFilter) shConditions.push(indFilter);
      const ctFilter = cityFilter(saMarketShareholdersTable.city);
      if (ctFilter) shConditions.push(ctFilter);

      const shRows = await db.select().from(saMarketShareholdersTable)
        .where(shConditions.length > 0 ? and(...(shConditions as any)) : undefined)
        .orderBy(sql`${saMarketShareholdersTable.ownershipPercent} DESC NULLS LAST`)
        .limit(3000);

      for (const sh of shRows) {
        if (!sh.shareholderName) continue;
        const candidate: LeadCandidate = {
          personName: sh.shareholderName!,
          personNameAr: sh.shareholderNameAr,
          personTitle: `Shareholder${sh.ownershipPercent ? ` (${sh.ownershipPercent.toFixed(2)}%)` : ""}`,
          personType: "shareholder",
          ownershipPct: sh.ownershipPercent ? String(sh.ownershipPercent) : null,
          companyName: sh.companyName || "",
          companyNameAr: sh.companyNameAr,
          industry: sh.sector,
          city: sh.city,
          source: "sa_market",
          sourceId: `sh_${sh.id}`,
          matchScore: 0,
        };
        candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
        if (candidate.matchScore > 0) results.push(candidate);
      }
    } catch (e) { console.warn("[LeadLists] SA Market shareholders error:", e); }
  }

  // ── SA Market Executives ──────────────────────────────────────────────────
  if (criteria.sources.includes("sa_market") && (wantsExec || wantsBoard || wantsManagement)) {
    try {
      const exConditions: any[] = [];
      const indFilter = industryFilter(saMarketExecutivesTable.sector);
      if (indFilter) exConditions.push(indFilter);
      const ctFilter = cityFilter(saMarketExecutivesTable.city);
      if (ctFilter) exConditions.push(ctFilter);

      const exRows = await db.select().from(saMarketExecutivesTable)
        .where(exConditions.length > 0 ? and(...(exConditions as any)) : undefined)
        .orderBy(saMarketExecutivesTable.companyName, saMarketExecutivesTable.position)
        .limit(5000);

      for (const ex of exRows) {
        if (!ex.executiveName) continue;
        const pos = (ex.position || "").toLowerCase();
        const isBoard = pos.includes("board") || pos.includes("chairman") || pos.includes("director");
        const isMgmt = pos.includes("ceo") || pos.includes("managing") || pos.includes("manager");

        if (!wantsExec && !wantsBoard && !wantsManagement) continue;
        if (isBoard && !wantsBoard && !wantsExec) continue;
        if (isMgmt && !wantsManagement && !wantsExec) continue;

        const personType = isBoard ? "board_member" : isMgmt ? "management" : "executive";

        const candidate: LeadCandidate = {
          personName: ex.executiveName!,
          personTitle: ex.position || "Executive",
          personType,
          companyName: ex.companyName || "",
          companyNameAr: ex.companyNameAr,
          industry: ex.sector,
          city: ex.city,
          source: "sa_market",
          sourceId: `ex_${ex.id}`,
          matchScore: 0,
        };
        candidate.matchScore = preScore(candidate, criteria, candidate.source === "orcbase" ? "structured" : "cr");
        if (candidate.matchScore > 0) results.push(candidate);
      }
    } catch (e) { console.warn("[LeadLists] SA Market executives error:", e); }
  }

  // ── ProsEngine Research (saved watchlist leads) ───────────────────────────
  if (criteria.sources.includes("prosengine")) {
    try {
      const rows = await db.select().from(prosengineResearchTable)
        .orderBy(sql`${prosengineResearchTable.createdAt} DESC`)
        .limit(2000);

      for (const row of rows) {
        if (!row.personName) continue;
        // Try to extract linkedin from the saved report JSON
        let linkedin: string | null = null;
        let biography: string | null = null;
        try {
          const rpt = JSON.parse(row.report || "{}") as Record<string, unknown>;
          const prof = (rpt.profile || {}) as Record<string, unknown>;
          if (prof.linkedin && typeof prof.linkedin === "string" && prof.linkedin !== "Not found") linkedin = prof.linkedin;
          biography = rpt.executive_summary as string ?? null;
        } catch { /* non-fatal */ }

        const candidate: LeadCandidate = {
          personName: row.personName,
          personTitle: row.title ?? "Research Subject",
          personType: "executive",
          linkedin: row.linkedinUrl ?? linkedin,
          biography,
          companyName: row.company ?? "",
          source: "prosengine",
          sourceId: `pe_${row.id}`,
          matchScore: 0,
        };
        // ProsEngine leads are explicitly chosen — give them a higher base score
        candidate.matchScore = Math.max(preScore(candidate, criteria, "cr"), 40);
        results.push(candidate);
      }
    } catch (e) { console.warn("[LeadLists] ProsEngine source error:", e); }
  }

  // Deduplicate by person name + company
  const seen = new Set<string>();
  const deduped: LeadCandidate[] = [];
  for (const r of results.sort((a, b) => b.matchScore - a.matchScore)) {
    const key = `${r.personName.toLowerCase().trim()}|${r.companyName.toLowerCase().trim()}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(r); }
    if (deduped.length >= criteria.maxLeads * 2) break;
  }
  return deduped;
}

// ─── POST /api/lead-lists ──────────────────────────────────────────────────
router.post("/lead-lists", async (req: Request, res: Response): Promise<void> => {
  const criteria = req.body as LeadCriteria;
  if (!criteria.name) { res.status(400).json({ error: "name is required" }); return; }

  const [list] = await db.insert(leadListsTable).values({
    name: criteria.name,
    criteria: JSON.stringify(criteria),
    status: "running",
    totalFound: 0,
    sourcesSearched: JSON.stringify(criteria.sources || ["orcbase", "masaar", "builder"]),
  }).returning();

  res.json({ id: list.id, status: "running", name: list.name });

  setImmediate(async () => {
    try {
      const candidates = await fetchPeople(criteria);
      const top = candidates.slice(0, criteria.maxLeads);

      // AI scoring
      let aiScores: Array<{ aiScore: number; aiReasoning: string }> = [];
      if (top.length > 0) {
        try {
          aiScores = await aiScoreBatch(top, criteria);
        } catch (e) {
          console.warn("[LeadLists] AI scoring failed:", e);
          aiScores = top.map(c => ({ aiScore: c.matchScore, aiReasoning: "" }));
        }
      }

      // Merge AI scores and sort
      const finalItems = top.map((c, i) => ({
        ...c,
        aiScore: aiScores[i]?.aiScore ?? c.matchScore,
        aiReasoning: aiScores[i]?.aiReasoning ?? "",
      })).sort((a, b) => (b.aiScore ?? b.matchScore) - (a.aiScore ?? a.matchScore));

      if (finalItems.length > 0) {
        await db.insert(leadListItemsTable).values(
          finalItems.map(item => ({
            listId: list.id,
            personName: item.personName,
            personNameAr: item.personNameAr,
            personTitle: item.personTitle,
            personType: item.personType,
            seniority: item.seniority,
            department: item.department,
            nationality: item.nationality,
            linkedin: item.linkedin,
            estimatedSalary: item.estimatedSalary,
            biography: item.biography,
            phone: item.phone,
            email: item.email,
            website: item.website,
            companyName: item.companyName,
            companyNameAr: item.companyNameAr,
            industry: item.industry,
            city: item.city,
            companyRevenue: item.companyRevenue,
            companyEmployees: item.companyEmployees,
            crNumber: item.crNumber,
            ownershipPct: item.ownershipPct,
            source: item.source,
            sourceId: item.sourceId,
            matchScore: item.matchScore,
            aiScore: item.aiScore,
            aiReasoning: item.aiReasoning,
          }))
        );
      }

      await db.update(leadListsTable)
        .set({ status: "done", totalFound: finalItems.length, updatedAt: new Date() })
        .where(eq(leadListsTable.id, list.id));
    } catch (err) {
      console.error("[LeadLists] hunt error:", err);
      await db.update(leadListsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(leadListsTable.id, list.id));
    }
  });
});

// ─── POST /api/lead-lists/:id/retry ─────────────────────────────────────────
router.post("/lead-lists/:id/retry", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [list] = await db.select().from(leadListsTable).where(eq(leadListsTable.id, id));
  if (!list) { res.status(404).json({ error: "List not found" }); return; }
  if (list.status === "running") { res.status(409).json({ error: "Hunt is already running" }); return; }

  const criteria = JSON.parse(list.criteria || "{}") as LeadCriteria;

  // Clear old items and reset status
  await db.delete(leadListItemsTable).where(eq(leadListItemsTable.listId, id));
  await db.update(leadListsTable)
    .set({ status: "running", totalFound: 0, updatedAt: new Date() })
    .where(eq(leadListsTable.id, id));

  res.json({ id, status: "running", name: list.name });

  setImmediate(async () => {
    try {
      const candidates = await fetchPeople(criteria);
      const top = candidates.slice(0, criteria.maxLeads);

      let aiScores: Array<{ aiScore: number; aiReasoning: string }> = [];
      if (top.length > 0) {
        try { aiScores = await aiScoreBatch(top, criteria); }
        catch (e) { aiScores = top.map(c => ({ aiScore: c.matchScore, aiReasoning: "" })); }
      }

      const finalItems = top.map((c, i) => ({
        ...c,
        aiScore: aiScores[i]?.aiScore ?? c.matchScore,
        aiReasoning: aiScores[i]?.aiReasoning ?? "",
      })).sort((a, b) => (b.aiScore ?? b.matchScore) - (a.aiScore ?? a.matchScore));

      if (finalItems.length > 0) {
        await db.insert(leadListItemsTable).values(
          finalItems.map(item => ({
            listId: id,
            personName: item.personName, personNameAr: item.personNameAr,
            personTitle: item.personTitle, personType: item.personType,
            seniority: item.seniority, department: item.department,
            nationality: item.nationality, linkedin: item.linkedin,
            estimatedSalary: item.estimatedSalary, biography: item.biography,
            phone: item.phone, email: item.email, website: item.website,
            companyName: item.companyName, companyNameAr: item.companyNameAr,
            industry: item.industry, city: item.city,
            companyRevenue: item.companyRevenue, companyEmployees: item.companyEmployees,
            crNumber: item.crNumber, ownershipPct: item.ownershipPct,
            source: item.source, sourceId: item.sourceId,
            matchScore: item.matchScore, aiScore: item.aiScore, aiReasoning: item.aiReasoning,
          }))
        );
      }

      await db.update(leadListsTable)
        .set({ status: "done", totalFound: finalItems.length, updatedAt: new Date() })
        .where(eq(leadListsTable.id, id));
    } catch (err) {
      console.error("[LeadLists] retry error:", err);
      await db.update(leadListsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(leadListsTable.id, id));
    }
  });
});

// ─── GET /api/lead-lists ────────────────────────────────────────────────────
router.get("/lead-lists", async (_req: Request, res: Response): Promise<void> => {
  const lists = await db.select().from(leadListsTable).orderBy(sql`${leadListsTable.createdAt} DESC`);
  res.json(lists);
});

// ─── GET /api/lead-lists/stats/all ────────────────────────────────────────
router.get("/lead-lists/stats/all", async (_req: Request, res: Response): Promise<void> => {
  const [orcCount, masaarCount, builderCount, prosCount, listCount, execCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select({ count: sql<number>`count(*)` }).from(masarCompaniesTable),
    db.select({ count: sql<number>`count(*)` }).from(builderCompaniesTable),
    db.select({ count: sql<number>`count(*)` }).from(prospectingResultsTable),
    db.select({ count: sql<number>`count(*)` }).from(leadListsTable),
    db.select({ count: sql<number>`count(*)` }).from(executivesTable),
  ]);
  res.json({
    orcbase: Number(orcCount[0]?.count || 0),
    masaar: Number(masaarCount[0]?.count || 0),
    builder: Number(builderCount[0]?.count || 0),
    prosengine: Number(prosCount[0]?.count || 0),
    leadLists: Number(listCount[0]?.count || 0),
    executives: Number(execCount[0]?.count || 0),
  });
});

// ─── GET /api/lead-lists/:id ──────────────────────────────────────────────
router.get("/lead-lists/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  const [list] = await db.select().from(leadListsTable).where(eq(leadListsTable.id, id));
  if (!list) { res.status(404).json({ error: "Not found" }); return; }
  res.json(list);
});

// ─── GET /api/lead-lists/:id/items ───────────────────────────────────────
router.get("/lead-lists/:id/items", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  const items = await db.select().from(leadListItemsTable)
    .where(eq(leadListItemsTable.listId, id))
    .orderBy(sql`COALESCE(${leadListItemsTable.aiScore}, ${leadListItemsTable.matchScore}) DESC`);
  res.json(items);
});

// ─── DELETE /api/lead-lists/:id/items/:itemId ────────────────────────────────
router.delete("/lead-lists/:id/items/:itemId", async (req: Request, res: Response): Promise<void> => {
  const itemId = parseInt(p(req.params.itemId));
  if (isNaN(itemId)) { res.status(400).json({ error: "Invalid item id" }); return; }
  await db.delete(leadListItemsTable).where(eq(leadListItemsTable.id, itemId));
  res.json({ success: true });
});

// ─── DELETE /api/lead-lists/:id ───────────────────────────────────────────
router.delete("/lead-lists/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  await db.delete(leadListItemsTable).where(eq(leadListItemsTable.listId, id));
  await db.delete(leadListsTable).where(eq(leadListsTable.id, id));
  res.json({ success: true });
});

// ─── GET /api/lead-lists/:id/export ──────────────────────────────────────
router.get("/lead-lists/:id/export", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(p(req.params.id));
  const format = String(req.query.format || "csv");
  const [list] = await db.select().from(leadListsTable).where(eq(leadListsTable.id, id));
  if (!list) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db.select().from(leadListItemsTable)
    .where(eq(leadListItemsTable.listId, id))
    .orderBy(sql`COALESCE(${leadListItemsTable.aiScore}, ${leadListItemsTable.matchScore}) DESC`);

  const rows = items.map(item => ({
    "Full Name": item.personName || "",
    "Arabic Name": item.personNameAr || "",
    "Title / Role": item.personTitle || "",
    "Person Type": item.personType || "",
    "Seniority": item.seniority || "",
    "Department": item.department || "",
    "Nationality": item.nationality || "",
    "Phone": item.phone || "",
    "Email": item.email || "",
    "LinkedIn": item.linkedin || "",
    "Estimated Salary (USD)": item.estimatedSalary || "",
    "Ownership %": item.ownershipPct || "",
    "Company": item.companyName || "",
    "Company (Arabic)": item.companyNameAr || "",
    "Industry": item.industry || "",
    "City": item.city || "",
    "Company Revenue": item.companyRevenue || "",
    "Company Employees": item.companyEmployees || "",
    "CR Number": item.crNumber || "",
    "Website": item.website || "",
    "Source": item.source || "",
    "Match Score": item.matchScore ?? 0,
    "AI Score": item.aiScore ?? "",
    "AI Reasoning": item.aiReasoning || "",
  }));

  const safeName = list.name.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);

  if (format === "excel") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=leads_${safeName}_${date}.xlsx`);
    res.send(Buffer.from(buf));
    return;
  }

  if (format === "json") {
    res.setHeader("Content-Disposition", `attachment; filename=leads_${safeName}_${date}.json`);
    res.json(rows);
    return;
  }

  const keys = Object.keys(rows[0] || {});
  const csv = [
    keys.join(","),
    ...rows.map(r => keys.map(k => `"${String((r as Record<string, unknown>)[k] || "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=leads_${safeName}_${date}.csv`);
  res.send(csv);
});

export default router;
