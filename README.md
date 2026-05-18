# ProspectSA

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
