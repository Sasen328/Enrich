/**
 * FAST PARALLEL HARVEST — runs 6 sectors at once across GPT-4o + Claude
 * Run: pnpm --filter @workspace/api-server exec tsx ./src/mass-harvest-fast.ts
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { db, companiesTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

interface CompanyRow {
  nameEn?: string | null;
  nameAr?: string | null;
  industry?: string | null;
  industryAr?: string | null;
  city?: string | null;
  region?: string | null;
  website?: string | null;
  companyType?: string | null;
  entityType?: string | null;
  foundingYear?: number | null;
  employeeCount?: number | null;
  revenue?: string | null;
  ownerName?: string | null;
  ownerTitle?: string | null;
  description?: string | null;
  enrichmentScore?: number | null;
  enrichmentStatus?: string | null;
  dataSource?: string | null;
  tags?: string | null;
}

const seenNames = new Set<string>();
let totalInserted = 0;
let totalSkipped = 0;

function key(s: string): string {
  return s.toLowerCase().replace(/[\s\-_''""،,.]/g, "").trim();
}

async function upsert(company: CompanyRow): Promise<boolean> {
  const kEn = key(company.nameEn || "");
  const kAr = key(company.nameAr || "");
  if (!kEn && !kAr) return false;
  if ((kEn && seenNames.has(kEn)) || (kAr && seenNames.has(kAr))) { totalSkipped++; return false; }

  try {
    const conds = [];
    if (company.nameEn?.trim()) conds.push(ilike(companiesTable.nameEn, company.nameEn.trim()));
    if (company.nameAr?.trim()) conds.push(ilike(companiesTable.nameAr, company.nameAr.trim()));
    if (conds.length) {
      const ex = await db.select({ id: companiesTable.id }).from(companiesTable).where(or(...conds)).limit(1);
      if (ex.length) { if (kEn) seenNames.add(kEn); if (kAr) seenNames.add(kAr); totalSkipped++; return false; }
    }

    await db.insert(companiesTable).values({
      nameEn: company.nameEn || null,
      nameAr: company.nameAr || null,
      industry: company.industry || null,
      industryAr: company.industryAr || null,
      city: company.city || null,
      region: company.region || null,
      website: company.website || null,
      companyType: company.companyType || null,
      entityType: company.entityType || null,
      foundingYear: typeof company.foundingYear === "number" ? company.foundingYear : null,
      employeeCount: typeof company.employeeCount === "number" ? company.employeeCount : null,
      revenue: company.revenue || null,
      ownerName: company.ownerName || null,
      ownerTitle: company.ownerTitle || null,
      description: company.description || null,
      country: "Saudi Arabia",
      enrichmentScore: company.enrichmentScore ?? 38,
      enrichmentStatus: company.enrichmentStatus ?? "partial",
      dataSource: company.dataSource ?? "ai-harvest",
      tags: company.tags ?? "",
    });

    if (kEn) seenNames.add(kEn);
    if (kAr) seenNames.add(kAr);
    totalInserted++;
    return true;
  } catch {
    totalSkipped++;
    return false;
  }
}

async function parseAndInsert(text: string, source: string, fallbackIndustry?: string): Promise<number> {
  let inserted = 0;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return 0;
    const parsed = JSON.parse(match[0]) as { companies?: CompanyRow[] };
    for (const c of (parsed.companies || [])) {
      const row: CompanyRow = {
        ...c,
        industry: c.industry || fallbackIndustry || null,
        dataSource: source,
      };
      if (await upsert(row)) inserted++;
    }
  } catch { /* ignore */ }
  return inserted;
}

// ── GPT-4o batch for a sector ────────────────────────────────────────────
async function gptSector(sectorEn: string, sectorAr: string): Promise<number> {
  const prompt = `List 60 REAL Saudi Arabian companies in the "${sectorEn}" sector.
Mix: large enterprises (10), mid-market private (30), SMEs/startups (20).
Include companies from across Saudi Arabia (Riyadh, Jeddah, Dammam, Mecca, Madinah, Khobar, Jubail, Yanbu, Tabuk, Abha, Qassim, Hail, etc.)

JSON format — include ALL 60:
{"companies":[
  {"nameEn":"...","nameAr":"...","industry":"${sectorEn}","industryAr":"${sectorAr}","city":"...","region":"...","companyType":"Private|Public|Government|Family","entityType":"LLC|JSC|Holding","foundingYear":2005,"employeeCount":150,"revenue":"SAR 20M-50M","description":"Short 1-2 sentence description","website":null,"ownerName":null,"ownerTitle":null}
]}

RULES: Only REAL companies. No "Saudi XYZ General Trading" generic inventions. Revenue in SAR ranges. null for unknown fields.`;

  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 4096,
    });
    return await parseAndInsert(r.choices[0]?.message?.content || "", "gpt4o", sectorEn);
  } catch { return 0; }
}

// ── Claude batch for a sector ────────────────────────────────────────────
async function claudeSector(sectorEn: string, sectorAr: string): Promise<number> {
  if (!anthropic) return 0;
  const prompt = `You are a Saudi B2B database. List 50 real Saudi companies in "${sectorEn}". 
Focus on companies DIFFERENT from the most famous 10 (so mid-market, family businesses, regional players).
Include cities beyond Riyadh: Jeddah, Dammam, Khobar, Mecca, Madinah, Jubail, Yanbu, Tabuk, Aseer.

JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${sectorEn}","industryAr":"${sectorAr}","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]}

Only real companies. null for unknowns.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    return await parseAndInsert(text, "claude", sectorEn);
  } catch { return 0; }
}

// ── Perplexity SME discovery ──────────────────────────────────────────────
async function perplexitySector(sectorEn: string, sectorAr: string): Promise<number> {
  const k = process.env.PERPLEXITY_API_KEY;
  if (!k) return 0;
  try {
    const res = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [
          { role: "system", content: "Saudi Arabia B2B researcher. Return ONLY valid JSON." },
          { role: "user", content: `List 25 real Saudi companies in the ${sectorEn} sector. Focus on SMEs and regional players not in mainstream lists. Return JSON: {"companies":[{"nameEn":"","nameAr":"","city":"","region":"","foundingYear":0,"employeeCount":0,"website":null,"revenue":"SAR X-YM","companyType":"Private","description":""}]}` },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      },
      { headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, timeout: 25000 }
    );
    const text: string = res.data?.choices?.[0]?.message?.content || "";
    const parsed: { companies?: CompanyRow[] } = {};
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) Object.assign(parsed, JSON.parse(m[0]));
    } catch { /* */ }
    let inserted = 0;
    for (const c of (parsed.companies || [])) {
      const ok = await upsert({ ...c, industry: sectorEn, industryAr: sectorAr, dataSource: "perplexity", tags: sectorEn.toLowerCase() });
      if (ok) inserted++;
    }
    return inserted;
  } catch { return 0; }
}

// ── Process sectors in parallel batches ──────────────────────────────────
async function processSectorBatch(sectors: Array<{ en: string; ar: string }>): Promise<void> {
  await Promise.all(sectors.map(async (s) => {
    const [g, c, p] = await Promise.allSettled([
      gptSector(s.en, s.ar),
      claudeSector(s.en, s.ar),
      perplexitySector(s.en, s.ar),
    ]);
    const gCount = g.status === "fulfilled" ? g.value : 0;
    const cCount = c.status === "fulfilled" ? c.value : 0;
    const pCount = p.status === "fulfilled" ? p.value : 0;
    const total = gCount + cCount + pCount;
    console.log(`  ✅ ${s.en}: +${total} (GPT=${gCount}, Claude=${cCount}, Perplexity=${pCount})`);
  }));
}

// ── Also run specialized prompts for broad coverage ──────────────────────
async function harvestByRegion(): Promise<void> {
  console.log("\n📍 [Region harvest] Generating city-specific company lists...");
  const cities = [
    { city: "Riyadh", region: "Riyadh Region" },
    { city: "Jeddah", region: "Mecca Region" },
    { city: "Dammam", region: "Eastern Province" },
    { city: "Mecca", region: "Mecca Region" },
    { city: "Madinah", region: "Madinah Region" },
    { city: "Khobar", region: "Eastern Province" },
    { city: "Jubail", region: "Eastern Province" },
    { city: "Yanbu", region: "Madinah Region" },
    { city: "Tabuk", region: "Tabuk Region" },
    { city: "Abha", region: "Aseer Region" },
    { city: "Qassim", region: "Qassim Region" },
    { city: "Hail", region: "Hail Region" },
  ];

  await Promise.all(cities.map(async ({ city, region }) => {
    const prompt = `List 40 real Saudi companies headquartered in ${city}, Saudi Arabia. Include diverse industries (not just one sector). Mix of large and SME companies. Include family businesses, government-linked companies, startups.

JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"${city}","region":"${region}","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]}

Only real companies. null for unknowns.`;

    try {
      const r = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 3000,
      });
      const count = await parseAndInsert(r.choices[0]?.message?.content || "", "gpt4o-city", city);
      console.log(`  📍 ${city}: +${count}`);
    } catch (err) {
      console.log(`  📍 ${city}: failed`);
    }
  }));
}

async function harvestByCompanyType(): Promise<void> {
  console.log("\n🏛️  [Type harvest] Family businesses, startups, SOEs...");
  const types = [
    { type: "Saudi family businesses", prompt: "the 100 most significant Saudi family business groups and conglomerates" },
    { type: "Saudi government-linked enterprises", prompt: "Saudi state-owned enterprises, government holding companies, and Vision 2030 mega-projects" },
    { type: "Saudi startups", prompt: "Saudi tech startups and scale-ups founded after 2015 that have received funding" },
    { type: "Saudi listed companies TASI", prompt: "all companies listed on the Saudi Tadawul stock exchange (TASI), including sector and market cap class" },
    { type: "Saudi joint ventures MNCs", prompt: "Saudi-international joint ventures and subsidiaries of multinational companies operating in Saudi Arabia" },
  ];

  await Promise.all(types.map(async ({ type, prompt: desc }) => {
    const fullPrompt = `List 60 real Saudi companies that belong to this category: ${desc}.

JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","entityType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1-2 sentences","website":null,"ownerName":null}]}

Only real companies. null for unknowns.`;

    try {
      const r = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: fullPrompt }],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 4096,
      });
      const count = await parseAndInsert(r.choices[0]?.message?.content || "", "gpt4o-type", type);
      console.log(`  🏛️  ${type}: +${count}`);
    } catch {
      console.log(`  🏛️  ${type}: failed`);
    }
  }));
}

// ── MAIN ──────────────────────────────────────────────────────────────────
const ALL_SECTORS = [
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
  { en: "General Trading & Distribution", ar: "التجارة العامة والتوزيع" },
];

async function main() {
  console.log("⚡ ProspectSA Fast Parallel Harvest");
  console.log("=====================================");

  // Load existing into dedup cache
  const existing = await db.select({ nameEn: companiesTable.nameEn, nameAr: companiesTable.nameAr }).from(companiesTable);
  for (const c of existing) {
    if (c.nameEn) seenNames.add(key(c.nameEn));
    if (c.nameAr) seenNames.add(key(c.nameAr));
  }
  console.log(`📋 Dedup cache: ${existing.length} existing companies loaded`);

  // Phase A: Sector × AI (6 sectors at a time)
  console.log(`\n🤖 [Phase A] Sector harvest (${ALL_SECTORS.length} sectors, 6 parallel)...`);
  const BATCH = 6;
  for (let i = 0; i < ALL_SECTORS.length; i += BATCH) {
    const batch = ALL_SECTORS.slice(i, i + BATCH);
    console.log(`\n  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(ALL_SECTORS.length / BATCH)}: ${batch.map(s => s.en).join(", ")}`);
    await processSectorBatch(batch);
  }

  // Phase B: City-based harvest
  await harvestByRegion();

  // Phase C: Company type harvest  
  await harvestByCompanyType();

  // Final count
  const [countRow] = await db.execute<{ count: string }>(`SELECT COUNT(*) as count FROM companies`);
  const total = countRow?.count || "?";

  console.log("\n=====================================");
  console.log(`✅ HARVEST COMPLETE`);
  console.log(`   New companies inserted: ${totalInserted}`);
  console.log(`   Duplicates skipped:     ${totalSkipped}`);
  console.log(`   Total in database:      ${total}`);
  console.log("=====================================\n");

  process.exit(0);
}

main().catch(err => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
