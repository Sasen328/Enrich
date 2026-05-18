# ProspectSA - Saudi B2B Intelligence Platform

## Overview

Full-stack B2B intelligence platform for Saudi Arabia, combining the capabilities of ZoomInfo, Apollo, Crunchbase, SignalHire, and Lusha into one autonomous system. Fully self-contained — no external data APIs required. All data is generated through AI enrichment and web scraping.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + Shadcn/UI
- **AI**: OpenAI GPT-4o + Anthropic Claude Sonnet via Replit AI Integrations (no user API key needed)
  - OpenAI: `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` → shared client in `src/lib/openai.ts`
  - Anthropic: `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` + `AI_INTEGRATIONS_ANTHROPIC_API_KEY` → `src/lib/anthropic-service.ts`
  - Model: `claude-sonnet-4-6` for Claude; `gpt-4o` for OpenAI. NEVER use `temperature` or `max_tokens` with OpenAI integration — use `max_completion_tokens` only
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Charts**: Recharts
- **Animations**: Framer Motion
- **HTTP client**: Axios + React Query

## Architecture: Unified Company Pool

**Single source of truth: `companiesTable`** — all 1,961 companies live here. No staging table confusion.
- All harvest scripts → `companiesTable` directly
- Builder engine now writes directly to `companiesTable` (not `builderCompaniesTable`)
- All views (Dashboard, Companies Database, Builder Results, Smart Prospecting) read from `companiesTable`
- `builderCompaniesTable` still exists for backward compat but is NOT used for display or new inserts
- `GET /api/companies/stats` → field coverage, enrichment breakdown, sources, cities, industries (full counts)

## Current Database State

**3,744 companies** and **7,591 executives** in main tables as of March 2026.
- Sources: seed-import (~1,700 new), gpt4o-micro (450), gpt4o (390), wikidata (272), gpt4o-micro2 (233), gpt4o-city (195), gpt4o-micro3 (140), gpt4o-type (76)...
- Coverage: 285+ unique industries, 68+ cities across all Saudi regions
- Seed import merged data from JSON files (1,695 companies, 5,462 executives) and SQL dump (1,997 companies, 2,589 management records)
- Import script: `scripts/src/seed-import.ts` — idempotent, run via `pnpm --filter @workspace/scripts run seed-import`
  - Add `--skip-enrich` to skip the AI gap enrichment step
  - Gap enrichment targets companies with enrichmentStatus != 'enriched' that are missing description or have no executives
  - Uses composite name+website dedup key for merge; GPT-4o for exec generation

## Harvest Scripts (in `artifacts/api-server/src/`)

| Script | Purpose |
|--------|---------|
| `mass-harvest.ts` | Original sequential harvester (Wikidata + Apollo + GPT-4o) |
| `mass-harvest-fast.ts` | Fast parallel harvest (6 sectors at once, GPT4o+Claude+Perplexity) |
| `harvest-continue.ts` | Continuation batches 4-7 + city/type harvest |
| `harvest-final.ts` | City-level + 8 type-bucket harvests |
| `harvest-final2.ts` | Remaining micro-sectors + themed + mega batch |
| `harvest-finish.ts` | Last micro-sectors + 8 themed batches + 2 mega batches |
| `harvest-push2k.ts` | 52 micro-sectors + Arabic/themed prompts |
| `harvest-2k-push.ts` | 5 broad sector batches (construction, retail, finance, healthcare) |

To add more companies: `pnpm --filter @workspace/api-server exec tsx ./src/harvest-push2k.ts`

## Key Features

### Smart Prospecting Engine (standalone — NOT part of OrcEngine)
- **Architecture**: Completely separate from OrcEngine, has its own folder `artifacts/api-server/src/prospecting/`
- **Engine**: `artifacts/api-server/src/prospecting/engine.ts`
- **Routes**: `artifacts/api-server/src/prospecting/routes.ts` → registered at `/api/prospecting/...`
- **Frontend**: `artifacts/prospect-sa/src/pages/prospecting/index.tsx` → API calls to `/api/prospecting`
- 5-step wizard UI: Target URL → Scanning → Configure → Extraction → Results
- 3-phase automated pipeline: Scan → Extract → Enrich
- Input any URL (chamber, directory, government site, exhibitor list) — quick-fill suggestions: riyadhchamber.com, saudiarabia.yellowpages.com.sa, www.kompass.com
- **Phase 1 (Scan)**: Detects pagination type, samples companies, generates filter questions via GPT-4o
- **Phase 2 (Extract)**: Detail-page-first strategy — finds company profile links on listing pages, visits each company's detail page, uses GPT-4o to parse ALL real data from the profile page. Falls back to listing-page text extraction only when no detail links are found.
- **Phase 3 (Enrich)**: 10 parallel data sources per company:
  1. Direct HTTP fetch of company website
  2. Playwright deep JS-rendered scrape
  3. Crawl4AI AI-ready markdown extraction
  4. Contact/about page scraping (4 paths)
  5. Perplexity research (focus-targeted)
  6. Perplexity detail query (CR/financial)
  7. Perplexity ownership research (when owner fields requested)
  8. Internal DB match (companiesTable read-only)
  9. Saudi government sources (Wathq/Wikidata/Saudi Open Data)
  10. Explorium firmographics API
  - GPT-4o synthesis → 22-field JSON, then Claude backup layer fills any remaining "Unknown" fields
- **Multi-select Questionnaire**: Filter questions support selecting multiple options (e.g., multiple cities, industries) with toggle buttons and checkmarks
- **Export History**: All exports are tracked in `prospecting_exports` table. "History" button in sidebar shows past exports with filename, format, record count, and date.
- **Focus Fields**: 18 fixed enrichment fields (ownerName, shareholders, crNumber, landline, capital, revenue, etc.) — NOT AI-generated. These map 1:1 to backend `FOCUS_FIELD_SEARCH_TERMS` and drive Perplexity enrichment queries.
- 5 concurrent companies during enrichment, 150s timeout each
- Enrichment depths: basic / standard / deep
- 8 REST endpoints: scan, extract, get job, get results, list jobs, delete, export, export history
- Export: CSV, Excel (base64 XLSX), JSON, PDF (HTML report)
- Frontend polls job status every 3s with live results streaming
- **CRITICAL RULE**: Prospecting NEVER writes to `companiesTable`. Uses `prospecting_results` table only.
- DB tables: `prospecting_jobs`, `prospecting_results`, `prospecting_exports` — separate from OrcEngine tables

### AI Database Builder
- 14 pre-configured Saudi data sources:
  - Government: Saudi Open Data (CKAN), Ministry of Commerce
  - Financial: CMA, Tadawul Listed Companies
  - Wikidata SPARQL (726+ companies)
  - Directories: Yellow Pages SA, Daleel, Kompass, Franchises
  - Chambers: Riyadh, Jeddah, Eastern Province, Madinah, Aseer
- Parallel multi-agent harvesting (batches of 5)
- Cross-deduplication against companies + builder_companies tables
- Per-company enrichment with 22 data points
- Explorium API enrichment (when `EXPLORIUM_API_KEY` is set, falls back gracefully)
- Dedicated `builder_jobs` table for tracking builder-specific job state
- Engine in `artifacts/api-server/src/lib/builder-engine.ts` with:
  - Robust deduplication (`/api/builder/deduplicate`)
  - Per-company re-enrichment (`/api/builder/re-enrich/:id`)
  - Bulk re-enrichment (`/api/builder/re-enrich-all`)
  - Auto-clean with phone/email/website validation (`/api/builder/clean`)
  - Incomplete companies listing (`/api/builder/incomplete`)
  - All builder companies endpoint (`/api/builder/companies`)
  - Builder job tracking (`/api/builder/builder-jobs`)
- "Validate & Clean" button (dedup + data validation)
- Push to Main Database functionality

### Companies Database
- Full-text search across Arabic + English names
- Filters: industry, city, enrichment status, company type, revenue
- 22+ data fields per company including:
  - Revenue (single field, real only)
  - Owner name & details, estimated wealth
  - Shareholders with ownership %
  - Key executives
  - Landline (validated Saudi numbers only)
  - Employee count, founding date, CR number, capital
  - Entity type, market positioning, recent news
- Export CSV/JSON
- Per-company re-enrichment

### MeshBase (Company & Executive Intelligence)
- Apollo.io-powered enrichment for companies and executives
- Dedicated executives table with full CRUD API
- Batch and single company enrichment via Apollo organization enrich
- Team discovery via Apollo people search + person match
- Enrichment stats dashboard (enriched vs unenriched counts)
- Frontend page at `/meshbase` with Companies/Executives tabs
- Search, industry filtering, pagination
- Company detail drawer showing linked executives
- Graceful degradation when API keys are absent

### Leads Management
- Link leads to companies
- Status tracking: new → contacted → qualified → converted → disqualified

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/          # Express 5 backend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── openai.ts           # OpenAI client (Replit AI Integration)
│   │       │   ├── scraper.ts          # Web scraping + contact extraction
│   │       │   ├── enrichment-engine.ts # AI enrichment pipeline
│   │       │   └── data-sources.ts     # 14 Saudi data sources config
│   │       ├── orcengine/             # Multi-agent intelligence system
│   │       │   ├── routes.ts          # /api/orcengine/* route registration
│   │       │   ├── enrichment.ts      # Company/person AI enrichment
│   │       │   ├── research.ts        # Async research jobs
│   │       │   ├── news.ts            # Saudi news via Perplexity
│   │       │   ├── scraper.ts         # Web scraping sessions + KB chat
│   │       │   ├── prospecting-engine.ts  # Scan → Extract → Enrich pipeline
│   │       │   ├── templates.ts       # Research templates (built-in + custom)
│   │       │   ├── export-service.ts  # JSON/CSV/HTML export
│   │       │   └── url-validator.ts   # SSRF protection
│   │       ├── openai-client.ts       # Shared OpenAI client for OrcEngine
│   │       ├── browser-helper.ts      # Playwright + cheerio web scraping
│   │       ├── perplexity-service.ts  # Perplexity AI search/chat
│   │       ├── gemini-search.ts       # Google Gemini AI research
│   │       ├── crawl4ai-engine.ts     # Crawl4AI service integration
│   │       └── routes/
│   │           ├── companies.ts        # Company CRUD + enrichment + export
│   │           ├── leads.ts            # Lead management
│   │           ├── prospecting.ts      # Smart Prospecting Engine (3-phase)
│   │           ├── builder.ts          # AI Database Builder + harvest jobs
│   │           └── meshbase.ts         # MeshBase executives + enrichment routes
│   └── prospect-sa/         # React + Vite frontend
│       └── src/
│           ├── pages/
│           │   ├── Dashboard.tsx
│           │   ├── companies/index.tsx
│           │   ├── prospecting/index.tsx         # ProsEngine hub (3 modes)
│           │   ├── prospecting/website.tsx        # Website Intelligence (URL + text input, AI chat)
│           │   ├── prospecting/person.tsx         # Person Intelligence 5-step wizard + AI chat
│           │   ├── prospecting/seeder.tsx         # Data Seeder (AI-generated records, 3-step wizard)
│           │   ├── database-builder/index.tsx
│           │   ├── database-builder/results.tsx
│           │   ├── leads/index.tsx
│           │   └── MeshBase.tsx
│           ├── components/
│           │   └── ProsEngineChat.tsx             # Reusable floating AI assistant (all 3 modes)
│           └── components/layout/
│               ├── AppSidebar.tsx
│               └── Layout.tsx
├── lib/
│   ├── api-spec/openapi.yaml     # Full OpenAPI spec (50+ endpoints)
│   ├── api-client-react/         # Generated React Query hooks
│   ├── api-zod/                  # Generated Zod schemas
│   └── db/
│       └── src/schema/
│           ├── companies.ts
│           ├── builder_companies.ts
│           ├── prospecting_sessions.ts
│           ├── jobs.ts
│           ├── leads.ts
│           ├── enrichment_reports.ts
│           ├── executives.ts
│           ├── prospecting_jobs.ts
│           ├── prospecting_results.ts
│           ├── research_jobs.ts
│           ├── scrape_sessions.ts
│           └── templates.ts
```

## UI Theme: Desert Aurora

Dark indigo/navy background design applied site-wide via CSS custom properties in `artifacts/prospect-sa/src/index.css`:
- Background: deep navy (`220 20% 8%`) → navy (`220 15% 11%`)
- Primary: teal-emerald (`168 65% 38%`) — buttons, active states, highlights
- Sidebar: darker navy (`220 25% 7%`) with teal active items
- Cards: elevated navy (`220 17% 14%`) with subtle borders
- Typography: Inter (body) + Outfit (headings/display)
- Charts: teal/emerald accent palette

## Data Validation Rules

- **Phone**: Rejects fabricated/estimated numbers, numbers with 5+ consecutive zeros, sequential patterns. Validates Saudi mobile (05x) and landline (01x) formats.
- **Email**: Rejects "estimated" emails, validates format
- **Website**: Rejects "estimated" URLs, validates URL parsing, checks reachability before enrichment
- **Revenue**: Single field (e.g., "SAR 50M - 100M"), never fabricated

## Enrichment Score

0-100 score based on 22 weighted fields:
- 0-30: red (pending)
- 30-70: amber (partial)  
- 70-100: green (enriched)

### OrcEngine (Multi-Agent Intelligence System)
- **Enrichment**: AI-powered company/person research with structured reports stored in DB
- **Research Jobs**: Async research pipeline using Perplexity + Gemini + OpenAI
- **Saudi News**: Real-time Saudi business news via Perplexity API
- **Web Scraping Sessions**: Scrape URLs into knowledge base with AI chat
- **Smart Prospecting**: Scan → Extract → Enrich pipeline for business directories
- **Research Templates**: Built-in + custom templates for common research tasks
- **Export**: JSON, CSV, HTML export formats
- Routes: `/api/orcengine/*` (enrichment, research, news, scrape, prospecting, templates, export)
- Helper services: `browser-helper`, `perplexity-service`, `openai-client`, `gemini-search`, `crawl4ai-engine`
- SSRF protection on all URL-accepting endpoints

### Masaar (7-Agent Saudi CR Intelligence Pipeline + Stealth Browser)
- **Entry Point**: Enter a Saudi CR number (7-12 digits) and click "Run Masaar"
- **Stealth Mode (default ON)**: Fully autonomous — AI auto-solves CAPTCHAs via Claude Vision, no human input needed
  - `StealthBrowser` class: anti-fingerprinting (navigator.webdriver, canvas noise, WebGL spoof, fake plugins), human-like Bézier mouse paths + Gaussian typing delays
  - `SessionManager`: persists browser cookies/localStorage per domain in `.agent_sessions/` so repeat visits bypass re-verification
  - `autoSolveCaptcha()`: takes screenshot → Claude Vision reads CAPTCHA → auto-fills (up to 3 retries) → falls back to human overlay only on failure
  - Frontend toggle: "Stealth Mode ON/OFF" — live stealth activity feed shows AI CAPTCHA solving attempts
- **Agent 1 — MC.gov.sa Browser**: StealthBrowser navigates mc.gov.sa (Arabic) — Claude Vision reads CAPTCHA, retries up to 4× on wrong answer
- **Agent 2 — Claude CR Parser**: Claude Sonnet parses all CR fields bilingually (EN + AR): name, legal form, HQ city, capital, activity, status
- **Agent 3 — Emagazine Search**: StealthBrowser searches emagazine.aamaly.sa — AI auto-solves any CAPTCHA that appears
- **Agent 4 — AOA PDF Parser**: Downloads PDF with `pdf-parse` then sends to Claude to extract all 15+ AOA fields (shareholders, managers, board, share restrictions, profit rules, dissolution, amendment procedures)
- **Agent 5 — Najiz Legal Agencies**: Fetches legal agency records from najiz.sa Ministry of Justice portal
- **Agent 6 — Cross-Validator**: Claude compares all three sources and flags conflicts with severity (high/medium/low) and recommendations
- **Agent 7 — Bilingual Report**: Claude compiles a full EN + AR intelligence report structured identically to AOA format
- **SSE Event Types**: `agent_start`, `agent_log`, `agent_complete`, `stealth_solving` (AI solving), `stealth_solved` (AI success), `captcha_required` (human fallback), `captcha_solved`, `job_complete`, `job_error`
- **SSE Streaming**: `POST /api/masaar/start { crNumber, stealthMode }` → `GET /api/masaar/stream/:jobId`
- **Frontend**: Pipeline tab (live agent cards), Report tab (EN/AR), Structured Data tab, Conflicts tab + stealth activity feed
- Files: `artifacts/api-server/src/lib/stealth-browser.ts` | `masaar-engine.ts` | `routes/masaar.ts` | `pages/masaar/index.tsx`

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Replit AI Integration proxy URL
- `AI_INTEGRATIONS_OPENAI_API_KEY`: Replit AI Integration dummy key
- `PERPLEXITY_API_KEY`: (Optional) Perplexity API key for news and research
- `GEMINI_API_KEY`: (Optional) Google Gemini API key for additional AI research
- `CRAWL4AI_URL`: (Optional) Crawl4AI service URL for enhanced web scraping
- `PORT`: Service port (auto-assigned)
- `APOLLO_API_KEY`: Apollo.io API key for company enrichment (optional)
- `APOLLO_ACCESS_TOKEN`: Apollo.io bearer token for people search (optional)
- `APOLLO_CLIENT_SECRET`: Fallback bearer token for Apollo people search (optional)
