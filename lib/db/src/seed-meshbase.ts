/**
 * MeshBase Seed Script v2
 * Truncates companies + executives tables then re-seeds from new curated JSON.
 * Files are newline-delimited JSON (one object per line, NOT a JSON array).
 * Run: tsx lib/db/src/seed-meshbase.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sql } from "drizzle-orm";
import { db, pool } from "./index";
import { companiesTable, executivesTable } from "./schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../../..");
const COMPANIES_FILE = path.join(ROOT, "attached_assets", "meshbase-companies_1773732122378.json");
const EXECUTIVES_FILE = path.join(ROOT, "attached_assets", "meshbase-executives_1773732122378.json");
const BATCH = 100;

type RawCompany = Record<string, unknown>;
type RawExecutive = Record<string, unknown>;

function readNDJson(filePath: string): Record<string, unknown>[] {
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(l => l.trim());
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch { console.warn(`⚠️  Skipping invalid JSON on line ${i + 1}`); return null; }
  }).filter(Boolean) as Record<string, unknown>[];
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function num(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return n.toFixed(2);
}

function intVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return Math.round(n);
}

function arrStr(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.filter(x => x !== null && x !== undefined).map(String);
  return arr.length > 0 ? arr : null;
}

function inferSeniority(position: string | null | undefined): string | null {
  const p = (position || "").toLowerCase();
  if (/\b(ceo|cfo|cto|coo|chief|founder|president|general manager|managing director|chairman)\b/.test(p)) return "C-Suite";
  if (/\b(vp|vice president|svp|evp)\b/.test(p)) return "VP";
  if (/\b(director)\b/.test(p)) return "Director";
  if (/\b(manager|head of|senior)\b/.test(p)) return "Senior";
  if (/\b(analyst|specialist|engineer|consultant|associate|coordinator)\b/.test(p)) return "Mid";
  return "Professional";
}

function mapCompany(raw: RawCompany) {
  const employeeCountStr = str(raw.employee_count);
  const logoUrl = str(raw.logo_url);
  const revenueStr = num(raw.revenue);
  const profitStr = num(raw.profit);
  const marketCapStr = num(raw.market_cap);
  const growthRateStr = raw.growth_rate != null ? String(raw.growth_rate) : null;

  return {
    nameEn: str(raw.name),
    nameAr: str(raw.arabic_name),
    industry: str(raw.industry) || "Other",
    subIndustry: str(raw.sub_industry),
    city: str(raw.city) || str(raw.headquarters) || "Riyadh",
    region: str(raw.headquarters),
    country: "Saudi Arabia",
    website: str(raw.website),
    phone: str(raw.phone),
    email: str(raw.contact_email),
    contactEmail: str(raw.contact_email),
    description: str(raw.description),
    employeeCount: employeeCountStr,
    revenue: revenueStr,
    profit: profitStr,
    marketCap: marketCapStr,
    growthRate: growthRateStr,
    foundingYear: intVal(raw.year_established),
    logoUrl: logoUrl,
    ceo: str(raw.ceo),
    founder: str(raw.founder),
    address: str(raw.address),
    aiInsights: str(raw.ai_insights),
    enrichmentStatus: "enriched",
    enrichmentScore: logoUrl ? 85 : revenueStr ? 70 : 50,
    dataSource: "meshbase",
  };
}

function mapExecutive(raw: RawExecutive, companyIntId: number | null) {
  return {
    companyId: companyIntId,
    companyName: str(raw.company_name),
    name: str(raw.name) || "Unknown",
    nameAr: str(raw.arabic_name),
    position: str(raw.position) || "Executive",
    email: str(raw.email),
    linkedin: str(raw.linkedin),
    linkedinUrl: str(raw.linkedin),
    biography: str(raw.bio),
    education: str(raw.education),
    photoUrl: str(raw.photo_url),
    yearsOfExperience: intVal(raw.years_of_experience),
    estimatedSalary: intVal(raw.estimated_salary),
    skills: arrStr(raw.skills),
    achievements: arrStr(raw.achievements),
    previousCompanies: arrStr(raw.previous_companies),
    seniorityLevel: inferSeniority(str(raw.position)),
    enrichmentStatus: "enriched",
    dataSource: "meshbase",
  };
}

async function run() {
  console.log("📂  Reading newline-delimited JSON files...");
  if (!fs.existsSync(COMPANIES_FILE)) throw new Error(`Not found: ${COMPANIES_FILE}`);
  if (!fs.existsSync(EXECUTIVES_FILE)) throw new Error(`Not found: ${EXECUTIVES_FILE}`);

  const companiesRaw = readNDJson(COMPANIES_FILE);
  const executivesRaw = readNDJson(EXECUTIVES_FILE);

  console.log(`   Companies in file : ${companiesRaw.length.toLocaleString()}`);
  console.log(`   Executives in file: ${executivesRaw.length.toLocaleString()}`);

  // ── Step 1: Wipe curated tables (cascade handles FK) ───────────────────────
  console.log("\n🗑️   Truncating executives + companies (CASCADE)...");
  await db.execute(sql`TRUNCATE TABLE executives, companies RESTART IDENTITY CASCADE`);
  console.log("   Tables cleared.\n");

  // ── Step 2: Seed companies ───────────────────────────────────────────────────
  console.log(`📦  Inserting ${companiesRaw.length.toLocaleString()} companies in batches of ${BATCH}...`);
  const jsonIdToDbId = new Map<string, number>();
  let inserted = 0;

  for (let i = 0; i < companiesRaw.length; i += BATCH) {
    const batch = companiesRaw.slice(i, i + BATCH);
    const rows = batch.map(mapCompany);
    const result = await db.insert(companiesTable).values(rows as any[]).returning({ id: companiesTable.id });
    for (let j = 0; j < batch.length; j++) {
      const jsonId = String(batch[j].id ?? "");
      if (jsonId && result[j]) {
        jsonIdToDbId.set(jsonId, result[j].id);
      }
    }
    inserted += batch.length;
    process.stdout.write(`\r   ${inserted.toLocaleString()} / ${companiesRaw.length.toLocaleString()} companies`);
  }
  console.log(`\n✅  Companies inserted: ${inserted.toLocaleString()}`);

  // ── Step 3: Seed executives ──────────────────────────────────────────────────
  console.log(`\n👤  Inserting ${executivesRaw.length.toLocaleString()} executives in batches of ${BATCH}...`);
  let execInserted = 0;
  let execSkipped = 0;

  for (let i = 0; i < executivesRaw.length; i += BATCH) {
    const batch = executivesRaw.slice(i, i + BATCH);
    const rows: ReturnType<typeof mapExecutive>[] = [];

    for (const raw of batch) {
      const rawCompanyId = String(raw.company_id ?? "");
      const companyIntId = jsonIdToDbId.get(rawCompanyId) ?? null;
      if (!companyIntId) execSkipped++;
      rows.push(mapExecutive(raw, companyIntId));
    }

    await db.insert(executivesTable).values(rows as any[]);
    execInserted += batch.length;
    process.stdout.write(`\r   ${execInserted.toLocaleString()} / ${executivesRaw.length.toLocaleString()} executives`);
  }
  console.log(`\n✅  Executives inserted: ${execInserted.toLocaleString()}`);
  if (execSkipped > 0) console.log(`⚠️   Executives with no matching company: ${execSkipped} (still inserted, companyId = null)`);

  // ── Step 4: Final count ──────────────────────────────────────────────────────
  const cResult = await db.execute(sql`SELECT COUNT(*) FROM companies`);
  const eResult = await db.execute(sql`SELECT COUNT(*) FROM executives`);
  const cCount = (cResult as any).rows?.[0] ?? (Array.isArray(cResult) ? cResult[0] : cResult);
  const eCount = (eResult as any).rows?.[0] ?? (Array.isArray(eResult) ? eResult[0] : eResult);
  console.log(`\n🏁  Final DB state:`);
  console.log(`   companies  : ${(cCount as any).count}`);
  console.log(`   executives : ${(eCount as any).count}`);

  await pool.end();
  process.exit(0);
}

run().catch(err => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
