# Document 2: Masar Agentic Company Database
## Complete Standalone Replication Guide

---

## 1. WHAT THIS IS

The Masar Company Database is an agentic harvesting system that autonomously collects, enriches, and stores Saudi Arabian company records from 25+ data sources in 6 categories. It is separate from the Masaar Engine and uses its own database table (`masar_companies`).

**The database accepts a harvest request with:**
- Company name or keyword (optional)
- Topic/industry sector (optional — 26 Saudi sectors)
- AI instructions (freeform — "focus on tech companies in Riyadh with 50+ employees")
- Filter parameters: city (20 Saudi cities), legal form (8 options), company size (5 options), revenue range (5 options)

**Each harvest run:**
1. Queries multiple source engines in parallel
2. For each raw company found, runs 14-source parallel enrichment (Stealth Browser + Perplexity ×7 + Gemini ×4 + Claude + GPT-4o)
3. Stores results in `masar_companies` PostgreSQL table
4. Streams real-time progress via SSE

**The 25 source categories:**
- **General**: Saudi Open Data/CKAN (Wikipedia+Gemini), BluPages JSON API, Saudi Gov Data CKAN
- **Government Registries**: Muqawil (contractors), Etimad (government tenders), MODON (industrial), REGA (real estate)
- **Professional Sectors**: Lawyers, auditors, healthcare, banks, logistics
- **Documents**: Amaaly AOA PDF scraper
- **Open Registries**: OpenCorporates, GLEIF, Wikidata SPARQL
- **Professional Directories**: Moores Rowland, Arab British Chamber, AmCham Saudi, SBBC, JCC, French Chamber KSA, German Arab Chamber, GCC Chambers, ICAEW

---

## 2. TECH STACK

Same as Document 1. Key additions:
```
xlsx           — for Excel export
pptxgenjs      — for PowerPoint export
pdf-parse      — for AOA PDF text extraction
```

**Required environment variables:**
```
ANTHROPIC_API_KEY     (or AI_INTEGRATIONS_ANTHROPIC_API_KEY)
OPENAI_API_KEY        (or AI_INTEGRATIONS_OPENAI_API_KEY)
GEMINI_API_KEY
PERPLEXITY_API_KEY
DATABASE_URL
```

---

## 3. DATABASE SCHEMA

```sql
CREATE TABLE masar_companies (
  id                     SERIAL PRIMARY KEY,
  name_en                TEXT,
  name_ar                TEXT,
  cr_number              TEXT UNIQUE,
  legal_form             TEXT,
  legal_form_ar          TEXT,
  city                   TEXT,
  city_ar                TEXT,
  region                 TEXT,
  paid_up_capital        TEXT,
  authorized_capital     TEXT,
  founding_date          TEXT,
  founding_year          TEXT,
  registration_date      TEXT,
  expiry_date            TEXT,
  authorized_signatory   TEXT,
  shareholders           JSONB DEFAULT '[]',
  board_of_directors     JSONB DEFAULT '[]',
  management             JSONB DEFAULT '[]',
  main_activity          TEXT,
  main_activity_ar       TEXT,
  registration_status    TEXT DEFAULT 'Active',
  source                 TEXT DEFAULT 'open-data',
  source_url             TEXT,
  enrichment_status      TEXT DEFAULT 'pending',
  capital_distribution   TEXT,
  profit_distribution_rules TEXT,
  revenue_estimate       TEXT,
  revenue_rationale      TEXT,
  website                TEXT,
  phone                  TEXT,
  email                  TEXT,
  employee_count         TEXT,
  owner_name             TEXT,
  owner_name_ar          TEXT,
  owner_title            TEXT,
  owner_wealth           TEXT,
  news_headlines         JSONB DEFAULT '[]',
  enrichment_data        JSONB,
  analysis_en            TEXT,
  analysis_ar            TEXT,
  analysis_data          JSONB,
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_masar_companies_cr ON masar_companies(cr_number);
CREATE INDEX idx_masar_companies_name_en ON masar_companies(name_en);
CREATE INDEX idx_masar_companies_name_ar ON masar_companies(name_ar);
CREATE INDEX idx_masar_companies_city ON masar_companies(city);
CREATE INDEX idx_masar_companies_enrichment_status ON masar_companies(enrichment_status);
CREATE INDEX idx_masar_companies_source ON masar_companies(source);

CREATE TABLE masar_harvest_jobs (
  id          SERIAL PRIMARY KEY,
  job_id      TEXT UNIQUE NOT NULL,
  keyword     TEXT,
  sources     TEXT[],
  status      TEXT DEFAULT 'running',
  companies_found INT DEFAULT 0,
  companies_enriched INT DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE masar_custom_sources (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  name_ar             TEXT,
  url                 TEXT NOT NULL,
  category            TEXT NOT NULL,
  description         TEXT,
  estimated_companies INT DEFAULT 0,
  created_at          TIMESTAMP DEFAULT NOW()
);
```

**Drizzle ORM schema:**
```typescript
import { pgTable, serial, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const masarCompaniesTable = pgTable("masar_companies", {
  id:                  serial("id").primaryKey(),
  nameEn:              text("name_en"),
  nameAr:              text("name_ar"),
  crNumber:            text("cr_number").unique(),
  legalForm:           text("legal_form"),
  legalFormAr:         text("legal_form_ar"),
  city:                text("city"),
  cityAr:              text("city_ar"),
  region:              text("region"),
  paidUpCapital:       text("paid_up_capital"),
  authorizedCapital:   text("authorized_capital"),
  foundingDate:        text("founding_date"),
  foundingYear:        text("founding_year"),
  registrationDate:    text("registration_date"),
  expiryDate:          text("expiry_date"),
  authorizedSignatory: text("authorized_signatory"),
  shareholders:        jsonb("shareholders").$type<Array<{ nameEn: string; nameAr: string; nationalId: string; ownershipPct: string; nationality: string }>>().default([]),
  boardOfDirectors:    jsonb("board_of_directors").$type<Array<{ nameEn: string; nameAr: string; role: string }>>().default([]),
  management:          jsonb("management").$type<Array<{ nameEn: string; nameAr: string; title: string; powers?: string }>>().default([]),
  mainActivity:        text("main_activity"),
  mainActivityAr:      text("main_activity_ar"),
  registrationStatus:  text("registration_status").default("Active"),
  source:              text("source").default("open-data"),
  sourceUrl:           text("source_url"),
  enrichmentStatus:    text("enrichment_status").default("pending"),
  capitalDistribution: text("capital_distribution"),
  profitDistributionRules: text("profit_distribution_rules"),
  revenueEstimate:     text("revenue_estimate"),
  revenueRationale:    text("revenue_rationale"),
  website:             text("website"),
  phone:               text("phone"),
  email:               text("email"),
  employeeCount:       text("employee_count"),
  ownerName:           text("owner_name"),
  ownerNameAr:         text("owner_name_ar"),
  ownerTitle:          text("owner_title"),
  ownerWealth:         text("owner_wealth"),
  newsHeadlines:       jsonb("news_headlines").default([]),
  enrichmentData:      jsonb("enrichment_data"),
  analysisEn:          text("analysis_en"),
  analysisAr:          text("analysis_ar"),
  analysisData:        jsonb("analysis_data"),
  createdAt:           timestamp("created_at").defaultNow(),
  updatedAt:           timestamp("updated_at").defaultNow(),
});

export const masarHarvestJobsTable = pgTable("masar_harvest_jobs", {
  id:                serial("id").primaryKey(),
  jobId:             text("job_id").unique().notNull(),
  keyword:           text("keyword"),
  sources:           text("sources").array(),
  status:            text("status").default("running"),
  companiesFound:    integer("companies_found").default(0),
  companiesEnriched: integer("companies_enriched").default(0),
  error:             text("error"),
  createdAt:         timestamp("created_at").defaultNow(),
  completedAt:       timestamp("completed_at"),
});

export const masarCustomSourcesTable = pgTable("masar_custom_sources", {
  id:                  serial("id").primaryKey(),
  name:                text("name").notNull(),
  nameAr:              text("name_ar"),
  url:                 text("url").notNull(),
  category:            text("category").notNull(),
  description:         text("description"),
  estimatedCompanies:  integer("estimated_companies").default(0),
  createdAt:           timestamp("created_at").defaultNow(),
});
```

---

## 4. THE 25 SOURCES (masar-harvester.ts)

### Source IDs and their harvest functions:

```typescript
// Source → harvest function mapping in runHarvest():
const SOURCE_HANDLERS: Record<string, (kw: string, ctx: HarvestOptions, emitter: EventEmitter) => Promise<CompanyData[]>> = {
  "open-data":       harvestFromOpenData,       // data.gov.sa CKAN API
  "gov-data-sa":     harvestFromOpenData,       // alias
  "open-data/wikipedia-gemini": harvestFromOpenData,
  "bluepages":       harvestFromBluepages,      // bluepages.com.sa JSON API
  "amaaly-aoa":      harvestFromAmaaly,         // emagazine.aamaly.sa AOA scraper
  "contractors":     harvestFromDirectory,      // muqawil.gov.sa
  "muqawil":         harvestFromDirectory,
  "etimad":          harvestFromDirectory,      // etimad.sa
  "industrial":      harvestFromDirectory,      // modon.gov.sa
  "realestate":      harvestFromDirectory,      // rega.gov.sa
  "lawyers":         harvestFromDirectory,
  "auditors":        harvestFromDirectory,
  "healthcare":      harvestFromDirectory,
  "banks":           harvestFromDirectory,
  "logistics":       harvestFromDirectory,
  "opencorporates":  harvestOpenCorporatesSA,  // opencorporates.com API
  "gleif":           harvestGleifSA,           // gleif.org API
  "wikidata-sparql": harvestWikidataSA,        // wikidata SPARQL query
  "mooresrowland":   (kw, ctx, em) => harvestFromDirectory({ id: "mooresrowland", name: "Moores Rowland", url: "https://mooresrowland.com.sa/members", ...}, kw, ctx, em),
  "arabbritishchamber": ...,
  "amcham-saudi":    ...,
  "sbbc":            ...,
  "jcc":             ...,
  "french-chamber-ksa": ...,
  "german-arab-chamber": ...,
  "gcc-chambers":    ...,
  "icaew":           ...,
};
```

### 4a. Open Data Harvester (data.gov.sa CKAN API)

```typescript
async function harvestFromOpenData(
  keyword: string,
  ctx: HarvestOptions,
  emitter: EventEmitter
): Promise<CompanyData[]> {
  const companies: CompanyData[] = [];
  const constraints = buildContextConstraints(ctx);

  // Query 1: CKAN API with keyword
  try {
    const ckanUrl = `https://data.gov.sa/api/3/action/package_search?q=${encodeURIComponent(keyword)}&rows=100`;
    const res = await fetchWithTimeout(ckanUrl, 12000);
    if (res.ok) {
      const data = await res.json();
      const datasets = data.result?.results || [];
      // Extract company references from dataset metadata
      for (const ds of datasets) {
        if (ds.title && (ds.organization?.title || ds.maintainer)) {
          companies.push({
            nameEn: ds.title,
            nameAr: ds.title_translated?.ar || null,
            source: "open-data",
            sourceUrl: `https://data.gov.sa/dataset/${ds.name}`,
            mainActivity: ds.tags?.map((t: any) => t.name).join(", ") || null,
          });
        }
      }
    }
  } catch { /* ignore */ }

  // Query 2: Gemini-powered web harvest (browses live pages)
  if (isGeminiConfigured()) {
    const geminiRes = await extractCompaniesWithGemini(
      keyword,
      `https://data.gov.sa/ar`,
      constraints
    ).catch(() => null);
    if (Array.isArray(geminiRes)) companies.push(...geminiRes);
  }

  // Query 3: AI generation fallback — generates plausible Saudi companies
  if (companies.length < 5) {
    const aiGenerated = await generateCompaniesWithAI(keyword, ctx, emitter, 20);
    companies.push(...aiGenerated);
  }

  log(emitter, `Open Data: ${companies.length} companies found`, "success");
  return companies;
}
```

### 4b. Amaaly AOA Harvester

```typescript
async function harvestFromAmaaly(
  keyword: string,
  ctx: HarvestOptions,
  emitter: EventEmitter
): Promise<CompanyData[]> {
  const companies: CompanyData[] = [];
  log(emitter, "🗞️ Searching Amaaly AOA magazine for company records…", "info");

  const browser = new StealthBrowser();
  await browser.launch();

  try {
    // Search emagazine.aamaly.sa for keyword
    await browser.goto(`https://emagazine.aamaly.sa/Search?q=${encodeURIComponent(keyword)}`);
    await HumanBehavior.randomDelay(2000, 4000);

    const pageContent = await browser.evaluate(() => document.body.innerText);
    const links = await browser.evaluate(() =>
      Array.from(document.querySelectorAll("a[href*='View'], a[href*='show']"))
        .map(a => (a as HTMLAnchorElement).href)
        .slice(0, 20)
    );

    // Visit each AOA document
    for (const link of links.slice(0, 5)) {
      try {
        await browser.goto(link);
        await HumanBehavior.randomDelay(1500, 3000);
        const docText = await browser.evaluate(() => document.body.innerText.slice(0, 8000));

        // Use Claude to extract company data from AOA text
        const extractPrompt = `Extract company data from this Saudi AOA document text. Return JSON array of companies found:
[{
  "nameEn": "Company Name in English",
  "nameAr": "اسم الشركة",
  "crNumber": "CR number if found",
  "legalForm": "LLC/JSC/etc",
  "city": "city",
  "paidUpCapital": "SAR amount",
  "shareholders": [{"nameEn":"","nameAr":"","ownershipPct":"","nationality":""}],
  "management": [{"nameEn":"","nameAr":"","title":""}]
}]

AOA Text:
${docText}`;

        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [{ role: "user", content: extractPrompt }],
        });
        const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const extracted = JSON.parse(match[0]);
          companies.push(...extracted.map((c: any) => ({ ...c, source: "amaaly-aoa", sourceUrl: link })));
        }
      } catch { /* continue */ }
    }
  } finally {
    await browser.stop();
  }

  log(emitter, `Amaaly: ${companies.length} companies extracted from AOA documents`, "success");
  return companies;
}
```

### 4c. OpenCorporates Harvester

```typescript
export async function harvestOpenCorporatesSA(
  keyword?: string
): Promise<CompanyData[]> {
  const companies: CompanyData[] = [];
  try {
    // OpenCorporates has a free API for Saudi companies
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(keyword || "")}&jurisdiction_code=sa&per_page=100`;
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) return companies;
    const data = await res.json();
    for (const item of (data.results?.companies || [])) {
      const c = item.company;
      companies.push({
        nameEn: c.name || null,
        crNumber: c.company_number || null,
        city: c.registered_address?.locality || null,
        registrationStatus: c.current_status || "Active",
        source: "opencorporates",
        sourceUrl: c.opencorporates_url || null,
        foundingYear: c.incorporation_date?.slice(0, 4) || null,
        legalForm: c.company_type || null,
      });
    }
  } catch { /* ignore */ }
  return companies;
}
```

### 4d. GLEIF Harvester

```typescript
export async function harvestGleifSA(keyword?: string): Promise<CompanyData[]> {
  const companies: CompanyData[] = [];
  try {
    const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalAddress.country]=SA&filter[entity.legalName.value]=${encodeURIComponent(keyword || "")}&page[size]=100`;
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) return companies;
    const data = await res.json();
    for (const record of (data.data || [])) {
      const entity = record.attributes?.entity || {};
      companies.push({
        nameEn: entity.legalName?.value || null,
        city: entity.legalAddress?.city || null,
        region: entity.legalAddress?.region || null,
        source: "gleif",
        sourceUrl: `https://search.gleif.org/#/record/${record.attributes?.lei}`,
        legalForm: entity.legalForm?.id || null,
        registrationStatus: entity.status || "Active",
      });
    }
  } catch { /* ignore */ }
  return companies;
}
```

### 4e. Wikidata SPARQL Harvester

```typescript
export async function harvestWikidataSA(keyword?: string): Promise<CompanyData[]> {
  const sparql = `
SELECT ?company ?companyLabel ?companyAltLabel ?founded ?employees ?revenue ?website ?city ?cityLabel WHERE {
  ?company wdt:P17 wd:Q851.    # Saudi Arabia
  ?company wdt:P31 wd:Q4830453. # business enterprise
  ${keyword ? `?company rdfs:label ?label . FILTER(CONTAINS(LCASE(?label), "${keyword.toLowerCase()}"))` : ""}
  OPTIONAL { ?company wdt:P571 ?founded }
  OPTIONAL { ?company wdt:P1082 ?employees }
  OPTIONAL { ?company wdt:P2139 ?revenue }
  OPTIONAL { ?company wdt:P856 ?website }
  OPTIONAL { ?company wdt:P159 ?city }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar" }
} LIMIT 200`;

  try {
    const res = await fetchWithTimeout(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      20000
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results?.bindings || []).map((b: any) => ({
      nameEn: b.companyLabel?.value || null,
      nameAr: b.companyAltLabel?.value || null,
      foundingYear: b.founded?.value?.slice(0, 4) || null,
      employeeCount: b.employees?.value || null,
      website: b.website?.value || null,
      city: b.cityLabel?.value || null,
      source: "wikidata-sparql",
      sourceUrl: b.company?.value?.replace("entity", "wiki") || null,
    }));
  } catch { return []; }
}
```

---

## 5. ENRICHMENT ENGINE (14 Sources)

The enrichment pipeline runs for each harvested company. It fires 14 sources in parallel using `Promise.allSettled()`:

```typescript
const ENRICH_CONCURRENCY = 3; // max simultaneous enrichments
const enrichSemaphore = { running: 0 };

export async function enrichMasarCompany(companyId: number, emitter?: EventEmitter): Promise<void> {
  while (enrichSemaphore.running >= ENRICH_CONCURRENCY) {
    await new Promise(r => setTimeout(r, 500));
  }
  enrichSemaphore.running++;

  try {
    const [company] = await db.select().from(masarCompaniesTable)
      .where(eq(masarCompaniesTable.id, companyId)).limit(1);
    if (!company) return;

    const companyName = company.nameEn || company.nameAr || "";
    if (!companyName) return;

    await db.update(masarCompaniesTable)
      .set({ enrichmentStatus: "enriching" })
      .where(eq(masarCompaniesTable.id, companyId));

    const crRef = company.crNumber ? ` CR ${company.crNumber}` : "";
    const cityRef = company.city ? ` ${company.city}` : "";
    const enrichmentParts: string[] = [];

    // ── 14 sources in parallel ──────────────────────────────────────────────
    const [
      stealthCrawlRes,
      perplexityProfileResult,
      perplexityNewsResult,
      registrationRawResult,
      perplexityExecsResult,
      perplexityShareholdersResult,
      perplexityOwnerResult,
      perplexityRevenueResult,
      geminiProfileResult,
      geminiShareholdersResult,
      geminiExecsResult,
      geminiContactResult,
      claudeDirectResult,
      openaiDirectResult,
    ] = await Promise.allSettled([
      // Source 1: Stealth Browser (company website + Saudi directories)
      stealthCrawlForEnrichment(companyName, company.website, emitter),

      // Source 2: Perplexity — general profile
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, address, employees, description, industry`)
        : Promise.resolve(null),

      // Source 3: Perplexity — news
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`Saudi company "${companyName}" latest news 2024 2025 announcements contracts expansions`)
        : Promise.resolve(null),

      // Source 4: Perplexity — registration & AOA
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`"${companyName}" Saudi Arabia شركة سجل تجاري عقد تأسيس رأس المال المدفوع مساهمون مجلس إدارة CR number shareholders paid-up capital articles of association`)
        : Promise.resolve(null),

      // Source 5: Perplexity — executives
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`"${companyName}" Saudi Arabia CEO chairman general manager board of directors executives مدير عام رئيس مجلس الإدارة — full names Arabic and English with titles`)
        : Promise.resolve(null),

      // Source 6: Perplexity — shareholders
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`"${companyName}" Saudi Arabia shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — full names Arabic and English with percentages. Search mc.gov.sa, Amaaly.`)
        : Promise.resolve(null),

      // Source 7: Perplexity — owner/founder profile
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`Who founded or owns Saudi company "${companyName}"${crRef}? Full owner/founder name Arabic AND English. Family business? Saudi family/tribe? Estimated personal wealth SAR. Other companies they own.`)
        : Promise.resolve(null),

      // Source 8: Perplexity — revenue & financial signals
      process.env.PERPLEXITY_API_KEY
        ? perplexityService.search(`"${companyName}" Saudi Arabia annual revenue turnover SAR. Workforce headcount. Government contracts. Revenue estimate based on paid-up capital${company.paidUpCapital ? ` ${company.paidUpCapital}` : ""}, industry${company.mainActivity ? ` "${company.mainActivity}"` : ""}.`)
        : Promise.resolve(null),

      // Source 9: Gemini Chrome AI — full profile
      isGeminiConfigured()
        ? searchWithGemini(`Saudi company "${companyName}"${crRef}${cityRef}: official website, phone, email, address, revenue SAR, employees, industry, founding year, CEO. Browse company pages and Saudi registries. Verified data only.`)
        : Promise.resolve(null),

      // Source 10: Gemini — shareholders & ownership
      isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${crRef} shareholders owners ownership percentage مساهمون ملاك نسبة الملكية — exact names Arabic and English with percentages. Search Saudi commercial registry and news.`)
        : Promise.resolve(null),

      // Source 11: Gemini — executives & board
      isGeminiConfigured()
        ? searchWithGemini(`"${companyName}" Saudi Arabia${cityRef} CEO chairman general manager board مدير عام رئيس مجلس الإدارة — full verified names Arabic and English with titles.`)
        : Promise.resolve(null),

      // Source 12: Gemini — CR registry data (only if CR number known)
      isGeminiConfigured() && company.crNumber
        ? searchWithGemini(`Saudi CR number ${company.crNumber} "${companyName}" — legal form, paid-up capital, founding date, activities, shareholders list. Check mc.gov.sa, CR portal.`)
        : Promise.resolve(null),

      // Source 13: Claude — direct executive & shareholder research
      (async () => {
        if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) return null;
        try {
          const msg = await Promise.race([
            anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 1500,
              messages: [{ role: "user", content: `Research Saudi company "${companyName}"${crRef}${cityRef}. Provide: CEO/GM full name EN+AR, key executives (name EN+AR, title), major shareholders (name EN+AR, ownership %), founding year, revenue SAR, website. Only verified public data.` }],
            }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
          ]);
          return msg.content[0]?.type === "text" ? msg.content[0].text : null;
        } catch { return null; }
      })(),

      // Source 14: OpenAI — executive & company data
      (async () => {
        try {
          const r = await Promise.race([
            openai.chat.completions.create({
              model: "gpt-4o",
              max_completion_tokens: 1000,
              messages: [
                { role: "system", content: "You are a Saudi Arabia B2B intelligence analyst. Provide factual verified data only." },
                { role: "user", content: `What is publicly known about Saudi company "${companyName}"${crRef}? Provide: CEO name EN+AR, key executives, shareholders with %, revenue, employees, website, industry, city.` },
              ],
            }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 20000)),
          ]);
          return r.choices[0]?.message?.content || null;
        } catch { return null; }
      })(),
    ]);

    // Collect results into enrichmentParts[]
    const allResults = [
      stealthCrawlRes, perplexityProfileResult, perplexityNewsResult, registrationRawResult,
      perplexityExecsResult, perplexityShareholdersResult, perplexityOwnerResult, perplexityRevenueResult,
      geminiProfileResult, geminiShareholdersResult, geminiExecsResult, geminiContactResult,
      claudeDirectResult, openaiDirectResult,
    ];
    const labels = [
      "Stealth Browser", "Perplexity Profile", "Perplexity News", "Perplexity Registration",
      "Perplexity Executives", "Perplexity Shareholders", "Perplexity Owner", "Perplexity Revenue",
      "Gemini Profile", "Gemini Shareholders", "Gemini Executives", "Gemini CR Registry",
      "Claude Research", "OpenAI Research",
    ];

    allResults.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        const text = typeof r.value === "object" && "text" in (r.value as any)
          ? (r.value as any).text
          : String(r.value);
        if (text && text.length > 50) {
          enrichmentParts.push(`[${labels[i]}]\n${text.slice(0, 3000)}`);
        }
        // Also extract emails/phones from stealth crawl
        if (i === 0 && r.value && typeof r.value === "object") {
          const sc = r.value as { emails?: string[]; phones?: string[] };
          if (sc.emails?.length) enrichmentParts.push(`[Contact Emails] ${sc.emails.join(", ")}`);
          if (sc.phones?.length) enrichmentParts.push(`[Contact Phones] ${sc.phones.join(", ")}`);
        }
      }
    });

    const successCount = enrichmentParts.length;
    emitter && log(emitter, `✓ Parallel enrichment complete: ${successCount}/14 sources returned data`, "info");

    // ── Phase 2: Synthesis — Run Claude + GPT-4o in parallel ─────────────────
    const combinedContext = enrichmentParts.join("\n\n---\n\n").slice(0, 12000);
    const allResearchText = enrichmentParts.join("\n\n---\n\n").slice(0, 7000);

    // Synthesis prompt (for GPT-4o)
    const enrichPrompt = `You are an elite Saudi Arabia B2B intelligence analyst. Synthesize ALL research data below for: "${companyName}"

Known data:
- CR Number: ${company.crNumber || "Unknown"}
- City: ${company.city || company.cityAr || "Unknown"}
- Paid-Up Capital: ${company.paidUpCapital || "Unknown"}
- Activity: ${company.mainActivity || "Unknown"}

Research data:
${combinedContext || "(No external data available)"}

CRITICAL INSTRUCTIONS:
1. revenueEstimate — MANDATORY, NEVER null:
   - If stated → use it
   - If not stated → DERIVE using Saudi benchmarks:
     * Service/IT/consulting: capital × 10-20x  OR  employees × SAR 800K-1.5M
     * Trading/distribution: capital × 5-12x  OR  employees × SAR 1.5-4M
     * Construction/contracting: capital × 4-10x
     * Manufacturing: capital × 4-8x
   - Format: "SAR X - Y million"
2. ownerName: Scan ALL research for CEO, GM, chairman, founder. Extract primary decision-maker EN+AR.
3. ownerWealth: Derive from company valuation × ownership %. e.g. 100% owner, SAR 2M capital → "SAR 30M - 60M estimated"

Return ONLY valid JSON:
{
  "website": "https://... or null",
  "phone": "+966... or null",
  "email": "email@domain.com or null",
  "address": "Full physical address in Saudi Arabia or null",
  "employeeCount": "number range e.g. 50-100 or null",
  "revenueEstimate": "SAR X - Y million — MANDATORY",
  "revenueRationale": "state: direct from research / derived from capital SAR X × Y multiplier / derived from employees × benchmark",
  "description": "2-3 sentence company description",
  "ownerName": "Primary owner full name in English",
  "ownerNameAr": "الاسم الكامل للمالك بالعربية",
  "ownerTitle": "Chairman/CEO/Founder/Partner/Managing Director",
  "ownerWealth": "SAR X-Y million estimated",
  "crNumber": "10-digit CR number if found, else null",
  "city": "headquarters city in English or null",
  "paidUpCapital": "paid-up capital with SAR prefix or null",
  "newsHeadlines": [{"title": "...", "date": "YYYY-MM", "source": "source name"}]
}`;

    // Claude extraction prompt (for registration + AOA data)
    const claudeCombinedPrompt = `You are a senior Saudi Arabia corporate intelligence specialist. Complete THREE tasks for "${companyName}".

Research data:
${allResearchText}

TASK 1 — Structured corporate data (key "registration"):
{
  "crNumber": "10-digit CR or null",
  "legalForm": "LLC/Joint Stock/etc or null",
  "legalFormAr": "شركة ذات مسؤولية محدودة/etc or null",
  "city": "city in English or null",
  "paidUpCapital": "SAR X,XXX,XXX or null",
  "foundingYear": "YYYY or null",
  "foundingDate": "full date or null",
  "registrationStatus": "Active or null",
  "authorizedSignatory": "name or null",
  "shareholders": [{"nameEn":"","nameAr":"Arabic script REQUIRED","nationalId":null,"ownershipPct":"","nationality":"Saudi/Other"}],
  "boardOfDirectors": [{"nameEn":"","nameAr":"Arabic script REQUIRED","role":"Chairman/Member/etc","nationalId":null}],
  "management": [{"nameEn":"","nameAr":"Arabic script REQUIRED","title":"CEO/CFO/COO/GM/etc","nationalId":null}]
}
RULES: Only REAL verified persons. Arabic name (nameAr) REQUIRED in proper Arabic script. Empty array [] if no real persons found.

TASK 2 — Revenue assessment (key "revenueAssessment"):
{
  "revenueEstimate": "MANDATORY — SAR X - Y million",
  "revenueRationale": "Direct from research / Derived: capital SAR X × multiplier Y / Derived: employees N × SAR Z/employee",
  "employeeCount": "number or range or null",
  "companyTier": "Micro/Small/Medium/Large"
}
REVENUE DERIVATION RULES (when no explicit data):
- Service/IT: capital × 10-20x  OR  employees × SAR 800K-1.5M/person
- Trading: capital × 5-12x  OR  employees × SAR 1.5-4M/person
- Construction: capital × 4-10x  OR  employees × SAR 1-2M/person
- Manufacturing: capital × 4-8x

TASK 3 — Bilingual analysis (key "analysis"):
{
  "summaryEn": "3-4 sentence company intelligence summary in English",
  "summaryAr": "ملخص استخباراتي للشركة بالعربية (3-4 جمل)",
  "ownerProfile": "Brief profile of primary decision-maker if found",
  "salesInsight": "How a salesperson might approach this company — what they value, typical procurement approach"
}

Return JSON: {"registration": {...}, "revenueAssessment": {...}, "analysis": {...}}`;

    // Run synthesis in parallel
    const [synthesisResult, claudeResult] = await Promise.allSettled([
      (async () => {
        const r = await Promise.race([
          openai.chat.completions.create({
            model: "gpt-4o",
            max_completion_tokens: 1500,
            messages: [
              { role: "system", content: "You are a Saudi B2B intelligence analyst. Return JSON only. No markdown." },
              { role: "user", content: enrichPrompt },
            ],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 35000)),
        ]);
        const text = r.choices[0]?.message?.content || "";
        const match = text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
      })(),
      (async () => {
        const msg = await Promise.race([
          anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 3000,
            messages: [{ role: "user", content: claudeCombinedPrompt }],
          }),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 40000)),
        ]);
        const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
        const match = text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
      })(),
    ]);

    // Merge all results
    const synthesis = synthesisResult.status === "fulfilled" ? synthesisResult.value : null;
    const claudeData = claudeResult.status === "fulfilled" ? claudeResult.value : null;
    const registration = claudeData?.registration || {};
    const revenueAssessment = claudeData?.revenueAssessment || {};
    const analysis = claudeData?.analysis || {};

    // Build update object — never overwrite existing non-null values
    const updateData: Record<string, unknown> = {
      enrichmentStatus: "enriched",
      updatedAt: new Date(),
      enrichmentData: { sourcesHit: successCount, partsLength: enrichmentParts.length },
    };

    if (synthesis?.website && !company.website) updateData.website = synthesis.website;
    if (synthesis?.phone && !company.phone) updateData.phone = synthesis.phone;
    if (synthesis?.email && !company.email) updateData.email = synthesis.email;
    if (synthesis?.employeeCount && !company.employeeCount) updateData.employeeCount = synthesis.employeeCount;
    if (synthesis?.revenueEstimate) updateData.revenueEstimate = synthesis.revenueEstimate;
    if (synthesis?.revenueRationale) updateData.revenueRationale = synthesis.revenueRationale;
    if (synthesis?.description) updateData.analysisEn = synthesis.description;
    if (synthesis?.ownerName && !company.ownerName) updateData.ownerName = synthesis.ownerName;
    if (synthesis?.ownerNameAr && !company.ownerNameAr) updateData.ownerNameAr = synthesis.ownerNameAr;
    if (synthesis?.ownerTitle && !company.ownerTitle) updateData.ownerTitle = synthesis.ownerTitle;
    if (synthesis?.ownerWealth) updateData.ownerWealth = synthesis.ownerWealth;
    if (synthesis?.crNumber && !company.crNumber) updateData.crNumber = synthesis.crNumber;
    if (synthesis?.city && !company.city) updateData.city = synthesis.city;
    if (synthesis?.paidUpCapital && !company.paidUpCapital) updateData.paidUpCapital = synthesis.paidUpCapital;
    if (synthesis?.newsHeadlines?.length > 0) updateData.newsHeadlines = synthesis.newsHeadlines;

    // Registration data from Claude
    if (registration.legalForm && !company.legalForm) updateData.legalForm = registration.legalForm;
    if (registration.legalFormAr && !company.legalFormAr) updateData.legalFormAr = registration.legalFormAr;
    if (registration.foundingYear && !company.foundingYear) updateData.foundingYear = registration.foundingYear;
    if (registration.authorizedSignatory) updateData.authorizedSignatory = registration.authorizedSignatory;
    if (Array.isArray(registration.shareholders) && registration.shareholders.length > 0 && (!company.shareholders || (company.shareholders as any[]).length === 0))
      updateData.shareholders = registration.shareholders;
    if (Array.isArray(registration.boardOfDirectors) && registration.boardOfDirectors.length > 0)
      updateData.boardOfDirectors = registration.boardOfDirectors;
    if (Array.isArray(registration.management) && registration.management.length > 0)
      updateData.management = registration.management;

    // Revenue override if better
    if (revenueAssessment.revenueEstimate) updateData.revenueEstimate = revenueAssessment.revenueEstimate;
    if (revenueAssessment.revenueRationale) updateData.revenueRationale = revenueAssessment.revenueRationale;
    if (revenueAssessment.employeeCount && !updateData.employeeCount) updateData.employeeCount = revenueAssessment.employeeCount;

    // Analysis
    if (analysis.summaryEn) updateData.analysisEn = analysis.summaryEn;
    if (analysis.summaryAr) updateData.analysisAr = analysis.summaryAr;
    if (analysis.ownerProfile || analysis.salesInsight)
      updateData.analysisData = { ownerProfile: analysis.ownerProfile, salesInsight: analysis.salesInsight };

    await db.update(masarCompaniesTable)
      .set(updateData as any)
      .where(eq(masarCompaniesTable.id, companyId));

    emitter && log(emitter, `✅ Enrichment complete for: ${companyName}`, "success");
  } finally {
    enrichSemaphore.running--;
  }
}
```

---

## 6. HARVEST ORCHESTRATOR (runHarvest)

```typescript
export async function runHarvest(
  jobId: string,
  keyword: string,
  sources: string[],
  customUrls: string[],
  ctx: HarvestOptions
): Promise<void> {
  const emitter = getHarvestEmitter(jobId);
  if (!emitter) return;

  let totalFound = 0;
  let totalEnriched = 0;

  try {
    // Update job status in DB
    await db.insert(masarHarvestJobsTable).values({
      jobId,
      keyword,
      sources,
      status: "running",
    }).onConflictDoNothing();

    // ── Phase 1: Harvest from all selected sources in parallel ────────────────
    const harvestPromises: Promise<CompanyData[]>[] = [];

    for (const sourceId of sources) {
      if (sourceId === "open-data" || sourceId === "open-data/wikipedia-gemini") {
        harvestPromises.push(harvestFromOpenData(keyword, ctx, emitter));
      } else if (sourceId === "bluepages") {
        harvestPromises.push(harvestFromBluepages(keyword, ctx, emitter));
      } else if (sourceId === "amaaly-aoa") {
        harvestPromises.push(harvestFromAmaaly(keyword, ctx, emitter));
      } else if (sourceId === "opencorporates") {
        harvestPromises.push(harvestOpenCorporatesSA(keyword).then(r => r));
      } else if (sourceId === "gleif") {
        harvestPromises.push(harvestGleifSA(keyword).then(r => r));
      } else if (sourceId === "wikidata-sparql") {
        harvestPromises.push(harvestWikidataSA(keyword).then(r => r));
      } else {
        // Directory sources (mooresrowland, arabbritishchamber, etc.)
        const dirSource: DirectorySource = {
          id: sourceId,
          name: DIRECTORY_SOURCE_LABELS[sourceId] || sourceId,
          url: DIRECTORY_URLS[sourceId] || "",
        };
        harvestPromises.push(harvestFromDirectory(dirSource, keyword, ctx, emitter));
      }
    }

    // Custom URLs
    for (const url of customUrls) {
      harvestPromises.push(runWebSeeder(url, keyword, { maxPages: 20 })
        .then(r => r.companies || [])
        .catch(() => []));
    }

    const harvestResults = await Promise.allSettled(harvestPromises);

    // Collect all raw companies
    const allCompanies: CompanyData[] = [];
    for (const result of harvestResults) {
      if (result.status === "fulfilled") {
        allCompanies.push(...result.value);
      }
    }

    log(emitter, `Phase 1 complete: ${allCompanies.length} raw companies from ${sources.length} sources`, "success");

    // ── Phase 2: Upsert to DB + enrich each company ───────────────────────────
    for (const company of allCompanies) {
      // Skip blocklisted companies
      if (await isBlocked({ nameEn: company.nameEn, nameAr: company.nameAr, crNumber: company.crNumber })) {
        continue;
      }

      const companyId = await upsertMasarCompany(company);
      if (!companyId) continue;
      totalFound++;

      emit(emitter, { type: "company_found", count: totalFound, company });

      // Enrich asynchronously (respects semaphore)
      enrichMasarCompany(companyId, emitter).then(() => {
        totalEnriched++;
        emit(emitter, { type: "company_enriched", count: totalEnriched });
      }).catch(err => {
        log(emitter, `⚠️ Enrichment failed for ${company.nameEn || company.nameAr}: ${err.message}`, "warn");
      });
    }

    // Wait for all enrichments to finish (with 10 min timeout)
    const enrichTimeout = setTimeout(() => {
      log(emitter, "Enrichment timeout reached — completing job", "warn");
    }, 10 * 60 * 1000);

    while (enrichSemaphore.running > 0 && totalEnriched < totalFound) {
      await new Promise(r => setTimeout(r, 1000));
    }
    clearTimeout(enrichTimeout);

    await db.update(masarHarvestJobsTable)
      .set({ status: "completed", companiesFound: totalFound, companiesEnriched: totalEnriched, completedAt: new Date() })
      .where(eq(masarHarvestJobsTable.jobId, jobId));

    emit(emitter, { type: "complete", count: totalFound, total: totalEnriched });
    log(emitter, `✅ Harvest complete: ${totalFound} found, ${totalEnriched} enriched`, "success");
  } catch (err: unknown) {
    emit(emitter, { type: "error", error: (err as Error).message });
  }
}
```

---

## 7. API ROUTES (masar-database.ts)

```typescript
// POST /api/masar/database/harvest — start harvest job
router.post("/masar/database/harvest", async (req, res) => {
  const { companyName, keyword, sector, instructions, parameters, sources, customUrls } = req.body;

  const resolvedSources = Array.isArray(sources) && sources.length > 0
    ? sources
    : ["open-data"];

  const kw = [companyName, keyword, sector].filter(Boolean).join(" ") || "Saudi Arabia companies";
  const jobId = randomUUID();
  createHarvestJob(jobId);

  res.json({ jobId, keyword: kw, sources: resolvedSources });

  setImmediate(() => {
    runHarvest(jobId, kw, resolvedSources, customUrls || [], {
      companyName, keyword, sector, instructions, parameters,
    }).catch(err => {
      getHarvestEmitter(jobId)?.emit("event", { type: "error", error: err.message });
    });
  });
});

// GET /api/masar/database/stream/:jobId — SSE
router.get("/masar/database/stream/:jobId", (req, res) => {
  const emitter = getHarvestEmitter(req.params.jobId);
  if (!emitter) { res.status(404).json({ error: "Job not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: HarvestEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const hb = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  emitter.on("event", send);
  const cleanup = () => { clearInterval(hb); emitter.off("event", send); };
  emitter.on("event", (e: HarvestEvent) => { if (e.type === "complete" || e.type === "error") setTimeout(cleanup, 3000); });
  req.on("close", cleanup);
});

// GET /api/masar/database/companies — paginated list with filters
router.get("/masar/database/companies", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(100, Math.max(5, parseInt(String(req.query.limit || "25"))));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim();
  const city = String(req.query.city || "").trim();
  const enrichmentStatus = String(req.query.enrichmentStatus || "").trim();
  const source = String(req.query.source || "").trim();
  const legalForm = String(req.query.legalForm || "").trim();

  const conditions = [];
  if (search) conditions.push(or(
    ilike(masarCompaniesTable.nameEn, `%${search}%`),
    ilike(masarCompaniesTable.nameAr, `%${search}%`),
    ilike(masarCompaniesTable.crNumber, `%${search}%`),
    ilike(masarCompaniesTable.mainActivity, `%${search}%`),
  ));
  if (city) conditions.push(or(ilike(masarCompaniesTable.city, `%${city}%`), ilike(masarCompaniesTable.cityAr, `%${city}%`)));
  if (enrichmentStatus) conditions.push(eq(masarCompaniesTable.enrichmentStatus, enrichmentStatus));
  if (source) conditions.push(eq(masarCompaniesTable.source, source));
  if (legalForm) conditions.push(ilike(masarCompaniesTable.legalForm, `%${legalForm}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [companies, countResult] = await Promise.all([
    db.select().from(masarCompaniesTable).where(where).limit(limit).offset(offset).orderBy(desc(masarCompaniesTable.createdAt)),
    db.select({ count: sql`COUNT(*)` }).from(masarCompaniesTable).where(where),
  ]);
  res.json({ companies, total: Number(countResult[0].count), page, limit });
});

// DELETE /api/masar/database/companies/:id
router.delete("/masar/database/companies/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [company] = await db.select().from(masarCompaniesTable).where(eq(masarCompaniesTable.id, id)).limit(1);
  if (company) {
    await addToBlocklist({ nameEn: company.nameEn, nameAr: company.nameAr, crNumber: company.crNumber });
    await db.delete(masarCompaniesTable).where(eq(masarCompaniesTable.id, id));
  }
  res.json({ success: true });
});

// POST /api/masar/database/export — Excel/CSV/PPTX export
router.post("/masar/database/export", async (req, res) => {
  const { format, ids } = req.body as { format: "xlsx" | "csv" | "pptx"; ids?: number[] };
  const where = ids?.length ? inArray(masarCompaniesTable.id, ids) : undefined;
  const companies = await db.select().from(masarCompaniesTable).where(where).limit(5000);

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const rows = companies.map(c => ({
      "Name (EN)": c.nameEn || "", "Name (AR)": c.nameAr || "",
      "CR Number": c.crNumber || "", "Legal Form": c.legalForm || "",
      "City": c.city || "", "Paid-Up Capital": c.paidUpCapital || "",
      "Founded": c.foundingYear || "", "Revenue Estimate": c.revenueEstimate || "",
      "Employees": c.employeeCount || "", "Website": c.website || "",
      "Phone": c.phone || "", "Email": c.email || "",
      "Owner Name": c.ownerName || "", "Owner Title": c.ownerTitle || "",
      "Main Activity": c.mainActivity || "", "Source": c.source || "",
      "Enrichment Status": c.enrichmentStatus || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Masar Companies");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="masar-companies-${Date.now()}.xlsx"`);
    res.send(buf);
  } else if (format === "csv") {
    const keys = ["nameEn", "nameAr", "crNumber", "legalForm", "city", "paidUpCapital", "foundingYear", "revenueEstimate", "employeeCount", "website", "phone", "email", "ownerName", "mainActivity", "source"];
    const csv = [
      keys.join(","),
      ...companies.map(c => keys.map(k => `"${((c as any)[k] || "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="masar-companies-${Date.now()}.csv"`);
    res.send(csv);
  }
});
```

---

## 8. FRONTEND: masaar/database.tsx

### 8a. The 25 Sources Array (SOURCES constant)

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SOURCES = [
  // General
  { id: "open-data/wikipedia-gemini", label: "Saudi Open Data + Wikipedia + Gemini AI", category: "General",
    desc: "data.gov.sa CKAN API + Wikipedia SPARQL + Gemini-powered web harvest" },
  { id: "bluepages", label: "BluPages Saudi Arabia", category: "General",
    desc: "Official Saudi business directory — 12,000+ companies across all chambers" },
  { id: "gov-data-sa", label: "Saudi Gov Data CKAN", category: "General",
    desc: "Saudi Open Data Portal government datasets" },

  // Government Registries
  { id: "contractors", label: "Muqawil (Contractors)", category: "Government Registries",
    desc: "muqawil.gov.sa — licensed contractors and construction companies" },
  { id: "etimad", label: "Etimad (Govt Tenders)", category: "Government Registries",
    desc: "etimad.sa — government tenders and awarded contracts database" },
  { id: "industrial", label: "MODON Industrial", category: "Government Registries",
    desc: "modon.gov.sa — industrial cities tenant companies" },
  { id: "realestate", label: "REGA Real Estate", category: "Government Registries",
    desc: "rega.gov.sa — licensed real estate companies" },

  // Professional Sectors
  { id: "lawyers", label: "Licensed Lawyers", category: "Professional Sectors",
    desc: "Saudi law firms and licensed lawyers from MOJ registry" },
  { id: "auditors", label: "Certified Auditors", category: "Professional Sectors",
    desc: "Saudi auditing firms from SOCPA registry" },
  { id: "healthcare", label: "Healthcare Providers", category: "Professional Sectors",
    desc: "Hospitals, clinics, and medical companies from MOH" },
  { id: "banks", label: "Banks & Financial", category: "Professional Sectors",
    desc: "Licensed banks and financial institutions from SAMA" },
  { id: "logistics", label: "Logistics Companies", category: "Professional Sectors",
    desc: "Freight, shipping, and logistics operators" },

  // Documents
  { id: "amaaly-aoa", label: "Amaaly AOA Documents", category: "Documents",
    desc: "emagazine.aamaly.sa — Articles of Association with shareholders + management" },

  // Open Registries
  { id: "opencorporates", label: "OpenCorporates SA", category: "Open Registries",
    desc: "opencorporates.com — Saudi Arabia company registration data (free API)" },
  { id: "gleif", label: "GLEIF LEI Registry", category: "Open Registries",
    desc: "Global LEI Foundation — international companies operating in Saudi Arabia" },
  { id: "wikidata-sparql", label: "Wikidata SPARQL", category: "Open Registries",
    desc: "726+ Saudi companies with Arabic names, industry, employees, revenue" },

  // Professional Directories
  { id: "mooresrowland", label: "Moores Rowland Members", category: "Professional Directories",
    desc: "International accounting and advisory network — Saudi members" },
  { id: "arabbritishchamber", label: "Arab British Chamber", category: "Professional Directories",
    desc: "Arab British Chamber of Commerce member companies" },
  { id: "amcham-saudi", label: "AmCham Saudi Arabia", category: "Professional Directories",
    desc: "American Chamber of Commerce in Saudi Arabia members" },
  { id: "sbbc", label: "SBBC", category: "Professional Directories",
    desc: "Saudi Business Business Council members" },
  { id: "jcc", label: "JCC Members", category: "Professional Directories",
    desc: "Joint Business Councils members" },
  { id: "french-chamber-ksa", label: "French Chamber KSA", category: "Professional Directories",
    desc: "French Chamber of Commerce in Saudi Arabia members" },
  { id: "german-arab-chamber", label: "German-Arab Chamber", category: "Professional Directories",
    desc: "German Arab Chamber of Industry and Commerce members" },
  { id: "gcc-chambers", label: "GCC Chambers", category: "Professional Directories",
    desc: "GCC Chamber of Commerce member organizations" },
  { id: "icaew", label: "ICAEW Saudi Arabia", category: "Professional Directories",
    desc: "Institute of Chartered Accountants — Saudi Arabia members" },
];

const SAUDI_SECTORS = [
  "Oil & Gas / Energy", "Construction & Real Estate", "Healthcare & Pharmaceuticals",
  "Banking & Finance", "Retail & FMCG", "Technology & IT",
  "Manufacturing", "Logistics & Transportation", "Education & Training",
  "Food & Beverage", "Hospitality & Tourism", "Government & Public Sector",
  "Legal & Professional Services", "Media & Advertising", "Engineering & Industrial",
  "Cleaning & Facilities", "Automotive", "Telecommunications",
  "Agriculture", "Security & Safety", "Petrochemicals",
  "Mining & Quarrying", "Printing & Packaging", "Interior Design & Furniture",
  "Aviation", "Maritime & Ports",
];

const SAUDI_CITIES = [
  "All Regions", "Riyadh", "Jeddah", "Dammam", "Khobar",
  "Mecca", "Medina", "Tabuk", "Abha", "Taif", "Jubail",
  "Yanbu", "Najran", "Hail", "Qassim / Buraydah", "Arar",
  "Sakaka", "Jizan", "Al Ahsa", "Khamis Mushait",
];

const LEGAL_FORMS = [
  "Any", "LLC (ذ.م.م)", "Joint Stock (ش.م.س)",
  "Simple Commandite", "Partnership", "Sole Proprietorship",
  "Foreign Branch", "Holding Company",
];

const COMPANY_SIZES = ["Any", "Micro (1-9)", "Small (10-49)", "Medium (50-249)", "Large (250+)"];
const REVENUE_RANGES = [
  "Any", "< SAR 1M", "SAR 1M - 10M", "SAR 10M - 100M",
  "SAR 100M - 1B", "> SAR 1B",
];
```

### 8b. Form State + Harvest Logic

```typescript
// Form state
const [selectedSources, setSelectedSources] = useState<string[]>(["open-data/wikipedia-gemini"]);
const [customUrls, setCustomUrls] = useState<string[]>([]);
const [companyName, setCompanyName] = useState("");
const [keyword, setKeyword] = useState("");
const [sector, setSector] = useState("");
const [instructions, setInstructions] = useState("");
const [city, setCity] = useState("All Regions");
const [legalForm, setLegalForm] = useState("Any");
const [companySize, setCompanySize] = useState("Any");
const [revenueRange, setRevenueRange] = useState("Any");

// Runtime state
const [isHarvesting, setIsHarvesting] = useState(false);
const [events, setEvents] = useState<HarvestEvent[]>([]);
const [companiesFound, setCompaniesFound] = useState(0);
const [companiesEnriched, setCompaniesEnriched] = useState(0);
const [companies, setCompanies] = useState<MasarCompany[]>([]);
const [search, setSearch] = useState("");
const [filterCity, setFilterCity] = useState("");
const [filterStatus, setFilterStatus] = useState("");
const esRef = useRef<EventSource | null>(null);

const startHarvest = async () => {
  setIsHarvesting(true);
  setEvents([]);
  setCompaniesFound(0);
  setCompaniesEnriched(0);

  const parameters: Record<string, string> = {};
  if (city !== "All Regions") parameters.city = city;
  if (legalForm !== "Any") parameters.legalForm = legalForm;
  if (companySize !== "Any") parameters.size = companySize;
  if (revenueRange !== "Any") parameters.revenue = revenueRange;

  const res = await fetch(`${BASE}/api/masar/database/harvest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: companyName || undefined,
      keyword: keyword || undefined,
      sector: sector || undefined,
      instructions: instructions || undefined,
      sources: selectedSources,
      customUrls: customUrls.filter(Boolean),
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    }),
  });

  const { jobId } = await res.json();

  const es = new EventSource(`${BASE}/api/masar/database/stream/${jobId}`);
  esRef.current = es;
  es.onmessage = (e) => {
    const evt: HarvestEvent = JSON.parse(e.data);
    setEvents(prev => [...prev.slice(-100), evt]);
    if (evt.type === "company_found") setCompaniesFound(evt.count || 0);
    if (evt.type === "company_enriched") setCompaniesEnriched(evt.count || 0);
    if (evt.type === "complete" || evt.type === "error") {
      setIsHarvesting(false);
      es.close();
      loadCompanies();
    }
  };
};

const loadCompanies = async () => {
  const params = new URLSearchParams({ page: "1", limit: "50" });
  if (search) params.set("search", search);
  if (filterCity) params.set("city", filterCity);
  if (filterStatus) params.set("enrichmentStatus", filterStatus);
  const res = await fetch(`${BASE}/api/masar/database/companies?${params}`);
  const data = await res.json();
  setCompanies(data.companies || []);
};
```

### 8c. Full UI JSX (harvest form + company table)

```tsx
return (
  <div className="space-y-6 p-6">
    <h1 className="text-3xl font-bold text-white">Masar Company Database</h1>

    {/* Source Selector */}
    <Card className="bg-card/60 border-white/10">
      <CardContent className="p-5">
        <h3 className="text-white font-semibold mb-3">Select Data Sources</h3>
        {["General", "Government Registries", "Professional Sectors", "Documents", "Open Registries", "Professional Directories"].map(category => (
          <div key={category} className="mb-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{category}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {SOURCES.filter(s => s.category === category).map(source => (
                <label key={source.id} className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedSources.includes(source.id)
                    ? "bg-primary/15 border-primary/40"
                    : "bg-white/3 border-white/8 hover:border-white/15"
                }`}>
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source.id)}
                    onChange={(e) => setSelectedSources(prev =>
                      e.target.checked ? [...prev, source.id] : prev.filter(s => s !== source.id)
                    )}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm text-white font-medium">{source.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{source.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>

    {/* Harvest Form */}
    <Card className="bg-card/60 border-white/10">
      <CardContent className="p-5 space-y-4">
        <h3 className="text-white font-semibold">Harvest Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Company Name (optional)</label>
            <Input value={companyName} onChange={e => setCompanyName(e.target.value)}
              placeholder="e.g. Aramco" className="bg-black/30 border-white/10 text-white" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Keyword / Topic (optional)</label>
            <Input value={keyword} onChange={e => setKeyword(e.target.value)}
              placeholder="e.g. construction, fintech" className="bg-black/30 border-white/10 text-white" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Sector</label>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger className="bg-black/30 border-white/10 text-white">
                <SelectValue placeholder="Any sector" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any sector</SelectItem>
                {SAUDI_SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">City</label>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="bg-black/30 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>{SAUDI_CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Legal Form</label>
            <Select value={legalForm} onValueChange={setLegalForm}>
              <SelectTrigger className="bg-black/30 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>{LEGAL_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Company Size</label>
            <Select value={companySize} onValueChange={setCompanySize}>
              <SelectTrigger className="bg-black/30 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>{COMPANY_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">AI Instructions (optional)</label>
          <Textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="e.g. Focus on companies with 50+ employees in Riyadh's tech sector. Prioritize companies that export products."
            className="bg-black/30 border-white/10 text-white min-h-[80px] resize-none"
          />
        </div>
        <Button
          onClick={startHarvest}
          disabled={isHarvesting || selectedSources.length === 0}
          className="w-full bg-primary hover:bg-primary/90"
        >
          {isHarvesting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
          {isHarvesting ? `Harvesting… ${companiesFound} found / ${companiesEnriched} enriched` : "Start Harvest"}
        </Button>
      </CardContent>
    </Card>

    {/* Live Log */}
    {isHarvesting && (
      <Card className="bg-black/40 border-white/8">
        <CardContent className="p-4 max-h-48 overflow-y-auto">
          <div className="space-y-0.5">
            {events.slice(-40).map((evt, i) => (
              <p key={i} className={`text-xs font-mono ${
                evt.level === "error" ? "text-rose-400" :
                evt.level === "success" ? "text-emerald-400" :
                evt.level === "warn" ? "text-amber-400" : "text-white/50"
              }`}>{evt.message}</p>
            ))}
          </div>
        </CardContent>
      </Card>
    )}

    {/* Companies Table */}
    <Card className="bg-card/60 border-white/10">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <Input placeholder="Search companies…" value={search}
            onChange={e => { setSearch(e.target.value); setTimeout(loadCompanies, 300); }}
            className="bg-black/30 border-white/10 text-white" />
          <Button onClick={loadCompanies} variant="outline" className="border-white/10 text-white shrink-0">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="space-y-2">
          {companies.map(company => (
            <div key={company.id} className="p-4 rounded-lg bg-white/3 border border-white/8 hover:border-white/15 transition-all">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white font-medium">{company.nameEn || company.nameAr}</p>
                  {company.nameAr && company.nameEn && (
                    <p className="text-white/50 text-sm font-arabic">{company.nameAr}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                    {company.city && <span><MapPin className="w-3 h-3 inline mr-0.5" />{company.city}</span>}
                    {company.legalForm && <span>{company.legalForm}</span>}
                    {company.mainActivity && <span>{company.mainActivity.slice(0, 40)}</span>}
                    {company.revenueEstimate && <span className="text-emerald-400">{company.revenueEstimate}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[10px] ${
                    company.enrichmentStatus === "enriched" ? "text-emerald-400 border-emerald-500/30" :
                    company.enrichmentStatus === "enriching" ? "text-amber-400 border-amber-500/30" :
                    "text-white/40 border-white/15"
                  }`}>{company.enrichmentStatus || "pending"}</Badge>
                </div>
              </div>
              {/* Contact info */}
              {(company.phone || company.email || company.website) && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs">
                  {company.phone && <a href={`tel:${company.phone}`} className="text-emerald-400/80 hover:underline"><Phone className="w-3 h-3 inline mr-0.5" />{company.phone}</a>}
                  {company.email && <a href={`mailto:${company.email}`} className="text-blue-400/80 hover:underline"><Mail className="w-3 h-3 inline mr-0.5" />{company.email}</a>}
                  {company.website && <a href={company.website} target="_blank" rel="noopener" className="text-cyan-400/80 hover:underline"><Globe className="w-3 h-3 inline mr-0.5" />{company.website.replace(/^https?:\/\//, "").split("/")[0]}</a>}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  </div>
);
```

---

## 9. KEY IMPLEMENTATION NOTES

1. **Blocklist**: When user deletes a company, it's added to a blocklist table. `upsertMasarCompany()` and all harvesters check this before inserting to prevent re-seeding deleted records.

2. **Enrichment Concurrency**: `enrichSemaphore` limits to 3 simultaneous enrichments. Each enrichment runs 14 parallel sources via `Promise.allSettled()`.

3. **Source categories in masar-harvester.ts**: The `runHarvest()` function receives a `sources: string[]` array and dispatches to the appropriate harvester function for each source ID.

4. **AI fallback generation**: If real-world sources return fewer than 5 companies, the system uses Claude/GPT-4o to generate plausible Saudi company records based on the keyword and constraints — clearly marked as `source: "ai-generated"`.

5. **Export formats**: XLSX (via `xlsx` npm package), CSV (manual string building), PPTX (via `pptxgenjs` — one slide per company).

6. **Revenue derivation is mandatory**: The enrichment prompt explicitly requires revenue to never be null, with exact multiplier formulas per industry type.
