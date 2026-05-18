/**
 * FINAL PUSH: 3 big sector batches + general Saudi company mega-list
 */
import OpenAI from "openai";
import { db, companiesTable } from "@workspace/db";
import { ilike, or } from "drizzle-orm";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface C { nameEn?: string|null; nameAr?: string|null; industry?: string|null; city?: string|null; region?: string|null; website?: string|null; companyType?: string|null; entityType?: string|null; foundingYear?: number|null; employeeCount?: number|null; revenue?: string|null; ownerName?: string|null; description?: string|null; }

const seen = new Set<string>(); let ins = 0;
function k(s: string) { return s.toLowerCase().replace(/[\s\-_''""،,.]/g,"").trim(); }

async function upsert(c: C, src: string): Promise<boolean> {
  const kE=k(c.nameEn||""); const kA=k(c.nameAr||"");
  if (!kE&&!kA) return false;
  if ((kE&&seen.has(kE))||(kA&&seen.has(kA))) return false;
  try {
    const conds: ReturnType<typeof ilike>[] = [];
    if (c.nameEn?.trim()) conds.push(ilike(companiesTable.nameEn,c.nameEn.trim()));
    if (c.nameAr?.trim()) conds.push(ilike(companiesTable.nameAr,c.nameAr.trim()));
    if (conds.length) { const ex=await db.select({id:companiesTable.id}).from(companiesTable).where(or(...conds)).limit(1); if (ex.length) { if(kE) seen.add(kE); if(kA) seen.add(kA); return false; } }
    await db.insert(companiesTable).values({ nameEn:c.nameEn||null, nameAr:c.nameAr||null, industry:c.industry||null, city:c.city||null, region:c.region||null, website:c.website||null, companyType:c.companyType||null, entityType:c.entityType||null, foundingYear:typeof c.foundingYear==="number"?c.foundingYear:null, employeeCount:typeof c.employeeCount==="number"?String(c.employeeCount):null, revenue:c.revenue||null, ownerName:c.ownerName||null, description:c.description||null, country:"Saudi Arabia", enrichmentScore:38, enrichmentStatus:"partial", dataSource:src, tags:"" });
    if (kE) seen.add(kE); if (kA) seen.add(kA); ins++; return true;
  } catch { return false; }
}

async function gpt(prompt: string, src: string): Promise<number> {
  try {
    const r = await openai.chat.completions.create({ model:"gpt-4o", messages:[{role:"user",content:prompt}], response_format:{type:"json_object"}, temperature:0.6, max_tokens:4096 });
    const text=r.choices[0]?.message?.content||""; const m=text.match(/\{[\s\S]*\}/); if (!m) return 0;
    const p=JSON.parse(m[0]) as { companies?: C[] }; let count=0;
    for (const c of (p.companies||[])) { if (await upsert(c, src)) count++; }
    return count;
  } catch { return 0; }
}

async function main() {
  console.log("🎯 2K Push");
  const existing=await db.select({nameEn:companiesTable.nameEn,nameAr:companiesTable.nameAr}).from(companiesTable);
  for (const c of existing) { if(c.nameEn) seen.add(k(c.nameEn)); if(c.nameAr) seen.add(k(c.nameAr)); }
  console.log(`Cache: ${existing.length} companies\n`);

  const prompts = [
    { l:"Construction tier2-3", p:`List 80 real Saudi construction companies (tier-2 and tier-3 contractors, subcontractors, specialist trades contractors, MEP companies). Include companies working on commercial, residential, industrial projects. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Construction & Contracting","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real. null for unknowns.`, src:"gpt4o-constr" },
    { l:"Retail chains", p:`List 80 real Saudi retail companies: fashion chains, supermarkets, electronics, pharmacies, bookstores, convenience stores, dept stores, online retailers. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Retail & Consumer Goods","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real. null for unknowns.`, src:"gpt4o-retail" },
    { l:"Financial services", p:`List 80 real Saudi financial services companies: banks, investment firms, brokerages, leasing companies, REITs, factoring, insurance brokers, financial advisors. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Banking & Islamic Finance","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real. null for unknowns.`, src:"gpt4o-finance" },
    { l:"Healthcare ecosystem", p:`List 80 real Saudi healthcare companies: hospitals, polyclinics, dental chains, optical chains, pharmacy chains, medical labs, homecare, physiotherapy centers, wellness centers. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"Healthcare & Hospitals","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real. null for unknowns.`, src:"gpt4o-health" },
    { l:"General Saudi SMEs", p:`List 100 real Saudi small and medium enterprises across ALL industries. These should be companies NOT commonly found in business databases — family businesses, regional champions, B2B specialists. Include companies from ALL Saudi cities. JSON:{"companies":[{"nameEn":"","nameAr":"","industry":"","city":"","region":"","companyType":"","foundingYear":0,"employeeCount":0,"revenue":"SAR X-YM","description":"1 sentence","website":null}]} Only real. Diverse sectors.`, src:"gpt4o-sme" },
  ];

  const results = await Promise.all(prompts.map(async ({l,p,src}) => ({ l, count: await gpt(p, src) })));
  for (const r of results) console.log(`  ${r.l}: +${r.count}`);

  const countRow = (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.[0] ?? (await db.execute(`SELECT COUNT(*) as count FROM companies`) as any)?.rows?.[0];
  console.log(`\n✅ New: ${ins} | Total: ${countRow?.count}`);
  process.exit(0);
}
main().catch(e => { console.error("❌", e); process.exit(1); });
