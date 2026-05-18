/**
 * Seed Import: loads attached_assets/companies_1773700359145.json and
 * attached_assets/executives_1773700359145.json into the live ProspectSA DB.
 *
 * Run:  node scripts/run-seed-import.mjs
 */

import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── helpers ───────────────────────────────────────────────────────────────

function fmtRevenue(raw) {
  const n = parseFloat(raw);
  if (!n || isNaN(n)) return null;
  if (n >= 1_000_000_000) return `SAR ${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `SAR ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `SAR ${(n / 1_000).toFixed(0)}K`;
  return `SAR ${n.toFixed(0)}`;
}

function parseEmployeeCount(s) {
  if (!s) return null;
  const clean = String(s).replace(/,/g, "");
  // "1001-5000" → take lower bound
  const match = clean.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return null;
}

function normalise(str) {
  return (str || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    // ── load seed files ──────────────────────────────────────────────
    const companiesRaw = JSON.parse(
      readFileSync(resolve("attached_assets/companies_1773700359145.json"), "utf8")
    );
    const executivesRaw = JSON.parse(
      readFileSync(resolve("attached_assets/executives_1773700359145.json"), "utf8")
    );

    console.log(`Loaded ${companiesRaw.length} companies, ${executivesRaw.length} executives`);

    // ── STEP 1: Companies ────────────────────────────────────────────
    console.log("\n=== STEP 1: Importing Companies ===");
    const oldIdToNewId = new Map(); // old UUID → new integer id
    let inserted = 0, updated = 0, skipped = 0;

    for (const c of companiesRaw) {
      const nameEn = (c.name || "").trim();
      if (!nameEn) { skipped++; continue; }

      const description      = (c.description && !c.description.startsWith("A ") ? c.description.trim() : null)
                               || (c.aiInsights || "").trim() || null;
      const marketPositioning = (c.aiInsights || "").trim() || null;
      const revenue           = c.revenue ? fmtRevenue(c.revenue) : null;
      const city              = (c.city || "").trim() || null;
      const region            = c.headquarters ? c.headquarters.split(",")[0].trim() : null;
      const employeeCount     = parseEmployeeCount(c.employeeCount);
      const foundingYear      = c.yearEstablished ? parseInt(c.yearEstablished) : null;

      // Dedup check
      const existing = await client.query(
        `SELECT id FROM companies WHERE LOWER(TRIM(name_en)) = $1 LIMIT 1`,
        [normalise(nameEn)]
      );

      if (existing.rows.length > 0) {
        const dbId = existing.rows[0].id;
        oldIdToNewId.set(c.id, dbId);
        await client.query(`
          UPDATE companies SET
            name_ar            = COALESCE(name_ar, $2),
            description        = COALESCE(NULLIF(description,''), $3),
            industry           = COALESCE(NULLIF(industry,''), $4),
            city               = COALESCE(NULLIF(city,''), $5),
            region             = COALESCE(NULLIF(region,''), $6),
            website            = COALESCE(NULLIF(website,''), $7),
            employee_count     = COALESCE(employee_count, $8),
            revenue            = COALESCE(NULLIF(revenue,''), $9),
            founding_year      = COALESCE(founding_year, $10),
            phone              = COALESCE(NULLIF(phone,''), $11),
            email              = COALESCE(NULLIF(email,''), $12),
            owner_name         = COALESCE(NULLIF(owner_name,''), $13),
            market_positioning = COALESCE(NULLIF(market_positioning,''), $14),
            updated_at         = NOW()
          WHERE id = $1
        `, [dbId, c.arabicName||null, description, c.industry||null, city, region,
            c.website||null, employeeCount, revenue, foundingYear,
            c.phone||null, c.contactEmail||null, c.founder||null, marketPositioning]);
        updated++;
      } else {
        const res = await client.query(`
          INSERT INTO companies (
            name_en, name_ar, description, industry, city, region,
            website, employee_count, revenue, founding_year, phone, email,
            owner_name, market_positioning, country,
            enrichment_score, enrichment_status, data_source,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
            'Saudi Arabia', 60, 'partial', 'seed-import', NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [nameEn, c.arabicName||null, description, c.industry||null, city, region,
            c.website||null, employeeCount, revenue, foundingYear,
            c.phone||null, c.contactEmail||null, c.founder||null, marketPositioning]);

        if (res.rows.length > 0) {
          oldIdToNewId.set(c.id, res.rows[0].id);
          inserted++;
        } else {
          // Find the row that conflicted
          const found = await client.query(
            `SELECT id FROM companies WHERE LOWER(TRIM(name_en)) = $1 LIMIT 1`,
            [normalise(nameEn)]
          );
          if (found.rows.length > 0) oldIdToNewId.set(c.id, found.rows[0].id);
          skipped++;
        }
      }

      if ((inserted + updated + skipped) % 100 === 0) {
        process.stdout.write(`  ${inserted} inserted, ${updated} updated, ${skipped} skipped\r`);
      }
    }
    console.log(`\n✓ Companies: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
    console.log(`  ID map: ${oldIdToNewId.size} entries`);

    // ── STEP 2: Executives ───────────────────────────────────────────
    console.log("\n=== STEP 2: Importing Executives ===");
    let exInserted = 0, exSkipped = 0;

    for (const e of executivesRaw) {
      const name = (e.name || "").trim();
      if (!name) { exSkipped++; continue; }

      // Resolve company
      let companyId = oldIdToNewId.get(e.companyId) || null;
      if (!companyId && e.companyName) {
        const found = await client.query(
          `SELECT id FROM companies WHERE LOWER(TRIM(name_en)) = $1 LIMIT 1`,
          [normalise(e.companyName)]
        );
        if (found.rows.length > 0) companyId = found.rows[0].id;
      }

      // Dedup: same name + position + companyId
      const dedup = await client.query(
        `SELECT id FROM executives
         WHERE LOWER(TRIM(name)) = $1
           AND (company_id = $2 OR ($2 IS NULL AND company_id IS NULL))
         LIMIT 1`,
        [normalise(name), companyId]
      );
      if (dedup.rows.length > 0) { exSkipped++; continue; }

      // Infer seniority
      const pos = (e.position || "").toLowerCase();
      let seniority = "Mid";
      if (/\b(ceo|cto|cfo|coo|cso|chief|president|chairman|founder)\b/.test(pos)) seniority = "C-Level";
      else if (/\b(vp|vice president|svp|evp|group head)\b/.test(pos)) seniority = "VP";
      else if (/\b(director|head of|managing director)\b/.test(pos)) seniority = "Director";
      else if (/\b(senior|sr\.?|lead)\b/.test(pos)) seniority = "Senior";
      else if (/\b(manager|mgr)\b/.test(pos)) seniority = "Manager";

      await client.query(`
        INSERT INTO executives (
          name, name_ar, position, company_id, company_name,
          biography, education, email, linkedin, linkedin_url,
          seniority_level, data_source, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,'seed-import',NOW(),NOW()
        )
        ON CONFLICT DO NOTHING
      `, [
        name,
        e.arabicName || null,
        e.position   || null,
        companyId,
        e.companyName || null,
        e.bio         || null,
        e.education   || null,
        e.email       || null,
        e.linkedIn    || null,
        seniority,
      ]);
      exInserted++;

      if ((exInserted + exSkipped) % 500 === 0) {
        process.stdout.write(`  ${exInserted} inserted, ${exSkipped} skipped\r`);
      }
    }
    console.log(`\n✓ Executives: ${exInserted} inserted, ${exSkipped} skipped`);

    // ── Final counts ─────────────────────────────────────────────────
    const totals = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM companies)  AS companies,
         (SELECT COUNT(*) FROM executives) AS executives`
    );
    const row = totals.rows[0];
    console.log(`\n🎉 Done! DB now has: ${row.companies} companies, ${row.executives} executives`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\n❌ Import failed:", err.message, err.stack);
  process.exit(1);
});
