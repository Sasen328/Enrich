import { v4 as uuidv4 } from "uuid";
import { db, builderCompaniesTable, builderJobsTable, companiesTable } from "@workspace/db";
import { eq, desc, ilike, and, sql, ne, isNull, or, lt } from "drizzle-orm";
import { SAUDI_DATA_SOURCES } from "./data-sources.js";
import { enrichCompanyWithAI, harvestSourceWithAI } from "./enrichment-engine.js";
import { isBlocked } from "./blocklist.js";
import { fetchWikidataSaudiCompanies, validateAndCleanData } from "./scraper.js";
import { bluepagesApiScan } from "./bluepages-scraper.js";

const EXPLORIUM_API_KEY = () => process.env.EXPLORIUM_API_KEY || null;

// ─── Saudi industries for varied AI fallback harvesting ───────────────────────
const SAUDI_SECTORS = [
  "construction & real estate", "oil & gas services", "petrochemicals",
  "food & beverage manufacturing", "retail & trading", "healthcare & pharmaceuticals",
  "logistics & transportation", "technology & IT services", "financial services & banking",
  "education & training", "hospitality & tourism", "agriculture & food processing",
  "media & advertising", "engineering & industrial services", "cleaning & facilities management",
  "automotive dealerships", "telecommunications", "security & safety services",
  "interior design & furniture", "printing & packaging",
];

/**
 * Harvest real companies from BluPages using the JSON API.
 * Each call can target a different city or keyword to expand coverage.
 */
async function harvestBluepagesForBuilder(
  targetCount = 300,
  city?: string,
  keyword?: string,
): Promise<Array<{ nameAr?: string; nameEn?: string; industry?: string; city?: string; website?: string; phone?: string; email?: string; crNumber?: string }>> {
  const results: Array<{ nameAr?: string; nameEn?: string; industry?: string; city?: string; website?: string; phone?: string; email?: string; crNumber?: string }> = [];
  try {
    for await (const { company } of bluepagesApiScan(keyword, city, undefined, targetCount)) {
      if (company) {
        results.push({
          nameAr:   company.nameAr   || undefined,
          nameEn:   company.nameEn   || undefined,
          industry: company.industry || undefined,
          city:     company.city     || undefined,
          website:  company.website  || undefined,
          phone:    company.phone    || undefined,
          email:    company.email    || undefined,
          crNumber: company.crNumber || undefined,
        });
      }
    }
  } catch (err) {
    console.error("[Builder] BluPages API harvest error:", err);
  }
  console.log(`[Builder] BluPages API returned ${results.length} companies`);
  return results;
}

interface ExploriumCompany {
  company_name?: string;
  company_name_ar?: string;
  industry?: string;
  city?: string;
  website?: string;
  phone?: string;
  email?: string;
  employee_count?: number;
  revenue?: string;
  founding_year?: number;
  cr_number?: string;
  description?: string;
  linkedin_url?: string;
}

async function enrichWithExplorium(companyName: string): Promise<ExploriumCompany | null> {
  const apiKey = EXPLORIUM_API_KEY();
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.explorium.ai/v1/businesses/enrich", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        company_name: companyName,
        country: "Saudi Arabia",
      }),
    });

    if (!response.ok) {
      console.warn(`Explorium API returned ${response.status} for "${companyName}"`);
      return null;
    }

    const data = await response.json() as ExploriumCompany;
    return data;
  } catch (err) {
    console.warn("Explorium enrichment failed:", err);
    return null;
  }
}

function mergeExploriumData(
  existing: Record<string, unknown>,
  explorium: ExploriumCompany
): Record<string, unknown> {
  const merged = { ...existing };
  if (explorium.company_name && !merged.nameEn) merged.nameEn = explorium.company_name;
  if (explorium.company_name_ar && !merged.nameAr) merged.nameAr = explorium.company_name_ar;
  if (explorium.industry && !merged.industry) merged.industry = explorium.industry;
  if (explorium.city && !merged.city) merged.city = explorium.city;
  if (explorium.website && !merged.website) merged.website = explorium.website;
  if (explorium.phone && !merged.phone) merged.phone = explorium.phone;
  if (explorium.email && !merged.email) merged.email = explorium.email;
  if (explorium.employee_count && !merged.employeeCount) merged.employeeCount = explorium.employee_count;
  if (explorium.revenue && !merged.revenue) merged.revenue = explorium.revenue;
  if (explorium.founding_year && !merged.foundingYear) merged.foundingYear = explorium.founding_year;
  if (explorium.cr_number && !merged.crNumber) merged.crNumber = explorium.cr_number;
  if (explorium.description && !merged.description) merged.description = explorium.description;
  if (explorium.linkedin_url && !merged.linkedinUrl) merged.linkedinUrl = explorium.linkedin_url;
  return merged;
}

export async function checkDuplicate(nameEn: string | null, nameAr: string | null, excludeJobId?: string): Promise<boolean> {
  const nameEnKey = (nameEn || "").toLowerCase().trim();
  const nameArKey = (nameAr || "").toLowerCase().trim();
  if (!nameEnKey && !nameArKey) return false;

  const mainConditions = [];
  if (nameEnKey) mainConditions.push(ilike(companiesTable.nameEn, nameEnKey));
  if (nameArKey) mainConditions.push(ilike(companiesTable.nameAr, nameArKey));

  const existingMain = await db.select({ id: companiesTable.id }).from(companiesTable).where(
    or(...mainConditions)
  ).limit(1);
  if (existingMain.length > 0) return true;

  const builderNameConditions = [];
  if (nameEnKey) builderNameConditions.push(ilike(builderCompaniesTable.nameEn, nameEnKey));
  if (nameArKey) builderNameConditions.push(ilike(builderCompaniesTable.nameAr, nameArKey));

  const builderConditions = [or(...builderNameConditions)];
  if (excludeJobId) {
    builderConditions.push(ne(builderCompaniesTable.jobId, excludeJobId));
  }
  const existingBuilder = await db.select({ id: builderCompaniesTable.id }).from(builderCompaniesTable).where(
    and(...builderConditions)
  ).limit(1);
  return existingBuilder.length > 0;
}

export async function deduplicateAll(): Promise<{ duplicatesFound: number; duplicatesDeleted: number }> {
  // Reset all flags first
  await db.update(builderCompaniesTable).set({ isDuplicate: false });

  const allCompanies = await db.select().from(builderCompaniesTable).orderBy(builderCompaniesTable.id);
  const seenEn = new Map<string, number>();
  const seenAr = new Map<string, number>();
  const seenCr = new Map<string, number>();
  const toDelete: number[] = [];

  for (const company of allCompanies) {
    const nameEnKey = (company.nameEn || "").toLowerCase().trim();
    const nameArKey = (company.nameAr || "").toLowerCase().trim();
    const crKey = (company.crNumber || "").trim();

    let isDup = false;
    // Check within builder table: name (EN), name (AR), CR number
    if (nameEnKey && seenEn.has(nameEnKey)) isDup = true;
    if (!isDup && nameArKey && seenAr.has(nameArKey)) isDup = true;
    if (!isDup && crKey && seenCr.has(crKey)) isDup = true;

    // Check against MeshBase companies table
    if (!isDup) {
      const mainConditions: any[] = [];
      if (nameEnKey) mainConditions.push(ilike(companiesTable.nameEn, nameEnKey));
      if (nameArKey) mainConditions.push(ilike(companiesTable.nameAr, nameArKey));
      if (crKey) mainConditions.push(ilike(companiesTable.crNumber, crKey));
      if (mainConditions.length > 0) {
        const mainExists = await db.select({ id: companiesTable.id }).from(companiesTable)
          .where(or(...mainConditions)).limit(1);
        if (mainExists.length > 0) isDup = true;
      }
    }

    if (isDup) {
      toDelete.push(company.id);
    } else {
      if (nameEnKey) seenEn.set(nameEnKey, company.id);
      if (nameArKey) seenAr.set(nameArKey, company.id);
      if (crKey) seenCr.set(crKey, company.id);
    }
  }

  // Delete all duplicates immediately
  let duplicatesDeleted = 0;
  if (toDelete.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const chunk = toDelete.slice(i, i + BATCH);
      await db.execute(sql`DELETE FROM builder_companies WHERE id = ANY(ARRAY[${sql.raw(chunk.join(","))}]::int[])`);
    }
    duplicatesDeleted = toDelete.length;
  }

  return { duplicatesFound: toDelete.length, duplicatesDeleted };
}

export async function autoClean(): Promise<{
  totalProcessed: number;
  invalidPhones: number;
  invalidEmails: number;
  invalidWebsites: number;
  duplicatesRemoved: number;
  totalCleaned: number;
}> {
  const allCompanies = await db.select().from(builderCompaniesTable);
  let invalidPhones = 0, invalidEmails = 0, invalidWebsites = 0, duplicatesRemoved = 0;
  const seenEn = new Set<string>();
  const seenAr = new Set<string>();

  for (const company of allCompanies) {
    const nameEnKey = (company.nameEn || "").toLowerCase().trim();
    const nameArKey = (company.nameAr || "").toLowerCase().trim();
    let isDup = false;
    if (nameEnKey && seenEn.has(nameEnKey)) isDup = true;
    if (nameArKey && seenAr.has(nameArKey)) isDup = true;

    if (isDup) {
      await db.update(builderCompaniesTable).set({ isDuplicate: true }).where(eq(builderCompaniesTable.id, company.id));
      duplicatesRemoved++;
    }
    if (nameEnKey) seenEn.add(nameEnKey);
    if (nameArKey) seenAr.add(nameArKey);

    const updates: Record<string, unknown> = {};
    if (company.phone) {
      const cleaned = company.phone.replace(/[\s\-\(\)\.]/g, "");
      const saudiMobile = /^(\+966|00966|966|0)(5\d{8})$/;
      const saudiLandline = /^(\+966|00966|966|0)(1[1-9]\d{6}|[2-9]\d{7})$/;
      const hasRepeat = /(\d)\1{4,}/.test(cleaned);
      const hasSeq = /1234567|7654321/.test(cleaned);
      if (hasRepeat || hasSeq || (!saudiMobile.test(cleaned) && !saudiLandline.test(cleaned))) {
        updates.phone = null;
        invalidPhones++;
      }
    }
    if (company.email) {
      if (company.email.includes("estimated") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email)) {
        updates.email = null;
        invalidEmails++;
      }
    }
    if (company.website) {
      try {
        new URL(company.website);
        if (company.website.includes("estimated")) {
          updates.website = null;
          invalidWebsites++;
        }
      } catch {
        updates.website = null;
        invalidWebsites++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(builderCompaniesTable).set({ ...updates, isValidated: true }).where(eq(builderCompaniesTable.id, company.id));
    }
  }

  return {
    totalProcessed: allCompanies.length,
    invalidPhones,
    invalidEmails,
    invalidWebsites,
    duplicatesRemoved,
    totalCleaned: duplicatesRemoved + invalidPhones + invalidEmails + invalidWebsites,
  };
}

export async function reEnrichCompany(companyId: number): Promise<{ success: boolean; message: string }> {
  const [company] = await db.select().from(builderCompaniesTable).where(eq(builderCompaniesTable.id, companyId));
  if (!company) {
    return { success: false, message: "Company not found" };
  }

  const companyName = company.nameEn || company.nameAr || "Unknown";
  const website = company.website || undefined;

  console.log(`[ReEnrich] Starting deep enrichment for: ${companyName}`);

  // Phase 1: Parallel data gathering
  const [exploriumResult, perplexityResult] = await Promise.allSettled([
    enrichWithExplorium(companyName),
    (async () => {
      const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
      const { canSpend, recordSpend } = await import("./paid-api-guard.js");
      if (!PERPLEXITY_API_KEY || !canSpend("perplexity")) return null;
      // Run 2 focused Perplexity queries: general + executive-specific
      const axios = (await import("axios")).default;
      const makeQuery = async (query: string) => {
        if (!canSpend("perplexity")) return null;
        try {
          const r = await axios.post("https://api.perplexity.ai/chat/completions", {
            model: "sonar",
            messages: [
              { role: "system", content: "You are a Saudi Arabia B2B intelligence analyst. Provide precise, factual data with names in both English and Arabic." },
              { role: "user", content: query }
            ],
            max_tokens: 2000,
            temperature: 0.1,
            return_citations: true,
          }, { headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 });
          recordSpend("perplexity");
          return r.data?.choices?.[0]?.message?.content || null;
        } catch { return null; }
      };
      const [general, executives] = await Promise.all([
        makeQuery(`Research the Saudi company "${companyName}"${website ? ` (${website})` : ""}. Provide: CEO/chairman name (Arabic + English), key executives with titles, major shareholders with ownership percentages, company type, founding year, employee count, revenue in SAR, headquarters city, industry sector.`),
        makeQuery(`Find executives, board members, and shareholders of "${companyName}" Saudi Arabia. List each person's full name in English and Arabic, their title/role, and ownership percentage if shareholder. Include LinkedIn profiles if available.`),
      ]);
      return { general, executives };
    })(),
  ]);

  const exploriumData = exploriumResult.status === "fulfilled" ? exploriumResult.value : null;
  const perplexityData = perplexityResult.status === "fulfilled" ? perplexityResult.value : null;

  // Phase 2: Parallel NEXUS power-scraper fetch for leadership sub-pages (unified browser/proxy/session)
  let leadershipPageContent = "";
  if (website) {
    try {
      const { scrapePage } = await import("./power-scraper.js");
      const baseUrl = website.replace(/\/$/, "");
      const leadershipUrls = [
        `${baseUrl}/about`, `${baseUrl}/about-us`, `${baseUrl}/team`,
        `${baseUrl}/leadership`, `${baseUrl}/management`, `${baseUrl}/board`,
      ];

      const results = await Promise.allSettled(
        leadershipUrls.map(async (url) => {
          try {
            const r = await scrapePage(url, {
              engines: ["cheerio", "playwright", "playwright-stealth"],
              minContentLength: 200,
              timeoutMs: 20000,
            });
            if (!r || !r.text || r.text.trim().length < 120) return null;
            return `\n=== ${url} ===\n${r.text.slice(0, 2500)}`;
          } catch { return null; }
        })
      );

      leadershipPageContent = results
        .filter(r => r.status === "fulfilled" && r.value)
        .map(r => (r as PromiseFulfilledResult<string>).value)
        .join("\n")
        .slice(0, 8000);
    } catch (e) {
      console.log(`[ReEnrich] Sub-page fetch skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Normalize null → undefined to satisfy enrichCompanyWithAI input typing
  const baseData: {
    nameAr?: string;
    nameEn?: string;
    website?: string;
    city?: string;
    industry?: string;
  } = {
    nameAr: company.nameAr ?? undefined,
    nameEn: company.nameEn ?? undefined,
    website: website ?? undefined,
    city: company.city ?? undefined,
    industry: company.industry ?? undefined,
  };

  const mergedBase = exploriumData ? (mergeExploriumData({ ...baseData }, exploriumData) as typeof baseData) : baseData;

  // Phase 3: Build context for AI synthesis
  const contextParts: string[] = [];
  if (perplexityData?.general) contextParts.push(`Perplexity general research:\n${perplexityData.general}`);
  if (perplexityData?.executives) contextParts.push(`Perplexity executive research:\n${perplexityData.executives}`);
  if (leadershipPageContent) contextParts.push(`Website leadership pages:\n${leadershipPageContent}`);

  const enriched = await enrichCompanyWithAI({
    nameAr: mergedBase.nameAr as string | undefined,
    nameEn: mergedBase.nameEn as string | undefined,
    website: mergedBase.website as string | undefined,
    city: mergedBase.city as string | undefined,
    industry: mergedBase.industry as string | undefined,
    contextBlock: contextParts.length > 0 ? `\n\nAdditional research:\n${contextParts.join("\n\n")}` : undefined,
  } as Parameters<typeof enrichCompanyWithAI>[0], "deep");

  const finalData = { ...enriched };
  if (exploriumData) {
    if (exploriumData.phone && !finalData.phone) finalData.phone = exploriumData.phone;
    if (exploriumData.email && !finalData.email) finalData.email = exploriumData.email;
    if (exploriumData.cr_number && !finalData.crNumber) finalData.crNumber = exploriumData.cr_number;
    if (exploriumData.linkedin_url && !finalData.linkedinUrl) finalData.linkedinUrl = exploriumData.linkedin_url;
  }

  console.log(`[ReEnrich] Saving enrichment for ${companyName}: executives=${!!finalData.keyExecutives}, shareholders=${!!finalData.shareholders}`);

  await db.update(builderCompaniesTable).set({
    ...finalData,
    isValidated: true,
    enrichmentStatus: "enriched",
    updatedAt: new Date(),
  }).where(eq(builderCompaniesTable.id, companyId));

  return { success: true, message: `Re-enriched "${companyName}" successfully` };
}

export async function reEnrichAll(): Promise<{ jobId: number; message: string }> {
  const [job] = await db.insert(builderJobsTable).values({
    status: "running",
    sourceIndex: 0,
    log: "Starting re-enrichment of all companies...",
    companiesFound: 0,
    companiesAdded: 0,
    companiesDuplicate: 0,
    startedAt: new Date(),
  }).returning();

  setImmediate(async () => {
    try {
      const companies = await db.select().from(builderCompaniesTable).where(
        eq(builderCompaniesTable.isDuplicate, false)
      );

      let enriched = 0;
      const logs: string[] = [`Starting re-enrichment of ${companies.length} companies`];

      for (const company of companies) {
        try {
          await reEnrichCompany(company.id);
          enriched++;
          logs.push(`Re-enriched: ${company.nameEn || company.nameAr} (${enriched}/${companies.length})`);
          await db.update(builderJobsTable).set({
            companiesAdded: enriched,
            companiesFound: companies.length,
            log: logs.join("\n"),
          }).where(eq(builderJobsTable.id, job.id));
        } catch (err) {
          logs.push(`Failed to re-enrich ${company.nameEn || company.nameAr}: ${err}`);
        }
      }

      await db.update(builderJobsTable).set({
        status: "completed",
        companiesAdded: enriched,
        companiesFound: companies.length,
        log: logs.join("\n"),
        completedAt: new Date(),
      }).where(eq(builderJobsTable.id, job.id));
    } catch (err) {
      await db.update(builderJobsTable).set({
        status: "failed",
        log: `Re-enrichment failed: ${err}`,
        completedAt: new Date(),
      }).where(eq(builderJobsTable.id, job.id));
    }
  });

  return { jobId: job.id, message: "Re-enrichment job started" };
}

export async function getIncompleteCompanies(): Promise<typeof builderCompaniesTable.$inferSelect[]> {
  const companies = await db.select().from(builderCompaniesTable).where(
    and(
      eq(builderCompaniesTable.isDuplicate, false),
      or(
        eq(builderCompaniesTable.enrichmentStatus, "pending"),
        eq(builderCompaniesTable.enrichmentStatus, "partial"),
        isNull(builderCompaniesTable.enrichmentStatus),
        lt(builderCompaniesTable.enrichmentScore, 30)
      )
    )
  ).orderBy(builderCompaniesTable.id);
  return companies;
}

export async function getAllBuilderCompanies(options?: {
  page?: number;
  limit?: number;
  status?: string;
  industry?: string;
  companyType?: string;
  jobId?: string;
  hideDuplicates?: boolean;
}): Promise<{
  companies: typeof builderCompaniesTable.$inferSelect[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const page = options?.page || 1;
  const limit = Math.min(options?.limit || 20, 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (options?.status) conditions.push(eq(builderCompaniesTable.enrichmentStatus, options.status));
  if (options?.industry) conditions.push(ilike(builderCompaniesTable.industry, `%${options.industry}%`));
  if (options?.companyType) conditions.push(eq(builderCompaniesTable.companyType, options.companyType));
  if (options?.jobId) conditions.push(eq(builderCompaniesTable.jobId, options.jobId));
  if (options?.hideDuplicates) conditions.push(eq(builderCompaniesTable.isDuplicate, false));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [companies, countResult] = await Promise.all([
    db.select().from(builderCompaniesTable).where(whereClause).limit(limit).offset(offset).orderBy(desc(builderCompaniesTable.updatedAt)),
    db.select({ count: sql<number>`count(*)` }).from(builderCompaniesTable).where(whereClause),
  ]);

  const total = Number(countResult[0]?.count || 0);
  return { companies, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function runHarvest(opts: {
  sourceIds?: string[];
  batchSize?: number;
  enrichmentDepth?: "basic" | "standard" | "deep";
  extraSources?: Array<{ id: string; name: string; nameAr?: string; url: string; category: string; description?: string; estimatedCompanies?: number }>;
}): Promise<{
  jobId: string;
  builderJobId: number;
  status: string;
  sourceIds: string[];
  sourcesTotal: number;
}> {
  const { sourceIds: requestedIds = [], batchSize = 5, enrichmentDepth = "standard", extraSources = [] } = opts;

  const allSources = [...SAUDI_DATA_SOURCES, ...extraSources.map(s => ({
    id: s.id, name: s.name, nameAr: s.nameAr || s.name, category: s.category as "government" | "directory" | "chamber" | "financial" | "wikidata",
    url: s.url, description: s.description || "", estimatedCompanies: s.estimatedCompanies || 0,
  }))];

  const sources = requestedIds.length > 0
    ? allSources.filter((s) => requestedIds.includes(s.id))
    : allSources;

  const jobId = uuidv4();

  const [builderJob] = await db.insert(builderJobsTable).values({
    legacyJobId: jobId,
    status: "running",
    sourceIndex: 0,
    log: `Starting harvest of ${sources.length} sources`,
    companiesFound: 0,
    companiesAdded: 0,
    companiesDuplicate: 0,
    startedAt: new Date(),
  }).returning();

  setImmediate(async () => {
    try {
      let totalAdded = 0;
      let totalDuplicates = 0;
      let totalFound = 0;
      let wasCancelled = false;
      const logs: string[] = [];

      for (let batchStart = 0; batchStart < sources.length; batchStart += batchSize) {
        const currentJob = await db.select().from(builderJobsTable).where(eq(builderJobsTable.id, builderJob.id));
        if (currentJob[0]?.status === "cancelled") {
          logs.push("Harvest cancelled by user");
          wasCancelled = true;
          break;
        }

        const batch = sources.slice(batchStart, batchStart + batchSize);

        const batchPromises = batch.map(async (source, batchIdx) => {
          const sourceIdx = batchStart + batchIdx;
          logs.push(`[${sourceIdx + 1}/${sources.length}] Harvesting: ${source.name}`);

          let rawCompanies: Array<{
            nameAr?: string | null;
            nameEn?: string | null;
            industry?: string | null;
            city?: string | null;
            website?: string | null;
            phone?: string | null;
            email?: string | null;
            crNumber?: string | null;
          }> = [];
          try {
            if (source.id === "wikidata") {
              rawCompanies = await fetchWikidataSaudiCompanies();
            } else if (source.id === "bluepages") {
              // Use the real BluPages JSON API — iterate across cities for max coverage
              const bpCities = ["Riyadh", "Jeddah", "Dammam", "Mecca", "Medina"];
              const cityTarget = bpCities[(batchStart + batchIdx) % bpCities.length];
              logs.push(`  BluPages API: targeting city "${cityTarget}"`);
              rawCompanies = await harvestBluepagesForBuilder(300, cityTarget);
            } else {
              // For JS-rendered directories that can't be scraped, use sector-varied AI prompt
              // Rotate through sectors so each harvest run covers different industries
              const runSector = SAUDI_SECTORS[Math.floor(Date.now() / 1000) % SAUDI_SECTORS.length];
              rawCompanies = await harvestSourceWithAI(source.id, source.name, source.url, runSector);
            }
          } catch (err) {
            console.error(`Harvest error for source ${source.id}:`, err);
            logs.push(`  Error harvesting ${source.name}: ${err}`);
            rawCompanies = [];
          }

          let sourceAdded = 0;
          let sourceDuplicates = 0;

          for (const rc of rawCompanies) {
            const nameKey = (rc.nameEn || rc.nameAr || "").toLowerCase().trim();
            if (!nameKey) continue;

            const isDuplicate = await checkDuplicate(rc.nameEn || null, rc.nameAr || null, jobId);

            if (isDuplicate) {
              sourceDuplicates++;
              continue; // skip — already in main company pool
            }

            // Respect the deletion blocklist — never re-seed a company the user deleted
            if (await isBlocked({ nameEn: rc.nameEn, nameAr: rc.nameAr, crNumber: rc.crNumber, website: rc.website })) {
              console.log(`[Builder] Skipping blocked company: ${rc.nameEn || rc.nameAr}`);
              continue;
            }

            let exploriumData: ExploriumCompany | null = null;
            if (EXPLORIUM_API_KEY()) {
              exploriumData = await enrichWithExplorium(rc.nameEn || rc.nameAr || "");
            }

            const dataSourceLabel = `builder-${source.id}`;

            try {
              const enriched = await enrichCompanyWithAI({
                nameAr: rc.nameAr,
                nameEn: rc.nameEn,
                website: rc.website || (exploriumData?.website ?? undefined),
                city: rc.city || (exploriumData?.city ?? undefined),
                industry: rc.industry || (exploriumData?.industry ?? undefined),
              }, enrichmentDepth);

              const cleaned = validateAndCleanData(enriched as Record<string, unknown>);
              const enrichedClean = cleaned as Record<string, unknown>;

              if (exploriumData) {
                if (exploriumData.phone && !enrichedClean.phone) enrichedClean.phone = exploriumData.phone;
                if (exploriumData.email && !enrichedClean.email) enrichedClean.email = exploriumData.email;
                if (exploriumData.cr_number && !enrichedClean.crNumber) enrichedClean.crNumber = exploriumData.cr_number;
                if (exploriumData.linkedin_url && !enrichedClean.linkedinUrl) enrichedClean.linkedinUrl = exploriumData.linkedin_url;
              }

              // Parse employee count — AI sometimes returns "50-200" range strings
              const rawEmp = enrichedClean.employeeCount;
              let parsedEmpCount: number | null = null;
              if (typeof rawEmp === "number" && !isNaN(rawEmp)) {
                parsedEmpCount = rawEmp;
              } else if (typeof rawEmp === "string" && rawEmp) {
                const firstNum = parseInt(rawEmp.replace(/[^0-9]/g, "").slice(0, 8), 10);
                if (!isNaN(firstNum)) parsedEmpCount = firstNum;
              }

              const companyPayload = {
                nameAr: (enrichedClean.nameAr as string) || null,
                nameEn: (enrichedClean.nameEn as string) || null,
                industry: (enrichedClean.industry as string) || null,
                industryAr: (enrichedClean.industryAr as string) || null,
                city: (enrichedClean.city as string) || null,
                region: (enrichedClean.region as string) || null,
                country: "Saudi Arabia",
                website: (enrichedClean.website as string) || null,
                phone: (enrichedClean.phone as string) || null,
                email: (enrichedClean.email as string) || null,
                description: (enrichedClean.description as string) || null,
                descriptionAr: (enrichedClean.descriptionAr as string) || null,
                employeeCount: parsedEmpCount,
                revenue: (enrichedClean.revenue as string) || null,
                foundingYear: (enrichedClean.foundingYear as number) || null,
                crNumber: (enrichedClean.crNumber as string) || null,
                capitalAmount: (enrichedClean.capitalAmount as string) || null,
                entityType: (enrichedClean.entityType as string) || null,
                companyType: (enrichedClean.companyType as string) || null,
                ownerName: (enrichedClean.ownerName as string) || null,
                ownerNameAr: (enrichedClean.ownerNameAr as string) || null,
                ownerTitle: (enrichedClean.ownerTitle as string) || null,
                ownerPhone: (enrichedClean.ownerPhone as string) || null,
                ownerEmail: (enrichedClean.ownerEmail as string) || null,
                ownerLinkedin: (enrichedClean.ownerLinkedin as string) || null,
                estimatedWealth: (enrichedClean.estimatedWealth as string) || null,
                shareholders: (enrichedClean.shareholders as string) || null,
                keyExecutives: (enrichedClean.keyExecutives as string) || null,
                marketPositioning: (enrichedClean.marketPositioning as string) || null,
                recentNews: (enrichedClean.recentNews as string) || null,
                linkedinUrl: (enrichedClean.linkedinUrl as string) || null,
                enrichmentScore: (enrichedClean.enrichmentScore as number) || 0,
                enrichmentStatus: (enrichedClean.enrichmentStatus as string) || "enriched",
              };

              await db.insert(builderCompaniesTable).values({
                jobId,
                sourceId: source.id,
                sourceName: source.name,
                ...companyPayload,
                isDuplicate: false,
              });
              sourceAdded++;
            } catch (err) {
              console.error("Enrichment error:", err);
              await db.insert(builderCompaniesTable).values({
                jobId,
                sourceId: source.id,
                sourceName: source.name,
                nameAr: rc.nameAr || null,
                nameEn: rc.nameEn || null,
                industry: rc.industry || null,
                city: rc.city || null,
                country: "Saudi Arabia",
                website: rc.website || null,
                phone: rc.phone || null,
                email: rc.email || null,
                enrichmentScore: 0,
                enrichmentStatus: "pending",
                isDuplicate: false,
              });
              sourceAdded++;
            }
          }

          totalAdded += sourceAdded;
          totalDuplicates += sourceDuplicates;
          totalFound += rawCompanies.length;

          logs.push(`  ${source.name}: found=${rawCompanies.length}, added=${sourceAdded}, duplicates=${sourceDuplicates}`);
          return { sourceAdded, sourceDuplicates };
        });

        await Promise.all(batchPromises);

        await db.update(builderJobsTable).set({
          sourceIndex: Math.min(batchStart + batchSize, sources.length),
          companiesFound: totalFound,
          companiesAdded: totalAdded,
          companiesDuplicate: totalDuplicates,
          log: logs.join("\n"),
        }).where(eq(builderJobsTable.id, builderJob.id));
      }

      if (wasCancelled) {
        logs.push(`Harvest cancelled: found=${totalFound}, added=${totalAdded}, duplicates=${totalDuplicates}`);
        await db.update(builderJobsTable).set({
          status: "cancelled",
          companiesFound: totalFound,
          companiesAdded: totalAdded,
          companiesDuplicate: totalDuplicates,
          log: logs.join("\n"),
          completedAt: new Date(),
        }).where(eq(builderJobsTable.id, builderJob.id));
      } else {
        logs.push(`Harvest complete: found=${totalFound}, added=${totalAdded}, duplicates=${totalDuplicates}`);
        await db.update(builderJobsTable).set({
          status: "completed",
          companiesFound: totalFound,
          companiesAdded: totalAdded,
          companiesDuplicate: totalDuplicates,
          log: logs.join("\n"),
          completedAt: new Date(),
        }).where(eq(builderJobsTable.id, builderJob.id));
      }
    } catch (err) {
      console.error("Harvest job error:", err);
      await db.update(builderJobsTable).set({
        status: "failed",
        log: `Harvest failed: ${err}`,
        completedAt: new Date(),
      }).where(eq(builderJobsTable.id, builderJob.id));
    }
  });

  return {
    jobId,
    builderJobId: builderJob.id,
    status: "running",
    sourceIds: sources.map((s) => s.id),
    sourcesTotal: sources.length,
  };
}

export async function getBuilderJob(id: number) {
  const [job] = await db.select().from(builderJobsTable).where(eq(builderJobsTable.id, id));
  return job || null;
}

export async function getBuilderJobs() {
  return db.select().from(builderJobsTable).orderBy(desc(builderJobsTable.id)).limit(50);
}

export async function cancelBuilderJobByLegacyJobId(legacyJobId: string): Promise<void> {
  const [job] = await db.select().from(builderJobsTable).where(
    eq(builderJobsTable.legacyJobId, legacyJobId)
  ).limit(1);

  if (job && job.status === "running") {
    await db.update(builderJobsTable).set({
      status: "cancelled",
      completedAt: new Date(),
    }).where(eq(builderJobsTable.id, job.id));
  }
}
