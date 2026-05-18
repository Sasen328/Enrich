/**
 * FINISHING BLOW: Last 10 micro-sectors + themed + mega batches
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
  const kE=k(c.nameEn||""); const kA=k(c.nameAr||"");
  if (!kE&&!kA) return false;
  if ((kE&&seen.has(kE))||(kA&&seen.has(kA))) { skip++; return false; }
  try {
    const conds: ReturnType<typeof ilike>[] = [];
    if (c.nameEn?.trim()) conds.push(ilike(companiesTable.nameEn,c.nameEn.trim()));
    if (c.nameAr?.trim()) conds.push(ilike(companiesTable.nameAr,c.nameAr.trim()));
    if (conds.length) { const ex=await db.select({id:companiesTable.id}).from(companiesTable).where(or(...conds)).limit(1); if (ex.length) { if(kE) seen.add(kE); if(kA) seen.add(kA); skip++; return false; } }
    await db.insert(companiesTable).values({ nameEn:c.nameEn||null, nameAr:c.nameAr||null, industry:c.industry||null, industryAr:c.industryAr||null, city:c.city||null, region:c.region||null, website:c.website||null, companyType:c.companyType||null, entityType:c.entityType||null, foundingYear:typeof c.foundingYear==="number"?c.foundingYear:null, employeeCount:typeof c.employeeCount==="number"?String(c.employeeCount):null, revenue:c.revenue||null, ownerName:c.ownerName||null, ownerTitle:c.ownerTitle||null, description:c.description||null, country:"Saudi Arabia", enrichmentScore:c.enrichmentScore??38, enrichmentStatus:c.enrichmentStatus??"partial", dataSource:c.dataSource??"ai-harvest", tags:c.tags??"" });
    if (kE) seen.add(kE); if (kA) seen.add(kA); ins++; return true;
  } catch { skip++; return false; }
}

async function gpt(prompt: string, src: string): Promise<number> {
  try {
    const r = await openai.chat.completions.create({ model:"gpt-4o", messages:[{role:"user",content:prompt}], response_format:{type:"json_object"}, temperature:0.6, max_tokens:4096 });
    const text=r.choices[0]?.message?.content||""; const m=text.match(/\{[\s\S]*\}/); if (!m) return 0;
    const p=JSON.parse(m[0]) as { companies?: C[] }; let count=0;
    for (const c of (p.companies||[])) { if (await upsert({...c, dataSource:src})) count++; }
    return count;
  } catch { return 0; }
}

async function main() {
  console.log("🎯 Finishing Blow: Last micro-sectors + mega batches");
  const existing=await db.select({nameEn:companiesTable.nameEn,nameAr:companiesTable.nameAr}).from(companiesTable);
  for (const c of existing) { if (c.nameEn) seen.add(k(c.nameEn)); if (c.nameAr) seen.add(k(c.nameAr)); }
  console.log(`📋 Cache: ${existing.length} companies\n`);

  // Last 10 micro-sectors
  const lastMicro = [
    "Rubber & Plastics Manufacturing", "Glass & Ceramics Manufacturing", "Cement Manufacturing",
    "Precast Concrete Products", "Thermal Insulation Products", "HVAC MEP Contracting",
    "Elevator & Escalator Services", "Interior Fit-out Contractors", "Landscaping & Horticulture",
    "Pest Control Services",
  ];
  console.log("🔬 Last 10 micro-sectors (all parallel)...");
  const microR = await Promise.all(lastMicro.map(async s => {
    const p = `List 30 real Saudi companies in "${s}". All regions. JSON: {"companies":[{"nameEn":"","nameAr":"","industry":"${s}","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real.`;
    return { s, count: await gpt(p, "gpt4o-micro3") };
  }));
  for (const r of microR) console.log(`  🔬 ${r.s}: +${r.count}`);

  // Themed batches in parallel
  console.log("\n\n🌍 Themed batches (all parallel)...");
  const themed = [
    { l:"Riyadh SMEs", p:`List 60 real small and medium companies in Riyadh. Mix trading, services, manufacturing, tech. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"","city":"Riyadh","region":"Riyadh Region","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real.` },
    { l:"Jeddah trading", p:`List 60 real Jeddah trading/import/export companies. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"General Trading & Distribution","city":"Jeddah","region":"Mecca Region","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real.` },
    { l:"Eastern Province industrial", p:`List 60 real industrial/manufacturing companies in Eastern Province (Dammam, Khobar, Jubail). JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"Eastern Province","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
    { l:"Saudi IT mid-market", p:`List 60 real Saudi IT/tech companies (not top-10). System integrators, VARs, ISVs, MSPs, cloud providers, ERP implementers. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Technology & IT Services","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
    { l:"Saudi franchise operators", p:`List 50 real Saudi operators of international franchise brands (list Saudi operator name, not franchise brand). JSON:{"companies":[{"nameEn":"Saudi Operator Co","nameAr":"","industry":"","city":"","region":"","companyType":"Private","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"Saudi franchisee of [brand]","website":null}]} Only real.` },
    { l:"Saudi agri-food", p:`List 50 real Saudi food producers: dairy, poultry, fish, dates, grain millers, olive oil, food manufacturers. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Agriculture & Agribusiness","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
    { l:"Saudi women founders", p:`List 30 real businesses led by Saudi women founders. Fashion, beauty, food, tech, consulting, healthcare. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null,"ownerName":"","ownerTitle":"Founder"}]} Only real.` },
    { l:"Saudi media/advertising agencies", p:`List 40 real Saudi media, advertising, PR, digital marketing agencies. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Advertising & Marketing","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"","website":null}]} Only real.` },
  ];
  const themedR = await Promise.all(themed.map(async ({l,p}) => ({ l, count: await gpt(p,"gpt4o-themed2") })));
  for (const r of themedR) console.log(`  🌍 ${r.l}: +${r.count}`);

  // Two mega batches in parallel
  console.log("\n\n📦 Two mega batches in parallel...");
  const [m1, m2] = await Promise.all([
    gpt(`Generate 200 real Saudi companies NOT in the top 100 most famous ones. Focus on mid-market family businesses, B2B industrials, professional services, regional champions in secondary cities. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real. Diverse industries and cities.`, "gpt4o-mega3"),
    gpt(`List 150 real Saudi companies operating in secondary Saudi cities: Abha, Tabuk, Qassim, Hail, Jizan, Najran, Yanbu, Jubail, Khobar, Yanbu. Companies with 10-1000 employees. All industries. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real companies.`, "gpt4o-mega4"),
  ]);
  console.log(`  📦 Mega 1: +${m1}`);
  console.log(`  📦 Mega 2: +${m2}`);

  const row = (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.[0] ?? (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.rows?.[0];
  console.log(`\n✅ New: ${ins} | Skipped: ${skip} | Total: ${row?.count}\n`);
  process.exit(0);
}
main().catch(e => { console.error("❌", e); process.exit(1); });
