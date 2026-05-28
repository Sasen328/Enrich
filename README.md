# ProspectSA

A multi-engine Saudi-market B2B intelligence platform. Discovers, enriches, and tracks companies and executives across the Saudi market using a stack of LLM-powered research agents, web scrapers, and free open-data sources. Combines the capabilities of ZoomInfo, Apollo, Crunchbase, SignalHire, and Lusha into one self-hostable system.

## What's inside

A pnpm monorepo combining a TypeScript/Express API server, a React/Vite frontend, and a Python Scout microservice. Eleven domain "engines" share one PostgreSQL pool, orchestrated by a Kimi-coordinated agent swarm.

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
| **Lead Factory** | 7-agent automated lead discovery + enrichment pipeline |
| **Company Intel** | 50-field deep company profiles |
| **Person Intel** | Executive dossiers (work history, social, seniority) |

**SwarmBoard** (`/swarm`) is the mission-control UI over these engines: a Q&A wizard assembles a Kimi-coordinated swarm, runs the selected agents in parallel (`POST /api/swarm/start`), and returns one fused report. It has three views — About, an Agents directory with per-agent profiles, and the live 4-phase run.

## Quick start

```bash
pnpm install
# Provision a persistent PostgreSQL 16, then set DATABASE_URL and at least
# one LLM key (see docs/ENV.md). Data lives in Postgres' PGDATA and persists
# across restarts.
./setup.sh                                   # installs deps, migrates, seeds
pnpm --filter @workspace/api-server run dev  # or run the API directly
```

## Documentation

**Start here**
- [SETUP.md](docs/SETUP.md) — install, run, seed
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system overview, monorepo layout
- [OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) — operator manual
- [ENV.md](docs/ENV.md) — every environment variable
- [API.md](docs/API.md) — all routers and endpoints
- [DATABASE.md](docs/DATABASE.md) — Drizzle schema reference
- [STATUS.md](docs/STATUS.md) — current status / gaps

**Engines** (`docs/engines/`)
- [lead-factory.md](docs/engines/lead-factory.md), [orcengine.md](docs/engines/orcengine.md), [scout.md](docs/engines/scout.md), [signals.md](docs/engines/signals.md), [company-intel.md](docs/engines/company-intel.md), [person-intel.md](docs/engines/person-intel.md), [prosengine.md](docs/engines/prosengine.md)

**Replication guides** (`docs/replication/`)
- [01-masaar-engine-replication.md](docs/replication/01-masaar-engine-replication.md)
- [02-masar-database-replication.md](docs/replication/02-masar-database-replication.md)

**Canonical feature refs (root)**
- [NEXUS_ENGINE.md](NEXUS_ENGINE.md), [DATABASEBUILDER_FEATURE_DOC.md](DATABASEBUILDER_FEATURE_DOC.md)

## Tech stack

Node 24 · pnpm workspaces · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle ORM · Zod · React 19 + Vite + Tailwind + shadcn/ui + Wouter + TanStack Query · Playwright/Puppeteer/Cheerio · Python 3.11 + FastAPI (Scout).

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
docs/                            Authoritative docs (see tables above)
scripts/                         Seed + migration helpers
```

## License

Proprietary — internal use only.
