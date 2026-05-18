# ProspectSA
A multi-engine Saudi-market B2B intelligence platform. Discovers, enriches, and tracks companies and executives across the Saudi market using a stack of LLM-powered research agents, web scrapers, and external data APIs.

## What's inside

A pnpm monorepo combining a TypeScript/Express API server, a React/Vite frontend, and a Python Scout microservice. Twelve domain "engines" share one PostgreSQL pool of ~3,744 companies and ~7,591 executives.

| Engine | What it does |
|---|---|
| **Masaar** | Saudi CR-number company lookup (interactive, captcha-aware) |
| **Masar** | Wathq-style CR registry harvester (shareholders, board, capital) |
| **ProsEngine** | Conversational prospecting + research export (PPT/PDF) |
| **Database Builder** | Agentic harvest from 14+ sources into the unified company pool |
| **Nexus** | LLM model router + anti-detection browser mesh + cost model |
| **OrcEngine** | Multi-source research orchestrator with HTML/PDF/PPT export |
| **Scout** | Python OSINT microservice: site intel, contact discovery, subdomains |
| **Signals** | Event-driven scoring: news, sanctions, regulatory, individual risk |
| **Lead Factory** | 4-phase automated lead discovery + enrichment pipeline |
| **Company Intel** | 50-field deep company profiles |
| **Person Intel** | Executive dossiers (work history, social, seniority) |
| **SA Market** | Tadawul + open-data: listed companies, shareholders, sectors |

## Quick start

```bash
pnpm install
# set DATABASE_URL and at least one LLM key (see docs/ENV.md)
pnpm --filter @workspace/api-server run dev
```

See [docs/SETUP.md](docs/SETUP.md) for the full guide.

## Documentation

**Start here**
- [SETUP.md](docs/SETUP.md) — install, run, seed
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system overview, monorepo layout
- [ENV.md](docs/ENV.md) — every environment variable
- [API.md](docs/API.md) — all 18 routers and ~150 endpoints
- [DATABASE.md](docs/DATABASE.md) — Drizzle schema reference

**Engines** (`docs/engines/`)
- [orcengine.md](docs/engines/orcengine.md), [scout.md](docs/engines/scout.md), [signals.md](docs/engines/signals.md), [lead-factory.md](docs/engines/lead-factory.md), [company-intel.md](docs/engines/company-intel.md), [person-intel.md](docs/engines/person-intel.md), [sa-market.md](docs/engines/sa-market.md)

**Deeper references** (`docs/docs/`)
- Engine-specific: [masaar-engine.md](docs/docs/masaar-engine.md), [masar-database.md](docs/docs/masar-database.md), [pros-engine.md](docs/docs/pros-engine.md), [ai-database-builder.md](docs/docs/ai-database-builder.md)
- Full replication guides for each engine + frontend
- [tech-stack-full.md](docs/docs/tech-stack-full.md) — dependency inventory
- [NEXUS_ENGINE.md](NEXUS_ENGINE.md), [DATABASEBUILDER_FEATURE_DOC.md](DATABASEBUILDER_FEATURE_DOC.md)

## Tech stack

Node 24 · pnpm workspaces · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle ORM · Zod 4 · React + Vite + Tailwind + shadcn/ui · Playwright/Puppeteer/Cheerio · Python 3.11 + FastAPI (Scout) · OpenAI · Anthropic · Perplexity · Apollo · Hunter.

Full-stack B2B intelligence platform for Saudi Arabia — combines the capabilities of ZoomInfo, Apollo, Crunchbase, SignalHire, and Lusha into one self-hostable system. AI-driven enrichment, web scraping, and signal monitoring; no external data APIs required to boot.

## Quick start

| Goal | Read |
|---|---|
| Deploy with Docker (recommended) | [`DEPLOY_README.md`](DEPLOY_README.md) |
| Local development | [`SETUP.md`](SETUP.md) |
| Full operator manual | [`docs/OPERATOR_GUIDE.md`](docs/OPERATOR_GUIDE.md) |
| Architecture overview | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Environment variables | [`docs/ENV.md`](docs/ENV.md) |
| API surface | [`docs/API.md`](docs/API.md) |
| Database schema | [`docs/DATABASE.md`](docs/DATABASE.md) |
| Current status / gaps | [`docs/STATUS.md`](docs/STATUS.md) |

## Engines

Each engine has a dedicated doc in [`docs/engines/`](docs/engines/):

- **Lead Factory** — 7-agent automated lead discovery, enrichment, scoring, outreach.
- **Signals** — buying-signal detection across web + regulatory feeds.
- **Scout** — Python OSINT microservice (site intel, social, deep scan).
- **OrcEngine** — multi-agent research orchestrator.
- **Company Intel / Person Intel / SA Market** — single-target deep profiles.
- **ProsEngine** — chat-driven research and seeding.
- **MeshBase / Masaar** — unified Saudi company pool + CR-database harvest.
- **NEXUS** — LLM router with provider waterfall + cost tracking. See [`NEXUS_ENGINE.md`](NEXUS_ENGINE.md).
- **Database Builder** — schema-driven scrape + dedupe. See [`DATABASEBUILDER_FEATURE_DOC.md`](DATABASEBUILDER_FEATURE_DOC.md).

## Stack

- **Backend:** Node 24, Express, TypeScript, Drizzle ORM, PostgreSQL 16
- **Frontend:** React 19, Vite, Tailwind, shadcn/ui, Wouter, TanStack Query
- **Microservice:** Python 3.11 + Playwright + FastAPI (Scout)
- **Monorepo:** pnpm workspaces

## Layout

```
artifacts/
├── api-server/     Express + Drizzle, serves API and (in prod) the built frontend
├── prospect-sa/    React + Vite frontend
├── python-scout/   FastAPI OSINT microservice
└── mockup-sandbox/ UI prototype playground
lib/
├── db/                          Drizzle schema + client (@workspace/db)
├── api-spec/, api-zod/, api-client-react/   Generated API surface
└── integrations-openai-ai-*/    Shared LLM helpers
docs/                            Authoritative docs (see table above)
scripts/                         Seed + migration helpers
```

## License

Proprietary — internal use only.
