# Lead Factory

**4-phase automated lead discovery + enrichment.** Input: a segment/filter brief. Output: a validated, enriched prospect list ready to push to a CRM or email tool.

## Phases

1. **Discover** — find candidate companies matching the brief (segment / filter mode).
2. **Enrich** — for each company, pull contacts (Apollo + Hunter + Scout).
3. **Validate** — score each prospect (`validationScore`) and reject low-confidence rows.
4. **Publish** — write final results, ready for export or push.

Job rows track per-phase counters: `totalDiscovered`, `totalEnriched`, `totalValidated`, `totalPublished`, `totalRejected`.

## Source

- Router: `artifacts/api-server/src/routes/lead-factory.ts`
- Engine: `artifacts/api-server/src/lib/lead-factory-engine.ts`

## Endpoints

All mounted under `/api/lead-factory`:

| Method | Path |
|---|---|
| POST | `/api/lead-factory/start` |
| GET | `/api/lead-factory/stream/:jobId` (SSE) |
| GET | `/api/lead-factory/jobs/:jobId` |
| GET | `/api/lead-factory/jobs` |
| GET | `/api/lead-factory/results/:jobId` |
| POST | `/api/lead-factory/results/:jobId/export` |
| POST | `/api/lead-factory/jobs/:jobId/cancel` |
| GET | `/api/lead-factory/company-suggest` |

Plus a sibling **Relationship Intel** flow:

| Method | Path |
|---|---|
| POST | `/api/relationship-intel/start` |
| GET | `/api/relationship-intel/:jobId` |

## Storage

| Table | Purpose |
|---|---|
| `lead_factory_jobs` | Pipeline state + per-phase counters |
| `lead_factory_results` | One row per prospect (`companyName, domain, phone, email, title, seniority, department, foundOn, enrichmentDepth, validationScore`) |

## External APIs

| Service | Used for |
|---|---|
| Perplexity | Company discovery + segment research |
| Apollo | Contact records, firmographics |
| Hunter | Email pattern + verification |
| Scout | Site-intel fallback, social discovery |

## Input modes

- **Segment** — high-level brief ("SaaS companies in Riyadh, 50–200 employees").
- **Filter** — structured criteria (city, industry, size, role title, seniority).

## Tuning

- `targetCount` caps the total enriched output.
- Enrichment depth (`shallow` / `standard` / `deep`) trades cost vs. data completeness.
- Reject thresholds live in `lead-factory-engine.ts`.
