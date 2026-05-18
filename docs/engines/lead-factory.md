# Lead Factory

**7-agent automated lead discovery + enrichment pipeline.** Input: an ICP brief (segment or list mode). Output: validated, scored, deduplicated prospects with AI-generated outreach, ready to publish into the unified `companies` / `leads` / `executives` tables.

## Pipeline (7 agents)

Implemented in `artifacts/api-server/src/lib/lead-factory-engine.ts`.

| # | Agent | Role |
|---|---|---|
| 1 | ICP Mapper & Source Orchestrator | Brief → prioritised sourcing plan |
| 2 | Lead Harvester | Execute plan across 40+ free + paid sources |
| 3 | Deep Enrichment | Scout + GLEIF + OpenCorporates + Wikidata + Gemini |
| 4 | Signal Intelligence | Scout full signals + regulatory signals |
| 5 | Validate, Verify & Deduplicate | Phone/email/data validation + DB dedup via `lead_fingerprints` |
| 6 | ICP Scoring + AI Copywriter | Composite score + NEXUS-generated outreach |
| 7 | Publish & Seed | Bridges into `leads` + `companies` + fingerprint index |

Job rows track per-phase counters: `totalDiscovered`, `totalEnriched`, `totalValidated`, `totalPublished`, `totalRejected`.

## Source files

| Concern | File |
|---|---|
| Router | `artifacts/api-server/src/routes/lead-factory.ts` |
| Pipeline engine | `artifacts/api-server/src/lib/lead-factory-engine.ts` |
| Relationship Intel engine | `artifacts/api-server/src/lib/relationship-intel-engine.ts` |
| Signal monitor | `artifacts/api-server/src/lib/signal-monitor.ts` |
| Schema | `lib/db/src/schema/lead_factory.ts` |
| Frontend (Lead Factory) | `artifacts/prospect-sa/src/pages/lead-factory/index.tsx` |
| Frontend (Relationship Intel) | `artifacts/prospect-sa/src/pages/relationship-intel/index.tsx` |
| Frontend (Leads CRM) | `artifacts/prospect-sa/src/pages/leads/index.tsx` |

All routes are mounted under `/api` via `artifacts/api-server/src/routes/index.ts` → `app.use("/api", router)` in `app.ts`.

## Endpoints

### Lead Factory

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/lead-factory/start` | Validate brief (Zod), create job, fire pipeline; returns `{ ok, jobId }` |
| GET  | `/api/lead-factory/stream/:jobId` | SSE stream of per-agent progress events |
| GET  | `/api/lead-factory/jobs` | Latest 50 jobs |
| GET  | `/api/lead-factory/jobs/:jobId` | Single job row |
| GET  | `/api/lead-factory/results/:jobId` | Results ordered by `icpScore` desc |
| POST | `/api/lead-factory/results/:jobId/publish` | Idempotent bridge into `companies`/`leads`; body `{ autoEnrichDownstream?: boolean }` also fires Signals + Relationship Intel for each new company |
| POST | `/api/lead-factory/jobs/:jobId/cancel` | Cancels a running job via the in-memory `JobRegistry` |
| GET  | `/api/lead-factory/company-suggest?q=…` | Autocomplete over `companies` + `builder_companies` (min 2 chars, max 8 suggestions) |

### Relationship Intelligence (sibling flow)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/relationship-intel/start` | Body requires `targetCompanyName`; returns `{ ok, jobId }` |
| GET  | `/api/relationship-intel/stream/:jobId` | SSE stream |
| GET  | `/api/relationship-intel/jobs` | Latest 20 jobs |
| GET  | `/api/relationship-intel/jobs/:jobId` | Single job row |
| POST | `/api/relationship-intel/jobs/:jobId/cancel` | Cancel a running job |

### Signal Monitor (sibling flow)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/signals/push` | Kicks off a signal monitor run; returns `{ ok, jobId }` |
| GET  | `/api/signals/stream/:jobId` | SSE stream |
| POST | `/api/signals/jobs/:jobId/cancel` | Cancel a running job |

### Leads & Lead Lists (downstream surfaces)

The Lead Factory publishes into these tables; the frontend manages them via:

- `/api/leads` (`routes/leads.ts`) — paginated CRUD on the unified leads table.
- `/api/lead-lists/*` (`routes/lead-lists.ts`) — hunt definitions, items, retries, exports.

## Storage

| Table | Purpose |
|---|---|
| `lead_factory_jobs` | Pipeline state + per-phase counters + `agentProgress` JSON |
| `lead_factory_results` | One row per prospect (see column reference below) |
| `lead_fingerprints` | Dedup index (normalized name / domain / phone / email / CR number) |
| `relationship_intel_jobs` | Target-company org chart + network + outreach plan |

### `lead_factory_results` column reference

Identity / firmographics: `companyName`, `companyNameAr`, `domain`, `phone`, `email`, `city`, `region`, `industry`, `subIndustry`, `employeeCount`, `revenue`, `crNumber`, `entityType`, `foundingYear`, `ownerName`, `description`, `logoUrl`, `linkedinUrl`.

Enrichment payloads (JSONB): `keyExecutives`, `rawData`, `enrichedData`, `signalData`.

Scoring + validation: `icpScore`, `priorityTier`, `buyingScore`, `riskScore`, `qualityScore`, `validationStatus` (default `pending`), `validationReasons`, `isDuplicate`, `duplicateOf`.

Outreach (NEXUS-generated): `outreachEmail`, `outreachLinkedin`, `outreachWhatsapp`, `openingAngle`, `culturalNote`, `conversationHook`.

Publish bridge (FK, set null on parent delete): `publishedLeadId`, `publishedCompanyId`.

## External APIs / data sources

| Service | Used for |
|---|---|
| Perplexity / Gemini | Company discovery + segment research |
| Apollo | Contact records, firmographics |
| Hunter | Email pattern + verification |
| Scout | Site-intel + signals (full + regulatory) |
| GLEIF / OpenCorporates / Wikidata | Legal entity + cross-border verification |
| NEXUS | AI outreach generation (email / LinkedIn / WhatsApp) |
| ActivePieces | Post-completion automation hook (`onLeadFactoryComplete`) |

## Input modes

- **Segment** — high-level ICP brief (`icpDescription`, plus optional `industries`, `cities`, `companySizes`, `targetTitles`, `seniority`, `prioritySignals`).
- **List** — caller supplies a pre-known company list to enrich + score.

Both modes are validated via `leadFactoryBriefSchema` (Zod) at request time; invalid briefs are rejected with `400` before a job is created.

## Tuning

- `targetCount` (default 50) caps total enriched output.
- Reject thresholds + scoring weights live in `lead-factory-engine.ts`.
- Cancellation is cooperative via `JobRegistry.cancel(jobId)` — running agents check the flag between steps.

## Frontend wiring (verified)

| Page | Calls |
|---|---|
| `pages/lead-factory/index.tsx` | `/api/lead-factory/start`, `/stream/:id`, `/jobs`, `/results/:id`, `/company-suggest`, plus `/api/relationship-intel/start` + `/stream/:id` |
| `pages/relationship-intel/index.tsx` | `/api/relationship-intel/start`, `/stream/:id` |
| `pages/leads/index.tsx` | `/api/lead-lists`, `/api/lead-lists/:id`, `/items`, `/retry`, `/export` |
