/**
 * PUSH TO 2000+: Arabic-first prompts, micro-sectors, CR-registered SMEs
 * Run: pnpm --filter @workspace/api-server exec tsx ./src/harvest-push2k.ts
 */

import OpenAI from "openai";
import { db, companiesTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CompanyRow {
  nameEn?: string | null; nameAr?: string | null; industry?: string | null; industryAr?: string | null;
  city?: string | null; region?: string | null; website?: string | null; companyType?: string | null;
  entityType?: string | null; foundingYear?: number | null; employeeCount?: number | null;
  revenue?: string | null; ownerName?: string | null; description?: string | null;
  enrichmentScore?: number | null; enrichmentStatus?: string | null; dataSource?: string | null; tags?: string | null;
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
      revenue: c.revenue || null, ownerName: c.ownerName || null, description: c.description || null,
      country: "Saudi Arabia", enrichmentScore: c.enrichmentScore ?? 38, enrichmentStatus: c.enrichmentStatus ?? "partial",
      dataSource: c.dataSource ?? "ai-harvest", tags: c.tags ?? "",
    });
    if (kE) seen.add(kE); if (kA) seen.add(kA); ins++; return true;
  } catch { skip++; return false; }
}

async function gpt(prompt: string, src: string): Promise<number> {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o", messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }, temperature: 0.6, max_tokens: 4096,
    });
    const text = r.choices[0]?.message?.content || "";
    const m = text.match(/\{[\s\S]*\}/); if (!m) return 0;
    const p = JSON.parse(m[0]) as { companies?: CompanyRow[] };
    let count = 0;
    for (const c of (p.companies || [])) { if (await upsert({ ...c, dataSource: src })) count++; }
    return count;
  } catch { return 0; }
}

const MICRO_SECTORS = [
  // Sub-sectors not yet covered
  "Catering & Food Services", "Car Rental & Fleet Management", "Office Supplies & Stationery",
  "Waste Management & Recycling", "Marine & Offshore Services", "Engineering Consultancy",
  "Architecture & Urban Planning", "Quantity Surveying & Cost Management", "Translation & Interpretation",
  "Event Management & MICE", "Recruitment & HR Services", "Payroll & Outsourcing Services",
  "Accounting & Audit Firms", "Tax Advisory", "Digital Marketing & SEO",
  "Cloud Computing & Data Centers", "Cybersecurity", "ERP & Enterprise Software",
  "Mobile App Development", "AI & Machine Learning", "Drone & UAV Services",
  "3D Printing & Additive Manufacturing", "Smart Home & Building Automation",
  "Medical Tourism", "Dental Clinics & Networks", "Optical & Eyewear",
  "Veterinary Services", "Pet Care & Grooming", "Animal Feed & Livestock",
  "Dates Processing & Export", "Honey & Organic Food", "Water Bottling",
  "Perfume & Oud", "Cosmetics & Beauty", "Salon & Spa Chains",
  "Gym & Fitness Chains", "Kids Entertainment & Family Entertainment Centers",
  "Gaming & Esports", "Book Publishing & Content", "Religious Tourism & Hajj Services",
  "Cleaning Products Manufacturing", "Paint & Coatings", "Rubber & Plastics Manufacturing",
  { sector: "Glass & Ceramics", city: "Yanbu" }, "Cement Manufacturing",
  "Precast Concrete", "Insulation Materials", "HVAC & MEP Contractors",
  "Elevator & Escalator Services", "Fit-out & Interior Contracting",
  "Landscaping & Horticulture", "Pest Control", "Swimming Pool & Recreation",
];

const ARABIC_SECTOR_PROMPTS = [
  { label: "Riyadh SMEs Arabic names", prompt: `List 50 real small and medium Saudi companies based in Riyadh that primarily use Arabic names. Include trading companies, contractors, service providers. For each: Arabic name (nameAr), English name (nameEn), industry, city=Riyadh, region=Riyadh Region, companyType, foundingYear, employeeCount, revenue. JSON: {"companies":[...]}` },
  { label: "Jeddah trading companies", prompt: `List 50 real Jeddah-based import/export and trading companies, including companies trading in electronics, food, textiles, chemicals, machinery. Arabic and English names. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"General Trading & Distribution","city":"Jeddah","region":"Mecca Region","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}` },
  { label: "Eastern Province industrial", prompt: `List 50 real industrial companies in Saudi Arabia's Eastern Province (Dammam, Khobar, Jubail, Yanbu, Ras Tanura). Industries: petrochemicals, plastics, rubber, steel, engineering, oil services. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"Eastern Province","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]}` },
  { label: "Saudi agri-food companies", prompt: `List 50 real Saudi agri-food companies: dairy farms, poultry producers, fish farms, dates producers, grain millers, sugar refiners, olive oil producers, food distributors. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Agriculture & Agribusiness","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]}` },
  { label: "Saudi women-led businesses", prompt: `List 30 real businesses in Saudi Arabia that are founded or led by Saudi women. Include various sectors: fashion, beauty, food, tech, consulting, healthcare. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null,"ownerName":"","ownerTitle":"Founder/CEO"}]}` },
  { label: "Saudi franchise operations", prompt: `List 50 real international franchise brands operating in Saudi Arabia AND the Saudi franchisee/operator name. Include fast food, retail, hospitality, automotive, healthcare franchises. JSON: {"companies":[{"nameEn":"Operator Co. Name","nameAr":"","industry":"","city":"","region":"","companyType":"Private","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"Saudi operator of [franchise brand] franchise","website":null}]}` },
  { label: "Saudi telecom & IT companies", prompt: `List 60 real Saudi IT, telecom, and technology companies beyond the top 5 (STC, Mobily, Zain, stc Solutions, etc.). Include system integrators, software houses, telecom resellers, network providers, managed service providers. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Technology & IT Services","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]}` },
  { label: "Saudi media production", prompt: `List 40 real Saudi media, advertising, PR, and production companies. Include TV production houses, film studios, advertising agencies, PR firms, digital agencies, social media agencies. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Media & Entertainment","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]}` },
];

async function main() {
  console.log("🚀 Push to 2000+ Harvest");
  console.log("=================================");

  const existing = await db.select({ nameEn: companiesTable.nameEn, nameAr: companiesTable.nameAr }).from(companiesTable);
  for (const c of existing) { if (c.nameEn) seen.add(k(c.nameEn)); if (c.nameAr) seen.add(k(c.nameAr)); }
  console.log(`📋 Dedup cache: ${existing.length} companies\n`);

  // Phase 1: Micro-sectors (batch 8 at a time)
  console.log("🔬 [Micro-sectors] 52 niche Saudi sectors...");
  const BATCH = 8;
  const sectors = MICRO_SECTORS.map(s => typeof s === "string" ? s : s.sector);
  for (let i = 0; i < sectors.length; i += BATCH) {
    const batch = sectors.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (sector) => {
      const prompt = `List 30 real Saudi companies in the "${sector}" sector. Include companies across all Saudi regions, all sizes.
JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${sector}","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real companies. null for unknowns.`;
      return { sector, count: await gpt(prompt, "gpt4o-micro") };
    }));
    for (const r of results) console.log(`  🔬 ${r.sector}: +${r.count}`);
  }

  // Phase 2: Arabic/themed prompts
  console.log("\n\n🌍 [Themed prompts] Special categories...");
  const results2 = await Promise.all(ARABIC_SECTOR_PROMPTS.map(async ({ label, prompt }) => ({
    label,
    count: await gpt(prompt, "gpt4o-themed"),
  })));
  for (const r of results2) console.log(`  🌍 ${r.label}: +${r.count}`);

  // Phase 3: Additional bulk GPT mega-prompt 
  console.log("\n\n📦 [Mega-prompt] Single large-batch request...");
  const megaPrompt = `You are the most comprehensive Saudi Arabia business database. Generate a list of 200 REAL Saudi companies that are NOT commonly found in standard databases.

Focus on:
- Mid-market family businesses (SAR 10M-500M revenue)
- Regional champions outside Riyadh (Jeddah, Dammam, secondary cities)
- B2B industrial and manufacturing companies
- Professional services firms
- Healthcare, pharma, and biotech companies
- Construction subcontractors
- Technology system integrators and VARs
- Logistics and transport companies
- Food production and agribusiness
- Retail chains and franchises

For each company:
{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}

Return: {"companies":[...200 items...]}
IMPORTANT: Only real companies. Diverse industries. Avoid top 50 most famous companies.`;

  const megaCount = await gpt(megaPrompt, "gpt4o-mega");
  console.log(`\n  📦 Mega batch: +${megaCount}`);

  // Final count
  const countRow = (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.[0] ?? (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.rows?.[0];
  console.log("\n=================================");
  console.log(`✅ PUSH COMPLETE`);
  console.log(`   New companies inserted: ${ins}`);
  console.log(`   Duplicates skipped:     ${skip}`);
  console.log(`   Total in database:      ${countRow?.count}`);
  console.log("=================================\n");
  process.exit(0);
}

main().catch(e => { console.error("❌", e); process.exit(1); });
