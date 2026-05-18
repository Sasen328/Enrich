# API Reference

Base URL: `http://localhost:{PORT}/api` (no auth in dev). All request/response bodies are validated by Zod schemas — see `lib/api-zod/src/generated/types/`.

## Conventions

- All POST/PATCH bodies are JSON.
- Pagination uses `?page=&pageSize=` unless noted.
- Long-running jobs return `{ jobId }` and stream progress via `GET /:resource/stream/:jobId` (Server-Sent Events).
- Errors follow the `ErrorResponse` schema: `{ error: string, code?: string, detail?: any }`.

---

## Auth

When `API_TOKEN` is set on the backend, every endpoint except `/healthz` and `/readyz` requires:

```
Authorization: Bearer <API_TOKEN>
```

`401 { error: "Missing bearer token" | "Invalid bearer token" }` otherwise.

## Health
**File:** `routes/health.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Liveness probe. 200 normally, 503 during graceful shutdown. Auth-exempt. |
| GET | `/readyz` | Readiness probe. Runs `SELECT 1`. 503 if DB unreachable or shutting down. Auth-exempt. |

## Job cancellation

Available for engines that mint emitter-backed jobs:

| Method | Path |
|---|---|
| POST | `/api/lead-factory/jobs/:jobId/cancel` |
| POST | `/api/relationship-intel/jobs/:jobId/cancel` |
| POST | `/api/signals/jobs/:jobId/cancel` |
| POST | `/api/masar/database/jobs/:jobId/cancel` |

Returns `404` if the job is unknown or already finished, otherwise `{ ok: true }`. The SSE stream emits a final `{ type: "cancelled", reason }` and then `stream_end`.

## Companies (unified pool)
**File:** `routes/companies.ts` — 13 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/companies` | List with filters (city, industry, status, search) |
| GET | `/companies/:id` | Single company |
| POST | `/companies` | Create |
| PATCH | `/companies/:id` | Update |
| DELETE | `/companies/:id` | Soft-delete (audited to `deleted_companies`) |
| POST | `/companies/bulk-delete` | Bulk delete by IDs |
| POST | `/companies/deduplicate` | Detect + merge duplicates by domain/CR |
| GET | `/companies/export` | Stream CSV/XLSX/JSON |
| GET | `/companies/:id/executives` | Executives joined by `companyId` |
| GET | `/analytics/dashboard` | KPI tiles |
| GET | `/analytics/by-city` | City distribution |
| GET | `/analytics/by-industry` | Industry distribution |
| GET | `/analytics/enrichment-stats` | Enrichment coverage |

## Leads (legacy CRM)
**File:** `routes/leads.ts`

| Method | Path |
|---|---|
| GET | `/leads` |
| POST | `/leads` |
| PATCH | `/leads/:id` |
| DELETE | `/leads/:id` |

## Lead Lists
**File:** `routes/lead-lists.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/lead-lists` | All lists |
| POST | `/lead-lists` | Create a hunt |
| GET | `/lead-lists/:id` | Detail |
| PATCH | `/lead-lists/:id` | Rename/update criteria |
| DELETE | `/lead-lists/:id` | Remove |
| GET | `/lead-lists/:id/items` | Members |
| POST | `/lead-lists/:id/items` | Add item |
| DELETE | `/lead-lists/:id/items/:itemId` | Remove item |
| POST | `/lead-lists/:id/run` | Trigger enrichment over the whole list |

## Builder
**File:** `routes/builder.ts` — 25 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/builder/sources` | List of registered data sources |
| POST | `/builder/sources` | Register a custom source |
| DELETE | `/builder/sources/:id` | Remove a custom source |
| POST | `/builder/harvest` | Start a harvest job (returns `jobId`) |
| GET | `/builder/jobs` | All jobs |
| GET | `/builder/jobs/:jobId` | Job detail |
| GET | `/builder/jobs/:jobId/stream` | SSE progress |
| POST | `/builder/jobs/:jobId/cancel` | Cancel |
| GET | `/builder/results/:jobId` | Companies produced by a job |
| POST | `/builder/deduplicate` | Dedup the staging table |
| POST | `/builder/merge` | Promote staging → unified pool |
| GET | `/builder/staging` | List `builder_companies` |
| … | … | (see source for full list — search/filter/export variants) |

See [DATABASEBUILDER_FEATURE_DOC.md](../DATABASEBUILDER_FEATURE_DOC.md) for the deep dive.

## MeshBase (executives + bulk enrichment)
**File:** `routes/meshbase.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/executives` | List with filters |
| GET | `/executives/:id` | Single |
| POST | `/executives` | Create |
| PATCH | `/executives/:id` | Update |
| DELETE | `/executives/:id` | Remove |
| GET | `/executives/export` | CSV/XLSX export |
| POST | `/enrichment/run` | Trigger pool-wide enrichment pass |
| GET | `/enrichment/stats` | Coverage stats |
| GET | `/enrichment/reports` | Past `enrichment_reports` |

## Masaar (CR-number lookup)
**File:** `routes/masaar.ts`

| Method | Path | Purpose |
|---|---|---|
| POST | `/masaar/start` | Begin CR lookup (returns `jobId`) |
| POST | `/masaar/captcha/:jobId` | Submit captcha solution if challenged |
| GET | `/masaar/stream/:jobId` | SSE progress + final record |

## Masar Database
**File:** `routes/masar-database.ts` — 17 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/masar/database/companies` | Browse Wathq-style records |
| GET | `/masar/database/companies/:id` | Single |
| POST | `/masar/database/harvest` | Start harvest by keyword |
| GET | `/masar/database/jobs/:jobId` | Job status |
| GET | `/masar/database/jobs/:jobId/stream` | SSE |
| GET | `/masar/database/stats` | Counts by sector/region |
| GET | `/masar/database/sources` | Custom sources |
| POST | `/masar/database/sources` | Add custom source |
| DELETE | `/masar/database/sources/:id` | Remove |
| POST | `/masar/database/promote` | Merge into unified `companies` |
| GET | `/masar/database/export` | CSV/XLSX |
| GET | `/masar/database/shareholders/:crNumber` | Drill-down |
| GET | `/masar/database/management/:crNumber` | Drill-down |

## SA Market (Tadawul / open data)
**File:** `routes/sa-market.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/sa-market/shareholders` | Listed-company shareholders |
| GET | `/sa-market/executives` | Listed-company board/management |
| GET | `/sa-market/profile/:name` | Aggregated company profile |
| POST | `/sa-market/profile/generate` | Generate AI profile from raw data |
| GET | `/sa-market/sectors` | Sector list |
| GET | `/sa-market/stats` | Counts by sector/region |
| GET | `/sa-market/search` | Free-text search |
| GET | `/sa-market/export` | CSV/XLSX |
| GET | `/sa-market/shareholder/:nationalId` | Reverse lookup by national ID |
| GET | `/sa-market/network/:name` | Shareholder network graph |
| POST | `/sa-market/refresh` | Pull fresh data from Wikidata/CMA |

## Person Intel
**File:** `routes/person-intel.ts`

| Method | Path |
|---|---|
| POST | `/person-intel/profile` |
| POST | `/person-intel/save` |
| GET | `/person-intel/saved` |
| DELETE | `/person-intel/saved/:id` |
| POST | `/person-intel/quick` |

## Company Intel
**File:** `routes/company-intel.ts`

| Method | Path |
|---|---|
| POST | `/company-intel/profile` |
| POST | `/company-intel/save` |
| GET | `/company-intel/saved` |
| DELETE | `/company-intel/saved/:id` |
| POST | `/company-intel/web-seed` |

## ProsEngine Chat
**File:** `routes/prosengine-chat.ts`

| Method | Path | Purpose |
|---|---|---|
| POST | `/prosengine/chat` | Send a chat turn (streams) |
| GET | `/prosengine/conversations` | History |
| GET | `/prosengine/conversations/:id` | Messages |
| DELETE | `/prosengine/conversations/:id` | Remove |
| POST | `/prosengine/seed` | Seed conversation with company context |
| POST | `/prosengine/export-ppt` | Export research as PPTX |
| POST | `/prosengine/export-pdf` | Export as PDF |

## OrcEngine
**File:** `orcengine/routes.ts` — registered via `registerOrcEngineRoutes()`

| Method | Path |
|---|---|
| POST | `/orcengine/scrape` |
| GET | `/orcengine/scrape/:id` |
| POST | `/orcengine/scrape/:id/chat` |
| POST | `/orcengine/export` |
| POST | `/orcengine/research` |

## Nexus
**File:** `routes/nexus.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/nexus/status` | Provider availability + costs |
| POST | `/nexus/llm/test` | Smoke-test the router |
| GET | `/nexus/session/usage` | Per-session usage tally |
| DELETE | `/nexus/session/usage` | Reset session counter |
| GET | `/nexus/models` | Enumerate models per provider |
| POST | `/nexus/route` | Manually call the router with overrides |

## Scout
**File:** `routes/scout.ts` (proxies to Python FastAPI at `SCOUT_URL`)

| Method | Path |
|---|---|
| GET | `/scout/health` |
| POST | `/scout/site-intel` |
| POST | `/scout/osint/harvest` |
| POST | `/scout/osint/social` |
| POST | `/scout/ai-extract` |
| POST | `/scout/full-scan` |

## Signals
**File:** `routes/signals.ts`

| Method | Path |
|---|---|
| POST | `/signals/scan` |
| GET | `/signals/:companyId` |
| POST | `/signals/news` |
| POST | `/signals/sanctions` |
| POST | `/signals/individual` |
| POST | `/signals/regulatory` |
| GET | `/signals` |
| DELETE | `/signals/:id` |

## Lead Factory
**File:** `routes/lead-factory.ts` — mounted at `/api/lead-factory`

| Method | Path |
|---|---|
| POST | `/api/lead-factory/start` |
| GET | `/api/lead-factory/stream/:jobId` |
| GET | `/api/lead-factory/jobs/:jobId` |
| GET | `/api/lead-factory/jobs` |
| GET | `/api/lead-factory/results/:jobId` |
| POST | `/api/lead-factory/results/:jobId/export` |
| POST | `/api/lead-factory/jobs/:jobId/cancel` |
| GET | `/api/lead-factory/company-suggest` |
| POST | `/api/relationship-intel/start` |
| GET | `/api/relationship-intel/:jobId` |

## Smart Prospecting
**File:** `prospecting/routes.ts` — registered via `registerProspectingRoutes()`

| Method | Path |
|---|---|
| POST | `/prospecting/scan` |
| POST | `/prospecting/extract` |
| GET | `/prospecting/jobs/:jobId` |
| GET | `/prospecting/jobs/:jobId/stream` |
| GET | `/prospecting/results/:jobId` |
| POST | `/prospecting/export` |
