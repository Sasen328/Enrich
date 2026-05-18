import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";
import path from "path";
import { fileURLToPath } from "url";

function seedDir() {
  // import.meta.url is undefined in CJS production bundles — fall back to process.argv[1]
  // (the entry point path: .../dist/index.cjs), then go up one level to seed-data/
  try {
    const u = ((import.meta as any)).url;
    if (typeof u === "string") {
      return path.resolve(path.dirname(fileURLToPath(u)), "../seed-data");
    }
  } catch { /* CJS runtime — import.meta not available */ }
  // CJS fallback: process.argv[1] = /path/to/dist/index.cjs → ../seed-data
  const entryDir = path.dirname(path.resolve(process.argv[1] || process.cwd()));
  return path.resolve(entryDir, "../seed-data");
}

function load<T>(filename: string): T[] {
  const file = path.join(seedDir(), filename);
  const json = gunzipSync(readFileSync(file)).toString("utf8");
  return JSON.parse(json) as T[];
}

function q(v: unknown): string {
  if (v == null) return "NULL";
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
}
function n(v: unknown): string {
  if (v == null) return "NULL";
  const num = Number(v);
  return isNaN(num) ? "NULL" : String(num);
}
function b(v: unknown): string {
  if (v == null) return "NULL";
  return v ? "TRUE" : "FALSE";
}
function arr(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return "NULL";
  const escaped = (v as string[]).map(s => `'${String(s).replace(/'/g, "''")}'`).join(",");
  return `ARRAY[${escaped}]::text[]`;
}
function jsonb(v: unknown): string {
  if (v == null) return "NULL";
  const s = JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'::jsonb`;
}

async function count(table: string): Promise<number> {
  const res = await db.execute<{ count: string }>(sql.raw(`SELECT COUNT(*)::text as count FROM ${table}`));
  const rows = Array.isArray(res) ? res : (res as any).rows ?? [];
  return parseInt(rows[0]?.count ?? "0", 10);
}

async function seedExecutives(): Promise<void> {
  const execs = load<any>("meshbase_executives.json.gz");
  console.log(`[Seed] Inserting ${execs.length} executives...`);
  await db.execute(sql.raw(`TRUNCATE TABLE executives RESTART IDENTITY`));
  const BATCH = 50;
  for (let i = 0; i < execs.length; i += BATCH) {
    const batch = execs.slice(i, i + BATCH);
    const vals = batch.map((e: any) =>
      `(${e.id}, ${n(e.company_id)}, ${q(e.name)}, ${q(e.name_ar)},
        ${q(e.position)}, ${q(e.position_ar)}, ${q(e.email)}, ${q(e.linkedin)},
        ${q(e.linkedin_url)}, ${q(e.phone)}, ${q(e.location)}, ${q(e.biography)},
        ${q(e.salary)}, ${b(e.is_featured)}, ${q(e.company_name)}, ${q(e.education)},
        ${q(e.seniority_level)}, ${q(e.department)}, ${q(e.apollo_id)},
        ${q(e.enrichment_status ?? "pending")}, ${q(e.data_source)}, ${q(e.photo_url)},
        ${n(e.years_of_experience)}, ${n(e.estimated_salary)}, ${arr(e.skills)})`
    ).join(",\n");
    await db.execute(sql.raw(`
      INSERT INTO executives (id, company_id, name, name_ar, position, position_ar, email,
        linkedin, linkedin_url, phone, location, biography, salary, is_featured, company_name,
        education, seniority_level, department, apollo_id, enrichment_status, data_source,
        photo_url, years_of_experience, estimated_salary, skills)
      VALUES ${vals}
      ON CONFLICT (id) DO NOTHING
    `));
    process.stdout.write(`\r[Seed] Executives: ${Math.min(i + BATCH, execs.length)}/${execs.length}`);
  }
  await db.execute(sql.raw(`SELECT setval('executives_id_seq', (SELECT MAX(id) FROM executives))`));
  console.log(`\n[Seed] Executives done.`);
}

async function seedMasarCompanies(): Promise<void> {
  const companies = load<any>("masar_companies.json.gz");
  console.log(`[Seed] Inserting ${companies.length} Masar companies...`);
  await db.execute(sql.raw(`TRUNCATE TABLE masar_companies RESTART IDENTITY`));
  const BATCH = 20;
  for (let i = 0; i < companies.length; i += BATCH) {
    const batch = companies.slice(i, i + BATCH);
    const vals = batch.map((m: any) =>
      `(${m.id}, ${q(m.name_en)}, ${q(m.name_ar)}, ${q(m.cr_number)}, ${q(m.legal_form)},
        ${q(m.legal_form_ar)}, ${q(m.city)}, ${q(m.city_ar)}, ${q(m.region)},
        ${q(m.paid_up_capital)}, ${q(m.authorized_capital)}, ${q(m.founding_date)},
        ${q(m.founding_year)}, ${q(m.registration_date)}, ${q(m.expiry_date)},
        ${q(m.authorized_signatory)}, ${jsonb(m.shareholders)}, ${jsonb(m.board_of_directors)},
        ${jsonb(m.management)}, ${q(m.main_activity)}, ${q(m.main_activity_ar)},
        ${q(m.registration_status)}, ${q(m.source ?? "open-data")}, ${q(m.source_url)},
        ${q(m.enrichment_status ?? "pending")}, ${q(m.website)}, ${q(m.phone)}, ${q(m.email)},
        ${q(m.employee_count)}, ${q(m.revenue_estimate)}, ${q(m.revenue_rationale)},
        ${jsonb(m.news_headlines)}, ${jsonb(m.enrichment_data)},
        ${q(m.analysis_en)}, ${q(m.analysis_ar)}, ${jsonb(m.analysis_data)},
        ${q(m.capital_distribution)}, ${q(m.profit_distribution_rules)})`
    ).join(",\n");
    await db.execute(sql.raw(`
      INSERT INTO masar_companies (id, name_en, name_ar, cr_number, legal_form, legal_form_ar,
        city, city_ar, region, paid_up_capital, authorized_capital, founding_date, founding_year,
        registration_date, expiry_date, authorized_signatory, shareholders, board_of_directors,
        management, main_activity, main_activity_ar, registration_status, source, source_url,
        enrichment_status, website, phone, email, employee_count, revenue_estimate, revenue_rationale,
        news_headlines, enrichment_data, analysis_en, analysis_ar, analysis_data,
        capital_distribution, profit_distribution_rules)
      VALUES ${vals}
      ON CONFLICT (id) DO NOTHING
    `));
    process.stdout.write(`\r[Seed] Masar: ${Math.min(i + BATCH, companies.length)}/${companies.length}`);
  }
  await db.execute(sql.raw(`SELECT setval('masar_companies_id_seq', (SELECT MAX(id) FROM masar_companies))`));
  console.log(`\n[Seed] Masar companies done.`);
}

async function seedBuilderCompanies(): Promise<void> {
  const companies = load<any>("builder_companies.json.gz");
  console.log(`[Seed] Inserting ${companies.length} builder companies...`);
  await db.execute(sql.raw(`TRUNCATE TABLE builder_companies RESTART IDENTITY`));
  const BATCH = 50;
  for (let i = 0; i < companies.length; i += BATCH) {
    const batch = companies.slice(i, i + BATCH);
    const vals = batch.map((c: any) =>
      `(${c.id}, ${q(c.job_id)}, ${q(c.source_id)}, ${q(c.source_name)},
        ${q(c.name_ar)}, ${q(c.name_en)}, ${q(c.industry)}, ${q(c.industry_ar)},
        ${q(c.city)}, ${q(c.region)}, ${q(c.country ?? "Saudi Arabia")},
        ${q(c.website)}, ${q(c.phone)}, ${q(c.email)}, ${q(c.description)}, ${q(c.description_ar)},
        ${n(c.employee_count)}, ${q(c.revenue)}, ${n(c.founding_year)},
        ${q(c.cr_number)}, ${q(c.capital_amount)}, ${q(c.entity_type)}, ${q(c.company_type)},
        ${q(c.owner_name)}, ${q(c.owner_name_ar)}, ${q(c.owner_title)},
        ${q(c.owner_phone)}, ${q(c.owner_email)}, ${q(c.owner_linkedin)},
        ${q(c.estimated_wealth)}, ${q(c.shareholders)}, ${q(c.key_executives)},
        ${q(c.market_positioning)}, ${q(c.recent_news)}, ${q(c.linkedin_url)},
        ${n(c.enrichment_score)}, ${q(c.enrichment_status)},
        ${b(c.is_duplicate)}, ${b(c.is_validated)})`
    ).join(",\n");
    await db.execute(sql.raw(`
      INSERT INTO builder_companies (id, job_id, source_id, source_name, name_ar, name_en,
        industry, industry_ar, city, region, country, website, phone, email, description,
        description_ar, employee_count, revenue, founding_year, cr_number, capital_amount,
        entity_type, company_type, owner_name, owner_name_ar, owner_title, owner_phone,
        owner_email, owner_linkedin, estimated_wealth, shareholders, key_executives,
        market_positioning, recent_news, linkedin_url, enrichment_score, enrichment_status,
        is_duplicate, is_validated)
      VALUES ${vals}
      ON CONFLICT (id) DO NOTHING
    `));
    process.stdout.write(`\r[Seed] Builder: ${Math.min(i + BATCH, companies.length)}/${companies.length}`);
  }
  await db.execute(sql.raw(`SELECT setval('builder_companies_id_seq', (SELECT MAX(id) FROM builder_companies))`));
  console.log(`\n[Seed] Builder companies done.`);
}

async function seedBuilderJobs(): Promise<void> {
  const jobs = load<any>("builder_jobs.json.gz");
  console.log(`[Seed] Inserting ${jobs.length} builder jobs...`);
  await db.execute(sql.raw(`TRUNCATE TABLE builder_jobs RESTART IDENTITY`));
  if (jobs.length === 0) return;
  const vals = jobs.map((j: any) =>
    `(${j.id}, ${q(j.legacy_job_id)}, ${q(j.status ?? "completed")}, ${n(j.source_index ?? 0)},
      ${q(j.log)}, ${n(j.companies_found ?? 0)}, ${n(j.companies_added ?? 0)},
      ${n(j.companies_duplicate ?? 0)}, ${j.started_at ? q(j.started_at) : "NULL"},
      ${j.completed_at ? q(j.completed_at) : "NULL"})`
  ).join(",\n");
  await db.execute(sql.raw(`
    INSERT INTO builder_jobs (id, legacy_job_id, status, source_index, log, companies_found,
      companies_added, companies_duplicate, started_at, completed_at)
    VALUES ${vals}
    ON CONFLICT (id) DO NOTHING
  `));
  await db.execute(sql.raw(`SELECT setval('builder_jobs_id_seq', (SELECT MAX(id) FROM builder_jobs))`));
  console.log(`[Seed] Builder jobs done.`);
}

export async function seedMeshbaseIfEmpty(): Promise<void> {
  try {
    const [execCount, masarCount, builderCount] = await Promise.all([
      count("executives"),
      count("masar_companies"),
      count("builder_companies"),
    ]);

    const devExecs = 6942, devMasar = 107, devBuilder = 962;
    const needsExecs = execCount < devExecs * 0.95;
    const needsMasar = masarCount < devMasar * 0.95;
    const needsBuilder = builderCount < devBuilder * 0.95;

    if (!needsExecs && !needsMasar && !needsBuilder) {
      console.log(`[Seed] All tables populated. executives=${execCount}, masar=${masarCount}, builder=${builderCount}`);
      return;
    }

    console.log(`[Seed] Missing data detected — executives=${execCount}, masar=${masarCount}, builder=${builderCount}`);

    if (needsExecs) await seedExecutives();
    if (needsMasar) await seedMasarCompanies();
    if (needsBuilder) {
      await seedBuilderJobs();
      await seedBuilderCompanies();
    }

    const [e2, m2, b2] = await Promise.all([
      count("executives"), count("masar_companies"), count("builder_companies"),
    ]);
    console.log(`[Seed] Complete — executives=${e2}, masar=${m2}, builder=${b2}`);
  } catch (err) {
    console.error("[Seed] Seeding failed:", err);
  }
}
