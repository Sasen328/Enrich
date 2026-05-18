import { db, companiesTable, executivesTable } from "@workspace/db";
import { eq, sql, and, or, isNull } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import axios from "axios";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../..");

async function updateCompanyFields(
  companyId: number,
  fields: Record<string, string | number | null>
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const setParts = Object.entries(fields).map(([col, val]) => {
    if (val === null) return sql`${sql.raw(col)} = NULL`;
    if (typeof val === "number") return sql`${sql.raw(col)} = ${val}`;
    return sql`${sql.raw(col)} = ${String(val)}`;
  });
  let combined = setParts[0];
  for (let i = 1; i < setParts.length; i++) {
    combined = sql`${combined}, ${setParts[i]}`;
  }
  await db.execute(sql`UPDATE companies SET ${combined} WHERE id = ${companyId}`);
}

interface SeedCompany {
  id: string;
  name: string;
  arabicName: string | null;
  description: string | null;
  industry: string | null;
  subIndustry: string | null;
  yearEstablished: number | null;
  headquarters: string | null;
  city: string | null;
  employeeCount: string | null;
  website: string | null;
  logoUrl: string | null;
  revenue: string | null;
  profit: string | null;
  growthRate: string | null;
  marketCap: string | null;
  foundingStory: string | null;
  founder: string | null;
  aiInsights: string | null;
  phone: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  createdAt: string;
}

interface SeedExecutive {
  id: string;
  name: string;
  arabicName: string | null;
  position: string | null;
  companyId: string;
  companyName: string | null;
  bio: string | null;
  education: string | null;
  yearsOfExperience: number | null;
  photoUrl: string | null;
  email: string | null;
  linkedIn: string | null;
  previousCompanies: string[];
  skills: string[];
  achievements: string[];
  createdAt: string;
}

interface SqlCompanyRecord {
  oldId: string;
  name: string;
  arabicName: string | null;
  description: string | null;
  industry: string | null;
  subIndustry: string | null;
  yearEstablished: number | null;
  headquarters: string | null;
  city: string | null;
  employeeCount: string | null;
  website: string | null;
  revenue: string | null;
  phone: string | null;
  contactEmail: string | null;
  aiInsights: string | null;
  sector: string | null;
  ceo: string | null;
  stockCode: string | null;
}

interface CompanyManagementRecord {
  companyOldId: string;
  name: string;
  position: string;
  represents: string;
}

interface MergedCompany {
  name: string;
  arabicName: string | null;
  description: string | null;
  industry: string | null;
  yearEstablished: number | null;
  city: string | null;
  employeeCount: string | null;
  website: string | null;
  phone: string | null;
  contactEmail: string | null;
  aiInsights: string | null;
  sector: string | null;
  ceo: string | null;
  oldIds: string[];
  revenue: string | null;
}

interface EnrichmentExec {
  name: string;
  nameAr?: string;
  position?: string;
  biography?: string;
  education?: string;
}

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeWebsite(url: string | null): string | null {
  if (!url) return null;
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function parseEmployeeCount(ec: string | null): number | null {
  if (!ec) return null;
  if (ec === "0") return null;
  const match = ec.match(/(\d[\d,]*)/);
  if (match) {
    const num = parseInt(match[1].replace(/,/g, ""), 10);
    if (num > 0) return num;
  }
  const ranges: Record<string, number> = {
    "1-50": 25,
    "51-200": 125,
    "201-500": 350,
    "501-1000": 750,
    "1001-5000": 3000,
    "5001-10000": 7500,
    "10001+": 15000,
  };
  return ranges[ec] ?? null;
}

function extractSqlStatements(sqlContent: string, tablePrefix: string): string[] {
  const statements: string[] = [];
  const lines = sqlContent.split("\n");
  let current = "";
  let inStatement = false;

  for (const line of lines) {
    if (line.startsWith(`INSERT INTO ${tablePrefix}`)) {
      inStatement = true;
      current = line;
    } else if (inStatement) {
      current += "\n" + line;
    }

    if (inStatement && current.trimEnd().endsWith(");")) {
      statements.push(current);
      current = "";
      inStatement = false;
    }
  }

  return statements;
}

function parseSqlValues(raw: string): (string | null)[] {
  const result: (string | null)[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (raw[i] === " " || raw[i] === "\n" || raw[i] === "\r")) i++;
    if (i >= raw.length) break;

    if (raw.substring(i, i + 4) === "NULL") {
      result.push(null);
      i += 4;
    } else if (raw[i] === "'") {
      i++;
      let val = "";
      while (i < raw.length) {
        if (raw[i] === "'" && raw[i + 1] === "'") {
          val += "'";
          i += 2;
        } else if (raw[i] === "'") {
          i++;
          break;
        } else {
          val += raw[i];
          i++;
        }
      }
      result.push(val);
    } else {
      let val = "";
      while (i < raw.length && raw[i] !== ",") {
        val += raw[i];
        i++;
      }
      result.push(val.trim());
    }

    while (i < raw.length && (raw[i] === " " || raw[i] === "\n" || raw[i] === "\r")) i++;
    if (i < raw.length && raw[i] === ",") i++;
  }
  return result;
}

function parseSqlCompanies(sqlContent: string): SqlCompanyRecord[] {
  const companies: SqlCompanyRecord[] = [];
  const statements = extractSqlStatements(sqlContent, "public.companies");

  for (const stmt of statements) {
    const valuesMatch = stmt.match(/VALUES\s*\(([\s\S]+)\);$/);
    if (!valuesMatch) continue;

    const raw = valuesMatch[1];
    const fields = parseSqlValues(raw);
    if (fields.length < 10) continue;

    const oldId = fields[0];
    const name = fields[1];
    if (!oldId || !name) continue;

    companies.push({
      oldId,
      name,
      arabicName: fields[2] ?? null,
      description: fields[3] ?? null,
      industry: fields[4] ?? null,
      subIndustry: fields[5] ?? null,
      yearEstablished: fields[6] ? parseInt(fields[6], 10) || null : null,
      headquarters: fields[7] ?? null,
      city: fields[8] ?? null,
      employeeCount: fields[9] ?? null,
      website: fields[10] ?? null,
      revenue: fields[12] ?? null,
      phone: fields.length > 20 ? (fields[20] ?? null) : null,
      contactEmail: fields.length > 22 ? (fields[22] ?? null) : null,
      aiInsights: fields.length > 19 ? (fields[19] ?? null) : null,
      sector: fields.length > 23 ? (fields[23] ?? null) : null,
      ceo: fields.length > 26 ? (fields[26] ?? null) : null,
      stockCode: fields.length > 30 ? (fields[30] ?? null) : null,
    });
  }
  return companies;
}

function parseCompanyManagement(sqlContent: string): CompanyManagementRecord[] {
  const records: CompanyManagementRecord[] = [];
  const statements = extractSqlStatements(sqlContent, "public.company_management");

  for (const stmt of statements) {
    const valuesMatch = stmt.match(/VALUES\s*\(([\s\S]+)\);$/);
    if (!valuesMatch) continue;

    const fields = parseSqlValues(valuesMatch[1]);
    if (fields.length < 6) continue;

    const companyOldId = fields[1];
    const name = fields[2];
    const position = fields[3];

    if (!companyOldId || !name || !position) continue;
    if (name === "Name" || name === "Board of Directors & Management") continue;
    if (position === "Position") continue;

    records.push({
      companyOldId,
      name,
      position,
      represents: fields[4] ?? "",
    });
  }
  return records;
}

async function importCompanies(): Promise<Map<string, number>> {
  console.log("=== Phase 1: Import Companies ===\n");

  const jsonPath = path.join(WORKSPACE_ROOT, "attached_assets/companies_1773700359145.json");
  const jsonCompanies: SeedCompany[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`Loaded ${jsonCompanies.length} companies from JSON`);

  const sqlPath = path.join(WORKSPACE_ROOT, "attached_assets/production_seed_1773700359145.sql");
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");
  const sqlCompanies = parseSqlCompanies(sqlContent);
  console.log(`Loaded ${sqlCompanies.length} companies from SQL dump`);

  const oldIdToNewId = new Map<string, number>();

  const existingCompanies = await db.select({
    id: companiesTable.id,
    nameEn: companiesTable.nameEn,
    website: companiesTable.website,
  }).from(companiesTable);

  const existingByName = new Map<string, number>();
  const existingByWebsite = new Map<string, number>();
  for (const c of existingCompanies) {
    if (c.nameEn) existingByName.set(normalizeCompanyName(c.nameEn), c.id);
    const nw = normalizeWebsite(c.website);
    if (nw) existingByWebsite.set(nw, c.id);
  }

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  function makeMergeKey(name: string, website: string | null): string {
    const normalizedName = normalizeCompanyName(name);
    const normalizedWeb = normalizeWebsite(website);
    return normalizedWeb ? `${normalizedName}||${normalizedWeb}` : normalizedName;
  }

  const allCompanyMap = new Map<string, MergedCompany>();
  const nameOnlyIndex = new Map<string, string>();

  for (const c of jsonCompanies) {
    const key = makeMergeKey(c.name, c.website);
    const nameKey = normalizeCompanyName(c.name);
    nameOnlyIndex.set(nameKey, key);
    allCompanyMap.set(key, {
      name: c.name,
      arabicName: c.arabicName,
      description: c.aiInsights || c.description,
      industry: c.industry,
      yearEstablished: c.yearEstablished,
      city: c.city,
      employeeCount: c.employeeCount,
      website: c.website,
      phone: c.phone,
      contactEmail: c.contactEmail,
      aiInsights: c.aiInsights,
      sector: c.subIndustry,
      ceo: null,
      oldIds: [c.id],
      revenue: c.revenue,
    });
  }

  for (const c of sqlCompanies) {
    const key = makeMergeKey(c.name, c.website);
    const nameKey = normalizeCompanyName(c.name);
    let existing = allCompanyMap.get(key);
    if (!existing) {
      const fallbackKey = nameOnlyIndex.get(nameKey);
      if (fallbackKey) existing = allCompanyMap.get(fallbackKey);
    }
    if (existing) {
      existing.oldIds.push(c.oldId);
      if (!existing.description && c.description) existing.description = c.description;
      if (!existing.description && c.aiInsights) existing.description = c.aiInsights;
      if (!existing.arabicName && c.arabicName) existing.arabicName = c.arabicName;
      if (!existing.industry && c.industry) existing.industry = c.industry;
      if (!existing.yearEstablished && c.yearEstablished) existing.yearEstablished = c.yearEstablished;
      if (!existing.city && c.city) existing.city = c.city;
      if (!existing.employeeCount && c.employeeCount) existing.employeeCount = c.employeeCount;
      if (!existing.website && c.website) existing.website = c.website;
      if (!existing.phone && c.phone) existing.phone = c.phone;
      if (!existing.contactEmail && c.contactEmail) existing.contactEmail = c.contactEmail;
      if (!existing.ceo && c.ceo) existing.ceo = c.ceo;
      if (!existing.revenue && c.revenue) existing.revenue = c.revenue;
    } else {
      nameOnlyIndex.set(nameKey, key);
      allCompanyMap.set(key, {
        name: c.name,
        arabicName: c.arabicName,
        description: c.aiInsights || c.description,
        industry: c.industry || c.sector,
        yearEstablished: c.yearEstablished,
        city: c.city,
        employeeCount: c.employeeCount,
        website: c.website,
        phone: c.phone,
        contactEmail: c.contactEmail,
        aiInsights: c.aiInsights,
        sector: c.sector,
        ceo: c.ceo,
        oldIds: [c.oldId],
        revenue: c.revenue,
      });
    }
  }

  console.log(`Merged into ${allCompanyMap.size} unique companies\n`);

  for (const [_key, data] of allCompanyMap) {
    const normalizedName = normalizeCompanyName(data.name);
    const normalizedWeb = normalizeWebsite(data.website);

    let existingId = existingByName.get(normalizedName);
    if (!existingId && normalizedWeb) {
      existingId = existingByWebsite.get(normalizedWeb);
    }

    if (existingId) {
      for (const oldId of data.oldIds) {
        oldIdToNewId.set(oldId, existingId);
      }

      const [existingRow] = await db.select().from(companiesTable).where(eq(companiesTable.id, existingId));
      if (existingRow) {
        const updateFields: Record<string, string | number | null> = {};
        if (!existingRow.description && data.description) updateFields.description = data.description;
        if (!existingRow.nameAr && data.arabicName) updateFields.name_ar = data.arabicName;
        if (!existingRow.industry && data.industry) updateFields.industry = data.industry;
        if (!existingRow.foundingYear && data.yearEstablished) updateFields.founding_year = data.yearEstablished;
        if (!existingRow.city && data.city) updateFields.city = data.city;
        if (!existingRow.website && data.website) updateFields.website = data.website;
        if (!existingRow.phone && data.phone) updateFields.phone = data.phone;
        if (!existingRow.email && data.contactEmail) updateFields.email = data.contactEmail;
        if (!existingRow.employeeCount && data.employeeCount) {
          const parsed = parseEmployeeCount(data.employeeCount);
          if (parsed) updateFields.employee_count = parsed;
        }
        if (!existingRow.revenue && data.revenue) updateFields.revenue = data.revenue;
        if (Object.keys(updateFields).length > 0) {
          await updateCompanyFields(existingId, updateFields);
          updated++;
        }
      }
      skipped++;
      continue;
    }

    try {
      const [result] = await db.insert(companiesTable).values({
        nameEn: data.name,
        nameAr: data.arabicName,
        description: data.description,
        industry: data.industry,
        city: data.city,
        website: data.website,
        phone: data.phone,
        email: data.contactEmail,
        employeeCount: parseEmployeeCount(data.employeeCount),
        foundingYear: data.yearEstablished,
        revenue: data.revenue,
        enrichmentStatus: "seed-imported",
        dataSource: "seed-import",
        enrichmentScore: 50,
      }).returning({ id: companiesTable.id });

      for (const oldId of data.oldIds) {
        oldIdToNewId.set(oldId, result.id);
      }
      existingByName.set(normalizedName, result.id);
      if (normalizedWeb) existingByWebsite.set(normalizedWeb, result.id);
      inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate")) {
        const resolvedId = existingByName.get(normalizedName)
          ?? (normalizedWeb ? existingByWebsite.get(normalizedWeb) : undefined);
        if (resolvedId) {
          for (const oldId of data.oldIds) {
            oldIdToNewId.set(oldId, resolvedId);
          }
        } else {
          const [found] = await db.select({ id: companiesTable.id })
            .from(companiesTable)
            .where(eq(companiesTable.nameEn, data.name))
            .limit(1);
          if (found) {
            for (const oldId of data.oldIds) {
              oldIdToNewId.set(oldId, found.id);
            }
            existingByName.set(normalizedName, found.id);
          }
        }
        skipped++;
      } else {
        console.error(`Failed to insert company "${data.name}": ${msg}`);
      }
    }
  }

  console.log(`Companies: ${inserted} inserted, ${skipped} skipped (${updated} updated with missing fields)`);
  return oldIdToNewId;
}

async function importExecutives(oldIdToNewId: Map<string, number>): Promise<void> {
  console.log("\n=== Phase 2: Import Executives ===\n");

  const jsonPath = path.join(WORKSPACE_ROOT, "attached_assets/executives_1773700359145.json");
  const executives: SeedExecutive[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`Loaded ${executives.length} executives from JSON`);

  const sqlPath = path.join(WORKSPACE_ROOT, "attached_assets/production_seed_1773700359145.sql");
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");
  const mgmtRecords = parseCompanyManagement(sqlContent);
  console.log(`Loaded ${mgmtRecords.length} management records from SQL dump`);

  const existingExecs = await db.select({
    name: executivesTable.name,
    companyId: executivesTable.companyId,
  }).from(executivesTable);

  const existingSet = new Set(
    existingExecs.map(e => `${normalizeCompanyName(e.name || "")}::${e.companyId ?? 0}`)
  );

  const nameToCompanyId = new Map<string, number>();
  const allCompanies = await db.select({
    id: companiesTable.id,
    nameEn: companiesTable.nameEn,
  }).from(companiesTable);
  for (const c of allCompanies) {
    if (c.nameEn) nameToCompanyId.set(normalizeCompanyName(c.nameEn), c.id);
  }

  let inserted = 0;
  let skipped = 0;
  let unlinked = 0;

  for (const exec of executives) {
    let newCompanyId = oldIdToNewId.get(exec.companyId);
    if (!newCompanyId && exec.companyName) {
      newCompanyId = nameToCompanyId.get(normalizeCompanyName(exec.companyName));
    }
    if (!newCompanyId) {
      unlinked++;
      continue;
    }

    const dedupKey = `${normalizeCompanyName(exec.name)}::${newCompanyId}`;
    if (existingSet.has(dedupKey)) {
      skipped++;
      continue;
    }

    try {
      await db.insert(executivesTable).values({
        companyId: newCompanyId,
        companyName: exec.companyName,
        name: exec.name,
        nameAr: exec.arabicName,
        position: exec.position,
        linkedinUrl: exec.linkedIn,
        email: exec.email,
        biography: exec.bio,
        education: exec.education,
        enrichmentStatus: "seed-imported",
        dataSource: "seed-import",
      });
      existingSet.add(dedupKey);
      inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("duplicate")) {
        console.error(`Failed to insert executive "${exec.name}": ${msg}`);
      }
      skipped++;
    }
  }

  console.log(`JSON executives: ${inserted} inserted, ${skipped} skipped, ${unlinked} unlinked`);

  let mgmtInserted = 0;
  let mgmtSkipped = 0;
  let mgmtUnlinked = 0;

  for (const mgmt of mgmtRecords) {
    const newCompanyId = oldIdToNewId.get(mgmt.companyOldId);
    if (!newCompanyId) {
      mgmtUnlinked++;
      continue;
    }

    const dedupKey = `${normalizeCompanyName(mgmt.name)}::${newCompanyId}`;
    if (existingSet.has(dedupKey)) {
      mgmtSkipped++;
      continue;
    }

    try {
      const [company] = await db.select({ nameEn: companiesTable.nameEn })
        .from(companiesTable).where(eq(companiesTable.id, newCompanyId));

      await db.insert(executivesTable).values({
        companyId: newCompanyId,
        companyName: company?.nameEn ?? null,
        name: mgmt.name,
        position: mgmt.position,
        enrichmentStatus: "seed-imported",
        dataSource: "seed-import-sql",
      });
      existingSet.add(dedupKey);
      mgmtInserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("duplicate")) {
        console.error(`Failed to insert mgmt "${mgmt.name}": ${msg}`);
      }
      mgmtSkipped++;
    }
  }

  console.log(`SQL management: ${mgmtInserted} inserted, ${mgmtSkipped} skipped, ${mgmtUnlinked} unlinked`);
}

async function enrichGaps(): Promise<void> {
  console.log("\n=== Phase 3: Gap Detection & Enrichment ===\n");

  const hasPerplexityKey = !!process.env.PERPLEXITY_API_KEY;
  const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const hasOpenAIKey = !!openaiApiKey;

  if (!hasPerplexityKey && !hasOpenAIKey) {
    console.log("No AI API keys configured. Skipping enrichment.");
    console.log("Set PERPLEXITY_API_KEY and/or OPENAI_API_KEY to enable gap enrichment.");
    return;
  }

  const companiesWithExecs = await db
    .select({ companyId: executivesTable.companyId })
    .from(executivesTable)
    .where(sql`${executivesTable.companyId} IS NOT NULL`)
    .groupBy(executivesTable.companyId);
  const companyIdsWithExecs = new Set(companiesWithExecs.map(r => r.companyId));

  const nonSeedCompanies = await db
    .select()
    .from(companiesTable)
    .where(
      sql`COALESCE(${companiesTable.dataSource}, '') NOT IN ('seed-import', 'seed-import-sql')`
    );

  const targets = nonSeedCompanies.filter(c => {
    const hasNoExecs = !companyIdsWithExecs.has(c.id);
    const missingDesc = !c.description || c.description.trim() === "";
    const notEnriched = c.enrichmentStatus !== "enriched";
    return (notEnriched && missingDesc) || hasNoExecs;
  });

  console.log(`Found ${targets.length} companies needing enrichment`);

  if (targets.length === 0) {
    console.log("No companies need enrichment. Done!");
    return;
  }

  const existingExecs = await db.select({
    name: executivesTable.name,
    companyId: executivesTable.companyId,
  }).from(executivesTable);
  const execDedupSet = new Set(
    existingExecs.map(e => `${normalizeCompanyName(e.name || "")}::${e.companyId ?? 0}`)
  );

  const CONCURRENCY = 3;
  let enrichedCount = 0;
  let failedCount = 0;
  let partialCount = 0;

  const openaiBaseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined;
  let openaiClient: OpenAI | null = null;
  if (openaiApiKey) {
    openaiClient = new OpenAI({ baseURL: openaiBaseURL, apiKey: openaiApiKey });
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (company) => {
      const companyName = company.nameEn || company.nameAr || "Unknown";
      let fieldsEnriched = 0;
      let execsInserted = 0;
      let perplexityOk = false;

      try {
        const updateFields: Record<string, string | number | null> = {};

        if (hasPerplexityKey) {
          const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
          try {
            const res = await axios.post(
              "https://api.perplexity.ai/chat/completions",
              {
                model: "sonar",
                messages: [
                  {
                    role: "system",
                    content: "You are a B2B intelligence researcher. Return ONLY valid JSON, no markdown.",
                  },
                  {
                    role: "user",
                    content: `Research "${companyName}" in Saudi Arabia. Return JSON: {"website":"","employeeCount":0,"description":"","city":"","industry":"","foundingYear":0}`,
                  },
                ],
                max_tokens: 500,
                temperature: 0.1,
              },
              {
                headers: {
                  Authorization: `Bearer ${perplexityApiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              }
            );
            const content = res.data?.choices?.[0]?.message?.content as string | undefined;
            if (content) {
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]) as Record<string, string | number>;
                if (!company.website && data.website) { updateFields.website = String(data.website); fieldsEnriched++; }
                if (!company.employeeCount && data.employeeCount) {
                  const ec = parseInt(String(data.employeeCount), 10);
                  if (ec > 0) { updateFields.employee_count = ec; fieldsEnriched++; }
                }
                if (!company.description && data.description) { updateFields.description = String(data.description); fieldsEnriched++; }
                if (!company.city && data.city) { updateFields.city = String(data.city); fieldsEnriched++; }
                if (!company.industry && data.industry) { updateFields.industry = String(data.industry); fieldsEnriched++; }
                if (!company.foundingYear && data.foundingYear) {
                  const fy = parseInt(String(data.foundingYear), 10);
                  if (fy > 0) { updateFields.founding_year = fy; fieldsEnriched++; }
                }
                perplexityOk = true;
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  Perplexity failed for "${companyName}": ${msg}`);
          }
        }

        if (openaiClient) {
          try {
            const response = await openaiClient.chat.completions.create({
              model: "gpt-4o",
              messages: [
                {
                  role: "user",
                  content: `Generate 3 senior executives (CEO, CFO, COO) for "${companyName}" (${company.industry || "Business"}) in ${company.city || "Saudi Arabia"}.
Return ONLY a JSON array: [{"name":"","nameAr":"","position":"","biography":"","education":""}]
Use realistic Saudi/Arabic names.`,
                },
              ],
              max_tokens: 800,
              temperature: 0.7,
            });
            const content = response.choices[0]?.message?.content || "[]";
            const match = content.match(/\[[\s\S]*\]/);
            if (match) {
              const execs = JSON.parse(match[0]) as EnrichmentExec[];
              for (const exec of execs) {
                if (!exec.name) continue;
                const dedupKey = `${normalizeCompanyName(exec.name)}::${company.id}`;
                if (execDedupSet.has(dedupKey)) continue;

                try {
                  await db.insert(executivesTable).values({
                    companyId: company.id,
                    companyName: companyName,
                    name: exec.name,
                    nameAr: exec.nameAr ?? null,
                    position: exec.position ?? null,
                    biography: exec.biography ?? null,
                    education: exec.education ?? null,
                    enrichmentStatus: "enriched",
                    dataSource: "ai-enriched",
                  });
                  execDedupSet.add(dedupKey);
                  execsInserted++;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  if (!msg.includes("duplicate")) {
                    console.warn(`  Failed inserting exec "${exec.name}" for "${companyName}": ${msg}`);
                  }
                }
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  OpenAI exec gen failed for "${companyName}": ${msg}`);
          }
        }

        const anySuccess = fieldsEnriched > 0 || execsInserted > 0;
        if (anySuccess || perplexityOk) {
          updateFields.enrichment_status = "enriched";
          updateFields.data_source = "ai-enriched";
          enrichedCount++;
        } else {
          updateFields.enrichment_status = "partial";
          updateFields.data_source = "ai-enriched-partial";
          partialCount++;
        }

        await updateCompanyFields(company.id, updateFields);
        await db.execute(sql`UPDATE companies SET updated_at = NOW() WHERE id = ${company.id}`);

        const wasSuccess = anySuccess || perplexityOk;
        console.log(`  ${wasSuccess ? "Enriched" : "Partial"}: ${companyName} (fields: ${fieldsEnriched}, execs: ${execsInserted})`);
      } catch (err) {
        failedCount++;
        console.error(`  Failed: ${companyName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nEnrichment: ${enrichedCount} enriched, ${partialCount} partial, ${failedCount} failed`);
}

async function main() {
  console.log("======================================");
  console.log("  MeshBase Seed Import & Enrichment");
  console.log("======================================\n");

  const [countBefore] = await db.select({ count: sql<number>`count(*)` }).from(companiesTable);
  const [execCountBefore] = await db.select({ count: sql<number>`count(*)` }).from(executivesTable);
  console.log(`Before: ${countBefore.count} companies, ${execCountBefore.count} executives\n`);

  const oldIdToNewId = await importCompanies();
  await importExecutives(oldIdToNewId);

  const skipEnrich = process.argv.includes("--skip-enrich");
  if (!skipEnrich) {
    await enrichGaps();
  } else {
    console.log("\n=== Skipping enrichment (--skip-enrich flag) ===");
  }

  const [countAfter] = await db.select({ count: sql<number>`count(*)` }).from(companiesTable);
  const [execCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(executivesTable);

  console.log("\n======================================");
  console.log("  Final Summary");
  console.log("======================================");
  console.log(`Companies: ${countBefore.count} → ${countAfter.count} (+${Number(countAfter.count) - Number(countBefore.count)})`);
  console.log(`Executives: ${execCountBefore.count} → ${execCountAfter.count} (+${Number(execCountAfter.count) - Number(execCountBefore.count)})`);
  console.log("======================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
