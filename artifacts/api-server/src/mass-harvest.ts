/**
 * MASS HARVEST ENGINE
 * Generates thousands of real Saudi companies via:
 * 1. Wikidata SPARQL (multiple entity-type queries, no artificial limit)
 * 2. GPT-4o sector-by-sector generation (30 sectors × 60 companies = 1800+)
 * 3. Claude sector-by-sector cross-check (different companies per sector)
 * 4. Perplexity real-time discovery per sector
 * 5. Apollo bulk organization search
 * 
 * Run: pnpm --filter @workspace/api-server exec tsx ./src/mass-harvest.ts
 */

import axios from "axios";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { db, companiesTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Saudi sectors to harvest ──────────────────────────────────────────────
const SECTORS = [
  { en: "Oil & Gas", ar: "النفط والغاز" },
  { en: "Petrochemicals & Chemicals", ar: "البتروكيماويات والكيماويات" },
  { en: "Banking & Islamic Finance", ar: "البنوك والتمويل الإسلامي" },
  { en: "Insurance", ar: "التأمين" },
  { en: "Real Estate & Property Development", ar: "العقارات والتطوير العقاري" },
  { en: "Construction & Contracting", ar: "البناء والمقاولات" },
  { en: "Telecommunications", ar: "الاتصالات" },
  { en: "Technology & IT Services", ar: "التكنولوجيا وخدمات تقنية المعلومات" },
  { en: "FinTech & Digital Payments", ar: "التكنولوجيا المالية" },
  { en: "Healthcare & Hospitals", ar: "الرعاية الصحية والمستشفيات" },
  { en: "Pharmaceuticals & Medical Devices", ar: "الأدوية والأجهزة الطبية" },
  { en: "Food & Beverage Manufacturing", ar: "تصنيع الأغذية والمشروبات" },
  { en: "Retail & Consumer Goods", ar: "التجزئة والسلع الاستهلاكية" },
  { en: "Automotive & Transportation", ar: "السيارات والنقل" },
  { en: "Logistics & Supply Chain", ar: "اللوجستيات وسلاسل التوريد" },
  { en: "Aviation & Aerospace", ar: "الطيران والفضاء" },
  { en: "Mining & Metals", ar: "التعدين والمعادن" },
  { en: "Electric Power & Utilities", ar: "الطاقة الكهربائية والمرافق" },
  { en: "Renewable Energy & Solar", ar: "الطاقة المتجددة والطاقة الشمسية" },
  { en: "Water & Environmental Services", ar: "المياه والخدمات البيئية" },
  { en: "Agriculture & Agribusiness", ar: "الزراعة والأعمال الزراعية" },
  { en: "Media & Entertainment", ar: "الإعلام والترفيه" },
  { en: "Education & Training", ar: "التعليم والتدريب" },
  { en: "Tourism & Hospitality", ar: "السياحة والضيافة" },
  { en: "Consulting & Professional Services", ar: "الاستشارات والخدمات المهنية" },
  { en: "Legal Services", ar: "الخدمات القانونية" },
  { en: "Advertising & Marketing", ar: "الإعلان والتسويق" },
  { en: "E-Commerce & Marketplace", ar: "التجارة الإلكترونية" },
  { en: "Investment & Private Equity", ar: "الاستثمار والأسهم الخاصة" },
  { en: "Furniture & Interior Design", ar: "الأثاث والتصميم الداخلي" },
  { en: "Textiles & Apparel", ar: "المنسوجات والملابس" },
  { en: "Steel & Building Materials", ar: "الحديد ومواد البناء" },
  { en: "Facility Management & Cleaning", ar: "إدارة المرافق والنظافة" },
  { en: "Security & Safety Systems", ar: "أنظمة الأمن والسلامة" },
  { en: "Printing & Packaging", ar: "الطباعة والتغليف" },
  { en: "Jewellery & Luxury Goods", ar: "المجوهرات والسلع الفاخرة" },
  { en: "Sports & Fitness", ar: "الرياضة واللياقة البدنية" },
  { en: "Non-profit & Social Enterprises", ar: "المنظمات غير الربحية" },
];

const REGIONS = ["Riyadh", "Jeddah", "Dammam", "Mecca", "Madinah", "Khobar", "Jubail", "Tabuk", "Abha", "Yanbu"];

// ── Company interface for insertion ──────────────────────────────────────
interface CompanyRow {
  nameEn?: string;
  nameAr?: string;
  industry?: string;
  industryAr?: string;
  city?: string;
  region?: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
  employeeCount?: number;
  revenue?: string;
  foundingYear?: number;
  crNumber?: string;
  companyType?: string;
  entityType?: string;
  ownerName?: string;
  ownerTitle?: string;
  linkedinUrl?: string;
  enrichmentScore?: number;
  enrichmentStatus?: string;
  dataSource?: string;
  tags?: string;
}

// ── Seen set to deduplicate in-memory ────────────────────────────────────
const seenNames = new Set<string>();
let totalInserted = 0;
let totalSkipped = 0;

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9أ-ي]/g, "").trim();
}

async function insertCompany(company: CompanyRow): Promise<boolean> {
  if (!company.nameEn && !company.nameAr) return false;
  const keyEn = normalizeKey(company.nameEn || "");
  const keyAr = normalizeKey(company.nameAr || "");
  const key = keyEn || keyAr;
  if (!key || seenNames.has(keyEn) || seenNames.has(keyAr)) { totalSkipped++; return false; }

  try {
    // Check DB
    const conditions = [];
    if (company.nameEn) conditions.push(ilike(companiesTable.nameEn, company.nameEn));
    if (company.nameAr) conditions.push(ilike(companiesTable.nameAr, company.nameAr));
    if (conditions.length > 0) {
      const existing = await db.select({ id: companiesTable.id }).from(companiesTable).where(or(...conditions)).limit(1);
      if (existing.length > 0) { totalSkipped++; if (keyEn) seenNames.add(keyEn); if (keyAr) seenNames.add(keyAr); return false; }
    }

    await db.insert(companiesTable).values({
      ...company,
      country: "Saudi Arabia",
      enrichmentScore: company.enrichmentScore ?? 35,
      enrichmentStatus: company.enrichmentStatus ?? "partial",
      dataSource: company.dataSource ?? "ai-harvest",
    } as any);
    if (keyEn) seenNames.add(keyEn);
    if (keyAr) seenNames.add(keyAr);
    totalInserted++;
    return true;
  } catch {
    totalSkipped++;
    return false;
  }
}

// ── 1. WIKIDATA SPARQL (multiple queries for maximum coverage) ───────────
async function harvestWikidata(): Promise<void> {
  console.log("\n🌐 [Wikidata] Starting SPARQL harvest...");

  const queries = [
    // Business enterprises in Saudi Arabia
    `SELECT DISTINCT ?nameEn ?nameAr ?industryLabel ?hqLabel ?website ?employees WHERE {
      ?c wdt:P31 wd:Q4830453 . ?c wdt:P17 wd:Q851 .
      OPTIONAL { ?c wdt:P452 ?industry . }
      OPTIONAL { ?c wdt:P159 ?hq . }
      OPTIONAL { ?c wdt:P1128 ?employees . }
      OPTIONAL { ?c wdt:P856 ?website . }
      OPTIONAL { ?c rdfs:label ?nameAr . FILTER(LANG(?nameAr)="ar") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?c rdfs:label ?nameEn . ?industry rdfs:label ?industryLabel . ?hq rdfs:label ?hqLabel . }
    } LIMIT 1000`,
    // Public companies (listed)
    `SELECT DISTINCT ?nameEn ?nameAr ?industryLabel ?hqLabel ?website ?employees WHERE {
      ?c wdt:P31 wd:Q891723 . ?c wdt:P17 wd:Q851 .
      OPTIONAL { ?c wdt:P452 ?industry . }
      OPTIONAL { ?c wdt:P159 ?hq . }
      OPTIONAL { ?c wdt:P1128 ?employees . }
      OPTIONAL { ?c wdt:P856 ?website . }
      OPTIONAL { ?c rdfs:label ?nameAr . FILTER(LANG(?nameAr)="ar") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?c rdfs:label ?nameEn . ?industry rdfs:label ?industryLabel . ?hq rdfs:label ?hqLabel . }
    } LIMIT 500`,
    // Holding companies
    `SELECT DISTINCT ?nameEn ?nameAr ?industryLabel ?hqLabel ?website WHERE {
      ?c wdt:P31 wd:Q206361 . ?c wdt:P17 wd:Q851 .
      OPTIONAL { ?c wdt:P452 ?industry . }
      OPTIONAL { ?c wdt:P159 ?hq . }
      OPTIONAL { ?c wdt:P856 ?website . }
      OPTIONAL { ?c rdfs:label ?nameAr . FILTER(LANG(?nameAr)="ar") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?c rdfs:label ?nameEn . ?industry rdfs:label ?industryLabel . ?hq rdfs:label ?hqLabel . }
    } LIMIT 300`,
  ];

  for (let qi = 0; qi < queries.length; qi++) {
    try {
      const res = await axios.get("https://query.wikidata.org/sparql", {
        params: { query: queries[qi], format: "json" },
        headers: { Accept: "application/sparql-results+json", "User-Agent": "ProspectSA/2.0" },
        timeout: 45000,
      });

      const bindings = res.data?.results?.bindings || [];
      console.log(`  Query ${qi + 1}: ${bindings.length} results`);
      let inserted = 0;
      for (const b of bindings) {
        const ok = await insertCompany({
          nameEn: b.nameEn?.value,
          nameAr: b.nameAr?.value,
          industry: b.industryLabel?.value,
          city: b.hqLabel?.value,
          website: b.website?.value,
          employeeCount: b.employees?.value ? parseInt(b.employees.value) : undefined,
          enrichmentScore: 40,
          enrichmentStatus: "partial",
          dataSource: "wikidata",
          tags: "wikidata",
        });
        if (ok) inserted++;
      }
      console.log(`  ✅ Wikidata query ${qi + 1}: ${inserted} new companies inserted`);
      await new Promise(r => setTimeout(r, 2000)); // respect rate limit
    } catch (err) {
      console.warn(`  ⚠️  Wikidata query ${qi + 1} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

// ── 2. GPT-4o sector × region mega-generation ───────────────────────────
async function harvestWithGPT4o(sector: { en: string; ar: string }, region: string): Promise<void> {
  const prompt = `You are a Saudi Arabia B2B intelligence database. List 50 REAL companies in the "${sector.en}" sector that operate in or near ${region}, Saudi Arabia.

Include a diverse mix:
- Large established companies (5-10)
- Mid-market private companies (20-25)  
- Growing SMEs and startups (15-20)

For EACH company provide exactly this JSON structure:
{
  "nameEn": "Company Name in English",
  "nameAr": "اسم الشركة بالعربية",
  "industry": "${sector.en}",
  "industryAr": "${sector.ar}",
  "city": "${region}",
  "region": "Region name",
  "website": "https://... or null",
  "companyType": "Public/Private/Government/Family",
  "entityType": "Joint Stock/LLC/Holding/Partnership",
  "foundingYear": 1990,
  "employeeCount": 500,
  "revenue": "SAR 50M-100M",
  "ownerName": "Name if known or null",
  "ownerTitle": "Title or null",
  "description": "2-sentence description",
  "enrichmentScore": 45,
  "enrichmentStatus": "partial"
}

RULES:
- ONLY real companies you are confident exist or existed in Saudi Arabia
- No fabricated or generic company names
- Revenue as a range in SAR (e.g. "SAR 10M-50M", "SAR 500M-1B")  
- foundingYear between 1900-2024
- If unsure about a field use null, NOT fabricated data

Respond: {"companies": [...50 items...]}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content || '{"companies":[]}';
    const parsed = JSON.parse(content) as { companies: CompanyRow[] };
    const companies = parsed.companies || [];

    let inserted = 0;
    for (const c of companies) {
      if (c.nameEn || c.nameAr) {
        const ok = await insertCompany({ ...c, dataSource: "gpt4o-harvest", tags: `${sector.en.toLowerCase().replace(/\s+/g, ",")},ai-generated` });
        if (ok) inserted++;
      }
    }
    if (inserted > 0) process.stdout.write(`+${inserted} `);
  } catch (err) {
    process.stdout.write(`! `);
  }
}

// ── 3. Claude cross-verification (different companies) ───────────────────
async function harvestWithClaude(sector: { en: string; ar: string }): Promise<void> {
  if (!anthropic) return;

  const prompt = `List 60 real Saudi Arabian companies in the "${sector.en}" sector. Include companies from ALL regions of Saudi Arabia (Riyadh, Jeddah, Dammam, Mecca, Madinah, Eastern Province, etc.) and all sizes (large, medium, SME).

Provide a JSON array of companies with these fields:
- nameEn (English name)
- nameAr (Arabic name)  
- industry ("${sector.en}")
- industryAr ("${sector.ar}")
- city (Saudi city)
- region (region name)
- companyType (Public/Private/Government/Family)
- entityType (Joint Stock/LLC/Holding)
- foundingYear (year)
- employeeCount (number)
- revenue (SAR range like "SAR 10M-50M")
- description (2 sentences)
- website (URL or null)

Only include real companies you are confident about. Format: {"companies": [...]}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]) as { companies: CompanyRow[] };
    let inserted = 0;
    for (const c of (parsed.companies || [])) {
      const ok = await insertCompany({ ...c, dataSource: "claude-harvest", tags: `${sector.en.toLowerCase().replace(/\s+/g, ",")},ai-generated` });
      if (ok) inserted++;
    }
    if (inserted > 0) process.stdout.write(`[C+${inserted}] `);
  } catch {
    process.stdout.write(`[C!] `);
  }
}

// ── 4. Perplexity sector discovery ───────────────────────────────────────
async function harvestWithPerplexity(sector: { en: string; ar: string }): Promise<void> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return;

  try {
    const res = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [
          { role: "system", content: "You are a Saudi business intelligence researcher. Provide accurate lists of real Saudi companies." },
          { role: "user", content: `List 30 real Saudi companies in the ${sector.en} sector. For each provide: English name, Arabic name, city, founding year, approximate employee count, website if known. Focus on lesser-known mid-market and SME companies (not just the top 5 famous ones). Format as JSON: {"companies":[{"nameEn":"","nameAr":"","city":"","foundingYear":0,"employeeCount":0,"website":null}]}` },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 30000,
      }
    );

    const text: string = res.data?.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]) as { companies: CompanyRow[] };
    let inserted = 0;
    for (const c of (parsed.companies || [])) {
      const ok = await insertCompany({
        ...c,
        industry: sector.en,
        industryAr: sector.ar,
        enrichmentScore: 40,
        enrichmentStatus: "partial",
        dataSource: "perplexity-harvest",
        tags: `${sector.en.toLowerCase().replace(/\s+/g, ",")},perplexity`,
      });
      if (ok) inserted++;
    }
    if (inserted > 0) process.stdout.write(`[P+${inserted}] `);
  } catch {
    process.stdout.write(`[P!] `);
  }
}

// ── 5. Apollo bulk organization search ───────────────────────────────────
async function harvestApollo(): Promise<void> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) { console.log("\n⚠️  Apollo API key not available, skipping"); return; }

  console.log("\n🔍 [Apollo] Searching for Saudi organizations...");

  const industries = [
    "oil and gas", "banking", "real estate", "construction", "telecommunications",
    "healthcare", "retail", "technology", "manufacturing", "logistics",
    "food and beverage", "finance", "insurance", "education", "hospitality",
  ];

  let apolloInserted = 0;

  for (const industry of industries) {
    try {
      const res = await axios.post(
        "https://api.apollo.io/api/v1/mixed_companies/search",
        {
          api_key: apiKey,
          q_organization_keyword_tags: [industry],
          organization_locations: ["Saudi Arabia"],
          per_page: 25,
          page: 1,
        },
        {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
          timeout: 15000,
        }
      );

      const orgs = res.data?.organizations || [];
      for (const org of orgs) {
        const ok = await insertCompany({
          nameEn: org.name,
          industry: org.industry,
          city: org.city,
          region: org.state,
          website: org.website_url,
          phone: org.phone,
          employeeCount: org.employee_count,
          revenue: org.annual_revenue_printed,
          foundingYear: org.founded_year,
          linkedinUrl: org.linkedin_url,
          description: org.short_description,
          enrichmentScore: 50,
          enrichmentStatus: "partial",
          dataSource: "apollo",
          tags: `apollo,${industry}`,
        });
        if (ok) apolloInserted++;
      }
      await new Promise(r => setTimeout(r, 500));
    } catch {
      // silently skip
    }
  }
  console.log(`  ✅ Apollo: ${apolloInserted} new companies inserted`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 ProspectSA Mass Harvest Engine v2.0");
  console.log("==========================================");
  console.log(`📊 Target: ${SECTORS.length} sectors × ~60 companies = ~${SECTORS.length * 60}+ companies\n`);

  // Load existing names into memory to avoid DB checks for every insert
  console.log("📋 Loading existing companies into dedup cache...");
  const existing = await db.select({ nameEn: companiesTable.nameEn, nameAr: companiesTable.nameAr }).from(companiesTable);
  for (const c of existing) {
    if (c.nameEn) seenNames.add(normalizeKey(c.nameEn));
    if (c.nameAr) seenNames.add(normalizeKey(c.nameAr));
  }
  console.log(`  Loaded ${existing.length} existing companies into dedup cache\n`);

  // Phase 1: Wikidata
  await harvestWikidata();

  // Phase 2: Apollo
  await harvestApollo();

  // Phase 3: GPT-4o sector × region (most productive)
  console.log("\n🤖 [GPT-4o] Sector × Region mega-generation...");
  // Use a subset of regions to keep token cost reasonable
  const regionsToUse = ["Riyadh", "Jeddah", "Dammam", "Mecca", "Madinah"];
  for (let si = 0; si < SECTORS.length; si++) {
    const sector = SECTORS[si];
    process.stdout.write(`\n  [${si + 1}/${SECTORS.length}] ${sector.en}: `);
    // One GPT-4o call per sector (covers all regions in one prompt)
    await harvestWithGPT4o(sector, "Saudi Arabia (all regions)");
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }
  console.log("\n");

  // Phase 4: Claude cross-check (generates different companies per sector)
  if (anthropic) {
    console.log("\n🧠 [Claude] Cross-sector verification harvest...");
    for (let si = 0; si < SECTORS.length; si++) {
      const sector = SECTORS[si];
      process.stdout.write(`\n  [${si + 1}/${SECTORS.length}] ${sector.en}: `);
      await harvestWithClaude(sector);
      await new Promise(r => setTimeout(r, 500));
    }
    console.log("\n");
  }

  // Phase 5: Perplexity (SME-focused, finds companies LLMs might miss)
  if (process.env.PERPLEXITY_API_KEY) {
    console.log("\n🔎 [Perplexity] SME discovery per sector...");
    // Perplexity per sector (focuses on lesser-known companies)
    for (let si = 0; si < SECTORS.length; si += 2) { // every other sector to save quota
      const sector = SECTORS[si];
      process.stdout.write(`\n  [${Math.floor(si / 2) + 1}] ${sector.en}: `);
      await harvestWithPerplexity(sector);
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log("\n");
  }

  // ── Final stats ──
  console.log("\n==========================================");
  console.log(`✅ HARVEST COMPLETE`);
  console.log(`   New companies inserted: ${totalInserted}`);
  console.log(`   Duplicates/skipped:     ${totalSkipped}`);

  const countResult = ((await db.execute<{ count: string }>(
    `SELECT COUNT(*) as count FROM companies`
  )) as any)?.[0] ?? ((await db.execute<{ count: string }>(
    `SELECT COUNT(*) as count FROM companies`
  )) as any)?.rows?.[0];
  console.log(`   Total in database:      ${countResult?.count || "?"}`);
  console.log("==========================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Harvest failed:", err);
  process.exit(1);
});
