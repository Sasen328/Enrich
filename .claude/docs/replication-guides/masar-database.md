# Masar Company Database

**Source files:**
- `artifacts/api-server/src/lib/masar-harvester.ts` (2,907 lines) — harvester + enrichment engine
- `artifacts/api-server/src/routes/masar-database.ts` (997 lines) — all API routes

The Masar Database is a fully managed Saudi B2B company repository. It combines a multi-source harvester (seeds new companies from 25+ sources), an enrichment engine (fills in intelligence per company using 14 parallel sources), a deduplication agent (removes duplicates using 3-tier identity matching), bulk management controls (select, delete, force-enrich), and multi-format export.

**Critical rule:** Only the harvester and enrichment engine write to the `masar_companies` table. Prospecting, Company Intel, Person Intel, OrcEngine, Lead Lists, and Builder routes are READ-ONLY.

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  STEP 1 — HARVESTER                                                   │
│  Discovers and seeds new companies into the database                  │
│                                                                        │
│  Input: keyword + sector + sources + customUrls + instructions        │
│  Output: new rows in masar_companies (enrichmentStatus = "pending")   │
│                                                                        │
│  25+ sources across 6 categories (see Sources section below)          │
│  AI extraction priority: Gemini → Claude → GPT-4o → regex fallback   │
│  Blocklist check: deleted companies are never re-seeded               │
│  Upsert logic:                                                         │
│    CR present → onConflictDoUpdate on CR number (unique index)        │
│    No CR → check name before insert (exact match prevents dupes)      │
│  Name validation: rejects CSS classes, sentences, country articles,   │
│    strings under 3 chars or over 120 chars                            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼  (auto-triggers after harvest)
┌────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — ENRICHMENT ENGINE                                           │
│  Fills in intelligence per company using 14 parallel sources          │
│                                                                        │
│  Concurrency: max 3 companies simultaneously (semaphore-controlled)   │
│  Status flow:  pending → enriching → enriched | failed               │
│                                                                        │
│  14 sources fired per company:                                        │
│    Perplexity (profile + contact)                                     │
│    Gemini (ownership, executives, market intel)    × 3 threads        │
│    Claude Sonnet (comprehensive corporate analysis)                   │
│    GPT-4o (validation + financial intelligence)                       │
│    Apollo.io API (verified contacts — APOLLO_API_KEY)                 │
│    Explorium API (company intelligence — EXPLORIUM_API_KEY)           │
│    emagazine.aamaly.sa (AOA document search)                          │
│    Maroof.sa (business verification + rating)                         │
│    Free sources (WHOIS, social, maps)                                 │
│    Website crawl (stealth browser or HTTP)                            │
│    mooresrowland.com (Middle East deal intelligence)                  │
│    bluepages.sa (Saudi business directory)                            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼  (manual trigger per company)
┌────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — PIPELINE ENRICHMENT  (optional deep dive)                  │
│  Runs the full 5-agent Masaar Pipeline on a specific company          │
│  (See docs/masaar-engine.md for pipeline details)                     │
│                                                                        │
│  Result saved back to DB:                                             │
│    shareholders[], management[], boardOfDirectors[]                   │
│    analysisEn, analysisAr (full bilingual reports)                    │
│    Smart field protection: only fills blank fields (never overwrites) │
│    Validation filter: rejects placeholder/undisclosed names           │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼  (on-demand)
┌────────────────────────────────────────────────────────────────────────┐
│  STEP 4 — DEDUPLICATION AGENT                                         │
│  3-tier identity matching → keep richer record → delete duplicate     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Harvester Sources (25+)

### Source A: Wikipedia + AI (source id: `"open-data"`)

The primary open-data source. Wikipedia is globally accessible, server-side rendered, and contains rich Saudi company data including Arabic names. Runs in 4 phases:

| Phase | What happens |
|-------|-------------|
| 1 | Scrapes 5 Wikipedia category pages for Saudi companies |
| 2 | Wikipedia API search for keyword-specific results (up to 20 results) |
| 3 | Fetches article intros to extract Arabic name, founding year, city, industry |
| 4 | Full infobox scrape for category-page companies (extracts structured data) |

**Wikipedia categories always scraped:**
- `Category:Companies_of_Saudi_Arabia`
- `Category:Saudi_Arabian_companies_established_in_the_21st_century`
- `Category:Banks_of_Saudi_Arabia`
- `Category:Manufacturing_companies_of_Saudi_Arabia`
- `Category:Retail_companies_of_Saudi_Arabia`
- Dynamic: `Category:[keyword]_companies_of_Saudi_Arabia`

After Wikipedia, Perplexity supplements with additional results if API key is configured. Falls back to Claude (2-pass) if Perplexity is unavailable.

### Source B: Amaaly AOA (source id: `"amaaly-aoa"`)
Stealth-scrapes `emagazine.aamaly.sa` for AOA (Articles of Association) publications. Seeds companies directly from AOA documents, capturing shareholder names, capital, and governance data from the original Arabic registration documents.

### Source C: data.gov.sa CKAN API (source id: `"gov-data-sa"`)
Saudi Open Data portal. Queries the CKAN API for business registry datasets.

### Source D: OpenCorporates (source id: `"opencorporates"`)
OpenCorporates SA jurisdiction — corporate registry data with CR numbers, legal forms, and registration status.

### Source E: GLEIF (source id: `"gleif"`)
Global Legal Entity Identifier Foundation. Returns Saudi legal entities with LEI codes, city, and registration status. Results capped at 50 per query.

### Source F: Wikidata SPARQL (source id: `"wikidata-sparql"`)
SPARQL queries against Wikidata's knowledge graph for Saudi company entities with structured property data.

### Source G: Bluepages (source id: `"bluepages"`)
`bluepages.com.sa` — Saudi business directory with contact details and business category data.

### Source H: Professional Directories (source ids as listed)
| Source ID | Directory |
|-----------|-----------|
| `"mooresrowland"` | MooresRowland — Middle East advisory and deal intelligence |
| `"arabbritishchamber"` | Arab-British Chamber of Commerce |
| `"amcham-saudi"` | American Chamber of Commerce Saudi Arabia |
| `"sbbc"` | Saudi British Business Council |
| `"jcc"` | Jeddah Chamber of Commerce |
| `"french-chamber-ksa"` | French-Arab Chamber of Commerce KSA |
| `"german-arab-chamber"` | German-Arab Chamber of Industry and Commerce |
| `"gcc-chambers"` | GCC Chambers Network |
| `"icaew"` | ICAEW Middle East member firms |

Each directory is scraped for Saudi member firms. A keyword filter is applied — only companies relevant to the search term are seeded (loose word-match against name + activity + description).

### Source I: Sector-Specific AI Search
AI-driven searches targeting specific regulatory and industry databases. Each sector uses a Perplexity query (multi-pass) or Claude fallback (2-pass):

| Source ID | Target Registry | Sector |
|-----------|----------------|--------|
| `"modon.gov.sa"` | MODON Industrial Property Authority | Manufacturing / Industrial |
| `"mawani.gov.sa"` | Saudi Ports Authority | Logistics & Freight |
| Additional sector configs exist for healthcare, construction, energy, finance, and more |

Multi-pass strategy:
- **Pass 1:** queries for top/well-known companies in the sector
- **Pass 2:** explicitly requests smaller/mid-size regional firms not in the first batch (triggers if pass 1 returns fewer than 20 companies)

### Source J: Custom URLs (user-provided)
Any URL the user adds to the custom sources list. Fetched and parsed by the AI extraction pipeline (Gemini → Claude → GPT-4o → regex fallback).

---

## Harvesting Process — Step by Step

### 1. Start a harvest job
```
POST /api/masar/database/harvest
{
  "companyName": "optional specific company name",
  "keyword": "construction",
  "sector": "real estate",
  "instructions": "focus on Riyadh-based companies with revenue over 50M",
  "parameters": {
    "city": "Riyadh",
    "legalForm": "Joint Stock Company",
    "size": "large",
    "revenue": "50M+"
  },
  "sources": ["open-data", "amaaly-aoa", "gleif"],
  "customUrls": ["https://mylist.com/companies"]
}
→ { "jobId": "uuid", "keyword": "construction real estate", "sources": [...] }
```

- Any combination of `companyName`, `keyword`, `sector` is valid — all parts are joined into one search term
- If no input is provided, defaults to `"Saudi Arabia companies"`
- `instructions` and `parameters` are injected into every AI generation prompt as constraints
- Both `source` (single string, legacy) and `sources` (array) are accepted
- `customUrls` are deduplicated before use

### 2. Stream harvest progress (SSE)
```
GET /api/masar/database/stream/:jobId
Content-Type: text/event-stream
```

SSE heartbeat every 15 seconds. Client disconnection triggers cleanup automatically.

**HarvestEvent types:**
| type | Payload | Meaning |
|------|---------|---------|
| `"log"` | `{ message, level: "info"|"success"|"warn"|"error" }` | Progress message |
| `"company_found"` | `{ company: CompanyData, count: number }` | New company seeded to DB |
| `"company_enriched"` | `{ company: CompanyData, count, total }` | Company enrichment complete |
| `"progress"` | `{ count, total }` | Progress counter update |
| `"complete"` | `{ count: number }` | Harvest done — enrichment continues in background |
| `"error"` | `{ error: string }` | Fatal harvest error |

### 3. Post-harvest background enrichment
After all sources have been harvested and the `"complete"` event fires, enrichment starts automatically as a detached background task (does not block the SSE stream). It processes the newly seeded pending companies in batches of 3.

### 4. View harvest job history
```
GET /api/masar/database/jobs
→ last 20 harvest jobs with jobId, keyword, source, status, companiesFound, companiesEnriched, createdAt
```

---

## AI Extraction Priority

For every raw text result from any source, companies are extracted using this fallback chain:

```
Gemini (primary — extractCompaniesWithGemini)
    ↓ if 0 results
Claude Sonnet (parseCompaniesWithClaude — max_tokens: 4096)
    ↓ if 0 results
GPT-4o (parseCompaniesWithGPT — response_format: json_object)
    ↓ if 0 results
Regex fallback (extractCompaniesViaRegex — Arabic script + EN name detection)
```

The same chain is used for AI-generative harvesting (where no raw text exists — pure knowledge-based generation):

```
Gemini (extractCompaniesWithGemini)
    ↓
Claude Sonnet
    ↓
GPT-4o
```

---

## Company Record Fields

Every seeded company contains these fields:

```
nameEn, nameAr            — English and Arabic company names
crNumber                  — 10-digit Saudi CR number (unique index)
legalForm, legalFormAr    — Legal form EN and AR
city, cityAr, region      — Location
paidUpCapital             — Capital in SAR
authorizedCapital         — Authorized capital
foundingDate, foundingYear — Establishment date
registrationDate          — CR registration date
expiryDate                — CR expiry date
authorizedSignatory       — Authorized signing person
registrationStatus        — Active / Expired / Suspended
mainActivity, mainActivityAr — Primary business activity
capitalDistribution       — Capital distribution text
profitDistributionRules   — Profit distribution rules from AOA
source                    — Which harvester produced this record
sourceUrl                 — URL of the source record
enrichmentStatus          — pending | enriching | enriched | failed
website, phone, email     — Contact details (filled by enrichment)
employeeCount             — Employee count estimate
revenueEstimate           — Revenue estimate in SAR
shareholders[]            — Array of shareholder objects
boardOfDirectors[]        — Board of directors array
management[]              — Management team array
analysisEn, analysisAr    — Full AI intelligence reports (from pipeline enrichment)
analysisData              — JSON metadata: confidence score, data quality, sources
newsHeadlines[]           — Recent news items
enrichedAt                — Timestamp of last enrichment
createdAt, updatedAt      — Record timestamps
```

---

## Enrichment Status Lifecycle

```
[seeded by harvester] → "pending"
                            │
                            ▼  enrichMasarCompany() called
                        "enriching"
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
          "enriched"                   "failed"
              │                            │
              └──────── re-enrich ─────────┘
                    (manual or bulk force)
```

---

## Per-Company Enrichment Controls

### Standard Re-Enrich (fast — 14-source engine)
```
POST /api/masar/database/companies/:id/re-enrich
→ { ok: true, message: "Re-enrichment started" }
```
Fires the 14-source enrichment engine on one company. Returns immediately; runs in background. Best for quick refresh of contact data, website, financials, and team information.

### Pipeline Enrich (deep — full 5-agent Masaar pipeline)
```
POST /api/masar/database/companies/:id/pipeline-enrich
→ { ok: true, jobId: "...", crNumber: "...", nameMode: false, message: "..." }
```
Triggers the full 5-agent Masaar pipeline (mc.gov.sa → Amaaly AOA → Deep Research → Compliance → Bilingual Report) for a single company. Takes 3–8 minutes. Produces the deepest intelligence available:
- Shareholder names with national IDs and ownership percentages
- Manager names with appointment terms and legal powers
- Board of directors extracted directly from AOA PDF
- Full compliance check (OFAC, UN, EU, CMA, SAMA, ZATCA, Maroof, Najiz)
- Full bilingual intelligence reports (EN + AR, ~8,000 tokens each)

**Auto CR discovery:** If the company has no CR number, Claude attempts to find it before running the pipeline (queries `"What is the Saudi CR number for [company name]?"`, matches 10-digit pattern starting with 1).

**Smart field protection:** Only fills blank fields with pipeline data — never overwrites existing verified data such as a name or city already in the record.

**Person validation filter:** All persons returned by the pipeline are checked before saving. Names matching these patterns are rejected:
- `undisclosed`, `unknown`, `not found`, `غير معلن`, `مجهول`
- `shareholder 1`, `owner 2`, `person 3`, `مساهم 1`
- `placeholder`, `N/A`, `-`
- Any string that is empty or only whitespace

### Bulk Enrich All
```
POST /api/masar/database/enrich-all
{ "mode": "pending" | "all" }
→ { ok: true, message: "...", count: N }
```

| Mode | Behavior | Cap |
|------|---------|-----|
| `"pending"` (default / Smart mode) | Enriches companies where status is: `"pending"`, `"failed"`, OR `"enriched"` but shareholders array is empty | 50 companies |
| `"all"` (Force mode) | Resets ALL non-enriching companies back to `"pending"` then processes them all | 100 companies |

All companies run concurrently (max 3 at a time via internal semaphore). This is the **Force Enrich All** button in the UI.

---

## Deduplication Agent

```
POST /api/masar/database/deduplicate
→ { duplicatesFound: N, duplicatesDeleted: N, remainingCompanies: N }
```

### Algorithm

**Identity keys checked in order (strongest first):**

1. **CR Number** (exact match) — definitively the same company
2. **Normalized English Name** — strips these words before comparing:
   `company, co, ltd, llc, corp, inc, group, holding, holdings, international, intl, establishment, est, trading, industries, industrial, services, solutions, technology, technologies`
   Then strips all non-alphanumeric characters, collapses whitespace.
3. **Normalized Arabic Name** — strips: `شركة، مؤسسة، مجموعة`
   Then strips non-Arabic/non-alphanumeric characters.

**When a duplicate is found, the record with the higher enrichment score is kept:**

| Field present | Score points |
|--------------|-------------|
| `enrichmentStatus = "enriched"` | +100 |
| `enrichmentStatus = "enriching"` | +50 |
| `shareholders` array (any items) | +15 |
| `website` | +10 |
| `boardOfDirectors` array | +10 |
| `email` | +8 |
| `phone` | +8 |
| `paidUpCapital` | +5 |

The lower-scoring record is deleted. If the surviving record is a different database row than the one currently stored as "canonical" for that key, the canonical pointer is updated.

**Batch deletion:** IDs to delete are processed in batches of 200 to handle large datasets without hitting query limits.

---

## Company Selection & Bulk Delete

### Select specific companies and delete
```
DELETE /api/masar/database/companies/bulk
{ "ids": [1, 2, 3, 45, 67] }
→ { ok: true, deleted: 5 }
```
Before deleting, each selected company is added to the **blocklist** — this permanently prevents those companies from being re-seeded by future harvest jobs. The blocklist check runs in `upsertMasarCompany()` before every insert.

### Delete single company
```
DELETE /api/masar/database/companies/:id
→ { ok: true }
```
Same behavior — company is blocklisted before deletion.

---

## Database Query & Filtering

```
GET /api/masar/database/companies
  ?page=1
  &limit=25              (min 5, max 100, default 25)
  &search=aramco         (searches nameEn, nameAr, crNumber, mainActivity — case-insensitive)
  &city=Riyadh           (matches city or cityAr — case-insensitive)
  &enrichmentStatus=enriched | pending | failed | enriching
  &source=open-data | amaaly-aoa | opencorporates | gleif | ...
  &legalForm=LLC         (case-insensitive partial match)

→ {
    companies: [...],
    pagination: { page, limit, total, pages }
  }
```

### Single company detail
```
GET /api/masar/database/companies/:id
→ full company record
```

### Stats
```
GET /api/masar/database/stats
→ {
    total: number,
    enriched: number,
    pending: number,
    activeSources: number,
    bySource: { "open-data": N, "amaaly-aoa": N, "opencorporates": N, ... }
  }
```

---

## Export Formats

```
GET /api/masar/database/export
  ?format=csv | excel | word | pdf | pptx
  &search=filter_term          (optional — only export matching records)
  &ids=1,2,3,4,5               (optional — export only selected company IDs)
```

When `ids` is provided, only those companies are exported regardless of search. When omitted, all matching companies are exported (up to 5,000 for CSV/Excel; all for Word/PDF/PPTX).

| Format | Contents | Details |
|--------|---------|---------|
| **CSV** | All flat fields | UTF-8 BOM (Arabic-safe), ready for Arabic Excel. Includes Analysis EN summary (first 500 chars). |
| **Excel (.xlsx)** | 3 worksheets | Sheet 1: Companies (all fields). Sheet 2: Shareholders (one row per shareholder, linked to company). Sheet 3: Management & Board (one row per person). |
| **Word (.doc)** | Full profiles | One section per company: key fields table + Shareholders table + Management table + Board table + AI Analysis EN + AI Analysis AR. |
| **PDF (HTML printable)** | Full profiles | Dark-themed HTML with ProspectSA branding. Print button included. One section per company with all tables and analysis. `window.print()` saves as PDF. |
| **PPTX** | Slide deck | One slide per company on dark background: company name EN+AR, 12 key fields in two columns, AI analysis excerpt, ProspectSA footer. |

---

## Custom Sources Management

Users can add any URL as a harvestable source. Before adding, the URL can be analyzed to preview what company data it contains.

```
GET  /api/masar/database/custom-sources
→ list of all saved custom sources

POST /api/masar/database/custom-sources
{ "url": "https://example.com/companies", "name": "My List" }
→ { id, name, url, createdAt }

POST /api/masar/database/analyze-source
{ "url": "https://example.com/companies" }
→ {
    ok: true,
    analysis: {
      suggestedName: "Short source name",
      description: "One sentence description",
      dataTypes: ["company names", "CR numbers", "contact info"],
      hasCompanyData: true,
      language: "ar" | "en" | "both",
      confidence: "high" | "medium" | "low",
      note: "Site requires browser/login — content could not be previewed"  // if JS-heavy
    },
    previewChars: 3420
  }

The analyze endpoint:
  1. Fetches the URL with a Saudi browser User-Agent
  2. Strips HTML, extracts text (up to 6,000 chars)
  3. Sends to Claude Sonnet for analysis
  4. If the page returned < 100 chars (JS SPA / login-gated), Claude infers
     from the domain name and URL pattern what the site likely contains

DELETE /api/masar/database/custom-sources/:id
→ { deleted: true }
```

---

## Write Protection Policy

The `masar_companies` table enforces strict write isolation. This prevents accidental corruption of company records by non-database routes.

| Route / Engine | Access |
|----------------|--------|
| `runHarvest()` — harvester | ✅ INSERT new companies |
| `enrichMasarCompany()` — enrichment engine | ✅ UPDATE fields |
| `/pipeline-enrich` route | ✅ UPDATE with pipeline results |
| `/re-enrich` route | ✅ UPDATE via enrichMasarCompany() |
| `/enrich-all` route | ✅ UPDATE via enrichMasarCompany() |
| Deduplication agent | ✅ DELETE duplicates |
| Bulk / single delete routes | ✅ DELETE + blocklist |
| Smart Prospecting Engine | ❌ READ-ONLY |
| Company Intelligence | ❌ READ-ONLY |
| Person Intelligence | ❌ READ-ONLY |
| OrcEngine / Lead Lists | ❌ READ-ONLY |
| Builder routes | ❌ READ-ONLY |

---

## Key Files

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/masar-harvester.ts` | All harvester functions + enrichMasarCompany (2,907 lines) |
| `artifacts/api-server/src/routes/masar-database.ts` | All database API routes (997 lines) |
| `artifacts/api-server/src/lib/masaar-engine.ts` | 5-agent deep pipeline (called by pipeline-enrich) |
| `artifacts/api-server/src/lib/blocklist.ts` | Deletion blocklist — prevents re-seeding |
| `artifacts/api-server/src/lib/free-sources.ts` | OpenCorporates, GLEIF, Wikidata harvesters |
| `artifacts/api-server/src/lib/mooresrowland-scraper.ts` | Directory scrapers (9 professional directories) |
| `artifacts/prospect-sa/src/pages/masaar/database.tsx` | Database UI — list, filter, select, delete, enrich, export |
