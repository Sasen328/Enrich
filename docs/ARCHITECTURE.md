# Architecture

## One paragraph

A pnpm-managed TypeScript monorepo around a single PostgreSQL database. An Express 5 API server exposes ~18 router modules; each module is one "engine" (a self-contained domain of functionality). A React/Vite frontend consumes the API via a Zod-typed, Orval-generated client. A separate Python/FastAPI microservice ("Scout") handles browser-driven OSINT. All engines share the same `companies` and `executives` tables ("unified pool") so enrichment performed by one engine is immediately visible to all others.

## Monorepo layout

```
/
├── artifacts/
│   ├── api-server/          Express 5 + tsx; all engines live here
│   │   └── src/
│   │       ├── index.ts     boot, port bind, recovery, MeshBase seed
│   │       ├── app.ts       Express app factory, middleware
│   │       ├── routes/      one file per engine (companies, leads, builder, …)
│   │       ├── orcengine/   OrcEngine (orchestrator, crawler, scraper, exports)
│   │       ├── prospecting/ Smart Prospecting sub-engine
│   │       └── lib/         scout-client, signal-engine, lead-factory-engine, etc.
│   ├── prospect-sa/         React + Vite + Tailwind + shadcn/ui (frontend)
│   └── python-scout/        FastAPI + Playwright (OSINT microservice)
├── lib/
│   ├── db/                  Drizzle schema + migrations (source of truth)
│   ├── api-zod/             Generated Zod types (from OpenAPI via orval)
│   ├── api-spec/            OpenAPI source + orval config
│   └── api-client-react/    Generated React Query hooks
├── scripts/                 seeders, harvest one-shots, maintenance
├── agents/                  Claude skills (find-skills, frontend-design, pptx, ui-ux-pro-max)
├── config/
├── docs/                    this folder
├── main.py                  ad-hoc Python entry
├── prospectsa_schema.sql    raw schema snapshot (informational)
├── NEXUS_ENGINE.md, DATABASEBUILDER_FEATURE_DOC.md   canonical feature refs
└── package.json             pnpm workspace root
```

## Runtime topology

```
                   ┌─────────────────────┐
                   │ React/Vite frontend │  artifacts/prospect-sa
                   └──────────┬──────────┘
                              │ HTTP (Orval-generated React Query client)
                   ┌──────────▼──────────┐
                   │   Express API       │  artifacts/api-server
                   │   (18 routers)      │
                   └──┬──────┬─────────┬─┘
                      │      │         │
            ┌─────────▼─┐ ┌──▼────┐ ┌──▼──────────────┐
            │ Postgres  │ │ Scout │ │ External APIs   │
            │ + Drizzle │ │ FastAPI│ │ OpenAI, Anthropic│
            └───────────┘ │ Python │ │ Perplexity      │
                          └────────┘ │ Apollo, Hunter  │
                                     │ Wikidata, CMA   │
                                     └─────────────────┘
```

## Engines

Each engine is a router file (and sometimes a `lib/*-engine.ts` companion). They all hit the same DB, so cross-engine reuse is the norm — e.g. **Lead Factory** writes to the shared `companies` pool that **Database Builder** seeds and **Signals** scores.

| Engine | Router | Companion | Tables it owns |
|---|---|---|---|
| Masaar | `routes/masaar.ts` | – | – (writes back to `companies`) |
| Masar | `routes/masar-database.ts` | – | `masar_companies`, `masar_harvest_jobs`, `masar_custom_sources` |
| ProsEngine | `routes/prosengine-chat.ts` | – | `prosengine_research`, `conversations`, `messages` |
| Builder | `routes/builder.ts` | – | `builder_companies`, `builder_jobs`, `builder_custom_sources` |
| OrcEngine | `orcengine/routes.ts` | `orcengine/orchestrator.ts` | `scrape_sessions`, `research_jobs` |
| Scout | `routes/scout.ts` | `lib/scout-client.ts` (+ Python service) | – |
| Signals | `routes/signals.ts` | `lib/signal-engine.ts` | `company_signals` |
| Lead Factory | `routes/lead-factory.ts` | `lib/lead-factory-engine.ts` | `lead_factory_jobs`, `lead_factory_results` |
| Company Intel | `routes/company-intel.ts` | – | `company_intel_research` |
| Person Intel | `routes/person-intel.ts` | – | `prosengine_research` (shared) |
| SA Market | `routes/sa-market.ts` | – | `sa_market_shareholders`, `sa_market_executives` |
| Nexus | `routes/nexus.ts` | `lib/nexus/*` | – (in-memory model router + browser mesh) |
| Smart Prospecting | `prospecting/routes.ts` | – | `prospecting_jobs`, `prospecting_sessions`, `prospecting_results`, `prospecting_exports` |
| MeshBase | `routes/meshbase.ts` | – | `companies`, `executives` |
| Lead Lists | `routes/lead-lists.ts` | – | `lead_lists`, `lead_list_items` |
| Companies | `routes/companies.ts` | – | `companies` |
| Leads | `routes/leads.ts` | – | `leads` |

## Cross-cutting infrastructure

- **Nexus router** (`lib/nexus/`) — chooses between OpenAI / Anthropic / Gemini / Groq / OpenRouter / Ollama by cost + capability waterfall. Tracks per-session usage.
- **Browser mesh** — Playwright + Puppeteer pool with proxy rotation (IPRoyal, Luna, SimplyNode, Webshare) and captcha solvers (CapMonster, AZCaptcha, NopeCHA, DeathByCaptcha). Toggleable via `NEXUS_PROXY_ENABLED` / `NEXUS_CAPTCHA_ENABLED`.
- **Activepieces** — optional external workflow triggers (one flow ID per engine, see [ENV.md](ENV.md)).
- **Drizzle** — single source of truth for schema; types flow through `drizzle-zod` → `lib/api-zod` → `lib/api-client-react`.

## Data flow: a typical enrichment

1. **Builder** harvests raw company names from Wikidata / Apollo / a custom source → writes to `builder_companies` staging.
2. Operator runs deduplication + merge → records flow into the shared `companies` table.
3. **MeshBase / Company Intel** fills out missing fields (founding, owner, executives) via Perplexity + Scout.
4. **Signals** scans periodically for news/sanctions/regulatory events → writes to `company_signals`, attached by `domain`.
5. **Lead Factory** mines the enriched pool by segment/filter → produces a hunt list in `lead_factory_results`.
6. **Person Intel** dossiers selected executives → stored in `prosengine_research` and exportable via ProsEngine.

## Build & code generation

- `lib/db` is the schema source of truth.
- `lib/api-spec/orval.config.ts` reads the OpenAPI spec and regenerates both `lib/api-zod` (Zod schemas) and `lib/api-client-react` (React Query hooks).
- `pnpm run typecheck` runs across all workspaces.
- `pnpm run build` uses esbuild for the API server; Vite for the frontend.

## Conventions

- New engine = new file in `artifacts/api-server/src/routes/`, mounted from `app.ts`.
- New DB table = new file in `lib/db/src/schema/`, re-exported from `schema/index.ts`.
- All input/output validated by Zod schemas in `lib/api-zod` to keep the frontend client in sync.
