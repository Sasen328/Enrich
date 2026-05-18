/**
 * FINAL PUSH: remaining micro-sectors + themed + mega batch
 */
import OpenAI from "openai";
import { db, companiesTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface C { nameEn?: string|null; nameAr?: string|null; industry?: string|null; industryAr?: string|null; city?: string|null; region?: string|null; website?: string|null; companyType?: string|null; entityType?: string|null; foundingYear?: number|null; employeeCount?: number|null; revenue?: string|null; ownerName?: string|null; ownerTitle?: string|null; description?: string|null; enrichmentScore?: number|null; enrichmentStatus?: string|null; dataSource?: string|null; tags?: string|null; }

const seen = new Set<string>(); let ins = 0; let skip = 0;
function k(s: string) { return s.toLowerCase().replace(/[\s\-_''""،,.]/g,"").trim(); }

async function upsert(c: C): Promise<boolean> {
  const kE = k(c.nameEn||""); const kA = k(c.nameAr||"");
  if (!kE && !kA) return false;
  if ((kE && seen.has(kE)) || (kA && seen.has(kA))) { skip++; return false; }
  try {
    const conds: ReturnType<typeof ilike>[] = [];
    if (c.nameEn?.trim()) conds.push(ilike(companiesTable.nameEn, c.nameEn.trim()));
    if (c.nameAr?.trim()) conds.push(ilike(companiesTable.nameAr, c.nameAr.trim()));
    if (conds.length) { const ex = await db.select({id:companiesTable.id}).from(companiesTable).where(or(...conds)).limit(1); if (ex.length) { if (kE) seen.add(kE); if (kA) seen.add(kA); skip++; return false; } }
    await db.insert(companiesTable).values({ nameEn:c.nameEn||null, nameAr:c.nameAr||null, industry:c.industry||null, industryAr:c.industryAr||null, city:c.city||null, region:c.region||null, website:c.website||null, companyType:c.companyType||null, entityType:c.entityType||null, foundingYear:typeof c.foundingYear==="number"?c.foundingYear:null, employeeCount:typeof c.employeeCount==="number"?String(c.employeeCount):null, revenue:c.revenue||null, ownerName:c.ownerName||null, ownerTitle:c.ownerTitle||null, description:c.description||null, country:"Saudi Arabia", enrichmentScore:c.enrichmentScore??38, enrichmentStatus:c.enrichmentStatus??"partial", dataSource:c.dataSource??"ai-harvest", tags:c.tags??"" });
    if (kE) seen.add(kE); if (kA) seen.add(kA); ins++; return true;
  } catch { skip++; return false; }
}

async function gpt(prompt: string, src: string): Promise<number> {
  try {
    const r = await openai.chat.completions.create({ model:"gpt-4o", messages:[{role:"user",content:prompt}], response_format:{type:"json_object"}, temperature:0.55, max_tokens:4096 });
    const text = r.choices[0]?.message?.content||""; const m = text.match(/\{[\s\S]*\}/); if (!m) return 0;
    const p = JSON.parse(m[0]) as { companies?: C[] }; let count = 0;
    for (const c of (p.companies||[])) { if (await upsert({...c, dataSource:src})) count++; }
    return count;
  } catch { return 0; }
}

const REMAINING_MICRO = [
  "Perfume & Oud Manufacturing", "Cosmetics & Beauty Products", "Salon & Spa Chains",
  "Gym & Fitness Chains", "Kids Entertainment & Family Centers", "Gaming & Esports",
  "Book Publishing & Media Content", "Hajj & Umrah Services", "Cleaning Products Manufacturing",
  "Paint & Coatings", "Rubber & Plastics Manufacturing", "Glass & Ceramics Manufacturing",
  "Cement & Building Materials Manufacturing", "Precast Concrete Products",
  "Thermal Insulation Products", "HVAC MEP Contractors", "Elevator & Escalator Services",
  "Interior Fit-out Contractors", "Landscaping & Horticulture Services", "Pest Control Services",
];

const THEMED = [
  { label: "Riyadh SMEs", p: `List 60 real small and medium Saudi companies primarily operating in Riyadh. Mix of trading, services, manufacturing, tech. Include Arabic names. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"Riyadh","region":"Riyadh Region","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real companies.` },
  { label: "Jeddah trading", p: `List 60 real Jeddah-based trading, import/export, and distribution companies. Include companies trading electronics, food, textiles, chemicals, machinery. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"General Trading & Distribution","city":"Jeddah","region":"Mecca Region","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real.` },
  { label: "Eastern Province industrial", p: `List 60 real industrial and manufacturing companies in Saudi Arabia's Eastern Province (Dammam, Khobar, Jubail, Yanbu). Petrochemicals, plastics, steel, engineering, oil services. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"Eastern Province","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
  { label: "Saudi women founders", p: `List 30 real businesses in Saudi Arabia founded or led by Saudi women entrepreneurs. Various sectors: fashion, beauty, food, tech, consulting, healthcare. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null,"ownerName":"","ownerTitle":"Founder/CEO"}]} Only real.` },
  { label: "Saudi franchise operators", p: `List 50 real Saudi operators of international franchise brands. Include the Saudi company name (not the franchise brand name), their industry, and which franchise(s) they operate. JSON: {"companies":[{"nameEn":"Saudi Operator Name","nameAr":"","industry":"","city":"","region":"","companyType":"Private","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"Saudi franchisee operating [brand]","website":null}]} Only real Saudi operators.` },
  { label: "Saudi IT & tech mid-market", p: `List 60 real Saudi IT companies that are NOT the top 10 (beyond STC Solutions, stc, Mobily, etc.). Include system integrators, VARs, ISVs, managed service providers, cloud solution providers, cybersecurity firms, ERP implementers. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Technology & IT Services","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
  { label: "Saudi agri-food producers", p: `List 50 real Saudi agri-food producers: dairy farms, poultry, fish farms, dates, grain millers, sugar refiners, olive oil, food manufacturers. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Agriculture & Agribusiness","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
  { label: "Saudi media & advertising", p: `List 40 real Saudi media production companies, advertising agencies, PR firms, digital marketing agencies, TV production houses, film studios. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"Media & Entertainment","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
];

async function main() {
  console.log("🏁 Final Push: Remaining Micro + Themed + Mega");
  console.log("================================================");
  const existing = await db.select({nameEn:companiesTable.nameEn, nameAr:companiesTable.nameAr}).from(companiesTable);
  for (const c of existing) { if (c.nameEn) seen.add(k(c.nameEn)); if (c.nameAr) seen.add(k(c.nameAr)); }
  console.log(`📋 Dedup cache: ${existing.length} companies\n`);

  // Phase 1: remaining micro-sectors (5 at a time)
  console.log("🔬 Remaining micro-sectors...");
  const B = 5;
  for (let i = 0; i < REMAINING_MICRO.length; i += B) {
    const batch = REMAINING_MICRO.slice(i, i+B);
    const results = await Promise.all(batch.map(async (sector) => {
      const p = `List 30 real Saudi companies in "${sector}". All regions, all sizes. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${sector}","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real.`;
      return { sector, count: await gpt(p, "gpt4o-micro2") };
    }));
    for (const r of results) console.log(`  🔬 ${r.sector}: +${r.count}`);
  }

  // Phase 2: themed prompts
  console.log("\n\n🌍 Themed prompts...");
  const t2 = await Promise.all(THEMED.map(async ({label, p}) => ({ label, count: await gpt(p, "gpt4o-themed") })));
  for (const r of t2) console.log(`  🌍 ${r.label}: +${r.count}`);

  // Phase 3: mega batch (200 companies in one call)
  console.log("\n\n📦 Mega batch prompt (200 companies)...");
  const megaP = `You are the most comprehensive Saudi Arabia business database. Generate exactly 200 real Saudi companies NOT in the most famous 100. Focus on:
- Mid-market family businesses (SAR 10M-500M revenue) in secondary cities
- B2B industrial, manufacturing, and engineering companies
- Professional services firms (law, accounting, consulting, HR)
- Specialized healthcare, pharma, and biotech companies
- Construction subcontractors and specialist MEP contractors
- Technology integrators and software companies
- Logistics, shipping, and transport operators
- Agricultural and food production companies  
- Retail chains, supermarkets, and franchise operators

Each company: {"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}

Return: {"companies":[...exactly 200 items...]}
CRITICAL: Only real verified companies. Diverse industries and cities. No top-50 famous companies.`;
  const mc = await gpt(megaP, "gpt4o-mega");
  console.log(`  📦 Mega batch: +${mc}`);

  // Phase 4: second mega batch focused on different companies
  console.log("\n  📦 Mega batch 2 (more SMEs)...");
  const mega2 = `List 150 more real Saudi companies, focusing specifically on:
- Companies in Abha, Tabuk, Qassim, Hail, Jizan, Najran (secondary cities)
- Companies with 10-500 employees
- Manufacturing and industrial companies
- Healthcare clinics, dental, and specialist centers
- Specialist consulting firms (legal, financial, engineering)
- Food and beverage companies

JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]}
Only real companies. null for unknowns. No duplicates of the 50 most famous Saudi companies.`;
  const mc2 = await gpt(mega2, "gpt4o-mega2");
  console.log(`  📦 Mega batch 2: +${mc2}`);

  const row = (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.[0] ?? (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.rows?.[0];
  console.log("\n================================================");
  console.log(`✅ DONE`);
  console.log(`   New: ${ins} | Skipped: ${skip} | Total: ${row?.count}`);
  console.log("================================================\n");
  process.exit(0);
}
main().catch(e => { console.error("❌", e); process.exit(1); });
