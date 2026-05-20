# Database Schema

PostgreSQL accessed through **Drizzle ORM**. The schema source of truth lives in `lib/db/src/schema/*.ts`; the raw SQL snapshot in `prospectsa_schema.sql` is informational only.

## Migrations

```bash
pnpm --filter @workspace/db run db:push    # apply schema
pnpm --filter @workspace/scripts run seed-import   # seed company pool
```

`drizzle.config.ts` points to `lib/db/src/schema/index.ts` and uses `DATABASE_URL`.

## Table groups

### 1. Unified company pool

| Table | Records | Purpose |
| `companies` | ~3,744 | The single source of truth for all engines. Holds Saudi companies in any state of enrichment. |
| `executives` | ~7,591 | Board members, management, C-suite. FK: `companyId → companies.id` |
| `deleted_companies` | – | Audit trail of removed/merged records (used by deduplicate flows) |

**`companies` key columns:** `id, nameAr, nameEn, website, phone, email, industry, city, region, crNumber, capitalAmount, ownerName, shareholders (json), keyExecutives (json), enrichmentStatus, enrichmentScore, createdAt, updatedAt`.

**`executives` key columns:** `id, companyId, name, nameAr, position, positionAr, email, phone, linkedin, department, seniorityLevel, yearsOfExperience, apolloId`.

### 2. Smart Prospecting

| Table | Purpose | FK |
| `prospecting_sessions` | URL + language + scan summary + filter questions | – |
| `prospecting_jobs` | Per-scan job state | – |
| `prospecting_results` | Companies extracted by the scan | `jobId`, `sessionId` |
| `prospecting_exports` | Export history (CSV/XLSX/JSON/PDF) | `jobId` |

### 3. Lead Factory

| Table | Purpose | FK |
| `lead_factory_jobs` | 4-phase pipeline state (`status, inputMode, brief, targetCount, agentProgress, totals…`) | – |
| `lead_factory_results` | Enriched prospects (`companyName, domain, phone, email, title, seniority, department, validationScore`) | `jobId → lead_factory_jobs` |
| `lead_lists` | Hunter-curated lists | – |
| `lead_list_items` | Members of a list | `listId → lead_lists` |
| `leads` | Legacy CRM table (kept for backward compat) | – |

### 4. Database Builder (staging)

| Table | Purpose |
| `builder_companies` | Temp staging for harvest → dedup → promote pipeline |
| `builder_jobs` | Harvest job state |
| `builder_custom_sources` | User-defined data sources |

### 5. Masar (Wathq CR registry)

| Table | Purpose |
| `masar_companies` | Full CR record: shareholders, management, capital, registration date |
| `masar_harvest_jobs` | Harvest job tracking |
| `masar_custom_sources` | User-defined sources |

### 6. OrcEngine + research

| Table | Purpose |
| `scrape_sessions` | URL set + summary + status for OrcEngine scrape jobs |
| `research_jobs` | OrcEngine research history with full report + sources + findings |
| `company_intel_research` | Saved Company Intel reports |
| `prosengine_research` | Saved Person Intel + ProsEngine research (shared) |

### 7. Signals

| Table | Purpose |
| `company_signals` | Time-stamped events scoped by `domain`. Columns: `category (positive/negative/neutral/mixed), title, summary, sourceUrl, confidence, metadata, timestamp` |

### 8. SA Market (Tadawul + open data)

| Table | Purpose |
| `sa_market_shareholders` | Listed-company shareholder rows: `sector, city, companyName, shareholderName, nationalId, ownershipPct, nationality` |
| `sa_market_executives` | Listed-company board/management: `sector, companyName, name, nameAr, position, nationalId` |

### 9. Chat & generic infra

| Table | Purpose | FK |
| `conversations` | ProsEngine chat sessions | – |
| `messages` | Chat messages | `conversationId → conversations` |
| `templates` | Email/research templates | – |
| `jobs` | Generic async job tracking (cross-engine) | – |
| `enrichment_reports` | Audit trail for enrichment passes | – |

## Foreign-key map

companies.id              ◄── executives.companyId
prospecting_jobs.id       ◄── prospecting_results.jobId
                          ◄── prospecting_exports.jobId
prospecting_sessions.id   ◄── prospecting_results.sessionId
lead_factory_jobs.id      ◄── lead_factory_results.jobId
lead_lists.id             ◄── lead_list_items.listId
conversations.id          ◄── messages.conversationId
Cross-engine joins by **domain** (e.g. `companies.website` ↔ `company_signals.domain`) rather than FK — keeps engines loosely coupled.

## Adding a new table

1. Create `lib/db/src/schema/my_table.ts` with `pgTable(...)`.
2. Re-export from `lib/db/src/schema/index.ts`.
3. Run `pnpm --filter @workspace/db run db:push`.
4. If the table is part of the public API, add a Zod type in `lib/api-zod` and regenerate the React client.
