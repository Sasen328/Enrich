/**
 * CONTINUATION: Batches 4-7 + city + type harvests
 * Run: pnpm --filter @workspace/api-server exec tsx ./src/harvest-continue.ts
 */

import OpenAI from "openai";
import axios from "axios";
import { db, companiesTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CompanyRow {
  nameEn?: string | null; nameAr?: string | null; industry?: string | null; industryAr?: string | null;
  city?: string | null; region?: string | null; website?: string | null; companyType?: string | null;
  entityType?: string | null; foundingYear?: number | null; employeeCount?: number | null;
  revenue?: string | null; ownerName?: string | null; ownerTitle?: string | null;
  description?: string | null; enrichmentScore?: number | null; enrichmentStatus?: string | null;
  dataSource?: string | null; tags?: string | null;
}

const seenNames = new Set<string>();
let totalInserted = 0; let totalSkipped = 0;

function k(s: string): string { return s.toLowerCase().replace(/[\s\-_''""،,.]/g, "").trim(); }

async function upsert(company: CompanyRow): Promise<boolean> {
  const kEn = k(company.nameEn || ""); const kAr = k(company.nameAr || "");
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
      nameEn: company.nameEn || null, nameAr: company.nameAr || null, industry: company.industry || null,
      industryAr: company.industryAr || null, city: company.city || null, region: company.region || null,
      website: company.website || null, companyType: company.companyType || null, entityType: company.entityType || null,
      foundingYear: typeof company.foundingYear === "number" ? company.foundingYear : null,
      employeeCount: typeof company.employeeCount === "number" ? company.employeeCount : null,
      revenue: company.revenue || null, ownerName: company.ownerName || null, ownerTitle: company.ownerTitle || null,
      description: company.description || null, country: "Saudi Arabia",
      enrichmentScore: company.enrichmentScore ?? 38, enrichmentStatus: company.enrichmentStatus ?? "partial",
      dataSource: company.dataSource ?? "ai-harvest", tags: company.tags ?? "",
    } as any);
    if (kEn) seenNames.add(kEn); if (kAr) seenNames.add(kAr);
    totalInserted++; return true;
  } catch { totalSkipped++; return false; }
}

async function parseInsert(text: string, src: string, fallback?: string): Promise<number> {
  let ins = 0;
  try {
    const m = text.match(/\{[\s\S]*\}/); if (!m) return 0;
    const p = JSON.parse(m[0]) as { companies?: CompanyRow[] };
    for (const c of (p.companies || [])) { if (await upsert({ ...c, industry: c.industry || fallback || null, dataSource: src })) ins++; }
  } catch { /* */ }
  return ins;
}

async function gptPrompt(prompt: string, src: string, fallback?: string): Promise<number> {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o", messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }, temperature: 0.5, max_tokens: 4096,
    });
    return await parseInsert(r.choices[0]?.message?.content || "", src, fallback);
  } catch { return 0; }
}

const REMAINING_SECTORS = [
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
  console.log("🔄 Harvest Continuation (batches 4-7 + city + type)");
  console.log("====================================================");

  const existing = await db.select({ nameEn: companiesTable.nameEn, nameAr: companiesTable.nameAr }).from(companiesTable);
  for (const c of existing) { if (c.nameEn) seenNames.add(k(c.nameEn)); if (c.nameAr) seenNames.add(k(c.nameAr)); }
  console.log(`📋 Dedup cache: ${existing.length} companies\n`);

  // === PHASE A: Remaining sectors ===
  console.log("🤖 [Phase A] Remaining 20 sectors (5 parallel)...");
  const BATCH = 5;
  for (let i = 0; i < REMAINING_SECTORS.length; i += BATCH) {
    const batch = REMAINING_SECTORS.slice(i, i + BATCH);
    console.log(`\n  Batch: ${batch.map(s => s.en).join(", ")}`);
    await Promise.all(batch.map(async (s) => {
      const prompt = `List 60 real Saudi companies in "${s.en}" sector. Mix large/mid/SME across all Saudi cities.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${s.en}","industryAr":"${s.ar}","city":"","region":"","companyType":"Private|Public|Government|Family","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null,"ownerName":null}]}
Only real companies. null for unknowns.`;
      const count = await gptPrompt(prompt, "gpt4o", s.en);
      console.log(`  ✅ ${s.en}: +${count}`);
    }));
  }

  // === PHASE B: City-specific companies ===
  console.log("\n\n📍 [Phase B] City-based harvest...");
  const cities = [
    { city: "Riyadh", region: "Riyadh Region" }, { city: "Jeddah", region: "Mecca Region" },
    { city: "Dammam", region: "Eastern Province" }, { city: "Mecca", region: "Mecca Region" },
    { city: "Madinah", region: "Madinah Region" }, { city: "Khobar", region: "Eastern Province" },
    { city: "Jubail", region: "Eastern Province" }, { city: "Yanbu", region: "Madinah Region" },
    { city: "Tabuk", region: "Tabuk Region" }, { city: "Abha", region: "Aseer Region" },
    { city: "Qassim", region: "Qassim Region" }, { city: "Hail", region: "Hail Region" },
    { city: "Jizan", region: "Jizan Region" }, { city: "Najran", region: "Najran Region" },
    { city: "Baha", region: "Baha Region" },
  ];

  await Promise.all(cities.map(async ({ city, region }) => {
    const prompt = `List 40 real companies based in ${city}, Saudi Arabia (region: ${region}). Diverse industries, all company sizes.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"${city}","region":"${region}","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real, verified companies. null for unknowns.`;
    const count = await gptPrompt(prompt, "gpt4o-city", city);
    console.log(`  📍 ${city}: +${count}`);
  }));

  // === PHASE C: Company type buckets ===
  console.log("\n\n🏛️  [Phase C] Company type buckets...");
  const typeBuckets = [
    { label: "Saudi family conglomerates", prompt: "List 60 real Saudi family business groups and conglomerates. Include the Bin Laden Group, Al-Futtaim Saudi operations, Olayan Group, Zamil Group, Algosaibi, Rajhi Group, Bugshan Group, Almunajem, Albaik, and many others. Diverse sectors." },
    { label: "Saudi SOEs and Vision 2030", prompt: "List 60 real Saudi state-owned enterprises, PIF-backed companies, and Vision 2030 mega-projects. Include ARAMCO subsidiaries, SABIC subsidiaries, GOSI investments, PIF portfolio companies, NEOM suppliers, Red Sea project companies, ROSHN, etc." },
    { label: "Saudi tech startups funded", prompt: "List 50 real Saudi technology startups that have received venture capital or angel investment since 2015. Include fintech, edtech, healthtech, logistics, e-commerce, SaaS, marketplace startups based in Saudi Arabia." },
    { label: "TASI listed companies", prompt: "List all 200 real Saudi companies listed on TASI (Tadawul All Share Index). Include company name in English and Arabic, ticker symbol if known, sector, founding year, approximate market cap class (Large/Mid/Small cap)." },
    { label: "Saudi construction & mega-projects", prompt: "List 60 real Saudi construction companies, contractors, and engineering firms. Include major contractors for NEOM, Red Sea, Diriyah, Expo City, and other Vision 2030 projects. All sizes from tier-1 to tier-3 contractors." },
    { label: "Saudi healthcare providers", prompt: "List 60 real Saudi healthcare companies: hospital groups, clinics, medical centers, pharmacies, homecare providers, lab chains, medical device distributors. Include both large groups and regional players." },
    { label: "Saudi retail and FMCG", prompt: "List 60 real Saudi retail companies, supermarket chains, hypermarkets, specialty retailers, and FMCG distributors. Include large retail groups, regional chains, and franchise operators." },
    { label: "Saudi logistics and transport companies", prompt: "List 60 real Saudi freight, logistics, shipping, trucking, warehousing, and last-mile delivery companies. Include companies serving Saudi Aramco, SABIC, and other industrial clients." },
  ];

  await Promise.all(typeBuckets.map(async ({ label, prompt: desc }) => {
    const fullPrompt = `${desc}

Return JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","entityType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1-2 sentences","website":null,"ownerName":null}]}
Only real companies with high confidence. null for unknown fields.`;
    const count = await gptPrompt(fullPrompt, "gpt4o-type", label);
    console.log(`  🏛️  ${label}: +${count}`);
  }));

  // === PHASE D: Perplexity sector discovery ===
  if (process.env.PERPLEXITY_API_KEY) {
    console.log("\n\n🔎 [Phase D] Perplexity SME discovery...");
    const perplexitySectors = [
      "Technology & IT Services", "Healthcare & Hospitals", "Retail & Consumer Goods",
      "Construction & Contracting", "Food & Beverage Manufacturing", "Logistics & Supply Chain",
      "Education & Training", "Tourism & Hospitality", "Real Estate & Property Development",
    ];
    await Promise.all(perplexitySectors.map(async (sector) => {
      try {
        const res = await axios.post(
          "https://api.perplexity.ai/chat/completions",
          {
            model: "sonar",
            messages: [
              { role: "system", content: "Saudi Arabia B2B researcher. Return ONLY valid JSON." },
              { role: "user", content: `List 30 real Saudi companies in ${sector} sector. Focus on SMEs and mid-market companies not widely covered in mainstream business media. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${sector}","city":"","region":"","foundingYear":0,"employeeCount":0,"website":null,"revenue":"SAR X-YM","companyType":"Private","description":"1 sentence"}]}` },
            ],
            max_tokens: 2000, temperature: 0.1,
          },
          { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" }, timeout: 25000 }
        );
        const text: string = res.data?.choices?.[0]?.message?.content || "";
        const count = await parseInsert(text, "perplexity", sector);
        console.log(`  🔎 ${sector}: +${count}`);
      } catch { console.log(`  🔎 ${sector}: failed`); }
    }));
  }

  // === Final count ===
  const row = (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.[0] ?? (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.rows?.[0];
  console.log("\n====================================================");
  console.log(`✅ CONTINUATION COMPLETE`);
  console.log(`   New companies inserted: ${totalInserted}`);
  console.log(`   Duplicates skipped:     ${totalSkipped}`);
  console.log(`   Total in database:      ${row?.count}`);
  console.log("====================================================\n");
  process.exit(0);
}

main().catch(e => { console.error("❌", e); process.exit(1); });
