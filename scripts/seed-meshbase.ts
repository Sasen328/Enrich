/**
 * MeshBase Seed Script
 * Seeds the curated companies + executives from JSON files.
 * Uses the `companies` and `executives` tables ONLY — never touches builder_companies.
 */

import fs from "fs";
import path from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { companiesTable, executivesTable } from "../lib/db/src/schema/index";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const ROOT = path.resolve(__dirname, "..");
const COMPANIES_FILE = path.join(ROOT, "attached_assets", "companies_1773720870834.json");
const EXECUTIVES_FILE = path.join(ROOT, "attached_assets", "executives_1773720870834.json");
const BATCH = 200;

function parseEmployeeCount(str: string | null | undefined): number | null {
  if (!str) return null;
  const digits = str.match(/\d+/g);
  if (!digits) return null;
  return parseInt(digits[digits.length - 1], 10);
}

function inferSeniority(position: string | null | undefined): string | null {
  const p = (position || "").toLowerCase();
  if (/\b(ceo|cfo|cto|coo|chief|founder|president|general manager|managing director)\b/.test(p)) return "C-Suite";
  if (/\b(vp|vice president)\b/.test(p)) return "VP";
  if (/\b(director)\b/.test(p)) return "Director";
  if (/\b(manager|head of|senior)\b/.test(p)) return "Senior";
  if (/\b(analyst|specialist|engineer|consultant|associate)\b/.test(p)) return "Mid";
  return null;
}

async function run() {
  console.log("📂 Reading JSON files...");
  const companiesRaw: Record<string, unknown>[] = JSON.parse(fs.readFileSync(COMPANIES_FILE, "utf-8"));
  const executivesRaw: Record<string, unknown>[] = JSON.parse(fs.readFileSync(EXECUTIVES_FILE, "utf-8"));
  console.log(`   Found ${companiesRaw.length.toLocaleString()} companies, ${executivesRaw.length.toLocaleString()} executives`);

  console.log("\n🗑️  Clearing existing curated data...");
  await db.execute(sql`DELETE FROM executives`);
  await db.execute(sql`DELETE FROM companies`);
  await db.execute(sql`ALTER SEQUENCE companies_id_seq RESTART WITH 1`);
  await db.execute(sql`ALTER SEQUENCE executives_id_seq RESTART WITH 1`);
  console.log("   ✓ Tables cleared");

  const uuidToIntId = new Map<string, number>();

  console.log("\n🏢 Inserting companies...");
  for (let i = 0; i < companiesRaw.length; i += BATCH) {
    const batch = companiesRaw.slice(i, i + BATCH);
    const values = batch.map((c) => ({
      nameEn: String(c.name || ""),
      nameAr: c.arabicName ? String(c.arabicName) : null,
      description: c.aiInsights ? String(c.aiInsights) : (c.description ? String(c.description) : null),
      industry: c.industry ? String(c.industry) : null,
      city: c.city ? String(c.city) : null,
      country: "Saudi Arabia",
      website: c.website ? String(c.website) : null,
      phone: c.phone ? String(c.phone) : null,
      email: c.contactEmail ? String(c.contactEmail) : null,
      employeeCount: parseEmployeeCount(c.employeeCount as string),
      revenue: c.revenue ? String(c.revenue) : null,
      foundingYear: c.yearEstablished ? Number(c.yearEstablished) : null,
      enrichmentStatus: "enriched",
      enrichmentScore: 75,
      dataSource: "meshbase-curated",
      tags: c.subIndustry ? String(c.subIndustry) : null,
    }));
    const inserted = await db.insert(companiesTable).values(values).returning({ id: companiesTable.id });
    batch.forEach((c, j) => {
      const uuid = c.id as string;
      if (uuid && inserted[j]) uuidToIntId.set(uuid, inserted[j].id);
    });
    if (i % 2000 === 0 || i + BATCH >= companiesRaw.length) {
      const pct = Math.min(100, Math.round(((i + BATCH) / companiesRaw.length) * 100));
      process.stdout.write(`\r   ${i + Math.min(BATCH, companiesRaw.length - i).toLocaleString()} / ${companiesRaw.length.toLocaleString()} (${pct}%)`);
    }
  }
  console.log(`\n   ✓ ${uuidToIntId.size.toLocaleString()} companies inserted`);

  console.log("\n👤 Inserting executives...");
  let execCount = 0;
  let skipped = 0;
  for (let i = 0; i < executivesRaw.length; i += BATCH) {
    const batch = executivesRaw.slice(i, i + BATCH);
    const values = batch.map((e) => {
      const uuid = e.companyId as string;
      const intId = uuid ? uuidToIntId.get(uuid) ?? null : null;
      if (!intId) skipped++;
      const pos = e.position ? String(e.position) : null;
      return {
        companyId: intId,
        companyName: e.companyName ? String(e.companyName) : null,
        name: String(e.name || ""),
        nameAr: e.arabicName ? String(e.arabicName) : null,
        position: pos,
        email: e.email ? String(e.email) : null,
        phone: e.phone ? String(e.phone) : null,
        linkedin: e.linkedIn ? String(e.linkedIn) : null,
        biography: e.bio ? String(e.bio) : null,
        education: e.education ? String(e.education) : null,
        seniorityLevel: inferSeniority(pos),
        enrichmentStatus: "enriched",
        dataSource: "meshbase-curated",
      };
    });
    await db.insert(executivesTable).values(values);
    execCount += values.length;
    if (i % 5000 === 0 || i + BATCH >= executivesRaw.length) {
      const pct = Math.min(100, Math.round(((i + BATCH) / executivesRaw.length) * 100));
      process.stdout.write(`\r   ${execCount.toLocaleString()} / ${executivesRaw.length.toLocaleString()} (${pct}%)`);
    }
  }
  console.log(`\n   ✓ ${execCount.toLocaleString()} executives inserted (${skipped} with unmapped company)`);

  console.log("\n✅ MeshBase seed complete!");
  const [cCount] = await db.execute(sql`SELECT COUNT(*) FROM companies`);
  const [eCount] = await db.execute(sql`SELECT COUNT(*) FROM executives`);
  console.log(`   companies table: ${(cCount as Record<string, unknown>).count} rows`);
  console.log(`   executives table: ${(eCount as Record<string, unknown>).count} rows`);
}

run().catch((e) => { console.error("\n❌ Seed failed:", e); process.exit(1); }).finally(() => pool.end());
