/**
 * FINAL HARVEST: Cities + Type Buckets + Extra sectors
 * Run: pnpm --filter @workspace/api-server exec tsx ./src/harvest-final.ts
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

const seen = new Set<string>();
let ins = 0; let skip = 0;
function k(s: string) { return s.toLowerCase().replace(/[\s\-_''""،,.]/g, "").trim(); }

async function upsert(c: CompanyRow): Promise<boolean> {
  const kE = k(c.nameEn || ""); const kA = k(c.nameAr || "");
  if (!kE && !kA) return false;
  if ((kE && seen.has(kE)) || (kA && seen.has(kA))) { skip++; return false; }
  try {
    const conds = [];
    if (c.nameEn?.trim()) conds.push(ilike(companiesTable.nameEn, c.nameEn.trim()));
    if (c.nameAr?.trim()) conds.push(ilike(companiesTable.nameAr, c.nameAr.trim()));
    if (conds.length) {
      const ex = await db.select({ id: companiesTable.id }).from(companiesTable).where(or(...conds)).limit(1);
      if (ex.length) { if (kE) seen.add(kE); if (kA) seen.add(kA); skip++; return false; }
    }
    await db.insert(companiesTable).values({
      nameEn: c.nameEn || null, nameAr: c.nameAr || null, industry: c.industry || null,
      industryAr: c.industryAr || null, city: c.city || null, region: c.region || null,
      website: c.website || null, companyType: c.companyType || null, entityType: c.entityType || null,
      foundingYear: typeof c.foundingYear === "number" ? c.foundingYear : null,
      employeeCount: typeof c.employeeCount === "number" ? String(c.employeeCount) : null,
      revenue: c.revenue || null, ownerName: c.ownerName || null, ownerTitle: c.ownerTitle || null,
      description: c.description || null, country: "Saudi Arabia",
      enrichmentScore: c.enrichmentScore ?? 38, enrichmentStatus: c.enrichmentStatus ?? "partial",
      dataSource: c.dataSource ?? "ai-harvest", tags: c.tags ?? "",
    });
    if (kE) seen.add(kE); if (kA) seen.add(kA); ins++; return true;
  } catch { skip++; return false; }
}

async function gpt(prompt: string, src: string, fallback?: string): Promise<number> {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o", messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }, temperature: 0.5, max_tokens: 4096,
    });
    const text = r.choices[0]?.message?.content || "";
    const m = text.match(/\{[\s\S]*\}/); if (!m) return 0;
    const p = JSON.parse(m[0]) as { companies?: CompanyRow[] };
    let count = 0;
    for (const c of (p.companies || [])) { if (await upsert({ ...c, industry: c.industry || fallback || null, dataSource: src })) count++; }
    return count;
  } catch { return 0; }
}

async function main() {
  console.log("🏁 Final Harvest: Cities + Type Buckets");
  console.log("==========================================");

  const existing = await db.select({ nameEn: companiesTable.nameEn, nameAr: companiesTable.nameAr }).from(companiesTable);
  for (const c of existing) { if (c.nameEn) seen.add(k(c.nameEn)); if (c.nameAr) seen.add(k(c.nameAr)); }
  console.log(`📋 Dedup cache: ${existing.length} companies loaded\n`);

  // ── Phase B: Cities ──
  console.log("📍 [City Harvest] All 15 Saudi cities in parallel...");
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

  const cityResults = await Promise.all(cities.map(async ({ city, region }) => {
    const prompt = `List 40 real companies based in ${city}, Saudi Arabia (${region}). Diverse industries, mix of large/mid/SME.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"${city}","region":"${region}","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real companies. null for unknowns.`;
    return { city, count: await gpt(prompt, "gpt4o-city", city) };
  }));

  for (const r of cityResults) console.log(`  📍 ${r.city}: +${r.count}`);

  // ── Phase C: Type Buckets ──
  console.log("\n\n🏛️  [Type Buckets] 8 company-type categories in parallel...");
  const buckets = [
    {
      label: "Saudi family conglomerates",
      prompt: `List 60 real Saudi family business groups and conglomerates. Go beyond the top 10 to include mid-tier family groups.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"Family","entityType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null,"ownerName":null}]}
Only real. null for unknowns.`,
    },
    {
      label: "Saudi SOEs & Vision 2030",
      prompt: `List 60 real Saudi state-owned enterprises, PIF-backed companies, and Vision 2030 project companies.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"Government","entityType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real. null for unknowns.`,
    },
    {
      label: "Saudi tech startups",
      prompt: `List 50 real Saudi technology startups founded after 2012 that have received funding or are notable. Include fintech, e-commerce, healthtech, edtech, logistics tech, SaaS.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"Private","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real funded/notable startups. null for unknowns.`,
    },
    {
      label: "TASI & Nomu listed companies",
      prompt: `List all real companies listed on Saudi Tadawul (TASI) and NOMU exchange. Include company name (English + Arabic), sector, approximate founding year, and listing year.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"Public","entityType":"Joint Stock Company","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"Listed company on TASI/NOMU","website":null}]}
Only real listed companies.`,
    },
    {
      label: "Saudi construction & mega-project contractors",
      prompt: `List 60 real Saudi construction companies, engineering firms, and contractors. Include firms working on NEOM, Red Sea, Diriyah, Expo City projects. All tiers.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Construction & Contracting","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real. null for unknowns.`,
    },
    {
      label: "Saudi healthcare hospital groups",
      prompt: `List 60 real Saudi healthcare companies: hospital chains, clinic networks, medical centers, pharmacy chains, lab chains, medical distributors.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Healthcare & Hospitals","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real. null for unknowns.`,
    },
    {
      label: "Saudi retail FMCG chains",
      prompt: `List 60 real Saudi retail companies, supermarkets, hypermarkets, fashion retailers, specialty stores, and FMCG distributors.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Retail & Consumer Goods","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real. null for unknowns.`,
    },
    {
      label: "Saudi logistics shipping freight",
      prompt: `List 60 real Saudi logistics, freight, shipping, trucking, warehousing, and last-mile delivery companies.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Logistics & Supply Chain","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real. null for unknowns.`,
    },
  ];

  const bucketResults = await Promise.all(buckets.map(async ({ label, prompt }) => ({
    label,
    count: await gpt(prompt, "gpt4o-type"),
  })));

  for (const r of bucketResults) console.log(`  🏛️  ${r.label}: +${r.count}`);

  // ── Phase D: Perplexity SME discovery ──
  if (process.env.PERPLEXITY_API_KEY) {
    console.log("\n\n🔎 [Perplexity] SME discovery in parallel...");
    const pSectors = [
      "Technology & IT Services", "Healthcare & Hospitals", "Retail & Consumer Goods",
      "Construction & Contracting", "Food & Beverage Manufacturing", "Logistics & Supply Chain",
      "Education & Training", "Real Estate & Property Development", "Banking & Islamic Finance",
    ];
    const pResults = await Promise.all(pSectors.map(async (sector) => {
      try {
        const res = await axios.post(
          "https://api.perplexity.ai/chat/completions",
          {
            model: "sonar",
            messages: [
              { role: "system", content: "Return ONLY valid JSON. No explanation text." },
              { role: "user", content: `List 25 real Saudi companies in ${sector}. Focus on SMEs and regional players. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${sector}","city":"","region":"","foundingYear":0,"employeeCount":0,"website":null,"revenue":"SAR X-YM","companyType":"Private","description":"1 sentence"}]}` },
            ],
            max_tokens: 2000, temperature: 0.1,
          },
          { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" }, timeout: 20000 }
        );
        const text: string = res.data?.choices?.[0]?.message?.content || "";
        const m = text.match(/\{[\s\S]*\}/); if (!m) return { sector, count: 0 };
        const p = JSON.parse(m[0]) as { companies?: CompanyRow[] };
        let count = 0;
        for (const c of (p.companies || [])) { if (await upsert({ ...c, industry: c.industry || sector, dataSource: "perplexity" })) count++; }
        return { sector, count };
      } catch { return { sector, count: 0 }; }
    }));
    for (const r of pResults) console.log(`  🔎 ${r.sector}: +${r.count}`);
  }

  // Final count
  const row = (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.[0] ?? (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.rows?.[0];
  console.log("\n==========================================");
  console.log(`✅ FINAL HARVEST COMPLETE`);
  console.log(`   New companies inserted: ${ins}`);
  console.log(`   Duplicates skipped:     ${skip}`);
  console.log(`   Total in database:      ${row?.count}`);
  console.log("==========================================\n");
  process.exit(0);
}

main().catch(e => { console.error("❌", e); process.exit(1); });
