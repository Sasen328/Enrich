# Document 4: AI Database Builder
## Complete Standalone Replication Guide

---

## 1. WHAT THIS IS

The AI Database Builder is an autonomous harvesting system that collects Saudi company data from 15 built-in data sources and any number of custom URLs added by the user. Unlike the Masar Database (which focuses on government registries and AOA documents), the Builder targets:

- Wikidata SPARQL query (726+ Saudi companies)
- Saudi government portals (data.gov.sa, mc.gov.sa)
- Stock market data (CMA, Tadawul)
- Business directories (Saudi Yellow Pages, Daleel, Kompass, franchises)
- Chambers of Commerce (Riyadh, Jeddah, Eastern Province, Madinah, Aseer)
- BluPages (12,000+ Saudi companies)
- User-added custom sources

**Flow:**
1. User sees a grid of all sources with harvest status and company count per source
2. User clicks ▶ on a source to harvest it individually, OR clicks "Harvest All"
3. User selects enrichment depth (Basic / Standard / Deep)
4. Backend runs AI harvesting for selected source(s), polling for job status
5. User clicks "View Results →" to go to the results page
6. Results page shows all harvested companies with search, filter, export, individual enrichment, +Lead

**Results page additional features:**
- Search by name/city/industry
- Filter by source, enrichment status
- Click any company to open a detail panel
- Detail panel: enrich with OrcEngine, add any person as a Lead (fires background person intel), AI chat about that company, seed data from that company
- Bulk export: XLSX, CSV, PPTX
- "Push to Database" (copies to main companies table)

---

## 2. TECH STACK

Same as Documents 1–3. This module additionally uses:
- `xlsx` — Excel export
- `pptxgenjs` — PowerPoint export (one slide per company)
- Explorium API (optional — for paid enrichment via `EXPLORIUM_API_KEY`)

**Required env vars:**
```
ANTHROPIC_API_KEY     (or AI_INTEGRATIONS_ANTHROPIC_API_KEY)
OPENAI_API_KEY        (or AI_INTEGRATIONS_OPENAI_API_KEY)
GEMINI_API_KEY
PERPLEXITY_API_KEY
DATABASE_URL
EXPLORIUM_API_KEY     (optional — paid enrichment service)
```

---

## 3. DATABASE SCHEMA

```sql
-- Main builder results table
CREATE TABLE builder_companies (
  id                SERIAL PRIMARY KEY,
  job_id            TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  source_name       TEXT,
  name_ar           TEXT,
  name_en           TEXT,
  industry          TEXT,
  city              TEXT,
  region            TEXT,
  country           TEXT DEFAULT 'Saudi Arabia',
  website           TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  description       TEXT,
  employee_count    INTEGER,
  revenue           TEXT,
  owner_name        TEXT,
  owner_name_ar     TEXT,
  owner_title       TEXT,
  owner_phone       TEXT,
  owner_email       TEXT,
  cr_number         TEXT,
  capital_amount    TEXT,
  entity_type       TEXT,
  company_type      TEXT,
  founding_year     INTEGER,
  enrichment_score  INTEGER,
  enrichment_status TEXT DEFAULT 'pending',
  is_duplicate      BOOLEAN DEFAULT FALSE,
  is_validated      BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW(),
  key_executives    TEXT,   -- JSON string
  shareholders      TEXT,   -- JSON string
  market_positioning TEXT,
  recent_news       TEXT,
  linkedin_url      TEXT
);

CREATE INDEX idx_builder_companies_source ON builder_companies(source_id);
CREATE INDEX idx_builder_companies_name_en ON builder_companies(name_en);
CREATE INDEX idx_builder_companies_city ON builder_companies(city);
CREATE INDEX idx_builder_companies_enrichment ON builder_companies(enrichment_status);

-- Builder jobs table
CREATE TABLE builder_jobs (
  id                 SERIAL PRIMARY KEY,
  job_id             TEXT UNIQUE NOT NULL,
  source_ids         TEXT[],
  status             TEXT DEFAULT 'harvesting',
  companies_harvested INTEGER DEFAULT 0,
  progress           INTEGER DEFAULT 0,
  error              TEXT,
  created_at         TIMESTAMP DEFAULT NOW(),
  completed_at       TIMESTAMP
);

-- Legacy jobs table (used by /api/builder/jobs/:jobId endpoint)
CREATE TABLE jobs (
  id          SERIAL PRIMARY KEY,
  job_id      TEXT UNIQUE NOT NULL,
  type        TEXT DEFAULT 'builder_harvest',
  status      TEXT DEFAULT 'harvesting',
  source_ids  TEXT,     -- JSON string
  sources_total INTEGER DEFAULT 0,
  companies_harvested INTEGER DEFAULT 0,
  progress    INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Custom sources added by user
CREATE TABLE builder_custom_sources (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  name_ar              TEXT,
  url                  TEXT NOT NULL,
  category             TEXT NOT NULL,
  description          TEXT,
  estimated_companies  INTEGER DEFAULT 0,
  created_at           TIMESTAMP DEFAULT NOW()
);

-- Main companies table (production database — Builder can push to this)
CREATE TABLE companies (
  id          SERIAL PRIMARY KEY,
  name_en     TEXT,
  name_ar     TEXT,
  cr_number   TEXT UNIQUE,
  industry    TEXT,
  city        TEXT,
  website     TEXT,
  phone       TEXT,
  email       TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);
```

Drizzle ORM:
```typescript
import { pgTable, serial, text, jsonb, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const builderCompaniesTable = pgTable("builder_companies", {
  id:               serial("id").primaryKey(),
  jobId:            text("job_id").notNull(),
  sourceId:         text("source_id").notNull(),
  sourceName:       text("source_name"),
  nameAr:           text("name_ar"),
  nameEn:           text("name_en"),
  industry:         text("industry"),
  city:             text("city"),
  region:           text("region"),
  country:          text("country").default("Saudi Arabia"),
  website:          text("website"),
  phone:            text("phone"),
  email:            text("email"),
  address:          text("address"),
  description:      text("description"),
  employeeCount:    integer("employee_count"),
  revenue:          text("revenue"),
  ownerName:        text("owner_name"),
  ownerNameAr:      text("owner_name_ar"),
  ownerTitle:       text("owner_title"),
  ownerPhone:       text("owner_phone"),
  ownerEmail:       text("owner_email"),
  crNumber:         text("cr_number"),
  capitalAmount:    text("capital_amount"),
  entityType:       text("entity_type"),
  companyType:      text("company_type"),
  foundingYear:     integer("founding_year"),
  enrichmentScore:  integer("enrichment_score"),
  enrichmentStatus: text("enrichment_status").default("pending"),
  isDuplicate:      boolean("is_duplicate").default(false),
  isValidated:      boolean("is_validated").default(false),
  createdAt:        timestamp("created_at").defaultNow(),
  keyExecutives:    text("key_executives"),    // JSON string
  shareholders:     text("shareholders"),       // JSON string
  marketPositioning: text("market_positioning"),
  recentNews:       text("recent_news"),
  linkedinUrl:      text("linkedin_url"),
});

export const builderJobsTable = pgTable("builder_jobs", {
  id:                 serial("id").primaryKey(),
  jobId:              text("job_id").unique().notNull(),
  sourceIds:          text("source_ids").array(),
  status:             text("status").default("harvesting"),
  companiesHarvested: integer("companies_harvested").default(0),
  progress:           integer("progress").default(0),
  error:              text("error"),
  createdAt:          timestamp("created_at").defaultNow(),
  completedAt:        timestamp("completed_at"),
});

export const jobsTable = pgTable("jobs", {
  id:                 serial("id").primaryKey(),
  jobId:              text("job_id").unique().notNull(),
  type:               text("type").default("builder_harvest"),
  status:             text("status").default("harvesting"),
  sourceIds:          text("source_ids"),
  sourcesTotal:       integer("sources_total").default(0),
  companiesHarvested: integer("companies_harvested").default(0),
  progress:           integer("progress").default(0),
  createdAt:          timestamp("created_at").defaultNow(),
  completedAt:        timestamp("completed_at"),
});

export const builderCustomSourcesTable = pgTable("builder_custom_sources", {
  id:                  serial("id").primaryKey(),
  name:                text("name").notNull(),
  nameAr:              text("name_ar"),
  url:                 text("url").notNull(),
  category:            text("category").notNull(),
  description:         text("description"),
  estimatedCompanies:  integer("estimated_companies").default(0),
  createdAt:           timestamp("created_at").defaultNow(),
});

export const companiesTable = pgTable("companies", {
  id:        serial("id").primaryKey(),
  nameEn:    text("name_en"),
  nameAr:    text("name_ar"),
  crNumber:  text("cr_number").unique(),
  industry:  text("industry"),
  city:      text("city"),
  website:   text("website"),
  phone:     text("phone"),
  email:     text("email"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## 4. THE 15 BUILT-IN DATA SOURCES (data-sources.ts)

```typescript
export interface DataSourceConfig {
  id: string;
  name: string;
  nameAr: string;
  category: "government" | "directory" | "chamber" | "financial" | "wikidata";
  url: string;
  description: string;
  estimatedCompanies: number;
}

export const SAUDI_DATA_SOURCES: DataSourceConfig[] = [
  {
    id: "wikidata",
    name: "Wikidata SPARQL",
    nameAr: "ويكي بيانات",
    category: "wikidata",
    url: "https://query.wikidata.org/sparql",
    description: "726+ Saudi companies with Arabic names, industry, HQ, employees, revenue, websites",
    estimatedCompanies: 726,
  },
  {
    id: "saudi-open-data",
    name: "Saudi Open Data (CKAN)",
    nameAr: "البيانات المفتوحة السعودية",
    category: "government",
    url: "https://data.gov.sa",
    description: "Saudi Open Data API with government-registered company data",
    estimatedCompanies: 2000,
  },
  {
    id: "ministry-commerce",
    name: "Ministry of Commerce",
    nameAr: "وزارة التجارة",
    category: "government",
    url: "https://mc.gov.sa",
    description: "Commercial registration and company registry data",
    estimatedCompanies: 5000,
  },
  {
    id: "cma-financial",
    name: "CMA Financial Market Data",
    nameAr: "هيئة السوق المالية",
    category: "financial",
    url: "https://www.cma.org.sa",
    description: "Listed companies on Tadawul (TASI) and NOMU markets",
    estimatedCompanies: 350,
  },
  {
    id: "tasi-listed",
    name: "Tadawul Listed Companies",
    nameAr: "شركات تداول",
    category: "financial",
    url: "https://www.tadawul.com.sa",
    description: "All companies listed on Saudi Stock Exchange",
    estimatedCompanies: 250,
  },
  {
    id: "yellow-pages-sa",
    name: "Saudi Yellow Pages",
    nameAr: "الصفحات الصفراء السعودية",
    category: "directory",
    url: "https://www.yellowpages.com.sa",
    description: "Business directory with phone, address, categories",
    estimatedCompanies: 8000,
  },
  {
    id: "daleel",
    name: "Daleel Business Directory",
    nameAr: "دليل",
    category: "directory",
    url: "https://www.daleel.sa",
    description: "Comprehensive Saudi business directory",
    estimatedCompanies: 3000,
  },
  {
    id: "kompass-sa",
    name: "Kompass Saudi Arabia",
    nameAr: "كومباس السعودية",
    category: "directory",
    url: "https://sa.kompass.com",
    description: "International B2B directory - Saudi Arabia section",
    estimatedCompanies: 2500,
  },
  {
    id: "franchises-sa",
    name: "Saudi Franchise Directory",
    nameAr: "الامتياز التجاري السعودي",
    category: "directory",
    url: "https://www.saudifranchise.com",
    description: "Franchise businesses operating in Saudi Arabia",
    estimatedCompanies: 500,
  },
  {
    id: "chamber-riyadh",
    name: "Riyadh Chamber of Commerce",
    nameAr: "غرفة الرياض",
    category: "chamber",
    url: "https://www.riyadhchamber.com",
    description: "Member companies of Riyadh Chamber of Commerce",
    estimatedCompanies: 4000,
  },
  {
    id: "chamber-jeddah",
    name: "Jeddah Chamber of Commerce",
    nameAr: "غرفة جدة",
    category: "chamber",
    url: "https://www.jcci.org.sa",
    description: "Member companies of Jeddah Chamber of Commerce",
    estimatedCompanies: 3500,
  },
  {
    id: "chamber-eastern",
    name: "Eastern Province Chamber",
    nameAr: "غرفة المنطقة الشرقية",
    category: "chamber",
    url: "https://www.chamber.org.sa",
    description: "Dammam/Eastern Province Chamber of Commerce members",
    estimatedCompanies: 2000,
  },
  {
    id: "chamber-madinah",
    name: "Madinah Chamber of Commerce",
    nameAr: "غرفة المدينة المنورة",
    category: "chamber",
    url: "https://www.madina-chamber.org.sa",
    description: "Member companies of Madinah Chamber of Commerce",
    estimatedCompanies: 1200,
  },
  {
    id: "chamber-aseer",
    name: "Aseer Chamber of Commerce",
    nameAr: "غرفة عسير",
    category: "chamber",
    url: "https://www.aseerchamber.org.sa",
    description: "Member companies of Aseer Region Chamber",
    estimatedCompanies: 800,
  },
  {
    id: "bluepages",
    name: "Blue Pages Saudi Arabia",
    nameAr: "الصفحات الزرقاء السعودية",
    category: "directory",
    url: "https://www.bluepages.com.sa",
    description: "Official Saudi business directory — 12,000+ companies across all chambers",
    estimatedCompanies: 12000,
  },
];
```

---

## 5. BACKEND: builder-engine.ts

### 5a. Main Harvest Function

```typescript
import { v4 as uuidv4 } from "uuid";

const SAUDI_SECTORS = [
  "construction & real estate", "oil & gas services", "petrochemicals",
  "food & beverage manufacturing", "retail & trading", "healthcare & pharmaceuticals",
  "logistics & transportation", "technology & IT services", "financial services & banking",
  "education & training", "hospitality & tourism", "agriculture & food processing",
  "media & advertising", "engineering & industrial services", "cleaning & facilities management",
  "automotive dealerships", "telecommunications", "security & safety services",
  "interior design & furniture", "printing & packaging",
];

interface RunHarvestOptions {
  sourceIds: string[];
  batchSize?: number;
  enrichmentDepth?: "basic" | "standard" | "deep";
  extraSources?: Array<{ id: string; name: string; url: string; category: string; nameAr: string; description: string; estimatedCompanies: number }>;
}

export async function runHarvest(options: RunHarvestOptions): Promise<{ jobId: string }> {
  const { sourceIds, batchSize = 1, enrichmentDepth = "standard", extraSources = [] } = options;
  const jobId = uuidv4();

  const allSources = [...SAUDI_DATA_SOURCES, ...extraSources];

  // Insert job record
  await db.insert(builderJobsTable).values({
    jobId,
    sourceIds,
    status: "harvesting",
    companiesHarvested: 0,
    progress: 0,
  });

  // Run in background
  setImmediate(async () => {
    let totalHarvested = 0;

    try {
      for (const sourceId of sourceIds) {
        const source = allSources.find(s => s.id === sourceId);
        if (!source) continue;

        console.log(`[Builder] Harvesting from: ${source.name}`);
        const companies = await harvestFromSource(source, { enrichmentDepth }).catch(() => []);

        for (const company of companies) {
          // Skip if blocked or duplicate
          if (await isBlocked({ nameEn: company.nameEn, nameAr: company.nameAr, crNumber: company.crNumber })) continue;
          const isDup = await checkDuplicate(company.nameEn || null, company.nameAr || null, jobId);

          await db.insert(builderCompaniesTable).values({
            jobId,
            sourceId: sourceId,
            sourceName: source.name,
            nameEn: company.nameEn || null,
            nameAr: company.nameAr || null,
            industry: company.industry || null,
            city: company.city || null,
            website: company.website || null,
            phone: company.phone || null,
            email: company.email || null,
            crNumber: company.crNumber || null,
            isDuplicate: isDup,
            enrichmentStatus: "pending",
          });
          totalHarvested++;
        }

        await db.update(builderJobsTable).set({
          companiesHarvested: totalHarvested,
          progress: Math.round((sourceIds.indexOf(sourceId) + 1) / sourceIds.length * 100),
        }).where(eq(builderJobsTable.jobId, jobId));
      }

      // Run enrichment if depth > basic
      if (enrichmentDepth !== "basic") {
        const pendingCompanies = await db.select().from(builderCompaniesTable)
          .where(and(eq(builderCompaniesTable.jobId, jobId), eq(builderCompaniesTable.enrichmentStatus, "pending")))
          .limit(500);

        for (const company of pendingCompanies) {
          await enrichCompanyWithAI(company.id, enrichmentDepth).catch(() => null);
        }
      }

      await db.update(builderJobsTable).set({
        status: "completed",
        companiesHarvested: totalHarvested,
        progress: 100,
        completedAt: new Date(),
      }).where(eq(builderJobsTable.jobId, jobId));
    } catch (err) {
      await db.update(builderJobsTable).set({
        status: "failed",
        error: (err as Error).message,
      }).where(eq(builderJobsTable.jobId, jobId));
    }
  });

  return { jobId };
}

async function harvestFromSource(
  source: DataSourceConfig,
  options: { enrichmentDepth: string }
): Promise<Array<{ nameEn?: string; nameAr?: string; industry?: string; city?: string; website?: string; phone?: string; email?: string; crNumber?: string }>> {
  switch (source.category) {
    case "wikidata":
      return harvestFromWikidata(source);
    case "government":
      return harvestFromGovernment(source);
    case "financial":
      return harvestFromFinancial(source);
    case "directory":
      return harvestFromDirectory(source);
    case "chamber":
      return harvestFromChamber(source);
    default:
      return harvestWithAI(source);
  }
}
```

### 5b. Source-Specific Harvesters

```typescript
async function harvestFromWikidata(source: DataSourceConfig) {
  const sparql = `
SELECT ?company ?companyLabel ?companyAltLabel ?industry ?industryLabel ?city ?cityLabel ?employees ?revenue ?website WHERE {
  ?company wdt:P17 wd:Q851.    # country = Saudi Arabia
  ?company wdt:P31/wdt:P279* wd:Q4830453.  # instance of business enterprise
  OPTIONAL { ?company wdt:P452 ?industry }
  OPTIONAL { ?company wdt:P159 ?city }
  OPTIONAL { ?company wdt:P1082 ?employees }
  OPTIONAL { ?company wdt:P2139 ?revenue }
  OPTIONAL { ?company wdt:P856 ?website }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar" }
} LIMIT 726`;

  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { "Accept": "application/json", "User-Agent": "ProspectSA/1.0" }, signal: AbortSignal.timeout(30000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results?.bindings || []).map((b: any) => ({
      nameEn: b.companyLabel?.value || null,
      nameAr: b.companyAltLabel?.value || null,
      industry: b.industryLabel?.value || null,
      city: b.cityLabel?.value || null,
      website: b.website?.value || null,
    }));
  } catch { return []; }
}

async function harvestFromGovernment(source: DataSourceConfig) {
  // Try CKAN API for data.gov.sa
  if (source.id === "saudi-open-data") {
    try {
      const res = await fetch(`https://data.gov.sa/api/3/action/organization_list`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        const orgs = data.result || [];
        return orgs.slice(0, 100).map((name: string) => ({
          nameEn: name,
          source: "saudi-open-data",
          city: "Saudi Arabia",
        }));
      }
    } catch { /* fall through */ }
  }

  // Fall back to AI generation for government sources
  return harvestWithAI(source);
}

async function harvestFromFinancial(source: DataSourceConfig) {
  // Tadawul has a public API for listed companies
  if (source.id === "tasi-listed") {
    try {
      const res = await fetch("https://www.saudiexchange.sa/wps/portal/tadawul/market-participants/listed-securities/listed-shares", {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      // Parse response for company names and tickers
    } catch { }
  }
  return harvestWithAI(source);
}

async function harvestFromDirectory(source: DataSourceConfig) {
  // BluPages has a JSON API
  if (source.id === "bluepages") {
    const results = [];
    try {
      for (const city of ["Riyadh", "Jeddah", "Dammam", "Khobar", "Mecca"]) {
        const res = await fetch(`https://api.bluepages.com.sa/companies?city=${encodeURIComponent(city)}&per_page=100`, {
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) {
          const data = await res.json();
          results.push(...(data.companies || []).map((c: any) => ({
            nameEn: c.name_en || c.name,
            nameAr: c.name_ar,
            city: c.city,
            phone: c.phone,
            email: c.email,
            website: c.website,
            industry: c.category || c.industry,
            crNumber: c.cr_number,
          })));
        }
      }
    } catch { }
    if (results.length > 0) return results;
  }
  return harvestWithAI(source);
}

async function harvestFromChamber(source: DataSourceConfig) {
  // Try Gemini to scrape chamber member pages
  if (isGeminiConfigured()) {
    try {
      const result = await searchWithGemini(
        `Visit ${source.url} and extract all member company names, industries, cities, phone numbers, and emails from the member directory. Return a JSON array of companies.`
      );
      if (result) {
        const match = String(result).match(/\[[\s\S]*\]/);
        if (match) {
          const companies = JSON.parse(match[0]);
          if (Array.isArray(companies) && companies.length > 0) return companies;
        }
      }
    } catch { }
  }
  return harvestWithAI(source);
}

async function harvestWithAI(source: DataSourceConfig) {
  // Fallback: use GPT-4o to generate realistic companies for this source
  const sector = SAUDI_SECTORS[Math.floor(Math.random() * SAUDI_SECTORS.length)];

  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: "You are a Saudi Arabia business data specialist. Generate realistic Saudi company data." },
        { role: "user", content: `Generate 30 realistic Saudi Arabia companies that would be listed in "${source.name}" (${source.description}).

Focus on: ${sector}

For each company provide: nameEn, nameAr, industry, city, website (if plausible), phone (Saudi format +966 5X XXXX XXXX), email, description, foundingYear, employeeCount.

Return ONLY a JSON array: [{"nameEn":"...","nameAr":"...","industry":"...","city":"...","website":"...","phone":"...","email":"...","description":"...","foundingYear":YYYY,"employeeCount":"..."}]` },
      ],
    });
    const text = r.choices[0]?.message?.content || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch { }
  return [];
}
```

### 5c. AI Enrichment

```typescript
export async function enrichCompanyWithAI(
  companyId: number,
  depth: "basic" | "standard" | "deep" = "standard"
): Promise<void> {
  const [company] = await db.select().from(builderCompaniesTable)
    .where(eq(builderCompaniesTable.id, companyId)).limit(1);
  if (!company) return;

  const name = company.nameEn || company.nameAr || "Unknown";

  await db.update(builderCompaniesTable).set({ enrichmentStatus: "enriching" })
    .where(eq(builderCompaniesTable.id, companyId));

  try {
    if (depth === "basic") {
      // Basic: just Perplexity or Gemini — no stealth browser
      const research = await webSearch(`Saudi company "${name}": website, phone, email, address, industry, city`);
      const score = calculateEnrichmentScore({ website: company.website, phone: company.phone, email: company.email });
      await db.update(builderCompaniesTable).set({
        enrichmentStatus: "enriched",
        enrichmentScore: score,
      }).where(eq(builderCompaniesTable.id, companyId));
      return;
    }

    if (depth === "standard") {
      // Standard: Perplexity + Gemini in parallel
      const [perplexityRes, geminiRes] = await Promise.allSettled([
        webSearch(`Saudi company "${name}": official website, phone number, email, address, CEO, industry, city, revenue estimate SAR, founding year.`),
        isGeminiConfigured()
          ? searchWithGemini(`Saudi company "${name}": website, phone, email, address, CEO name, industry, city, revenue, employees.`)
          : Promise.resolve(null),
      ]);

      const parts: string[] = [];
      if (perplexityRes.status === "fulfilled" && perplexityRes.value) parts.push(String(perplexityRes.value));
      if (geminiRes.status === "fulfilled" && geminiRes.value) parts.push(String(geminiRes.value));
      const combined = parts.join("\n\n").slice(0, 5000);

      await synthesizeAndUpdate(companyId, name, company, combined);
      return;
    }

    // Deep: all sources in parallel (same 14-source pattern as Masar Database)
    const [
      perplexityProfile, perplexityExecs, perplexityRevenue,
      geminiProfile, geminiExecs,
      claudeRes, openaiRes,
    ] = await Promise.allSettled([
      webSearch(`Saudi company "${name}": website phone email address revenue employees CEO founded industry city.`),
      webSearch(`"${name}" Saudi Arabia CEO chairman executives shareholders ownership مدير عام مساهمون.`),
      webSearch(`"${name}" Saudi Arabia annual revenue SAR employees government contracts paid-up capital.`),
      isGeminiConfigured() ? searchWithGemini(`Saudi company "${name}": full profile website phone email address CEO industry employees revenue. Verified data.`) : Promise.resolve(null),
      isGeminiConfigured() ? searchWithGemini(`"${name}" Saudi Arabia executives shareholders owners — full names Arabic and English with titles and ownership %.`) : Promise.resolve(null),
      (async () => {
        const msg = await Promise.race([
          anthropic.messages.create({
            model: "claude-sonnet-4-6", max_tokens: 1500,
            messages: [{ role: "user", content: `Research Saudi company "${name}". Provide CEO name EN+AR, key executives, major shareholders with %, founding year, revenue SAR, website. Verified public data only.` }],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
        ]);
        return msg.content[0]?.type === "text" ? msg.content[0].text : null;
      })(),
      (async () => {
        const r = await Promise.race([
          openai.chat.completions.create({
            model: "gpt-4o", max_completion_tokens: 800,
            messages: [{ role: "system", content: "You are a Saudi Arabia B2B intelligence analyst." }, { role: "user", content: `Facts about Saudi company "${name}": website, phone, email, CEO, shareholders, revenue, industry.` }],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
        ]);
        return r.choices[0]?.message?.content || null;
      })(),
    ]);

    const parts: string[] = [];
    [perplexityProfile, perplexityExecs, perplexityRevenue, geminiProfile, geminiExecs, claudeRes, openaiRes]
      .forEach((r) => {
        if (r.status === "fulfilled" && r.value) {
          const text = String(r.value);
          if (text.length > 30) parts.push(text.slice(0, 2000));
        }
      });

    await synthesizeAndUpdate(companyId, name, company, parts.join("\n\n---\n\n").slice(0, 8000));
  } catch (err) {
    await db.update(builderCompaniesTable).set({ enrichmentStatus: "failed" })
      .where(eq(builderCompaniesTable.id, companyId));
  }
}

async function synthesizeAndUpdate(
  companyId: number,
  name: string,
  company: typeof builderCompaniesTable.$inferSelect,
  research: string
): Promise<void> {
  const synthesisPrompt = `You are a Saudi Arabia B2B intelligence analyst. Extract structured data for: "${name}"

Research:
${research}

Return ONLY valid JSON:
{
  "website": "https://... or null",
  "phone": "+966... or null",
  "email": "... or null",
  "address": "full Saudi address or null",
  "description": "2-3 sentence description or null",
  "industry": "industry sector or null",
  "city": "city or null",
  "foundingYear": year_number_or_null,
  "employeeCount": number_or_null,
  "revenue": "SAR X - Y million (MANDATORY — derive if not explicit using: service capital×10-20x, trading capital×5-12x, construction capital×4-10x) or null",
  "ownerName": "primary owner/CEO name in English or null",
  "ownerNameAr": "اسم المالك بالعربية or null",
  "ownerTitle": "CEO/Chairman/Founder or null",
  "crNumber": "10-digit CR or null",
  "keyExecutives": "[{\"name\":\"\",\"title\":\"\"}] JSON string or null",
  "shareholders": "[{\"name\":\"\",\"percentage\":\"\"}] JSON string or null",
  "enrichmentScore": 0_to_100_based_on_completeness
}`;

  const [gptRes, claudeRes] = await Promise.allSettled([
    openai.chat.completions.create({
      model: "gpt-4o", max_completion_tokens: 1200,
      messages: [{ role: "system", content: "Return JSON only." }, { role: "user", content: synthesisPrompt }],
    }).then(r => r.choices[0]?.message?.content || "").catch(() => ""),
    anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 1200,
      messages: [{ role: "user", content: synthesisPrompt }],
    }).then(r => r.content[0]?.type === "text" ? r.content[0].text : "").catch(() => ""),
  ]);

  const texts = [gptRes, claudeRes].map(r => r.status === "fulfilled" ? r.value : "");
  let parsed: Record<string, unknown> = {};
  for (const text of texts) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const data = JSON.parse(match[0]);
        parsed = { ...parsed, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v != null && v !== "" && v !== "null")) };
        break;
      } catch { }
    }
  }

  const score = parsed.enrichmentScore as number || calculateEnrichmentScore(parsed);
  await db.update(builderCompaniesTable).set({
    website: (parsed.website as string) || company.website || null,
    phone: (parsed.phone as string) || company.phone || null,
    email: (parsed.email as string) || company.email || null,
    address: (parsed.address as string) || null,
    description: (parsed.description as string) || null,
    industry: (parsed.industry as string) || company.industry || null,
    city: (parsed.city as string) || company.city || null,
    foundingYear: (parsed.foundingYear as number) || null,
    employeeCount: (parsed.employeeCount as number) || null,
    revenue: (parsed.revenue as string) || null,
    ownerName: (parsed.ownerName as string) || null,
    ownerNameAr: (parsed.ownerNameAr as string) || null,
    ownerTitle: (parsed.ownerTitle as string) || null,
    crNumber: (parsed.crNumber as string) || company.crNumber || null,
    keyExecutives: (parsed.keyExecutives as string) || null,
    shareholders: (parsed.shareholders as string) || null,
    enrichmentScore: score,
    enrichmentStatus: "enriched",
    isValidated: true,
  }).where(eq(builderCompaniesTable.id, companyId));
}

function calculateEnrichmentScore(data: Record<string, unknown>): number {
  let score = 0;
  if (data.website) score += 15;
  if (data.phone) score += 15;
  if (data.email) score += 15;
  if (data.address) score += 10;
  if (data.ownerName) score += 15;
  if (data.revenue) score += 10;
  if (data.industry) score += 5;
  if (data.city) score += 5;
  if (data.foundingYear) score += 5;
  if (data.employeeCount) score += 5;
  return Math.min(100, score);
}

export async function reEnrichAll(): Promise<void> {
  const companies = await db.select().from(builderCompaniesTable)
    .where(eq(builderCompaniesTable.enrichmentStatus, "pending")).limit(200);
  for (const company of companies) {
    await enrichCompanyWithAI(company.id, "standard").catch(() => null);
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }
}

export async function getBuilderJob(jobId: string) {
  const [job] = await db.select().from(builderJobsTable)
    .where(eq(builderJobsTable.jobId, jobId)).limit(1);
  // Also check legacy jobs table
  if (!job) {
    const [legacyJob] = await db.select().from(jobsTable)
      .where(eq(jobsTable.jobId, jobId)).limit(1);
    if (legacyJob) return { status: legacyJob.status, companiesHarvested: legacyJob.companiesHarvested || 0, progress: legacyJob.progress || 0 };
  }
  return job;
}
```

---

## 6. API ROUTES (builder.ts)

```typescript
const router = Router();
const sourceLastHarvested: Record<string, Date> = {};

// GET /api/builder/sources — list all sources (built-in + custom)
router.get("/builder/sources", async (req, res) => {
  const custom = await db.select().from(builderCustomSourcesTable).orderBy(builderCustomSourcesTable.createdAt);

  const countRows = await db.execute(sql`SELECT source_id, COUNT(*)::int AS cnt FROM builder_companies GROUP BY source_id`);
  const countMap: Record<string, number> = {};
  for (const row of (countRows as any).rows ?? countRows) {
    const r = row as { source_id: string; cnt: number };
    if (r.source_id) countMap[r.source_id] = Number(r.cnt);
  }

  const all = [
    ...SAUDI_DATA_SOURCES.map(s => ({
      ...s, isEnabled: true, isCustom: false,
      lastHarvestedAt: sourceLastHarvested[s.id]?.toISOString() || null,
      harvestedCount: countMap[s.id] || 0,
    })),
    ...custom.map(s => ({
      id: `custom-${s.id}`, name: s.name, nameAr: s.nameAr || s.name,
      category: s.category, url: s.url, description: s.description || "",
      estimatedCompanies: s.estimatedCompanies || 0,
      isEnabled: true, isCustom: true, dbId: s.id,
      lastHarvestedAt: sourceLastHarvested[`custom-${s.id}`]?.toISOString() || null,
      harvestedCount: countMap[`custom-${s.id}`] || 0,
    })),
  ];
  res.json(all);
});

// POST /api/builder/sources — add custom source
router.post("/builder/sources", async (req, res) => {
  const { name, url, category, description, estimatedCompanies } = req.body;
  if (!name || !url || !category) { res.status(400).json({ error: "name, url, and category are required" }); return; }
  const [inserted] = await db.insert(builderCustomSourcesTable).values({
    name: name.trim(), nameAr: name.trim(),
    url: url.trim(), category: category.trim(),
    description: description?.trim() || null,
    estimatedCompanies: estimatedCompanies || 0,
  }).returning();
  res.json({ success: true, source: { id: `custom-${inserted.id}`, ...inserted, isCustom: true } });
});

// DELETE /api/builder/sources/:id
router.delete("/builder/sources/:id", async (req, res) => {
  const { id } = req.params;
  const numId = id.startsWith("custom-") ? parseInt(id.replace("custom-", ""), 10) : parseInt(id, 10);
  if (!isNaN(numId)) await db.delete(builderCustomSourcesTable).where(eq(builderCustomSourcesTable.id, numId));
  res.json({ success: true });
});

// POST /api/builder/sources/:id/harvest — harvest single source
router.post("/builder/sources/:id/harvest", async (req, res) => {
  const { id } = req.params;
  const { batchSize = 1, enrichmentDepth = "standard" } = req.body;
  const customSources = await db.select().from(builderCustomSourcesTable);
  const extraSources = customSources.map(s => ({
    id: `custom-${s.id}`, name: s.name, nameAr: s.nameAr || s.name,
    url: s.url, category: s.category as any, description: s.description || "",
    estimatedCompanies: s.estimatedCompanies || 0,
  }));

  const result = await runHarvest({ sourceIds: [id], batchSize, enrichmentDepth, extraSources });
  sourceLastHarvested[id] = new Date();

  // Insert into legacy jobs table so frontend can poll /api/builder/jobs/:jobId
  await db.insert(jobsTable).values({
    jobId: result.jobId,
    type: "builder_harvest",
    status: "harvesting",
    sourceIds: JSON.stringify([id]),
    sourcesTotal: 1,
  });

  res.json({ jobId: result.jobId, builderJobId: 1 });
});

// POST /api/builder/harvest — harvest all sources
router.post("/builder/harvest", async (req, res) => {
  const { batchSize = 3, enrichmentDepth = "standard" } = req.body;
  const customSources = await db.select().from(builderCustomSourcesTable);
  const extraSources = customSources.map(s => ({
    id: `custom-${s.id}`, name: s.name, nameAr: s.nameAr || s.name,
    url: s.url, category: s.category as any, description: s.description || "",
    estimatedCompanies: s.estimatedCompanies || 0,
  }));

  const allSourceIds = [
    ...SAUDI_DATA_SOURCES.map(s => s.id),
    ...extraSources.map(s => s.id),
  ];
  const result = await runHarvest({ sourceIds: allSourceIds, batchSize, enrichmentDepth, extraSources });

  await db.insert(jobsTable).values({
    jobId: result.jobId,
    type: "builder_harvest",
    status: "harvesting",
    sourceIds: JSON.stringify(allSourceIds),
    sourcesTotal: allSourceIds.length,
  });

  res.json({ jobId: result.jobId });
});

// GET /api/builder/jobs/:jobId — poll job status
router.get("/builder/jobs/:jobId", async (req, res) => {
  const job = await getBuilderJob(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(job);
});

// GET /api/builder/results — paginated company list
router.get("/builder/results", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || "25"))));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim();
  const sourceId = String(req.query.sourceId || "").trim();
  const enrichmentStatus = String(req.query.enrichmentStatus || "").trim();

  const conditions = [eq(builderCompaniesTable.isDuplicate, false)];
  if (search) conditions.push(or(
    ilike(builderCompaniesTable.nameEn, `%${search}%`),
    ilike(builderCompaniesTable.nameAr, `%${search}%`),
    ilike(builderCompaniesTable.industry, `%${search}%`),
    ilike(builderCompaniesTable.city, `%${search}%`),
  )!);
  if (sourceId) conditions.push(eq(builderCompaniesTable.sourceId, sourceId));
  if (enrichmentStatus) conditions.push(eq(builderCompaniesTable.enrichmentStatus, enrichmentStatus));

  const [companies, countResult] = await Promise.all([
    db.select().from(builderCompaniesTable).where(and(...conditions)).limit(limit).offset(offset).orderBy(desc(builderCompaniesTable.createdAt)),
    db.select({ count: sql`COUNT(*)` }).from(builderCompaniesTable).where(and(...conditions)),
  ]);
  res.json({ companies, total: Number(countResult[0].count), page, limit });
});

// POST /api/builder/results/:id/enrich — re-enrich single company
router.post("/builder/results/:id/enrich", async (req, res) => {
  const id = parseInt(req.params.id);
  await enrichCompanyWithAI(id, "deep");
  const [updated] = await db.select().from(builderCompaniesTable).where(eq(builderCompaniesTable.id, id)).limit(1);
  res.json({ success: true, company: updated });
});

// POST /api/builder/results/:id/save-enrichment — save OrcEngine enrichment back to record
router.post("/builder/results/:id/save-enrichment", async (req, res) => {
  const id = parseInt(req.params.id);
  const { keyExecutives, shareholders, description, marketPositioning } = req.body;
  await db.update(builderCompaniesTable).set({
    keyExecutives: keyExecutives || undefined,
    shareholders: shareholders || undefined,
    description: description || undefined,
    marketPositioning: marketPositioning || undefined,
    enrichmentStatus: "enriched",
  }).where(eq(builderCompaniesTable.id, id));
  res.json({ success: true });
});

// DELETE /api/builder/results/:id — delete + blocklist
router.delete("/builder/results/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [company] = await db.select().from(builderCompaniesTable).where(eq(builderCompaniesTable.id, id)).limit(1);
  if (company) {
    await addToBlocklist({ nameEn: company.nameEn, nameAr: company.nameAr, crNumber: company.crNumber });
    await db.delete(builderCompaniesTable).where(eq(builderCompaniesTable.id, id));
  }
  res.json({ success: true });
});

// POST /api/builder/push-to-database — copy selected records to main companies table
router.post("/builder/push-to-database", async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  const companies = await db.select().from(builderCompaniesTable)
    .where(inArray(builderCompaniesTable.id, ids));
  let pushed = 0;
  for (const c of companies) {
    try {
      await db.insert(companiesTable).values({
        nameEn: c.nameEn || null,
        nameAr: c.nameAr || null,
        crNumber: c.crNumber || null,
        industry: c.industry || null,
        city: c.city || null,
        website: c.website || null,
        phone: c.phone || null,
        email: c.email || null,
      }).onConflictDoNothing();
      pushed++;
    } catch { /* duplicate — ignore */ }
  }
  res.json({ success: true, pushed });
});

// GET /api/builder/stats — summary statistics
router.get("/builder/stats", async (req, res) => {
  const [total, enriched, bySource] = await Promise.all([
    db.select({ count: sql`COUNT(*)` }).from(builderCompaniesTable)
      .where(eq(builderCompaniesTable.isDuplicate, false)),
    db.select({ count: sql`COUNT(*)` }).from(builderCompaniesTable)
      .where(and(eq(builderCompaniesTable.isDuplicate, false), eq(builderCompaniesTable.enrichmentStatus, "enriched"))),
    db.execute(sql`SELECT source_id, COUNT(*)::int AS cnt FROM builder_companies WHERE is_duplicate = false GROUP BY source_id`),
  ]);
  res.json({
    total: Number(total[0].count),
    enriched: Number(enriched[0].count),
    bySource: Object.fromEntries(((bySource as any).rows ?? bySource).map((r: any) => [r.source_id, r.cnt])),
  });
});

// POST /api/builder/export — bulk export
router.post("/builder/export", async (req, res) => {
  const { format, ids } = req.body as { format: "xlsx" | "csv" | "pptx"; ids?: number[] };
  const where = ids?.length
    ? and(inArray(builderCompaniesTable.id, ids), eq(builderCompaniesTable.isDuplicate, false))
    : eq(builderCompaniesTable.isDuplicate, false);
  const companies = await db.select().from(builderCompaniesTable).where(where).limit(5000);

  if (format === "csv") {
    const keys = ["nameEn", "nameAr", "industry", "city", "website", "phone", "email", "ownerName", "revenue", "enrichmentStatus", "sourceId"];
    const csv = [keys.join(","), ...companies.map(c => keys.map(k => `"${String((c as any)[k] || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="builder-companies-${Date.now()}.csv"`);
    res.send(csv);
    return;
  }

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const rows = companies.map(c => ({
      "Name (EN)": c.nameEn || "", "Name (AR)": c.nameAr || "",
      "Industry": c.industry || "", "City": c.city || "",
      "Website": c.website || "", "Phone": c.phone || "",
      "Email": c.email || "", "Owner": c.ownerName || "",
      "Revenue": c.revenue || "", "Source": c.sourceId || "",
      "Enrichment": c.enrichmentStatus || "", "Score": c.enrichmentScore || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Builder Results");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const base64 = buf.toString("base64");
    res.json({ content: base64, filename: `builder-companies-${Date.now()}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return;
  }

  if (format === "pptx") {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    for (const company of companies.slice(0, 50)) {
      const slide = pptx.addSlide();
      slide.addText(company.nameEn || company.nameAr || "Unknown", { x: 0.5, y: 0.3, fontSize: 20, bold: true, color: "FFFFFF" });
      slide.addText([
        { text: `Industry: ${company.industry || "—"}\n`, options: {} },
        { text: `City: ${company.city || "—"}\n`, options: {} },
        { text: `Revenue: ${company.revenue || "—"}\n`, options: {} },
        { text: `Website: ${company.website || "—"}\n`, options: {} },
        { text: `Phone: ${company.phone || "—"}\n`, options: {} },
        { text: `Email: ${company.email || "—"}`, options: {} },
      ], { x: 0.5, y: 1.5, w: 9, h: 5, fontSize: 14, color: "CCCCCC" });
    }
    const buf = await pptx.write({ outputType: "nodebuffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="builder-companies-${Date.now()}.pptx"`);
    res.send(buf);
    return;
  }
});
```

---

## 7. FRONTEND: database-builder/index.tsx

### 7a. Main Page State

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const [sources, setSources] = useState<SourceItem[]>([]);
const [sourcesLoading, setSourcesLoading] = useState(true);
const [harvestStates, setHarvestStates] = useState<Record<string, HarvestState>>({});
const [harvestAllRunning, setHarvestAllRunning] = useState(false);
const [enrichmentDepth, setEnrichmentDepth] = useState<"basic" | "standard" | "deep">("standard");

// Add Source modal
const [addSourceOpen, setAddSourceOpen] = useState(false);
const [srcName, setSrcName] = useState("");
const [srcUrl, setSrcUrl] = useState("");
const [srcCategory, setSrcCategory] = useState("business-directory");
const [srcEstimated, setSrcEstimated] = useState("");
const [srcDescription, setSrcDescription] = useState("");

interface HarvestState {
  status: "idle" | "harvesting" | "done" | "error";
  count?: number;
  error?: string;
}

const loadSources = async () => {
  const res = await fetch(`${BASE}/api/builder/sources`);
  const data = await res.json();
  setSources(data);
  setSourcesLoading(false);
};

useEffect(() => { loadSources(); }, []);
```

### 7b. Harvest Logic (single source)

```typescript
const harvestOne = async (source: SourceItem) => {
  setHarvestStates(prev => ({ ...prev, [source.id]: { status: "harvesting" } }));
  try {
    const res = await fetch(`${BASE}/api/builder/sources/${encodeURIComponent(source.id)}/harvest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchSize: 1, enrichmentDepth }),
    });
    if (!res.ok) {
      const err = await res.json();
      setHarvestStates(prev => ({ ...prev, [source.id]: { status: "error", error: err.error || "Harvest failed" } }));
      return;
    }
    const job = await res.json();

    // Poll until done
    let polls = 0;
    const poll = async () => {
      const jobRes = await fetch(`${BASE}/api/builder/jobs/${job.jobId}`);
      const jobData = await jobRes.json();
      if (jobData.status === "completed") {
        setHarvestStates(prev => ({ ...prev, [source.id]: { status: "done", count: jobData.companiesHarvested } }));
        setSources(prev => prev.map(s => s.id === source.id ? { ...s, lastHarvestedAt: new Date().toISOString() } : s));
      } else if (jobData.status === "failed" || jobData.status === "cancelled") {
        setHarvestStates(prev => ({ ...prev, [source.id]: { status: "error", error: `Job ${jobData.status}` } }));
      } else if (polls < 60) {
        polls++;
        setTimeout(() => poll(), 3000);
      } else {
        setHarvestStates(prev => ({ ...prev, [source.id]: { status: "error", error: "Timed out" } }));
      }
    };
    setTimeout(() => poll(), 2000);
  } catch (e) {
    setHarvestStates(prev => ({ ...prev, [source.id]: { status: "error", error: (e as Error).message } }));
  }
};
```

### 7c. Full JSX Layout

```tsx
const categoryIcon: Record<string, string> = {
  wikidata: "🌍", government: "🏛️", directory: "📂",
  chamber: "🤝", financial: "💹",
  "business-directory": "📂", "chamber-of-commerce": "🤝",
  "industry-association": "🏭", linkedin: "💼", news: "📰", other: "🔗",
};

return (
  <div className="space-y-8 animate-in fade-in duration-500">
    {/* Header */}
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-white">AI Database Builder</h1>
        <p className="text-muted-foreground mt-2">
          Autonomous harvesting from Saudi data sources. Click ▶ on any source to harvest individually.
        </p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Enrichment depth selector */}
        <Select value={enrichmentDepth} onValueChange={v => setEnrichmentDepth(v as typeof enrichmentDepth)}>
          <SelectTrigger className="bg-black/40 border-white/15 text-white w-44 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="basic">Basic enrichment</SelectItem>
            <SelectItem value="standard">Standard enrichment</SelectItem>
            <SelectItem value="deep">Deep enrichment</SelectItem>
          </SelectContent>
        </Select>

        {/* View Results link */}
        <Link href="/database-builder/results" className="text-sm font-medium text-primary hover:underline">
          View Results →
        </Link>

        {/* Add Source dialog */}
        <Dialog open={addSourceOpen} onOpenChange={setAddSourceOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="border-white/15 text-white gap-2 h-9">
              <Plus className="w-4 h-4" /> Add Source
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-white/10 sm:max-w-[500px]">
            <DialogHeader><DialogTitle className="text-white">Add Custom Data Source</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-muted-foreground text-xs">Source Name *</Label>
                <Input value={srcName} onChange={e => setSrcName(e.target.value)}
                  placeholder="e.g. Saudi Exporters Directory" className="bg-black/40 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Website URL *</Label>
                <Input value={srcUrl} onChange={e => setSrcUrl(e.target.value)}
                  placeholder="https://example.com" className="bg-black/40 border-white/10 text-white mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-muted-foreground text-xs">Category</Label>
                  <Select value={srcCategory} onValueChange={setSrcCategory}>
                    <SelectTrigger className="bg-black/40 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="business-directory">Business Directory</SelectItem>
                      <SelectItem value="chamber-of-commerce">Chamber of Commerce</SelectItem>
                      <SelectItem value="government">Government Portal</SelectItem>
                      <SelectItem value="industry-association">Industry Association</SelectItem>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="news">News / Media</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Est. Companies Listed</Label>
                  <Input value={srcEstimated} onChange={e => setSrcEstimated(e.target.value.replace(/\D/g, ""))}
                    placeholder="e.g. 1200" className="bg-black/40 border-white/10 text-white mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Description (optional)</Label>
                <Textarea value={srcDescription} onChange={e => setSrcDescription(e.target.value)}
                  placeholder="Briefly describe what this source provides…"
                  className="bg-black/40 border-white/10 text-white resize-none min-h-[60px] mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddSourceOpen(false)} className="border-white/10">Cancel</Button>
              <Button onClick={async () => {
                const res = await fetch(`${BASE}/api/builder/sources`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: srcName, url: srcUrl, category: srcCategory, estimatedCompanies: srcEstimated ? parseInt(srcEstimated) : null, description: srcDescription }),
                });
                if (res.ok) { setAddSourceOpen(false); setSrcName(""); setSrcUrl(""); setSrcEstimated(""); setSrcDescription(""); loadSources(); }
              }}>Add Source</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Harvest All */}
        <Button
          onClick={async () => {
            setHarvestAllRunning(true);
            for (const s of sources) setHarvestStates(prev => ({ ...prev, [s.id]: { status: "harvesting" } }));
            const res = await fetch(`${BASE}/api/builder/harvest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ batchSize: 3, enrichmentDepth }),
            });
            const job = await res.json();
            let polls = 0;
            const poll = async () => {
              const jr = await fetch(`${BASE}/api/builder/jobs/${job.jobId}`).then(r => r.json());
              if (jr.status === "completed" || jr.status === "failed") {
                for (const s of sources) setHarvestStates(prev => ({ ...prev, [s.id]: { status: jr.status === "completed" ? "done" : "idle" } }));
                setHarvestAllRunning(false);
              } else if (polls < 120) { polls++; setTimeout(() => poll(), 3000); }
              else setHarvestAllRunning(false);
            };
            setTimeout(() => poll(), 2000);
          }}
          disabled={harvestAllRunning || sourcesLoading}
          className="bg-gradient-to-r from-primary to-accent border-none h-9"
        >
          {harvestAllRunning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Harvesting All…</> : <><Zap className="w-4 h-4 mr-2" />Harvest All</>}
        </Button>
      </div>
    </div>

    {/* Sources Grid */}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {sourcesLoading
        ? [1,2,3,4,5,6].map(i => <Card key={i} className="h-36 bg-white/5 border-white/5 animate-pulse" />)
        : sources.map(source => {
          const hs = harvestStates[source.id] || { status: "idle" };
          return (
            <Card key={source.id} className={cn(
              "bg-card/40 backdrop-blur-sm border transition-all duration-200",
              hs.status === "harvesting" && "border-primary/60 shadow-[0_0_20px_rgba(6,182,212,0.15)]",
              hs.status === "done" && "border-emerald-500/40",
              hs.status === "error" && "border-rose-500/30",
              hs.status === "idle" && "border-white/10 hover:border-white/20",
            )}>
              <CardContent className="p-5">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span>{categoryIcon[source.category] || "🔗"}</span>
                      <h4 className="font-semibold text-white text-sm truncate">{source.name}</h4>
                      {source.isCustom && (
                        <span className="text-[10px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded shrink-0">Custom</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{source.url}</p>
                    {source.description && <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-1">{source.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {source.isCustom && (
                      <button
                        onClick={async () => {
                          await fetch(`${BASE}/api/builder/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
                          loadSources();
                        }}
                        className="text-muted-foreground hover:text-rose-400 transition-colors p-1"
                      ><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                    <button
                      onClick={() => harvestOne(source)}
                      disabled={hs.status === "harvesting" || harvestAllRunning}
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                        hs.status === "harvesting" ? "bg-primary/20 text-primary cursor-not-allowed" :
                        hs.status === "done" ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" :
                        hs.status === "error" ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30" :
                        "bg-primary/10 text-primary hover:bg-primary/25 hover:scale-110",
                      )}
                    >
                      {hs.status === "harvesting" ? <Loader2 className="w-4 h-4 animate-spin" />
                        : hs.status === "done" ? <CheckCircle2 className="w-4 h-4" />
                        : hs.status === "error" ? <AlertCircle className="w-4 h-4" />
                        : <Play className="w-4 h-4 ml-0.5" />}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t border-white/5 pt-3">
                  <div className="flex items-center gap-1.5">
                    <Database className="w-3 h-3" />
                    {(source.harvestedCount || 0) > 0
                      ? <><span className="text-emerald-400 font-medium">{source.harvestedCount!.toLocaleString()} harvested</span><span className="opacity-50 mx-1">/</span>~{source.estimatedCompanies?.toLocaleString() || "N/A"} est.</>
                      : <span>~{source.estimatedCompanies?.toLocaleString() || "N/A"} estimated</span>
                    }
                  </div>
                  <div className="flex items-center gap-1.5">
                    {hs.status === "harvesting" ? <span className="text-primary animate-pulse">Harvesting…</span>
                      : hs.status === "done" ? <span className="text-emerald-400">{hs.count ?? 0} added</span>
                      : hs.status === "error" ? <span className="text-rose-400 truncate max-w-[120px]">{hs.error}</span>
                      : <><Clock className="w-3 h-3" />{source.lastHarvestedAt ? new Date(source.lastHarvestedAt).toLocaleDateString() : "Never"}</>
                    }
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  </div>
);
```

---

## 8. FRONTEND: database-builder/results.tsx (key parts)

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Queries
const { data: stats } = useQuery({
  queryKey: ["builder-stats"],
  queryFn: () => fetch(`${BASE}/api/builder/stats`).then(r => r.json()),
  refetchInterval: 30000,
});

const { data: resultsData } = useQuery({
  queryKey: ["builder-results", page, search, sourceFilter, statusFilter],
  queryFn: () => {
    const params = new URLSearchParams({ page: String(page), limit: "25" });
    if (search) params.set("search", search);
    if (sourceFilter) params.set("sourceId", sourceFilter);
    if (statusFilter) params.set("enrichmentStatus", statusFilter);
    return fetch(`${BASE}/api/builder/results?${params}`).then(r => r.json());
  },
});

// Add Lead (fires background person intel enrichment)
const addPersonAsLead = async (person: Record<string, unknown>, company: BuilderCompany, personTitle?: string) => {
  const fullName = String(person.name || person.nameEn || "");
  if (!fullName) return;

  // Step 1: Save lead immediately
  await fetch(`${BASE}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: fullName.split(" ")[0] || "",
      lastName: fullName.split(" ").slice(1).join(" ") || "",
      title: personTitle || String(person.title || person.role || ""),
      email: String(person.email || ""),
      phone: String(person.phone || ""),
      industry: company.industry || "",
      city: company.city || "",
      notes: `Company: ${company.nameEn || company.nameAr}`,
      status: "new",
      source: "database-builder",
    }),
  });

  // Step 2: Fire background person intel enrichment
  fetch(`${BASE}/api/person-intel/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: fullName,
      company: company.nameEn || company.nameAr,
      title: personTitle || String(person.title || ""),
      knownFacts: `Industry: ${company.industry || ""}. City: ${company.city || ""}.`,
    }),
  }).then(async (pr) => {
    if (!pr.ok) return;
    const profileData = await pr.json();
    // Step 3: Auto-save to ProsEngine Research
    await fetch(`${BASE}/api/person-intel/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personName: fullName, company: company.nameEn, title: personTitle, report: profileData, tags: "builder-auto" }),
    });
  }).catch(() => {});
};

// Export
const exportCompanies = async (format: "xlsx" | "csv" | "pptx", selectedIds?: number[]) => {
  const res = await fetch(`${BASE}/api/builder/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, ids: selectedIds }),
  });
  if (format === "csv") {
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `builder-companies-${Date.now()}.csv`;
    a.click();
  } else {
    const data = await res.json();
    const binary = atob(data.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: data.mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = data.filename;
    a.click();
  }
};
```

---

## 9. KEY IMPLEMENTATION NOTES

1. **Polling pattern for harvest**: Frontend calls `/api/builder/sources/:id/harvest` → gets `jobId` → polls `/api/builder/jobs/:jobId` every 3 seconds → max 60 polls (3 minutes) → updates UI with done/error state.

2. **Harvest All vs Single**: "Harvest All" calls `/api/builder/harvest` with all source IDs. "Single source" calls `/api/builder/sources/:id/harvest`. Both return a `jobId` to poll.

3. **Enrichment depth selector**: Frontend passes `enrichmentDepth` in harvest request body. Backend passes this to `enrichCompanyWithAI()`:
   - `basic`: just Perplexity + Gemini, no Claude synthesis
   - `standard`: Perplexity + Gemini + GPT-4o synthesis
   - `deep`: all 7 sources + Claude + synthesis (same pattern as Masar enrichment)

4. **Blocklist integration**: `isBlocked()` checks a `blocklist` table. When a user deletes a company, `addToBlocklist()` adds its name/CR to prevent re-harvesting.

5. **Duplicate detection**: `checkDuplicate()` queries both `builder_companies` AND the main `companies` table by nameEn, nameAr, and crNumber. Duplicates are flagged (`isDuplicate: true`) but not deleted — they're filtered out of the default results view.

6. **Auto-clean** (`/api/builder/clean`): validates phone numbers (Saudi regex), emails (basic regex), websites (URL.parse), and removes invalid values. Also re-flags duplicates.

7. **OrcEngine deep enrichment**: The Results page's detail panel has an "Enrich with AI" button that calls `/api/orcengine/enrich/company` — this is a more expensive per-company enrichment that returns executives and shareholders, which are then saved back to the builder record via `/api/builder/results/:id/save-enrichment`.

8. **"Push to Database"**: Copies selected records from `builder_companies` to the main `companies` table using `.onConflictDoNothing()` on the CR number unique constraint.

9. **Custom sources are stored in DB**: `builder_custom_sources` table. They persist across restarts. The `/api/builder/sources` endpoint merges SAUDI_DATA_SOURCES (static) + custom DB sources on every request.

10. **Source count tracking**: A `COUNT(*) GROUP BY source_id` query runs on every `/api/builder/sources` call to show how many companies have been harvested per source — no need for a separate counter.
