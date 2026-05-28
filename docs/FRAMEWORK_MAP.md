# ProspectSA — Complete Framework Map + Agentic Web Engine Plan

> **Ground-truth mapping** of the ProspectSA platform as it currently stands in
> the repository (post-cleanup: SwarmBoard added, Dashboard + SA Market removed,
> Docker removed, enrichment routed through Nexus). Generated from the live code,
> not an aspirational spec.

---

## 0 · What runs where (the mental model)

ProspectSA is a **pnpm monorepo** with three runtimes:

| Layer | Lives in | Runtime | Role |
|---|---|---|---|
| **Frontend** | `artifacts/prospect-sa` | React 19 + Vite (built, served by the API) | All engine UIs. Talks to the API over `/api/*`. |
| **API server** | `artifacts/api-server` | Node 24 + Express 5 | All engine *logic*, scrapers, LLM routing, DB access. |
| **Scout** | `artifacts/python-scout` | Python 3.11 + FastAPI (port 8099) | OSINT microservice: site intel, contacts, subdomains, social. |
| **Shared** | `lib/db`, `lib/api-*` | — | Drizzle schema + client, API spec/zod, OpenAI integrations. |

Data lives in **PostgreSQL** (`DATABASE_URL`). The browser bundle contains the UI
only — every scrape/LLM/enrichment action executes server-side.

---

## 1 · Tab framework (current nav)

Six top tabs (Dashboard removed; `/` redirects to `/ai-chat`).

| Top Tab | Sub-tabs | Page(s) | Primary API | Engine |
|---|---|---|---|---|
| **AI Chat** | — | `pages/ai-chat` (+ `components/composer/*`) | `/api/ai-chat/stream`, `/api/composer/*`, `/api/behavior/suggest` | Claude orchestrator + 9 tools + Plan B (§2) |
| **SwarmBoard** | About · Agents · Swarm Live | `pages/swarm` | `/api/swarm/start` (SSE) | Kimi-coordinated swarm (§3) |
| **Lead Genome** | Saved Leads · Lead Lists | `pages/leads` | `/api/lead-genome/*`, `/api/lead-lists/*` | storage + enrich |
| **Lead Factory** | Person Hunt · Company Hunt · Results · Signals · Relationship | `pages/lead-factory/*`, `pages/signal-intelligence/*`, `pages/relationship-intel/*` | `/api/lead-factory/*`, `/api/signals/*`, `/api/relationship-intel/*` | 7-agent LF + Signals + 4-agent Relationship (§4) |
| **ProsEngine** | Company Intel · Person Intel · Website Intel · Data Seeder | `pages/prospecting/*` | `/api/company-intel/*`, `/api/person-intel/*`, `/api/prosengine/*` | §5 |
| **Harvest AI** | Masaar Engine · Masaar Database · AI DB Builder | `pages/masaar/*`, `pages/database-builder/*` | `/api/masaar/*`, `/api/masar/database/*`, `/api/builder/*`, `/api/harvest-ai/*` | 5-agent Masaar + Builder (§6) |

Hidden / direct-URL admin: `/meshbase/*`, `/orcengine`.

### Mounted API routers (`routes/index.ts` + `app.ts`)
`health · companies · leads · lead-lists · builder · meshbase · masaar · masar-database · person-intel · company-intel · prosengine-chat · ai-chat · composer · orcengine · nexus · scout · signals · lead-factory · lead-genome · harvest-ai · sources · seeder · behavior · swarm` — plus `registerOrcEngineRoutes` and `registerProspectingRoutes`. All under `/api`, behind `authRequired`.

---

## 2 · AI Chat orchestrator

- **Composer**: 6-stage wizard (`components/composer/ChatLayout.tsx`) — Compose → Enhance → Clarify → Run → Report → Enrich, plus the `BehaviorAgent` sidecar.
- **Orchestrator** (`lib/agents/orchestrator.ts`): Claude tool-use loop, default `claude-sonnet-4-6`, max 8 rounds, last 10 turns.
- **9 tools** (`lib/agents/tools.ts`): `nexus_run · web_search · url_crawl · deep_scrape · harvester_run · sanctions_screen · scout_osint · lead_factory_run · signal_monitor`.
- **SSE events**: `agent_start · agent_done · intent · token · final · error`.
- **Plan B** (`routes/ai-chat.ts`): when `ANTHROPIC_API_KEY` is absent, delegates to `nexusRunRole("planner", …)` and emits `degraded_mode: <provider>`.
- **Swarm toggle**: switches the page to post `/api/swarm/start` instead of `/api/ai-chat/stream`.
- **Behavior agent**: `POST /api/behavior/suggest` returns `{suggestion, oneLineHint, plugActions[]}`; events persisted to `behavior_events`.
- **Customize drawer**: Skills · Templates · Sources · Connectors (OAuth) · Plugins (toggle persistence) · Modes.

---

## 3 · SwarmBoard + swarm engine (net-new)

- **UI** (`pages/swarm`): three views — **About** (explainer + 4-phase flow), **Agents** (directory of 11 engines + per-agent profile), **Swarm Live** (Q&A wizard → evaluating → live orbit → visual report).
- **Engine** (`lib/agents/swarm.ts`): **PLAN** (Kimi-pinned coordinator decomposes the brief) → **FAN-OUT** (specialist sub-agents run in parallel via `nexusRunRole`) → **FUSE** (writer synthesises one report). Runs entirely on the Nexus fabric — works without an Anthropic key.
- **Route** (`routes/swarm.ts`): `POST /api/swarm/start` (SSE, same event shape as AI Chat). Publishes lifecycle events to the in-process **event bus** (`lib/event-bus.ts`).

---

## 4 · Lead Factory · Signals · Relationship

- **Lead Factory** (`lib/lead-factory-engine.ts`): 7-agent pipeline — ICP mapping → harvesting → enrichment → validation → scoring → outreach → publishing. SSE stream.
- **Signals** (`routes/signals.ts`, `lib/signal-engine.ts`, `lib/signal-monitor.ts`): scan / news / sanctions / regulatory / individual / feed (SSE) / recent / `:id/push-to-genome`. Rule-based scoring + LLM significance via `nexusRunRole("signal")`.
- **Relationship Tree** (`lib/relationship-intel-engine.ts`): 4-agent — Org Mapper → Stakeholder Enricher (Scout + **Sherlock** + **TheHarvester** + NEXUS) → Network Expander → Outreach Sequencer. Each `OrgNode` carries a **trust verdict** (`scoreFact`) rendered as a pill in `pages/relationship-intel/tree.tsx`.

---

## 5 · ProsEngine (four tools)

| Tool | API | Backend |
|---|---|---|
| **Company Intel** | `/api/company-intel/profile` | Web Seeder + Gemini ×5 + Perplexity ×4 + Claude + GPT-4o ensemble → synthesise; `verdicts[]` + humanized report. |
| **Person Intel** | `/api/person-intel/profile` | Perplexity ×4 + web-seeder + Gemini + Claude + GPT-4o ensemble; verdicts + caveats; auto-pushes to ProsEngine Watchlist. |
| **Website Intel** | `/api/company-intel/web-seed` | `lib/web-seeder.ts` multi-page BFS crawl → 5-layer scraper (§7). |
| **Data Seeder** | `/api/prosengine/seed/{eval,approve,harvest,enrich}` | Real pipeline: GPT-4o-vision EVAL → approve → Crawl4AI/ScrapeGraphAI harvest → 7-agent enrich + verdicts. (`routes/seeder.ts`, staging table.) |

Direct provider keys are **guarded** (`lib/llm-clients.ts` `lazyAnthropic`/`lazyOpenAI` → clean 503 on missing key). Research helpers fall back to `nexusRunRole("researcher")` when Perplexity is absent.

---

## 6 · Harvest AI (Masaar + Builder)

- **Masaar Engine** (`lib/masaar-engine.ts`): 5-agent — (1) MC.gov.sa stealth browser + CAPTCHA + CR parse → (2) Amaaly AOA OCR + translate → (3) deep research (Perplexity ×5 + Gemini ×4 + Claude + GPT-4o + NEXUS) → (4) OFAC/UN/EU/CMA/SAMA/ZATCA compliance → (5) bilingual report (Claude EN + GPT-4o AR, **NEXUS synthesis fallback** when both are down). SSE.
- **Masaar Database** (`/api/masar/database/*`): re-enrich (single/all/bulk), pipeline force-push, deduplicate, bulk delete, export (csv/xlsx/word/pdf/pptx).
- **AI DB Builder** (`lib/builder-engine.ts`, `/api/builder/*`): multi-source harvest (14+) → dedup → auto-clean → push to main DB → export; Perplexity research falls back to NEXUS.

---

## 7 · Native Web Engine (scrapers)

`lib/power-scraper.ts` — **5-layer** auto-escalating stack:

```
L1  Cheerio + axios            fast static HTML
L2  Playwright + Stealth        full JS + bot-evasion
L3  Camoufox                    engine-level stealth   (CAMOUFOX_ENABLED)
L4  ScrapeGraphAI               LLM schema extraction  (schemaPrompt → result.structured)
L5  BeautifulSoup subprocess    RTL / malformed HTML
```

`lib/scrapers/`: `camoufox-runner · crawlee-runner (CRAWLEE_ENABLED) · proxy-pool · scrapegraph-client · sherlock-client · theharvester-client`. Multi-page BFS crawler + pagination + per-page classification in `crawlSite`.

---

## 8 · Nexus Engine (multi-LLM fabric)

`lib/nexus/` — adapters: **OpenRouter · Groq · Gemini · OpenAI · Anthropic · Ollama · DeepSeek · Kimi/Moonshot · Perplexity**.

**Roles → tiers** (`roles.ts`):

| Role | Tier | Notes |
|---|---|---|
| planner | **planning** | Kimi-pinned default |
| researcher | realtime | Perplexity-first |
| extractor / signal / tree | extraction | DeepSeek/Groq/Qwen |
| arabic | arabic | Kimi + Groq orpheus-arabic |
| writer | synthesis | Gemini → Claude → GPT-4o |
| validator / bulk | bulk | cheap/local |

`nexusRunRole(role, prompt, opts)` routes with automatic fallback. `nexusFusion(prompt, {models, arbitrator})` ensembles cheap models + arbitrates. Plus proxy-manager, captcha-solver, session-manager. Exposed at `/api/nexus/run`, `/api/nexus/fusion`.

---

## 9 · Cross-cutting layers

- **Source-credibility verdicts** (`lib/credibility/verdict.ts`): `scoreFact` → `{certainty, trustScore, sources, rationale}`; trust weights from the source registry. Rendered as lavender pills.
- **Humanizer** (`lib/report/humanize.ts`): strips machine artifacts, rewrites to exec tone via `nexusRunRole("writer")`, fact-preservation diff.
- **Source registry** (`harvest_sources` table, `routes/sources.ts`): unified registry with credibility tier + trust weight + per-engine enforcement (whitelist/blacklist) + health probe.
- **Event bus** (`lib/event-bus.ts`): in-process pub/sub + ring buffer; the swarm publishes lifecycle events.
- **Deploy hardening** (`lib/require-env.ts`): `requireEnv`/`hasEnv`/`MissingEnvError` → clean 503s; `assertProductionSafety`.

---

## 10 · Data layer

PostgreSQL via Drizzle (`lib/db`). Core tables: `companies`, `executives`, `masar_companies`, `builder_companies`, `lead_lists`, `lead_list_items`, `leads`, `prosengine_research`, `company_intel_research`, `harvest_sources`, `behavior_events`, `seeder_rows`, composer tables. Migrations in `lib/db/drizzle/*.sql` (applied by `start.sh` via drizzle-kit push + psql safety net). *(SA Market tables dropped in `0008`.)*

---

## 11 · Run / deploy

No Docker. Native run: `setup.sh` (deps + migrate + seed) → `start.sh` (drizzle push + Python Scout on 8099 + Node API on `PORT`). Replit: see **`docs/REPLIT.md`** (modules nodejs-24 / python-3.11 / postgresql-16; Secrets `DATABASE_URL` + ≥1 LLM key). CI: `.github/workflows/ci.yml` (typecheck + build).

**Env essentials:** `DATABASE_URL` (required); LLM keys (`OPENROUTER_API_KEY` recommended — unlocks the whole waterfall incl. Kimi; plus `ANTHROPIC/OPENAI/GEMINI/GROQ/DEEPSEEK/MOONSHOT/PERPLEXITY`); optional `APOLLO/EXPLORIUM`, captcha keys, `API_TOKEN`+`FRONTEND_ORIGIN` for public exposure, `CAMOUFOX_ENABLED`/`CRAWLEE_ENABLED`. Full reference: `docs/ENV.md`.

---

*Companion docs: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/ENV.md`, `docs/OPERATOR_GUIDE.md`, `docs/REPLIT.md`, `docs/llm-providers/*`, `docs/scrapers/*`.*
