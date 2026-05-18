# Replit Enrich App — Complete Documentation Bundle

This folder contains **every documentation file** in the project, organized by purpose. 33 Markdown files + 1 SQL schema snapshot, total ~800 KB.

Generated 2026-05-18 from `C:\Users\sgied\OneDrive\Desktop\Nexflow\Enrichment engine\Replit Enrich app`.

## Start here (in this order)

| # | File | What it gives you |
|---|---|---|
| 1 | [README.md](README.md) | One-page project overview + doc index |
| 2 | [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) | **The complete wiring guide** — install, env, seeds, per-engine config, Nexus, smoke tests, data-source registry per tool, firewall whitelist |
| 3 | [docs/STATUS.md](docs/STATUS.md) | What works today, what's left, what shipped, what's deferred. Roadmap to 100% functional. |
| 4 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Monorepo layout + runtime topology + engine map |

## Reference docs (lookup as needed)

| File | Purpose |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Install / run / seed commands, troubleshooting |
| [docs/ENV.md](docs/ENV.md) | Every environment variable, grouped (LLM, scraping, captcha, auth, shutdown, frontend) |
| [docs/API.md](docs/API.md) | All 18 routers + ~150 endpoints, auth, cancel endpoints |
| [docs/DATABASE.md](docs/DATABASE.md) | Drizzle schema reference grouped by table family |
| [prospectsa_schema.sql](prospectsa_schema.sql) | Raw SQL schema snapshot for DBA reference |

## Engine-specific docs

`docs/engines/` — one file per engine, ~150 lines each:

| Engine | File | What it does |
|---|---|---|
| OrcEngine | [docs/engines/orcengine.md](docs/engines/orcengine.md) | Multi-source research orchestrator with HTML/PDF/PPT export |
| Scout | [docs/engines/scout.md](docs/engines/scout.md) | Python OSINT microservice (Sherlock-style social discovery, subdomain enum) |
| Signals | [docs/engines/signals.md](docs/engines/signals.md) | Event-driven scoring (news, sanctions, regulatory) |
| Lead Factory | [docs/engines/lead-factory.md](docs/engines/lead-factory.md) | 4-phase automated lead discovery + enrichment |
| Company Intel | [docs/engines/company-intel.md](docs/engines/company-intel.md) | 50-field company profiles |
| Person Intel | [docs/engines/person-intel.md](docs/engines/person-intel.md) | Executive dossiers (work history, social, seniority) |
| SA Market | [docs/engines/sa-market.md](docs/engines/sa-market.md) | Tadawul/Nomu listed-company intelligence |

## Replication guides (operator-grade build-from-scratch)

`docs/replication-guides/` — large, comprehensive build playbooks. Use when you want to recreate an engine end-to-end in a new project, or as the deepest possible reference.

| Guide | Size | Use case |
|---|---|---|
| [01-masaar-engine-replication.md](docs/replication-guides/01-masaar-engine-replication.md) | 57 KB | Build the 7-agent CR-lookup pipeline from scratch (MC.gov, Wathq, AOA, Najiz, OFAC/UN/CMA/SAMA/ZATCA, bilingual report) |
| [02-masar-database-replication.md](docs/replication-guides/02-masar-database-replication.md) | 65 KB | Wathq-style registry harvester + 14 sources + dedup + enrichment depths |
| [03-prosengine-replication.md](docs/replication-guides/03-prosengine-replication.md) | 62 KB | 3-phase prospecting pipeline (Scan → Extract → Enrich) + 10 sources + exports |
| [04-ai-database-builder-replication.md](docs/replication-guides/04-ai-database-builder-replication.md) | 65 KB | Full Builder rebuild — older copy, superseded by `DATABASEBUILDER_FEATURE_DOC.md` |
| [fullstack-complete-replication-guide.md](docs/replication-guides/fullstack-complete-replication-guide.md) | 72 KB | Meta-index that links the four above |
| [prosengine-full-stack-replication-guide.md](docs/replication-guides/prosengine-full-stack-replication-guide.md) | 70 KB | Near-duplicate of #03 — kept for cross-reference |
| [masaar-prosengine-technical-reference.md](docs/replication-guides/masaar-prosengine-technical-reference.md) | 43 KB | Event reference + SSE event types + job-polling for Masaar & ProsEngine |
| [tech-stack-full.md](docs/replication-guides/tech-stack-full.md) | 41 KB | Complete dependency inventory + AI model waterfall |
| [frontend-replication-guide.md](docs/replication-guides/frontend-replication-guide.md) | 14 KB | Why engines tangle, route map, App.tsx pattern, 14-step replication order |

### Shorter teaser docs (overlap with replication guides above)

| Doc | Size | Note |
|---|---|---|
| [ai-database-builder.md](docs/replication-guides/ai-database-builder.md) | 40 KB | Quick reference to the 14 builder sources |
| [masaar-engine.md](docs/replication-guides/masaar-engine.md) | 18 KB | Short Masaar overview |
| [masar-database.md](docs/replication-guides/masar-database.md) | 25 KB | Masar schema overview |
| [pros-engine.md](docs/replication-guides/pros-engine.md) | 27 KB | ProsEngine quick reference |

## Canonical references (root-level)

These were already in the project and remain the authoritative deep-dives for their topics:

| File | Size | Topic |
|---|---|---|
| [NEXUS_ENGINE.md](NEXUS_ENGINE.md) | 32 KB | The 6-layer Nexus engine — LLM router, browser mesh, proxy mesh, captcha solvers, harvester, OSINT, orchestration |
| [DATABASEBUILDER_FEATURE_DOC.md](DATABASEBUILDER_FEATURE_DOC.md) | 29 KB | The best-written Builder reference (use this instead of `04-ai-database-builder-replication.md`) |
| [replit.md](replit.md) | 18 KB | Original Replit-side platform overview |

## Migration / strategy docs

| Doc | Use case |
|---|---|
| [docs/NEXUS_MIGRATION.md](docs/NEXUS_MIGRATION.md) | Per-file plan to route every LLM call through Nexus (5/13 engines done so far) |
| [docs/DOC_AUDIT.md](docs/DOC_AUDIT.md) | Keep/merge/delete recommendations to deduplicate the replication guides above |

---

## What's NOT in this bundle

Excluded because they're not documentation:

- `node_modules/`, `dist/`, `.vite/` — vendored / build artifacts
- `agents/.agents/skills/*/SKILL.md` — Claude skill manifests (not app docs)
- `docs/docs/frontend-source-code.md` — 498k-line raw code dump (already flagged in [DOC_AUDIT.md](docs/DOC_AUDIT.md) for deletion)

If you need any of those, navigate to the project directly at:
`C:\Users\sgied\OneDrive\Desktop\Nexflow\Enrichment engine\Replit Enrich app`

---

## Quick-reference map by question

| If you want to know… | Read this |
|---|---|
| How do I get the app running from a clean machine? | `docs/SETUP.md` + `docs/OPERATOR_GUIDE.md` |
| Which env vars do I need to set? | `docs/ENV.md` |
| What endpoints exist? | `docs/API.md` |
| What does the database look like? | `docs/DATABASE.md` + `prospectsa_schema.sql` |
| How do the 12+ engines fit together? | `docs/ARCHITECTURE.md` |
| What sources does each engine hit? | `docs/OPERATOR_GUIDE.md` §11 |
| What's broken or missing? | `docs/STATUS.md` |
| How do I rebuild engine X from scratch in a different project? | `docs/replication-guides/0X-*-replication.md` |
| How does Nexus actually work? | `NEXUS_ENGINE.md` |
| How is the Database Builder wired? | `DATABASEBUILDER_FEATURE_DOC.md` |
| Which docs should we delete to clean up? | `docs/DOC_AUDIT.md` |
| What was changed in the most recent AI-assisted session? | `docs/STATUS.md` "Recently shipped" section |
