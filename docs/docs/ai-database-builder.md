# AI Database Builder — Masar Company Database

**Source files:**
- `artifacts/api-server/src/lib/masar-harvester.ts` — harvester + enrichment engine
- `artifacts/api-server/src/routes/masar-database.ts` — all API routes
- `artifacts/api-server/src/lib/web-seeder.ts` — shared Web Seeder library (fires automatically after every enrichment)

The AI Database Builder is a fully managed Saudi B2B company repository. It combines a multi-source harvester (seeds new companies from 25+ sources), an enrichment engine (fills in intelligence per company using 14 parallel sources), a deduplication agent (removes duplicates using 3-tier identity matching), bulk management controls (select, delete, force-enrich), and multi-format export.

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
                                   ▼  (automatic — fires after every enrichment)
┌────────────────────────────────────────────────────────────────────────┐
│  STEP 2b — BACKGROUND WEB SEEDER  (lib/web-seeder.ts)                │
│  Fires as setImmediate() — never blocks the enrichment response       │
│                                                                        │
│  Triggered when: company.website is known after enrichment            │
│  Crawls up to 6 pages of the company website                         │
│  Each page → Claude Sonnet agent (1,024 tokens, 20s timeout)         │
│  Aggregation → Claude Sonnet (3,000 tokens, 45s timeout)             │
│                                                                        │
│  Supplements DB record (re-fetches current state before writing):    │
│    email       — fills if currently blank                             │
│    phone       — fills if currently blank                             │
│    management  — populates if currently empty array                   │
│    enrichmentData.webSeeder:                                          │
│      pagesAnalyzed, services[], b2bSignals[], techStack[], keyClients[]│
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
| 1 | Scrapes 5+ Wikipedia category pages for Saudi companies |
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

**Phase 3 filtering — article must pass both checks to be included:**
- Title must contain at least one of: `Company, Corporation, Group, Bank, Factory, Industries, Holdings, Trading, Services, Fund, Institute, Airlines, Telecom, Energy, Chemical, Petroleum, Cement, Steel, Media, Tech, Pharma, Retail, Logistics, Construction, Contractors, Conglomerate`
- OR snippet must contain: `company, corporation, firm, enterprise, manufacturer, supplier, provider, operator, conglomerate, subsidiary, publicly traded, listed on, stock exchange`
- Excluded if title matches: diplomatic relations, Royal Saudi Air Force, King of, Queen of, Ministry of, weapons of mass, Wikipedia, List of, born, died, President, Prime Minister, politician, diplomat

**Phase 4 — infobox scrape:** Full Playwright page load on each Wikipedia article. Extracts every field from the company infobox: founded, headquarters, key people, industry, products, revenue, employees, subsidiaries, parent company.

**Perplexity supplement:** After phases 1–4, Perplexity runs an additional search `"[keyword] Saudi Arabia companies list"` to supplement with companies not on Wikipedia. Falls back to Claude (2-pass) if Perplexity is unavailable.

---

### Source B: Amaaly AOA (source id: `"amaaly-aoa"`)

Stealth-scrapes `emagazine.aamaly.sa` for Articles of Association (AOA) publications. Seeds companies directly from AOA documents, capturing shareholder names, paid-up capital, authorized signatory, legal form, and governance data from the original Arabic registration documents.

**Search strategy:** Uses a stealth Playwright browser with Saudi IP fingerprint. Searches by keyword across multiple result pages. For each result, scores by keyword match strength and document recency. Downloads top-scored AOA PDFs and extracts company data.

---

### Source C: data.gov.sa CKAN API (source id: `"gov-data-sa"`)

Saudi Open Data portal. Queries the CKAN API (`data.gov.sa/api/3`) for business registry datasets. Searches datasets by keyword, downloads CSV/JSON resources, and parses them for company names, CR numbers, and cities.

---

### Source D: OpenCorporates (source id: `"opencorporates"`)

OpenCorporates SA jurisdiction (`sa` country code). Queries the company search API (`api.opencorporates.com/v0.4/companies/search?jurisdiction_code=sa`). Returns up to 3 pages (default cap) of results per keyword. Fields: company name EN, CR number, legal form, registration date, status, source URL.

---

### Source E: GLEIF (source id: `"gleif"`)

Global Legal Entity Identifier Foundation. Queries `api.gleif.org/api/v1/entities?filter[entity.legalAddress.country]=SA`. Returns Saudi legal entities registered with LEI codes. Results capped at 50 per query. Fields: legal name EN, city, registration status, LEI code, source URL.

---

### Source F: Wikidata SPARQL (source id: `"wikidata-sparql"`)

SPARQL queries against Wikidata's knowledge graph (`query.wikidata.org/sparql`). Query targets: `wd:Q6256` (Saudi Arabia) as country of headquarters. Extracts: entity label EN + AR, founding year, city, Wikipedia link. Results converted into company records.

---

### Source G: Bluepages (source id: `"bluepages"`)

`bluepages.com.sa` — Saudi business directory. Scraped with HTTP + Cheerio. Extracts: company name AR + EN, phone, email, website, city, business category, address. Results filtered to valid Saudi company names before seeding.

---

### Source H: Professional Directories (9 sources)

Each directory scraped for Saudi member firms. A keyword filter is applied after scraping — only companies where the keyword matches name, activity, or description (loose word-match) are seeded.

| Source ID | Directory | What is scraped |
|-----------|-----------|----------------|
| `"mooresrowland"` | MooresRowland | Middle East advisory firms, deal intelligence, Saudi member companies |
| `"arabbritishchamber"` | Arab-British Chamber of Commerce | Saudi member companies with UK trade ties |
| `"amcham-saudi"` | American Chamber of Commerce Saudi Arabia | Saudi-US business member directory |
| `"sbbc"` | Saudi British Business Council | Saudi and UK member companies |
| `"jcc"` | Jeddah Chamber of Commerce | Jeddah-registered member companies |
| `"french-chamber-ksa"` | French-Arab Chamber of Commerce KSA | French-Saudi business member directory |
| `"german-arab-chamber"` | German-Arab Chamber of Industry and Commerce | German-Saudi member firms |
| `"gcc-chambers"` | GCC Chambers Network | Saudi member companies in GCC chamber network |
| `"icaew"` | ICAEW Middle East | Saudi member firms of the Institute of Chartered Accountants in England and Wales |

Fields harvested per directory member: `nameEn`, `nameAr`, `website`, `phone`, `email`, `city`, `region`, `mainActivity`, `sourceUrl`.

---

### Source I: Sector-Specific AI Search

AI-driven multi-pass searches targeting specific regulatory bodies and industry databases. Each sector config defines a Perplexity query template and a source label (the authoritative registry domain for that sector).

| Source ID | Source Label | Sector Coverage |
|-----------|-------------|----------------|
| `"modon.gov.sa"` | MODON Saudi Industrial Property Authority | Manufacturing, industrial, factories, production facilities |
| `"mawani.gov.sa"` | Saudi Ports Authority (Mawani) | Freight, logistics, shipping, warehousing, supply chain, customs |

**Multi-pass strategy per sector:**
- **Pass 1:** Perplexity query requesting 20+ real Saudi companies in the sector with full fields (nameAr, nameEn, city, mainActivity, foundingYear, legalForm, paidUpCapital)
- **Pass 2:** triggers if pass 1 returns fewer than 20 companies — explicitly requests smaller/mid-size regional firms and lesser-known businesses not in the first batch, asking for at least 10 different companies

**Fallback (no Perplexity key):** Claude Sonnet multi-pass:
- Pass 1: same query sent to Claude with training knowledge
- Pass 2: same diversification request (triggers if fewer than 25 companies found)

Results parsed through the standard AI extraction chain (Gemini → Claude → GPT-4o).

---

### Source J: Custom URLs (user-provided)

Any URL added by the user to the custom sources list. Each custom URL is fetched with a Saudi Windows Chrome User-Agent, HTML stripped to plain text (up to 6,000 chars), and fed through the AI extraction chain (Gemini → Claude → GPT-4o → regex fallback). Companies found are seeded with `source: "custom"` and `sourceUrl` set to the original URL.

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
  "sources": ["open-data", "amaaly-aoa", "gleif", "mooresrowland"],
  "customUrls": ["https://mylist.com/companies"]
}
→ { "jobId": "uuid", "keyword": "construction real estate", "sources": [...] }
```

- `companyName`, `keyword`, `sector` are all optional — any combination works. All parts are joined into one search term (e.g., `"construction real estate"`)
- If none are provided, defaults to `"Saudi Arabia companies"` (broad harvest)
- `instructions` and `parameters` are injected into every AI generation and extraction prompt as hard constraints that narrow the results
- Both `source` (single string, legacy) and `sources` (array) are accepted
- `customUrls` are deduplicated before use — duplicate URLs in the same request are silently dropped

### 2. Stream harvest progress (SSE)
```
GET /api/masar/database/stream/:jobId
Content-Type: text/event-stream
```

SSE heartbeat every 15 seconds (`": heartbeat"`). Client disconnection triggers cleanup automatically — the SSE endpoint detects `req.on("close")` and removes the job emitter.

**HarvestEvent types:**

| `type` | Payload | Meaning |
|--------|---------|---------|
| `"log"` | `{ message: string, level: "info"\|"success"\|"warn"\|"error" }` | Progress message from any harvester step |
| `"company_found"` | `{ company: CompanyData, count: number }` | A new company was successfully seeded into the DB |
| `"company_enriched"` | `{ company: CompanyData, count: number, total: number }` | One company finished enrichment |
| `"progress"` | `{ count: number, total: number }` | Enrichment progress counter |
| `"complete"` | `{ count: number }` | Harvesting done — background enrichment may still be running |
| `"error"` | `{ error: string }` | Fatal harvest error — job aborted |

### 3. Post-harvest background enrichment
After all sources complete and `"complete"` fires, enrichment starts automatically as a detached `setImmediate()` background task — it does not block the SSE stream or delay the `"complete"` event. Queries the DB for all newly seeded `enrichmentStatus = "pending"` companies (capped at `totalSeeded + 5`, max 50). Runs in batches of 3 (ENRICH_CONCURRENCY constant).

On enrichment completion, updates the harvest job record: `{ companiesEnriched: N, status: "completed", completedAt: new Date() }`.

### 4. View harvest job history
```
GET /api/masar/database/jobs
→ last 20 harvest jobs ordered by createdAt DESC
  Fields: jobId, keyword, source, status, companiesFound, companiesEnriched, createdAt
```

---

## AI Extraction Priority Chain

For every raw text result from any source, companies are extracted using this fallback chain. If a stage returns 0 results, the next stage runs:

```
1. Gemini  (extractCompaniesWithGemini — GEMINI_API_KEY required)
       ↓ if 0 results or error
2. Claude Sonnet  (parseCompaniesWithClaude — max_tokens: 4096)
       ↓ if 0 results or error
3. GPT-4o  (parseCompaniesWithGPT — response_format: json_object)
       ↓ if 0 results or error
4. Regex fallback  (extractCompaniesViaRegex)
       • Scans each line for Arabic script ([\u0600-\u06FF]) or keyword match
       • Extracts Arabic names from Arabic-script runs (3–80 chars)
       • Extracts CR numbers matching 10-digit patterns starting with 1/2/3/4
       • Cap: 15 companies per text block
```

The same chain applies to AI-generative harvesting (sector search, Wikipedia supplement) where no raw text exists:

```
1. Gemini generation
       ↓
2. Claude Sonnet generation
       ↓
3. GPT-4o generation (response_format: json_object)
```

**Context constraints injection:** For sector searches and AI generation, the user's `instructions`, `parameters`, and `sector` are appended to every AI prompt as hard constraints via `buildContextConstraints()`.

**Extraction JSON schema expected from AI:**
```json
{
  "companies": [
    {
      "nameEn": "...", "nameAr": "...", "crNumber": "...",
      "city": "...", "cityAr": "...", "region": "...",
      "legalForm": "...", "paidUpCapital": "5,000,000 SAR",
      "mainActivity": "...", "mainActivityAr": "...",
      "foundingYear": "...", "registrationDate": "...",
      "registrationStatus": "Active",
      "authorizedSignatory": "..."
    }
  ]
}
```

Rules enforced in the AI extraction system prompt:
- `nameAr` MUST be in Arabic script (not transliteration) if available
- `legalForm` must be one of: Limited Liability Company, Joint Stock Company, Sole Proprietorship, Branch
- `paidUpCapital` must include SAR suffix
- `crNumber` must be 10 digits if visible, else null
- Every company must be included even if fields are only partially known

---

## Name Validation Filter

Every company is validated by `isValidCompanyName()` before being seeded. Rejected if any of:
- String is falsy, empty, or only whitespace
- Length < 3 chars or > 120 chars
- Starts with `http`, `www`, or `@`
- Matches CSS/HTML patterns: `.mw-parser`, `display:`, `output`, `class=`, `<div`, `{`
- Matches common-word sentences (5+ lowercase words, no Arabic)
- Contains paragraph indicators: `. `, `, ` (commas/periods mid-string suggesting sentences)
- Ends with 3+ consecutive digits (page numbers, IDs)
- Contains country/diplomatic article patterns: `– relations`, `weapons of mass`, `Royal Saudi Air Force`, `King of Saudi`, `of Saudi Arabia$` — UNLESS the name also contains corporate words like Company, Group, Industries, Bank, Fund, etc.
- Must have at least one noun-like word (not all lowercase common words)

City field also validated: rejected if it matches CSS class patterns `.mw-parser`, `.geo-`, `display:`, `output`.

---

## Company Record Fields

Every seeded company contains these database fields:

```
nameEn                  — English company name
nameAr                  — Arabic company name
crNumber                — 10-digit Saudi CR number (UNIQUE INDEX — upsert key)
legalForm               — Legal form in English
legalFormAr             — Legal form in Arabic
city                    — Headquarters city (English)
cityAr                  — Headquarters city (Arabic)
region                  — Saudi region (Riyadh, Makkah, Eastern Province, etc.)
paidUpCapital           — Paid-up capital with SAR suffix
authorizedCapital       — Authorized capital
foundingDate            — Full founding date (date type)
foundingYear            — Founding year (string, e.g. "1995")
registrationDate        — CR registration date
expiryDate              — CR expiry date
authorizedSignatory     — Authorized signing person name
registrationStatus      — "Active" | "Expired" | "Suspended"
mainActivity            — Primary business activity (English)
mainActivityAr          — Primary business activity (Arabic)
capitalDistribution     — Capital distribution text (from AOA)
profitDistributionRules — Profit distribution rules (from AOA)
source                  — Harvester that produced this record (e.g. "open-data", "amaaly-aoa")
sourceUrl               — URL of the originating source record
enrichmentStatus        — "pending" | "enriching" | "enriched" | "failed"
website                 — Company website URL (filled by enrichment)
phone                   — Primary phone number (filled by enrichment)
email                   — Primary email address (filled by enrichment)
employeeCount           — Employee count estimate (filled by enrichment)
revenueEstimate         — Revenue estimate in SAR (filled by enrichment)
shareholders            — JSON array of shareholder objects
boardOfDirectors        — JSON array of board member objects
management              — JSON array of management team objects
analysisEn              — Full English AI intelligence report (from pipeline enrichment)
analysisAr              — Full Arabic AI intelligence report (from pipeline enrichment)
analysisData            — JSON metadata: { confidenceScore, dataQuality, sources[] }
newsHeadlines           — JSON array of recent news items
enrichmentData          — JSON of raw enrichment source data
enrichedAt              — Timestamp of last enrichment run
createdAt               — Record creation timestamp
updatedAt               — Record last update timestamp
```

---

## Upsert Logic

`upsertMasarCompany(company: CompanyData)` is called for every company discovered by any harvester. Steps:

1. **Blocklist check** — if company CR or name is on the blocklist (deleted companies), silently return null (skip insert)
2. **Name validation** — run `isValidCompanyName()` on both `nameEn` and `nameAr`
3. **CR present:** `INSERT INTO masar_companies ... ON CONFLICT (crNumber) DO UPDATE SET ...` — merges fields from new data only where existing fields are null/empty
4. **No CR:** query by normalized name first. If match found → update. If no match → insert new record.
5. Returns the database `id` on success, `null` if skipped

---

## Enrichment Status Lifecycle

```
[seeded by harvester] ─────────────────────► "pending"
                                                 │
                                                 ▼  enrichMasarCompany() called
                                            "enriching"
                                                 │
                              ┌──────────────────┴───────────────────┐
                              ▼                                       ▼
                          "enriched"                              "failed"
                              │                                       │
                              └──────────────── re-enrich ───────────┘
                                           (manual or bulk force)
```

A company stuck at `"enriching"` for over 10 minutes is treated as failed in subsequent `enrich-all` calls.

---

## Per-Company Enrichment Controls

### Standard Re-Enrich (fast — 14-source enrichment engine)
```
POST /api/masar/database/companies/:id/re-enrich
→ { ok: true, message: "Re-enrichment started" }
```
Fires the full 14-source enrichment engine on one company. Returns immediately; runs in background via `setImmediate()`. Best for refreshing contact data, website, financials, and team information. Sets status to `"enriching"` before starting.

### Pipeline Enrich (deep — full 5-agent Masaar Pipeline)
```
POST /api/masar/database/companies/:id/pipeline-enrich
→ {
    ok: true,
    jobId: "uuid",
    crNumber: "1234567890" | null,
    nameMode: false,
    message: "Pipeline started for CR 1234567890"
  }
```

Triggers the complete 5-agent Masaar Pipeline on a single company. Takes 3–8 minutes depending on network speed and CAPTCHA. Produces the deepest intelligence available:
- Shareholders with national IDs and exact ownership percentages (from mc.gov.sa)
- Manager names with appointment terms and legal powers (from mc.gov.sa)
- Board of directors extracted directly from AOA PDF (from emagazine.aamaly.sa)
- Full compliance check across 9 databases (OFAC, UN, EU, CMA, SAMA, ZATCA, Maroof, Najiz)
- Full bilingual intelligence reports — ~8,000 tokens each in EN and AR (Agent 5 output)

**Auto CR discovery:** If the company has no CR number in the database, Claude Sonnet is called first: `"What is the Saudi commercial registration (CR) number for [company name]? Return only the 10-digit number."` Matches 10-digit pattern starting with 1. If found, the pipeline runs in CR mode (`runMasaarPipeline`). If not found, runs in name mode (`runMasaarPipelineByName`).

**Smart field protection:** Pipeline results are saved with a field-by-field check before every update. Existing non-null values are never overwritten. Only blank/null fields are filled from pipeline output. Exception: `analysisEn` and `analysisAr` (bilingual reports) are always updated since they are the most comprehensive intelligence.

**Person validation filter (applied before saving shareholders/managers/board):**

These name patterns are rejected — none of these are saved to the DB:
- Exact strings: `undisclosed`, `unknown`, `not found`, `not available`, `not disclosed`
- Arabic equivalents: `غير معلن`, `مجهول`, `غير متاح`, `غير معروف`
- Numbered placeholders: `shareholder 1`, `shareholder 2`, `owner 1`, `person 1`, `person 2`, `مساهم 1`, `مساهم 2`
- Generic placeholders: `placeholder`, `n/a`, `-`, `—`, `x`, `tbd`, `unknown person`
- Any string that is null, undefined, or only whitespace after trimming

### Bulk Enrich All
```
POST /api/masar/database/enrich-all
{ "mode": "pending" | "all" }
→ { ok: true, message: "Enriching N companies...", count: N }
```

| Mode | UI Label | Behavior | Cap |
|------|---------|---------|-----|
| `"pending"` (default) | Smart Enrich | Targets companies where `enrichmentStatus IN ("pending", "failed")` OR `enrichmentStatus = "enriched"` but `shareholders` array is empty | 50 companies |
| `"all"` | Force Enrich All | Resets ALL companies with status NOT `"enriching"` back to `"pending"`, then processes all of them | 100 companies |

All companies are enriched with concurrency max 3 (internal semaphore). Returns immediately with a count; enrichment runs as a detached background task. This is what the **Force Enrich** / **Enrich All** button in the UI triggers.

---

## Deduplication Agent

```
POST /api/masar/database/deduplicate
→ {
    duplicatesFound: N,
    duplicatesDeleted: N,
    remainingCompanies: N
  }
```

### Full Algorithm

**Step 1 — Build identity key map**

For every company in the database, compute up to 3 identity keys:

1. **CR Number key** (strongest) — exact CR number string (e.g., `"cr:1234567890"`)
2. **Normalized English Name key** — computed as follows:
   - Lowercase the entire `nameEn`
   - Strip stop words: `company, co, ltd, llc, corp, inc, group, holding, holdings, international, intl, establishment, est, trading, industries, industrial, services, solutions, technology, technologies`
   - Strip all non-alphanumeric characters (punctuation, spaces, dashes, dots)
   - Collapse all whitespace to nothing
   - Key format: `"en:[normalized]"` (e.g., `"en:saudiaramco"`)
3. **Normalized Arabic Name key** — computed as follows:
   - Strip Arabic stop words: `شركة`, `مؤسسة`, `مجموعة`
   - Strip all non-Arabic, non-alphanumeric characters
   - Collapse all whitespace
   - Key format: `"ar:[normalized]"` (e.g., `"ar:أرامكوالسعودية"`)

**Step 2 — Group by key**

Any key shared by 2+ companies = duplicate group. A company can appear in multiple groups (e.g., same EN name AND same CR number).

**Step 3 — Select winner per group**

For each duplicate group, compute an enrichment score for every member:

| Condition | Score |
|-----------|-------|
| `enrichmentStatus = "enriched"` | +100 |
| `enrichmentStatus = "enriching"` | +50 |
| `shareholders` array has ≥ 1 item | +15 |
| `website` is non-null | +10 |
| `boardOfDirectors` array has ≥ 1 item | +10 |
| `email` is non-null | +8 |
| `phone` is non-null | +8 |
| `paidUpCapital` is non-null | +5 |

The company with the highest score is the winner. Ties are broken by lower `id` (earlier-seeded record wins).

**Step 4 — Delete losers**

All non-winner IDs from all duplicate groups are collected, deduplicated, then deleted in batches of 200 (prevents query length limits on large datasets).

**Returns:** total duplicates found, total deleted, and count of remaining companies after deletion.

---

## Company Selection & Bulk Delete

### Select specific companies and delete
```
DELETE /api/masar/database/companies/bulk
Body: { "ids": [1, 2, 3, 45, 67] }
→ { ok: true, deleted: 5 }
```
Before deletion, every selected company's CR number and both names (EN + AR) are added to the **blocklist**. The blocklist is a persistent table checked by `upsertMasarCompany()` before every insert — blocklisted companies are silently skipped, meaning they can never be re-seeded by any future harvest job.

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
  &limit=25
  &search=aramco
  &city=Riyadh
  &enrichmentStatus=enriched
  &source=open-data
  &legalForm=LLC
```

| Parameter | Type | Default | Behavior |
|-----------|------|---------|---------|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 25 | Records per page. Min: 5. Max: 100. |
| `search` | string | — | Case-insensitive partial match on: `nameEn`, `nameAr`, `crNumber`, `mainActivity` |
| `city` | string | — | Case-insensitive partial match on: `city` OR `cityAr` |
| `enrichmentStatus` | string | — | Exact match: `"enriched"`, `"pending"`, `"failed"`, `"enriching"` |
| `source` | string | — | Exact match on `source` field: `"open-data"`, `"amaaly-aoa"`, `"opencorporates"`, `"gleif"`, `"mooresrowland"`, etc. |
| `legalForm` | string | — | Case-insensitive partial match on `legalForm` |

**Response:**
```json
{
  "companies": [...],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 1247,
    "pages": 50
  }
}
```

### Single company detail
```
GET /api/masar/database/companies/:id
→ full company record (all fields including shareholders[], management[], boardOfDirectors[], analysisEn, analysisAr)
```

### Stats
```
GET /api/masar/database/stats
→ {
    total: number,          // total companies in DB
    enriched: number,       // enrichmentStatus = "enriched"
    pending: number,        // enrichmentStatus = "pending"
    activeSources: number,  // distinct source values present
    bySource: {
      "open-data": N,
      "amaaly-aoa": N,
      "opencorporates": N,
      "gleif": N,
      "mooresrowland": N,
      ...
    }
  }
```

---

## Export Formats

```
GET /api/masar/database/export
  ?format=csv | excel | word | pdf | pptx
  &search=filter_term     (optional — same search logic as GET /companies)
  &ids=1,2,3,4,5          (optional — comma-separated list of specific company IDs)
```

When `ids` is provided, only those specific companies are exported regardless of `search`. When omitted, all companies matching `search` are exported (CSV/Excel cap: 5,000; Word/PDF/PPTX: no cap).

| Format | File | Contents | Details |
|--------|------|---------|---------|
| **CSV** | `.csv` | All flat fields | UTF-8 BOM (`\uFEFF`) prepended — ensures Arabic renders correctly when opened in Excel on any locale. Fields: all scalar company fields + `analysisEnSummary` (first 500 chars of `analysisEn`). |
| **Excel** | `.xlsx` | 3 worksheets | **Sheet 1 — Companies:** all scalar fields, one row per company. **Sheet 2 — Shareholders:** one row per shareholder linked to company by ID + name. **Sheet 3 — Management & Board:** one row per person from `management[]` + `boardOfDirectors[]`, linked to company. |
| **Word** | `.doc` | Full company profiles | One section per company: heading with name EN + AR, key fields table (2 columns), Shareholders table (name EN, name AR, ownership %, nationality), Management table (name EN, name AR, title), Board table, AI Analysis EN block, AI Analysis AR block. |
| **PDF** | `.html` (print-as-PDF) | Full company profiles | Dark-themed HTML page with ProspectSA branding, print button at top. `window.print()` triggered on load saves to PDF. One section per company with all tables and full analysis text. |
| **PPTX** | `.pptx` | Slide deck | One slide per company. Dark background (`#0f172a`). Title: company name EN (28pt white bold) + AR (20pt gray). Body: 12 key fields in 2 columns (label in accent color, value in white). AI analysis excerpt (first 300 chars). ProspectSA footer. |

---

## Custom Sources Management

Users can save any URL as a reusable harvestable source. Before adding, the URL can be analyzed to preview what company data it likely contains.

### List saved custom sources
```
GET /api/masar/database/custom-sources
→ [{ id, name, url, createdAt }, ...]
```

### Add a custom source
```
POST /api/masar/database/custom-sources
{ "url": "https://example.com/companies", "name": "My Company List" }
→ { id, name, url, createdAt }
```

### Analyze a URL before adding
```
POST /api/masar/database/analyze-source
{ "url": "https://example.com/companies" }
→ {
    ok: true,
    analysis: {
      suggestedName: "Short human-readable source name",
      description: "One-sentence description of what data the site contains",
      dataTypes: ["company names", "CR numbers", "contact info", "Arabic names"],
      hasCompanyData: true,
      language: "ar" | "en" | "both",
      confidence: "high" | "medium" | "low",
      note: "Site requires browser rendering or login — content preview unavailable"
    },
    previewChars: 3420   // how many chars of text were extracted from the page
  }
```

**Analyze endpoint behavior:**
1. Fetches the URL using `axios` with a Windows Chrome User-Agent and Saudi `Accept-Language: ar-SA,ar;q=0.9` header
2. Parses HTML with Cheerio, strips `<script>`, `<style>`, `<noscript>`, `<nav>`, `<footer>`, `<header>` tags
3. Extracts plain text (up to 6,000 chars)
4. Sends text to Claude Sonnet with: source URL, domain name, extracted text preview
5. If page returned < 100 chars (JavaScript SPA or login-gated), Claude infers content from domain name and URL path patterns
6. Returns structured analysis JSON

### Delete a custom source
```
DELETE /api/masar/database/custom-sources/:id
→ { deleted: true }
```

---

## Write Protection Policy

The `masar_companies` table enforces strict write isolation to prevent accidental corruption by non-database routes.

| Route / Engine | Table Access |
|----------------|-------------|
| `runHarvest()` — harvester | ✅ INSERT new companies via `upsertMasarCompany()` |
| `enrichMasarCompany()` — enrichment engine | ✅ UPDATE enrichment fields |
| `POST /companies/:id/re-enrich` | ✅ UPDATE via `enrichMasarCompany()` |
| `POST /companies/:id/pipeline-enrich` | ✅ UPDATE with pipeline results (field-protected) |
| `POST /enrich-all` | ✅ UPDATE via `enrichMasarCompany()` (batch) |
| `POST /deduplicate` | ✅ DELETE duplicate records |
| `DELETE /companies/bulk` | ✅ DELETE + blocklist entries |
| `DELETE /companies/:id` | ✅ DELETE + blocklist entry |
| Smart Prospecting Engine | ❌ READ-ONLY — never writes |
| Company Intelligence (ProsEngine) | ❌ READ-ONLY — never writes |
| Person Intelligence (ProsEngine) | ❌ READ-ONLY — never writes |
| OrcEngine | ❌ READ-ONLY — never writes |
| Lead Lists | ❌ READ-ONLY — never writes |
| Builder routes | ❌ READ-ONLY — never writes |

---

## API Routes — Complete List

```
POST   /api/masar/database/harvest
GET    /api/masar/database/stream/:jobId
GET    /api/masar/database/jobs

GET    /api/masar/database/companies
GET    /api/masar/database/companies/:id
DELETE /api/masar/database/companies/:id
DELETE /api/masar/database/companies/bulk

POST   /api/masar/database/companies/:id/re-enrich
POST   /api/masar/database/companies/:id/pipeline-enrich

POST   /api/masar/database/enrich-all
POST   /api/masar/database/deduplicate

GET    /api/masar/database/export

GET    /api/masar/database/stats

GET    /api/masar/database/custom-sources
POST   /api/masar/database/custom-sources
POST   /api/masar/database/analyze-source
DELETE /api/masar/database/custom-sources/:id
```

---

## Environment Variables

| Variable | Used By | Status |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | Enrichment (Claude), extraction fallback (Claude), custom source analysis, pipeline-enrich | Required |
| `OPENAI_API_KEY` | Enrichment (GPT-4o), extraction fallback (GPT-4o) | Required |
| `GEMINI_API_KEY` | Enrichment (Gemini × 3), extraction primary (Gemini) | Required |
| `PERPLEXITY_API_KEY` | Enrichment (profile + contact), sector search, Wikipedia supplement | Required (graceful Claude fallback) |
| `APOLLO_API_KEY` | Enrichment — Apollo.io people search | Optional |
| `EXPLORIUM_API_KEY` | Enrichment — Explorium company intelligence | Optional |

---

## Key Files

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/masar-harvester.ts` | All harvester functions + `enrichMasarCompany()` (2,907 lines) |
| `artifacts/api-server/src/routes/masar-database.ts` | All database API route handlers (997 lines) |
| `artifacts/api-server/src/lib/masaar-engine.ts` | 5-agent Masaar Pipeline called by `pipeline-enrich` |
| `artifacts/api-server/src/lib/blocklist.ts` | Deletion blocklist — prevents deleted companies from being re-seeded |
| `artifacts/api-server/src/lib/free-sources.ts` | OpenCorporates, GLEIF, Wikidata SPARQL harvesters |
| `artifacts/api-server/src/lib/mooresrowland-scraper.ts` | Directory scrapers for all 9 professional directories |
| `artifacts/prospect-sa/src/pages/masaar/database.tsx` | Database UI — list, filter, select, enrich, export |
