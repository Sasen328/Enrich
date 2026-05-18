# Agentic Database Builder — Full Feature Documentation

## Overview

The Agentic Database Builder is a harvesting engine that autonomously extracts Saudi company records from 14 pre-built sources (plus unlimited user-added custom sources) and stages them in `builder_companies`. Results are enriched by AI (Claude or GPT-4o), deduplicated against each other and cross-checked against MeshBase, cleaned, and can be seeded into MeshBase manually. **The Builder never writes directly to `companies` (MeshBase) during harvest — only an explicit "Seed to MeshBase" action does so.**

---

## Architecture

```
Frontend (React — database-builder/index.tsx)
  ↓ GET  /api/builder/sources
  ↓ POST /api/builder/sources                  ← Add custom source
  ↓ DELETE /api/builder/sources/:id            ← Remove custom source
  ↓ POST /api/builder/sources/:id/harvest      ← Harvest one source
  ↓ POST /api/builder/harvest                  ← Harvest all sources
  ↓ GET  /api/builder/jobs/:jobId              ← 3-second polling
  ↓ GET  /api/builder/results                  ← (results page)
  ↓ POST /api/builder/deduplicate
  ↓ POST /api/builder/auto-clean
  ↓ GET  /api/builder/export                   ← CSV or Excel download
API Server (Express — builder.ts)
  └── builder-engine.ts   (runHarvest, deduplicateAll, autoClean, reEnrichAll)
  └── enrichment-engine.ts (enrichCompanyWithAI)
  └── data-sources.ts     (SAUDI_DATA_SOURCES — 14 built-in sources)
DB: builder_companies, builder_jobs, builder_custom_sources, jobs
```

---

## Database Schema

### `builder_companies`
```sql
CREATE TABLE builder_companies (
  id                  SERIAL PRIMARY KEY,
  name_en             TEXT,
  name_ar             TEXT,
  industry            TEXT,
  sub_industry        TEXT,
  city                TEXT,
  region              TEXT,
  country             TEXT DEFAULT 'Saudi Arabia',
  cr_number           VARCHAR(20),
  phone               TEXT,
  email               TEXT,
  website             TEXT,
  address             TEXT,
  employees           INTEGER,
  revenue             TEXT,
  founding_year       INTEGER,
  legal_form          TEXT,
  entity_type         TEXT,
  paid_up_capital     TEXT,
  shareholders        TEXT,                    -- JSON array
  executives          TEXT,                    -- JSON array
  description         TEXT,
  source_id           TEXT,                    -- e.g. "wikidata", "custom-3"
  source_name         TEXT,                    -- Human-readable name
  source_url          TEXT,                    -- URL harvested from
  enrichment_status   TEXT DEFAULT 'pending',  -- "pending" | "enriched" | "partial" | "failed"
  enrichment_depth    TEXT DEFAULT 'basic',    -- "basic" | "standard" | "deep"
  is_duplicate        BOOLEAN DEFAULT false,
  duplicate_of_id     INTEGER,                 -- References another builder_companies.id
  is_seeded           BOOLEAN DEFAULT false,   -- True after seeded to MeshBase
  raw_data            TEXT,                    -- JSON: raw response from source API/scrape
  created_at          TIMESTAMP DEFAULT now(),
  updated_at          TIMESTAMP DEFAULT now()
);
```

### `builder_jobs`
```sql
CREATE TABLE builder_jobs (
  id                    SERIAL PRIMARY KEY,
  job_id                VARCHAR(36) UNIQUE NOT NULL,  -- UUID
  status                TEXT DEFAULT 'pending',        -- "running" | "completed" | "failed" | "cancelled"
  source_ids            TEXT,                          -- JSON array of source IDs being harvested
  batch_size            INTEGER DEFAULT 1,
  enrichment_depth      TEXT DEFAULT 'standard',
  companies_harvested   INTEGER DEFAULT 0,
  companies_enriched    INTEGER DEFAULT 0,
  companies_duplicated  INTEGER DEFAULT 0,
  progress              INTEGER DEFAULT 0,             -- 0–100
  total_sources         INTEGER DEFAULT 0,
  completed_sources     INTEGER DEFAULT 0,
  error                 TEXT,
  created_at            TIMESTAMP DEFAULT now(),
  updated_at            TIMESTAMP DEFAULT now()
);
```

### `builder_custom_sources`
```sql
CREATE TABLE builder_custom_sources (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  name_ar               TEXT,
  url                   TEXT NOT NULL,
  category              TEXT NOT NULL,           -- see Category enum below
  description           TEXT,
  estimated_companies   INTEGER DEFAULT 0,
  created_at            TIMESTAMP DEFAULT now(),
  updated_at            TIMESTAMP DEFAULT now()
);
```

**Category values:**
`"business-directory"` | `"chamber-of-commerce"` | `"government"` | `"industry-association"` | `"linkedin"` | `"news"` | `"other"`

### Seed Data

`builder_companies` is pre-seeded from `artifacts/api-server/src/seed-data/builder_companies.json.gz` at server startup via `seedMeshbaseIfEmpty()`. Current live count: **962 records**.

Sample seed entries:
```json
[
  {
    "nameEn": "Nadec",
    "nameAr": "الشركة الوطنية للتنمية الزراعية",
    "industry": "Food Industry",
    "city": "Riyadh",
    "foundingYear": 1981,
    "sourceId": "wikidata",
    "sourceName": "Wikidata SPARQL",
    "enrichmentStatus": "enriched"
  },
  {
    "nameEn": "Saudi Aramco",
    "nameAr": "شركة أرامكو السعودية",
    "industry": "Energy & Oil",
    "city": "Dhahran",
    "foundingYear": 1933,
    "sourceId": "cma-financial",
    "sourceName": "CMA Financial Market Data",
    "enrichmentStatus": "enriched"
  },
  {
    "nameEn": "Saudi Basic Industries Corporation (SABIC)",
    "nameAr": "الشركة السعودية للصناعات الأساسية",
    "industry": "Petrochemicals",
    "city": "Riyadh",
    "foundingYear": 1976,
    "sourceId": "wikidata",
    "sourceName": "Wikidata SPARQL",
    "enrichmentStatus": "enriched"
  },
  {
    "nameEn": "Al Rajhi Bank",
    "nameAr": "مصرف الراجحي",
    "industry": "Banking & Finance",
    "city": "Riyadh",
    "foundingYear": 1957,
    "sourceId": "cma-financial",
    "sourceName": "CMA Financial Market Data",
    "enrichmentStatus": "enriched"
  },
  {
    "nameEn": "stc (Saudi Telecom Company)",
    "nameAr": "شركة الاتصالات السعودية",
    "industry": "Telecommunications",
    "city": "Riyadh",
    "foundingYear": 1998,
    "sourceId": "wikidata",
    "sourceName": "Wikidata SPARQL",
    "enrichmentStatus": "enriched"
  }
]
```

---

## Built-In Data Sources (`data-sources.ts`)

14 pre-configured sources — all defined in `SAUDI_DATA_SOURCES`:

| ID | Name | Category | URL | Est. Companies |
|---|---|---|---|---|
| `wikidata` | Wikidata SPARQL | wikidata | `https://query.wikidata.org/sparql` | 500 |
| `ministry-commerce` | Ministry of Commerce | government | `https://mc.gov.sa` | 5000 |
| `cma-financial` | CMA Financial Market Data | financial | `https://www.cma.org.sa` | 250 |
| `saudi-chamber` | Saudi Chamber of Commerce | chamber | `https://www.saudichamber.org.sa` | 3000 |
| `riyadh-chamber` | Riyadh Chamber | chamber | `https://www.riyadhchamber.com` | 2000 |
| `yellow-pages-sa` | Saudi Yellow Pages | directory | `https://www.yellowpages.com.sa` | 8000 |
| `kompass-sa` | Kompass Saudi Arabia | directory | `https://sa.kompass.com` | 4500 |
| `zawya-sa` | Zawya Saudi Companies | directory | `https://www.zawya.com/en/companies/saudi-arabia` | 3500 |
| `dnb-sa` | D&B Saudi Arabia | directory | `https://www.dnb.com/en-us/data-cloud/saudi-arabia.html` | 6000 |
| `exporters-sa` | Saudi Exporters Directory | government | `https://www.saudiexporter.sa` | 1200 |
| `tadawul` | Tadawul Listed Companies | financial | `https://www.tadawul.com.sa/wps/portal/tadawul/markets/companies` | 200 |
| `vision-companies` | Vision 2030 Companies | government | `https://www.vision2030.gov.sa` | 800 |
| `startup-sa` | Startup Saudi (Monsha'at) | government | `https://www.monshaat.gov.sa` | 1500 |
| `linkedin-sa` | LinkedIn Saudi Companies | linkedin | `https://www.linkedin.com/companies/saudi-arabia` | 10000 |

---

## Backend: `builder-engine.ts`

### `runHarvest(options)`

```typescript
interface HarvestOptions {
  sourceIds: string[];           // Which sources to harvest (can be single or all)
  batchSize: number;             // Concurrent source processing (default: 1 single, 3 for all)
  enrichmentDepth: "basic" | "standard" | "deep";
  extraSources?: SourceDef[];    // Custom sources from DB merged in
}

async function runHarvest(options: HarvestOptions): Promise<{ jobId: string; builderJobId: number }>
```

**Steps:**

1. Creates a `builder_jobs` record (status: "running")
2. Also creates a `jobs` table record (type: "builder_harvest") for shared polling compatibility
3. For each source in `sourceIds`, calls the appropriate fetcher:
   - Source ID `"wikidata"` → `fetchWikidataSaudiCompanies()`
   - All others → `harvestSourceWithAI(source, enrichmentDepth)`
4. For each company returned, runs dedup check, then INSERT into `builder_companies`
5. Updates `builder_jobs` progress throughout
6. Sets `builder_jobs.status = "completed"` when done

### `fetchWikidataSaudiCompanies()`

The only source with a dedicated fetcher. Uses SPARQL:

```sparql
SELECT DISTINCT ?company ?companyLabel ?industry ?industryLabel ?city ?cityLabel ?founded ?employees ?website WHERE {
  ?company wdt:P31 wd:Q4830453.       # instance of: business
  ?company wdt:P17 wd:Q851.           # country: Saudi Arabia
  OPTIONAL { ?company wdt:P452 ?industry. }
  OPTIONAL { ?company wdt:P159 ?city. }
  OPTIONAL { ?company wdt:P571 ?founded. }
  OPTIONAL { ?company wdt:P1128 ?employees. }
  OPTIONAL { ?company wdt:P856 ?website. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ar". }
}
LIMIT 500
```

Endpoint: `https://query.wikidata.org/sparql`  
Headers: `Accept: application/sparql-results+json`  
Timeout: 30 seconds

Returns mapped array of companies with `sourceId: "wikidata"`, `sourceName: "Wikidata SPARQL"`.

### `harvestSourceWithAI(source, depth)`

For all non-Wikidata sources:

1. Fetches the source URL with Axios (realistic User-Agent, 15-second timeout)
2. Parses HTML with Cheerio, extracts text (strips scripts/styles/nav)
3. Calls Claude (`claude-sonnet-4-5`) with prompt:
   ```
   You are a Saudi company data extraction specialist.
   Extract all Saudi company records from this webpage.
   Return a JSON array. Each object must have:
     nameEn, nameAr (if available), industry, city, phone, email, website,
     address, employees, revenue, foundingYear, crNumber (if visible),
     description, legalForm
   Return null for missing fields. Do not fabricate data.
   Source: {source.name} ({source.url})
   ```
4. Parses the JSON response
5. Falls back to GPT-4o if Claude fails or returns malformed JSON
6. Final fallback: regex-based heuristic extraction (finds patterns like SAR amounts, phone numbers, CR numbers)

**Enrichment by depth:**
- `"basic"` — returns raw extracted data as-is (`enrichmentStatus: "pending"`)
- `"standard"` — calls `enrichCompanyWithAI(company, "standard")` for each record
- `"deep"` — calls `enrichCompanyWithAI(company, "deep")` + web search to fill missing fields

### `deduplicateAll()`

```typescript
async function deduplicateAll(): Promise<{ flagged: number; deleted: number }>
```

**Algorithm:**

1. Loads ALL `builder_companies` records
2. Loads ALL `companies` (MeshBase) records for cross-check
3. For each `builder_companies` record, checks:
   - **Same `nameEn`** (case-insensitive) as another builder record → duplicate
   - **Same `nameAr`** as another builder record → duplicate
   - **Same `cr_number`** as another builder record → duplicate
   - **Same `nameEn` exists in MeshBase** → flag as `duplicate_of_meshbase`
4. For all flagged duplicates: `DELETE FROM builder_companies WHERE id = ?`
5. Returns `{ flagged: N, deleted: N }`

**MeshBase cross-check is read-only** — no writes to `companies`.

### `autoClean()`

```typescript
async function autoClean(): Promise<{ cleaned: number }>
```

Validates and normalizes every `builder_companies` record:
- **Phone numbers:** Must match Saudi format (`+966`, `05xx`, `9665xxx`). Invalid → set to null.
- **Email addresses:** Must match standard email regex. Invalid → set to null.
- **Website URLs:** Must start with `http://` or `https://`. Adds `https://` prefix if missing.
- **CR numbers:** Must be 10 digits. Non-conforming → set to null.
- **Names:** Trims whitespace from `nameEn` and `nameAr`.
- Sets `updated_at = now()` for each modified record.

### `reEnrichCompany(id, depth)`

Re-enriches a single company by ID. Calls `enrichCompanyWithAI()` with the specified depth, then `UPDATE builder_companies` with enriched data.

### `reEnrichAll(depth)`

Fetches all records where `enrichment_status = "pending"` or `enrichment_status = "partial"`, then re-enriches each one sequentially.

---

## `enrichment-engine.ts`

```typescript
async function enrichCompanyWithAI(company: CompanyData, depth: string): Promise<CompanyData>
```

**Standard depth:**
- Translates Arabic `nameAr` to English `nameEn` if missing (and vice versa)
- Guesses `city` from company name if not set
- Normalizes `industry` to a standard Saudi sector name
- Returns `enrichmentStatus: "enriched"` or `"partial"`

**Deep depth (all of standard, plus):**
- Calls Claude to search its training knowledge for the company's phone, email, website
- Validates each returned value (phone format, email regex, URL format)
- Attempts to find `employees` and `revenue` estimates from company size/industry context
- Sets `enrichmentStatus: "enriched"` if all key fields filled, `"partial"` if some still missing

**AI model:** Claude `claude-sonnet-4-5` primary; falls back to GPT-4o (`gpt-4o`) on error or rate limit.

**Explorium API (optional enrichment):**
If `EXPLORIUM_API_KEY` is set in environment:
```
POST https://api.explorium.ai/v1/companies/enrich
{ "company_name": nameEn, "country": "Saudi Arabia" }
```
Returns enriched company profile. Merged into the company data before Claude enrichment.

---

## API Endpoints

### `GET /api/builder/sources`

Returns all configured sources (built-in + custom).

**Response:** Array of source objects:
```json
[
  {
    "id": "wikidata",
    "name": "Wikidata SPARQL",
    "nameAr": "ويكيداتا",
    "category": "wikidata",
    "url": "https://query.wikidata.org/sparql",
    "description": "Open knowledge base with 500+ Saudi company entries",
    "estimatedCompanies": 500,
    "isEnabled": true,
    "isCustom": false,
    "lastHarvestedAt": "2026-03-20T08:30:00Z"
  },
  {
    "id": "custom-3",
    "name": "Saudi Exporters Directory",
    "nameAr": "دليل المصدرين السعوديين",
    "category": "government",
    "url": "https://www.saudiexporter.sa",
    "description": "Custom source added by user",
    "estimatedCompanies": 1200,
    "isEnabled": true,
    "isCustom": true,
    "dbId": 3,
    "lastHarvestedAt": null
  }
]
```

---

### `POST /api/builder/sources`

Adds a custom source.

**Request body:**
```json
{
  "name": "Saudi Exporters Directory",
  "url": "https://www.saudiexporter.sa",
  "category": "government",
  "estimatedCompanies": 1200,
  "description": "Official Saudi export council directory"
}
```

**Response:**
```json
{
  "success": true,
  "source": {
    "id": "custom-3",
    "name": "Saudi Exporters Directory",
    "nameAr": "Saudi Exporters Directory",
    "category": "government",
    "url": "https://www.saudiexporter.sa",
    "description": "Official Saudi export council directory",
    "estimatedCompanies": 1200,
    "isEnabled": true,
    "isCustom": true,
    "dbId": 3,
    "lastHarvestedAt": null
  }
}
```

---

### `DELETE /api/builder/sources/:id`

Deletes a custom source. `:id` is the `custom-{n}` format string.

**Response:** `{ "success": true }`

---

### `POST /api/builder/sources/:id/harvest`

Triggers harvest for a single source.

**Request body:**
```json
{
  "batchSize": 1,
  "enrichmentDepth": "standard"
}
```

**Response:**
```json
{
  "jobId": "uuid-v4",
  "builderJobId": 42,
  "sourceId": "wikidata",
  "status": "running"
}
```

The `jobId` here is the UUID used to poll `GET /api/builder/jobs/:jobId`.

---

### `POST /api/builder/harvest`

Triggers harvest for ALL sources.

**Request body:**
```json
{
  "batchSize": 3,
  "enrichmentDepth": "standard"
}
```

**Response:**
```json
{
  "jobId": "uuid-v4",
  "totalSources": 14,
  "status": "running"
}
```

---

### `GET /api/builder/jobs/:jobId`

Polls job status.

**Response:**
```json
{
  "jobId": "uuid-v4",
  "status": "completed",
  "companiesHarvested": 87,
  "companiesEnriched": 74,
  "companiesDuplicated": 12,
  "progress": 100,
  "totalSources": 14,
  "completedSources": 14,
  "createdAt": "2026-03-25T10:00:00Z",
  "updatedAt": "2026-03-25T10:45:00Z"
}
```

---

### `GET /api/builder/results`

Returns all `builder_companies` records (paginated).

**Query params:** `?page=1&limit=50&search=aramco&status=enriched&source=wikidata`

**Response:**
```json
{
  "companies": [
    {
      "id": 1,
      "nameEn": "Nadec",
      "nameAr": "الشركة الوطنية للتنمية الزراعية",
      "industry": "Food Industry",
      "city": "Riyadh",
      "crNumber": null,
      "phone": null,
      "email": null,
      "website": null,
      "employees": null,
      "revenue": null,
      "foundingYear": 1981,
      "enrichmentStatus": "enriched",
      "sourceId": "wikidata",
      "sourceName": "Wikidata SPARQL",
      "isDuplicate": false,
      "isSeeded": false,
      "createdAt": "2026-03-01T00:00:00Z"
    }
  ],
  "total": 962,
  "page": 1,
  "limit": 50
}
```

---

### `POST /api/builder/deduplicate`

Runs deduplication across all `builder_companies`, cross-checked against MeshBase.

**Response:**
```json
{
  "success": true,
  "flagged": 45,
  "deleted": 45,
  "message": "Deleted 45 duplicate records (3 were also present in MeshBase)"
}
```

---

### `POST /api/builder/auto-clean`

Validates and normalizes all records.

**Response:**
```json
{
  "success": true,
  "cleaned": 128,
  "message": "Cleaned 128 records: 45 phones fixed, 23 emails removed, 60 websites normalized"
}
```

---

### `GET /api/builder/export`

Exports all `builder_companies` as CSV or Excel.

**Query params:** `?format=csv` or `?format=excel`

**Response (CSV):** Direct file download with `Content-Type: text/csv` and `Content-Disposition: attachment; filename=builder_export_2026-03-25.csv`

**Response (Excel):** Direct file download with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**CSV columns:**
```
id, nameEn, nameAr, industry, city, crNumber, phone, email, website, address,
employees, revenue, foundingYear, legalForm, entityType, paidUpCapital,
description, sourceId, sourceName, enrichmentStatus, isDuplicate, isSeeded, createdAt
```

---

### `POST /api/builder/re-enrich`

Re-enriches all pending/partial records.

**Request body:** `{ "depth": "deep" }`

**Response:** `{ "success": true, "enriched": 89 }`

---

### `POST /api/builder/seed-meshbase`

Seeds approved `builder_companies` records into MeshBase (`companies` table). This is the **only** path from Builder → MeshBase. User must explicitly trigger it.

**Request body:** `{ "ids": [1, 2, 3] }` (specific IDs) or `{}` (all non-seeded, non-duplicate records)

**Response:**
```json
{
  "success": true,
  "seeded": 45,
  "failed": 2,
  "message": "45 companies seeded to MeshBase"
}
```

After seeding: sets `builder_companies.is_seeded = true` for each seeded row.

---

## Frontend: `src/pages/database-builder/index.tsx`

### State variables

```typescript
const [sources, setSources]           = useState<SourceItem[]>([]);
const [sourcesLoading, setSourcesLoading] = useState(true);
const [harvestStates, setHarvestStates] = useState<Record<string, HarvestState>>({});
const [harvestAllRunning, setHarvestAllRunning] = useState(false);
const [addSourceOpen, setAddSourceOpen] = useState(false);
const [enrichmentDepth, setEnrichmentDepth] = useState<"basic" | "standard" | "deep">("standard");

interface HarvestState {
  status: "idle" | "harvesting" | "done" | "error";
  count?: number;      // companies added when done
  error?: string;      // error message when failed
}
```

### API prefix

```typescript
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// All API calls: `${BASE}/api/builder/...`
```

### Source loading

```typescript
const loadSources = async () => {
  const res = await fetch(`${BASE}/api/builder/sources`);
  const data = await res.json();
  setSources(data);
};
useEffect(() => { void loadSources(); }, []);
```

### Harvest one source

```typescript
const harvestOne = async (source: SourceItem) => {
  setSourceState(source.id, { status: "harvesting" });

  // POST /api/builder/sources/:id/harvest
  const { jobId } = await fetch(`${BASE}/api/builder/sources/${source.id}/harvest`, {
    method: "POST",
    body: JSON.stringify({ batchSize: 1, enrichmentDepth }),
  }).then(r => r.json());

  // Poll GET /api/builder/jobs/:jobId every 3 seconds, up to 60 polls (3 minutes)
  let polls = 0;
  const poll = async () => {
    const jobData = await fetch(`${BASE}/api/builder/jobs/${jobId}`).then(r => r.json());
    if (jobData.status === "completed") {
      setSourceState(source.id, { status: "done", count: jobData.companiesHarvested });
    } else if (jobData.status === "failed") {
      setSourceState(source.id, { status: "error", error: `Job ${jobData.status}` });
    } else if (polls < 60) {
      polls++;
      setTimeout(() => void poll(), 3000);
    } else {
      setSourceState(source.id, { status: "error", error: "Timed out" });
    }
  };
  setTimeout(() => void poll(), 2000);  // Initial delay before first poll
};
```

### Harvest all sources

```typescript
const harvestAll = async () => {
  setHarvestAllRunning(true);
  for (const s of sources) setSourceState(s.id, { status: "harvesting" });

  // POST /api/builder/harvest
  const { jobId } = await fetch(`${BASE}/api/builder/harvest`, {
    method: "POST",
    body: JSON.stringify({ batchSize: 3, enrichmentDepth }),
  }).then(r => r.json());

  // Poll every 3 seconds, up to 120 polls (6 minutes)
  let polls = 0;
  const poll = async () => {
    const jobData = await fetch(`${BASE}/api/builder/jobs/${jobId}`).then(r => r.json());
    if (jobData.status === "completed" || jobData.status === "failed") {
      for (const s of sources) setSourceState(s.id, { status: jobData.status === "completed" ? "done" : "idle" });
      setHarvestAllRunning(false);
    } else if (polls < 120) {
      polls++;
      setTimeout(() => void poll(), 3000);
    } else {
      setHarvestAllRunning(false);
    }
  };
  setTimeout(() => void poll(), 2000);
};
```

### Add custom source

```typescript
const handleAddSource = async () => {
  await fetch(`${BASE}/api/builder/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, url, category, estimatedCompanies: parseInt(estimated), description }),
  });
  await loadSources();
  setAddSourceOpen(false);
};
```

### Delete custom source

```typescript
const handleDeleteSource = async (source: SourceItem) => {
  await fetch(`${BASE}/api/builder/sources/${source.id}`, { method: "DELETE" });
  await loadSources();
};
```

### Source Card UI

```tsx
<Card className={cn(
  "bg-card/40 backdrop-blur-sm border transition-all duration-200",
  isHarvesting && "border-primary/60 shadow-[0_0_20px_rgba(6,182,212,0.15)]",   // cyan glow
  isDone        && "border-emerald-500/40",                                       // green border
  isError       && "border-rose-500/30",                                          // red border
  !isHarvesting && !isDone && !isError && "border-white/10 hover:border-white/20", // default
)}>
  {/* Top: category emoji + source name + Custom badge (if custom) */}
  {/* Right: Delete button (custom only) + Harvest play button */}
  {/* Bottom: estimated company count | harvest status */}
</Card>
```

**Category emojis:**
```typescript
const categoryIcon: Record<string, string> = {
  wikidata: "🌍", government: "🏛️", directory: "📂",
  chamber: "🤝", financial: "💹",
  "business-directory": "📂", "chamber-of-commerce": "🤝",
  "industry-association": "🏭", linkedin: "💼",
  news: "📰", other: "🔗",
};
```

**Harvest button states:**
- `idle` → Play icon, `bg-primary/10 hover:bg-primary/25 hover:scale-110`
- `harvesting` → `Loader2` spin, `bg-primary/20 cursor-not-allowed`
- `done` → `CheckCircle2`, `bg-emerald-500/20 text-emerald-400`
- `error` → `AlertCircle`, `bg-rose-500/20 text-rose-400`

### Header controls

```tsx
{/* Enrichment Depth selector */}
<Select value={enrichmentDepth} onValueChange={...}>
  <SelectItem value="basic">Basic enrichment</SelectItem>
  <SelectItem value="standard">Standard enrichment</SelectItem>
  <SelectItem value="deep">Deep enrichment</SelectItem>
</Select>

{/* Navigation */}
<Link href="/database-builder/results">View Results →</Link>

{/* Add Source dialog trigger */}
<Button variant="outline"><Plus /> Add Source</Button>

{/* Harvest All */}
<Button className="bg-gradient-to-r from-primary to-accent">
  {harvestAllRunning ? <><Loader2 spin/>Harvesting All...</> : <><Zap/>Harvest All</>}
</Button>
```

---

## Results Page (`src/pages/database-builder/results/index.tsx`)

Separate route at `/database-builder/results`. Loads all `builder_companies` from `GET /api/builder/results`.

**Controls on results page:**
- Search bar (filters by nameEn/nameAr/industry)
- Status filter dropdown (all/enriched/partial/pending/failed)
- Source filter dropdown (all sources)
- "Deduplicate" button → `POST /api/builder/deduplicate`
- "Auto Clean" button → `POST /api/builder/auto-clean`
- "Re-Enrich All" button → `POST /api/builder/re-enrich`
- "Export CSV" button → `GET /api/builder/export?format=csv`
- "Export Excel" button → `GET /api/builder/export?format=excel`
- "Seed to MeshBase" button → `POST /api/builder/seed-meshbase`

**Company cards** in results grid show:
- Company name (EN + AR)
- Industry badge
- City
- Enrichment status badge
- Source name
- Phone/Email/Website if present
- Founding year if present

---

## Data Flow Summary

```
User selects enrichmentDepth + clicks ▶ on a source card (or Harvest All)
  → POST /api/builder/sources/:id/harvest { batchSize, enrichmentDepth }
    → runHarvest({ sourceIds: [id], batchSize, enrichmentDepth, extraSources })
      → INSERT builder_jobs (status: "running")
      → For Wikidata: fetchWikidataSaudiCompanies() — SPARQL query
      → For others:  harvestSourceWithAI(source, depth) — Axios + Cheerio + Claude
      → For each company:
          → Dedup check (nameEn, nameAr, CR)
          → If not duplicate: INSERT builder_companies
          → If depth != "basic": enrichCompanyWithAI() → UPDATE builder_companies
      → UPDATE builder_jobs (status: "completed", companiesHarvested: N)
    → Returns { jobId }
  ← Frontend polls GET /api/builder/jobs/:jobId every 3s
  ← On "completed": shows ✓ badge with count on source card

User clicks "Deduplicate"
  → POST /api/builder/deduplicate
    → Loads all builder_companies
    → Loads all companies (MeshBase) for cross-check
    → DELETE duplicates from builder_companies
  ← Shows count deleted

User clicks "Seed to MeshBase" on results page
  → POST /api/builder/seed-meshbase { ids: [...] or empty }
    → For each selected builder_company:
        → INSERT INTO companies (MeshBase) if not exists
        → UPDATE builder_companies SET is_seeded = true
  ← Shows count seeded
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| SPARQL queries | Axios + `application/sparql-results+json` |
| HTML scraping | Axios + Cheerio |
| AI extraction | Claude claude-sonnet-4-5 (primary) |
| AI fallback | GPT-4o (OpenAI) |
| Optional enrichment | Explorium API (if `EXPLORIUM_API_KEY` set) |
| Excel export | xlsx (SheetJS) |
| DB ORM | Drizzle ORM (PostgreSQL) |
| Frontend state | React useState + fetch (no TanStack Query on builder page) |
| Frontend polling | Manual setInterval via `setTimeout` chain |

---

## Environment Variables Required

```
ANTHROPIC_API_KEY   — Claude claude-sonnet-4-5 (extraction + enrichment)
OPENAI_API_KEY      — GPT-4o fallback
DATABASE_URL        — PostgreSQL connection string
EXPLORIUM_API_KEY   — Optional: Explorium company enrichment API
```

---

## Critical Rules

1. **Never write to `companies` (MeshBase) during harvest** — `builder_companies` is the staging table only
2. **Seed to MeshBase is always a manual user action** — there is no automatic promotion
3. **Dedup cross-checks MeshBase as read-only** — it finds duplicates but does not write to MeshBase
4. **Never fabricate CR numbers** — if not found on source page, `crNumber` stays null
5. **Custom sources** use the `builder_custom_sources` table, identified with `"custom-{id}"` prefix
6. **Wikidata uses SPARQL**, not HTTP scraping — it is the only source with a specialized fetcher
7. **3-minute harvest poll timeout** for single source (60 × 3s), 6-minute for all sources (120 × 3s)
8. **`lastHarvestedAt`** is tracked in-memory on the server (`sourceLastHarvested` Map), not in DB — restarting the server resets it for built-in sources; custom sources reset too
