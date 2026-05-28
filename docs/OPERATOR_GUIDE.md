# Operator Guide — Full Wiring from Cold Start

This is the single document you need to take the app from a clean checkout to a fully-wired, running instance with every engine functional. Follow the sections in order.

> **Read first:** [SETUP.md](SETUP.md) for prerequisites, [ENV.md](ENV.md) for the full env-var reference, [STATUS.md](STATUS.md) for what works today vs. what's blocked.

---

## 0. Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 24.x | API server, frontend |
| pnpm | 9+ | Workspace package manager (enforced via `preinstall` hook) |
| Python | 3.11+ | Scout microservice only |
| PostgreSQL | 14+ | Single shared database |

Verify:
```bash
node -v
pnpm -v
python --version
psql --version
```

---

## 1. Install dependencies

```bash
pnpm install
```

This installs every workspace package: `artifacts/api-server`, `artifacts/prospect-sa`, `lib/db`, `lib/api-zod`, `lib/api-client-react`, `lib/api-spec`, `scripts`.

---

## 2. Set up environment

Create `.env` at the repo root. **Minimum to boot:**

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/enrich

# At least one LLM key (Nexus will use whichever it finds)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

**Per-tool env vars** — turn each one on by adding the keys listed.

| Tool | Required env vars | Optional |
|---|---|---|
| **Masaar** (CR lookup) | `ANTHROPIC_API_KEY` | One captcha: `CAPMONSTER_API_KEY` / `AZCAPTCHA_API_KEY` / `NOPECHA_API_KEY` |
| **Masar** (Wathq harvest) | `ANTHROPIC_API_KEY` | `PERPLEXITY_API_KEY` for richer enrichment |
| **ProsEngine** | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | — |
| **Database Builder** | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | `PERPLEXITY_API_KEY` for the deep-enrichment tier |
| **Nexus** (LLM router) | At least one of: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | `OLLAMA_BASE_URL` (default `http://localhost:11434`), `HUGGING_FACE_API_KEY` |
| **OrcEngine** | `OPENAI_API_KEY`, `PERPLEXITY_API_KEY` | — |
| **Scout** (OSINT microservice) | `SCOUT_URL` (default `http://localhost:8099`) | `CHROMIUM_EXECUTABLE_PATH` on Nix / non-standard Chromium installs |
| **Signals** | `PERPLEXITY_API_KEY`, `SCOUT_URL` | `DISABLE_PERPLEXITY=true` to force fallback |
| **Lead Factory** | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY` | `APOLLO_API_KEY`, `HUNTER_API_KEY` |
| **Company Intel / Person Intel** | `PERPLEXITY_API_KEY`, `OPENAI_API_KEY` | `APOLLO_API_KEY` for Person Intel |
| **SA Market** | `OPENAI_API_KEY` | — (Wikidata + CMA are public) |
| **Activepieces flows** (optional) | `ACTIVEPIECES_URL`, `ACTIVEPIECES_API_KEY` | + flow IDs per engine |
| **Proxy mesh** (optional) | one of: `IPROYAL_USER+PASS+ENDPOINT`, `LUNAPROXY_*`, `SIMPLYNODE_*`, `WEBSHARE_PROXY_LIST` | `NEXUS_PROXY_ENABLED=true` |

The full canonical list is in [ENV.md](ENV.md). The `lib/config/env.ts` module validates them with Zod at boot — missing required vars throw a loud, listed error.

---

## 3. Provision the database

### 3a. Create the database

```bash
psql -U postgres -c "CREATE DATABASE enrich;"
```

### 3b. Apply the schema

The Drizzle schema is the source of truth (`lib/db/src/schema/*.ts`). Apply it with:

```bash
pnpm --filter @workspace/db run db:push
```

This creates ~30 tables: `companies`, `executives`, `leads`, `lead_factory_jobs`, `lead_factory_results`, `lead_lists`, `lead_list_items`, `prospecting_*`, `builder_*`, `masar_*`, `masaar_*`, `scrape_sessions`, `research_jobs`, `company_signals`, `company_intel_research`, `prosengine_research`, `sa_market_*`, `conversations`, `messages`, `templates`, `jobs`, `enrichment_reports`, `relationship_intel_jobs`, `lead_fingerprints`, `deleted_companies`.

**Schema reference:** [DATABASE.md](DATABASE.md).

### 3c. Seed data

There is **no raw SQL seed file**. Seeds run via TypeScript so they are type-safe and idempotent. The `prospectsa_schema.sql` file at the repo root is the schema snapshot only — do not use it for seeding.

| Seed | Command | What it does |
|---|---|---|
| **`seed-import`** (canonical) | `pnpm --filter @workspace/scripts run seed-import` | Imports ~1,773 companies + ~2,100 executives from `scripts/attached_assets/companies_*.json` + `executives_*.json`. Dedupes by `(nameEn, website)`. Fills missing CEOs/descriptions via GPT-4o. Pass `--skip-enrich` to skip AI gap-fill. Idempotent — safe to re-run. |
| **`seed-meshbase`** (reset) | `tsx scripts/seed-meshbase.ts` | Truncates and re-seeds `companies` + `executives` from the same JSON fixtures. Use for resetting to a known state. |
| **`seed-companies`** (legacy) | called from `index.ts` on first boot | Hard-codes ~20 Saudi anchors (Aramco, SABIC, STC, etc.). Auto-runs if the `companies` table is empty. |

Run the canonical seed:

```bash
pnpm --filter @workspace/scripts run seed-import
```

Verify:

```sql
SELECT count(*) FROM companies;   -- expect ~1,773+
SELECT count(*) FROM executives;  -- expect ~2,100+
```

---

## 4. Wire each engine

Each engine is a router in `artifacts/api-server/src/routes/*.ts` plus (for the bigger ones) a companion engine module in `lib/`. None of them need separate "wiring" — they auto-mount when the API server starts — but each has external dependencies that must be reachable. Verify per-engine.

### 4a. Masaar — Saudi CR lookup

- **Router:** `routes/masaar.ts`
- **Needs:** `ANTHROPIC_API_KEY`, a captcha solver key.
- **Verify:** `curl -X POST http://localhost:3000/api/masaar/start -H 'Content-Type: application/json' -d '{"crNumber":"1010234567"}'`. Returns `{ jobId }`. Then `GET /api/masaar/stream/:jobId` for SSE progress.

### 4b. Masar — Wathq registry harvester

- **Router:** `routes/masar-database.ts` · **Engine:** `lib/masar-harvester.ts`
- **Needs:** `ANTHROPIC_API_KEY`. Optional `PERPLEXITY_API_KEY` for deep enrichment.
- **Tables:** `masar_companies`, `masar_harvest_jobs`, `masar_custom_sources`.
- **Verify:** `POST /api/masar/database/harvest` with `{ keyword: "real estate riyadh" }`.

### 4c. ProsEngine — conversational research + export

- **Router:** `routes/prosengine-chat.ts`
- **Needs:** `OPENAI_API_KEY` (streaming chat — currently bypasses Nexus). See [NEXUS_MIGRATION.md](NEXUS_MIGRATION.md) Phase 5.
- **Tables:** `conversations`, `messages`, `prosengine_research`.
- **Verify:** `POST /api/prosengine/chat` with `{ message, conversationId? }` — streams SSE.

### 4d. Database Builder — agentic company harvest

- **Router:** `routes/builder.ts` · **Engine:** `lib/builder-engine.ts`
- **Needs:** `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Optional `PERPLEXITY_API_KEY`.
- **Tables:** `builder_companies`, `builder_jobs`, `builder_custom_sources`.
- **14 built-in sources:** Wikidata, ministry registries, CMA, chambers of commerce, directories — see [DATABASEBUILDER_FEATURE_DOC.md](../DATABASEBUILDER_FEATURE_DOC.md).
- **Verify:** `GET /api/builder/sources` returns the registered sources. `POST /api/builder/harvest` starts a job.

### 4e. Scout — Python OSINT microservice

- **Router (proxy):** `routes/scout.ts` · **Client:** `lib/scout-client.ts`
- **Needs:** Python service running on `SCOUT_URL` (default `http://localhost:8099`).
- **Start the Python service:**
  ```bash
  cd artifacts/python-scout
  uv sync
  uv run uvicorn main:app --port 8099
  ```
- **Verify:** `GET /api/scout/health` returns `{ ok: true }`.

### 4f. Signals — event-driven scoring

- **Router:** `routes/signals.ts` · **Engine:** `lib/signal-engine.ts`
- **Needs:** `PERPLEXITY_API_KEY`, `SCOUT_URL`.
- **Tables:** `company_signals`.
- **Verify:** `POST /api/signals/scan` with `{ companyName, domain }`.

### 4g. Lead Factory — 4-phase enrichment pipeline

- **Router:** `routes/lead-factory.ts` · **Engine:** `lib/lead-factory-engine.ts`
- **Needs:** at minimum one LLM key + `PERPLEXITY_API_KEY`. Optional `APOLLO_API_KEY`, `HUNTER_API_KEY` for contact data.
- **Tables:** `lead_factory_jobs`, `lead_factory_results`, plus auto-bridges into `companies` + `executives` for A/B-tier leads.
- **Run a job:**
  ```bash
  curl -X POST http://localhost:3000/api/lead-factory/start \
    -H 'Content-Type: application/json' \
    -d '{"inputMode":"segment","icpDescription":"SaaS, Riyadh, 50-200 employees","targetCount":20,"autoEnrichDownstream":false}'
  ```
- **Auto-seed Signals + Network Intel:** set `"autoEnrichDownstream": true` in the body.
- **Manual re-publish:** `POST /api/lead-factory/results/:jobId/publish` with `{ autoEnrichDownstream: true }`.
- **Engine doc:** [engines/lead-factory.md](engines/lead-factory.md).

### 4h. Company Intel / Person Intel

- **Routers:** `routes/company-intel.ts`, `routes/person-intel.ts`
- **Needs:** `PERPLEXITY_API_KEY`, `OPENAI_API_KEY`. `APOLLO_API_KEY` for Person Intel.
- **Tables:** `company_intel_research`, `prosengine_research` (shared with Person Intel).
- **Verify:** `POST /api/company-intel/profile` with `{ name, website? }`.

### 4i. SA Market — Tadawul + open data

- **Router:** `routes/sa-market.ts`
- **Needs:** `OPENAI_API_KEY` (for `POST /profile/generate`). Data sources (Wikidata, CMA) are public.
- **Tables:** `sa_market_shareholders`, `sa_market_executives`.
- **First-time bootstrap:** `POST /api/sa-market/refresh` pulls ~726 listed companies.

### 4j. OrcEngine — research orchestrator

- **Router:** `orcengine/routes.ts` · **Engine:** `orcengine/orchestrator.ts`
- **Needs:** `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`.
- **Tables:** `scrape_sessions`, `research_jobs`.
- **Verify:** `POST /api/orcengine/scrape` with `{ urls: ["https://example.sa"] }`.

### 4k. Smart Prospecting

- **Router:** `prospecting/routes.ts`
- **Needs:** `ANTHROPIC_API_KEY`.
- **Tables:** `prospecting_jobs`, `prospecting_sessions`, `prospecting_results`, `prospecting_exports`.
- **Note:** overlaps with Lead Factory — see [STATUS.md](STATUS.md) item 14.

### 4l. Network / Relationship Intelligence

- **Engine:** `lib/relationship-intel-engine.ts` · mounted via Lead Factory router
- **Needs:** Same as Lead Factory.
- **Tables:** `relationship_intel_jobs`.
- **Verify:** `POST /api/relationship-intel/start` with `{ targetCompanyName, targetWebsite? }`.

---

## 5. Connect Nexus (the LLM router)

Nexus is **already wired into the API server** — it lives at `lib/nexus/` and runs in-process. There is nothing separate to start. The waterfall it uses:

```
OpenRouter → DeepSeek V3 → Groq Llama → Mistral → Qwen
           → Gemini 2.5 Flash → Claude Sonnet → GPT-4o → Ollama
```

Each provider is tried in order; the first whose key is present **and** is reachable wins.

### Confirm Nexus is alive

```bash
curl http://localhost:3000/api/nexus/status
```

You should see a JSON payload with per-provider availability + cost model + session usage.

### Wire each engine through Nexus

| Engine | Already on Nexus? |
|---|---|
| Signals | ✅ |
| Lead Factory | ✅ |
| MeshBase enrichment | ✅ |
| Masaar | ⚠ partial — direct Anthropic call remains |
| OrcEngine | ⚠ partial |
| Company Intel | ⚠ partial |
| Person Intel | ⚠ partial |
| ProsEngine Chat | ❌ direct SDK (needs streaming — see Phase 5 in NEXUS_MIGRATION.md) |
| Masar | ❌ direct Anthropic |
| SA Market | ❌ direct OpenAI |
| Smart Prospecting | ❌ direct Anthropic |

The migration roadmap with per-file plans and recommended Nexus tier per call site is in [NEXUS_MIGRATION.md](NEXUS_MIGRATION.md).

### Nexus API surface

```typescript
import { nexusGenerate, nexusExtract, nexusSynthesize, nexusRealtime } from "../lib/nexus/index.js";

// Cheap field extraction (DeepSeek / Groq)
const fields = await nexusExtract(rawText, "Extract company name, phone, email as JSON");

// Final report writing (Gemini → Claude → GPT-4o)
const report = await nexusSynthesize(data, "Write a B2B intelligence report");

// Tiered general generation
const text = await nexusGenerate(prompt, { tier: "arabic" }); // or "cheap" | "reasoning" | "frontier"

// Latency-sensitive (Groq)
const reply = await nexusRealtime(prompt);
```

All return `{ text, model, provider, costUSD, tokensIn, tokensOut }`.

### Nexus session usage (cost dashboard)

```bash
curl http://localhost:3000/api/nexus/session/usage   # tally per-provider cost since boot
curl -X DELETE http://localhost:3000/api/nexus/session/usage  # reset counter
```

---

## 6. Start the services

### API server (dev)

```bash
pnpm --filter @workspace/api-server run dev
```

Boots on `PORT`. On startup it recovers stuck `lead_lists` jobs and runs `seed-companies` if `companies` is empty.

### Frontend

```bash
pnpm --filter @workspace/prospect-sa run dev
```

### Scout (optional, but needed for Signals + Lead Factory full functionality)

```bash
cd artifacts/python-scout
uv run uvicorn main:app --port 8099
```

---

## 7. Smoke test (end-to-end)

This sequence exercises every layer.

```bash
# 1. Liveness
curl http://localhost:3000/api/healthz
#  → { status: "ok" }

# 2. Nexus is reachable
curl http://localhost:3000/api/nexus/status | head

# 3. Scout is reachable (skip if not running Python service)
curl http://localhost:3000/api/scout/health

# 4. Seed bootstrap (idempotent)
pnpm --filter @workspace/scripts run seed-import

# 5. Companies + executives present
psql -d enrich -c "SELECT count(*) FROM companies; SELECT count(*) FROM executives;"

# 6. Run a Lead Factory job with downstream auto-enrichment
JOB=$(curl -s -X POST http://localhost:3000/api/lead-factory/start \
  -H 'Content-Type: application/json' \
  -d '{"inputMode":"segment","icpDescription":"fintech Riyadh","targetCount":10,"autoEnrichDownstream":true}' \
  | jq -r '.jobId')
echo "Lead Factory job: $JOB"

# 7. Watch the SSE stream
curl -N http://localhost:3000/api/lead-factory/stream/$JOB

# 8. After pipeline_complete, confirm bridge
psql -d enrich -c "SELECT count(*) FROM companies WHERE data_source = 'lead-factory';"

# 9. Confirm Signals were seeded (autoEnrichDownstream=true)
psql -d enrich -c "SELECT count(*) FROM company_signals WHERE timestamp > now() - interval '5 minutes';"

# 10. Confirm Relationship/Network Intel job
psql -d enrich -c "SELECT id, target_company_name, status FROM relationship_intel_jobs ORDER BY created_at DESC LIMIT 5;"
```

If every check passes, the app is fully wired.

---

## 8. Production deployment

Before deploying past local dev:

- [ ] Set `API_TOKEN` on the backend and `VITE_API_TOKEN` on the frontend (must match). Example: `openssl rand -hex 32`.
- [ ] Set `FRONTEND_ORIGIN` to your frontend URL (or comma-separated list) so CORS stops being permissive.
- [ ] Set `NODE_ENV=production`.
- [ ] Run `pnpm typecheck && pnpm build`.
- [ ] Build the frontend: `pnpm --filter @workspace/prospect-sa run build`.
- [ ] Serve the frontend bundle behind the same origin as the API (or set `FRONTEND_ORIGIN` in CORS).
- [ ] Provision external proxies and captcha keys if you'll be running Masaar or Masar at scale.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Server won't boot, throws "Invalid environment configuration" | Required env missing | Check the error — it lists exactly which vars failed Zod parse. See [ENV.md](ENV.md). |
| Scout endpoints 502 | Python service down or `SCOUT_URL` wrong | Start the Python service; verify with `curl $SCOUT_URL/healthz`. |
| Masaar captcha endpoints hang | No captcha solver key set | Add one of `CAPMONSTER_API_KEY`/`AZCAPTCHA_API_KEY`/`NOPECHA_API_KEY`. |
| Lead Factory job never completes | Perplexity rate limit or Apollo key invalid | Watch SSE stream; agent logs say which sub-call failed. |
| `companies` table empty after seed | JSON fixtures missing | Confirm `scripts/attached_assets/companies_*.json` exists. |
| Playwright errors (Chromium not found) | Wrong path / missing system libs | Set `CHROMIUM_EXECUTABLE_PATH` to the installed binary, or run `pnpm exec playwright install --with-deps chromium`. |
| `pnpm install` fails with "use pnpm" | A different package manager was tried | The `preinstall` hook enforces pnpm. Run `corepack enable && corepack prepare pnpm@latest --activate`. |
| Auto-downstream seeding never fires | `autoEnrichDownstream` not set | Pass `"autoEnrichDownstream": true` in the start body, or call `POST /api/lead-factory/results/:jobId/publish` after the fact. |

---

## 10. What's NOT wired (gaps to know about)

These are documented separately in [STATUS.md](STATUS.md). Summary:

- **Authentication** — every API is open. Don't deploy past localhost without fixing.
- **Frontend ↔ generated client** — frontend uses raw `fetch()` in 141+ places; types drift silently.
- **Streaming via Nexus** — ProsEngine chat still uses direct SDKs.
- **In-memory job state** — three job-emitter Maps can leak under sustained load.

For the migration plan, see [NEXUS_MIGRATION.md](NEXUS_MIGRATION.md). For the full punch list, see [STATUS.md](STATUS.md).

---

## 11. Data sources per tool

Every engine has a fixed registry of external sources it hits. This section lists them verbatim so you know what to whitelist on a corporate proxy, what to monitor for rate-limit issues, and which keys unlock which integrations.

### 11.1 Database Builder — 15 sources

Defined in `artifacts/api-server/src/lib/builder-engine.ts` (and helper modules). Approximate row counts come from a fresh harvest.

| id | Name | Endpoint | Category | ~Companies |
|---|---|---|---|---|
| `wikidata` | Wikidata SPARQL | `https://query.wikidata.org/sparql` | linked-data | 726 |
| `saudi-open-data` | Saudi Open Data (CKAN) | `https://data.gov.sa/api/3/action/package_search` | government | 2,000 |
| `ministry-commerce` | Ministry of Commerce | `https://mc.gov.sa` | government | 5,000 |
| `cma-financial` | CMA market data | `https://www.cma.org.sa` | financial | 350 |
| `tasi-listed` | Tadawul listed companies | `https://www.tadawul.com.sa` | financial | 250 |
| `yellow-pages-sa` | Saudi Yellow Pages | `https://www.yellowpages.com.sa` | directory | 8,000 |
| `daleel` | Daleel Business Directory | `https://www.daleel.sa` | directory | 3,000 |
| `kompass-sa` | Kompass Saudi Arabia | `https://sa.kompass.com` | directory | 2,500 |
| `franchises-sa` | Saudi Franchise Directory | `https://www.saudiFranchise.com` | directory | 500 |
| `bluepages` | Blue Pages Saudi Arabia | `https://www.bluepages.com.sa` | directory | 12,000 |
| `chamber-riyadh` | Riyadh CoC | `https://www.riyadhchamber.com` | chamber | 4,000 |
| `chamber-jeddah` | Jeddah CoC (JCCI) | `https://www.jcci.org.sa` | chamber | 3,500 |
| `chamber-eastern` | Eastern Province CoC | `https://www.chamber.org.sa` | chamber | 2,000 |
| `chamber-madinah` | Madinah CoC | `https://www.madina-chamber.org.sa` | chamber | 1,200 |
| `chamber-aseer` | Aseer CoC | `https://www.aseerchamber.org.sa` | chamber | 800 |

Plus user-added rows in the `builder_custom_sources` table — register more with `POST /api/builder/sources`.

### 11.2 Masaar — 7-agent CR pipeline

Defined in `artifacts/api-server/src/lib/masaar-engine.ts`.

| Agent | Phase | Source | Extracts |
|---|---|---|---|
| 1a | CR fetch (stealth) | `https://mc.gov.sa/ar/eservices/Pages/Commercial-data.aspx` | CR number, names, capital, legal form, HQ |
| 1b | CR intelligence (fallback) | Perplexity API | Same fields when MC.gov is blocked |
| 2 | AOA intelligence | `https://emagazine.aamaly.sa/search` | Articles-of-Association PDFs (Crawl4AI + OCR) |
| 3 | Deep research | Perplexity × 5 + Gemini × 4 | Executives, shareholders, history |
| 4 | Compliance + sanctions | OFAC SDN, UN SC, CMA, SAMA, ZATCA, Maroof | Sanctions hits, risk class |
| 4 | Government cross-check | Najiz API | Legal-agency filings |
| 5 | Bilingual report writer | Claude (Nexus `synthesize`) + GPT-4o | AR + EN final report |

Network requirements: outbound HTTPS to all of `mc.gov.sa`, `emagazine.aamaly.sa`, `*.perplexity.ai`, `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openai.com`. Captcha solver active (`CAPMONSTER_API_KEY` etc.) for agent 1a.

### 11.3 Masar — Wathq registry harvester

Defined in `artifacts/api-server/src/lib/masar-harvester.ts`.

| Source | Endpoint | What it pulls |
|---|---|---|
| Saudi Open Data | `https://data.gov.sa/api/3/action/package_search` | CR records, activities, capital |
| Aamaly e-magazine | `https://emagazine.aamaly.sa/search` | AOA PDFs (Crawl4AI parse) |
| OpenCorporates | `https://api.opencorporates.com/v0.4/companies/search` (filter `jurisdiction_code=sa`) | CR numbers, registration dates |
| GLEIF | `https://api.gleif.org/api/v1/lei-records` | Legal Entity Identifiers |
| Wikidata SPARQL | `https://query.wikidata.org/sparql` | Founding year, HQ, sector, headcount |

### 11.4 Lead Factory — Agent 2 harvester (40+ sources)

Defined in `artifacts/api-server/src/lib/lead-factory-engine.ts` Agent 2 + helper modules (`free-sources.ts`, scrapers).

**Corporate registries**
- Wikidata SPARQL · OpenCorporates · GLEIF · `data.gov.sa` CKAN

**Business directories**
- Blue Pages (JSON API) · Yellow Pages SA · Daleel · Kompass SA

**Chambers of Commerce**
- Riyadh · Jeddah · Eastern Province · Madinah · Aseer

**Listed-company enrichment**
- Tadawul · Argaam · CMA disclosures (revenue, ISIN, sector)

**Contact discovery**
- Hunter.io (`HUNTER_API_KEY` — email patterns)
- Apollo.io (`APOLLO_API_KEY` — contact DB)
- Clearbit logo API (free tier)
- GitHub Org API (tech-hiring signals)
- Wappalyzer (`WAPPALYZER_API_KEY` — tech fingerprint)

**Web fallback**
- Perplexity sector prompts
- Nexus multi-model synthesis when JS rendering is needed

### 11.5 Signals — news + risk feeds

Defined in `artifacts/api-server/src/lib/signal-engine.ts` and `lib/signal-monitor.ts`.

| Feed | URL | Language |
|---|---|---|
| Google News RSS (AR) | `news.google.com/rss/search?q={q}&hl=ar&gl=SA&ceid=SA:ar` | AR |
| Google News RSS (EN) | `news.google.com/rss/search?q={q}&hl=en&gl=SA&ceid=SA:en` | EN |
| Arab News | `arabnews.com/rss.xml` | EN |
| Saudi Gazette | `saudigazette.com.sa/rss` | EN |
| Argaam | `argaam.com/ar/article/rss` | AR |
| Mubasher | `mubasher.info/feed` | AR |
| Al Eqtisadiah | `aleqt.com/rss` | AR |
| Maal | `maal.net/feed` | AR |
| CNBC Arabia | `cnbcarabia.com/rss` | AR |
| Al Arabiya Business | `alarabiya.net/aswaq.rss` | AR |
| OFAC SDN list | sanctions feed via Scout | EN |
| UN Security Council list | sanctions feed via Scout | EN |
| Etimad procurement | scraped via Scout | AR |

Classification: DeepSeek via Nexus (~$0.00001 per article).

### 11.6 SA Market — Tadawul + open data

Defined in `artifacts/api-server/src/routes/sa-market.ts`.

| Source | Coverage |
|---|---|
| Tadawul (TASI) + Nomu | ~350 listed companies |
| CMA disclosures | shareholder ownership %, board, executives |
| Wikidata SPARQL | enrichment (founding, employees) |
| Saudi Open Data (CKAN) | gov-published shareholder + board datasets |

### 11.7 Scout (Python OSINT)

Defined under `artifacts/python-scout/src/`.

| Capability | Mechanism / Sources |
|---|---|
| Social discovery (Sherlock-style) | 15 platforms: Twitter/X, Instagram, LinkedIn, Facebook, YouTube, TikTok, Snapchat, GitHub, GitLab, Medium, Behance, Pinterest, SoundCloud, Twitch, Reddit |
| Subdomain enumeration | Certificate Transparency via `crt.sh`, DNS brute force |
| WHOIS / DNS | `python-whois`, `dnspython` |
| Email discovery | Hunter.io (optional) + pattern permutation fallback |
| Site intelligence | Playwright (JS render) + BeautifulSoup parsing |
| Tech stack detect | Wappalyzer signatures (local) |
| AI extraction | Gemini 2.5 Flash (ScrapeGraphAI pattern) |

### Network/firewall summary

If you operate behind a corporate proxy, whitelist these domains to enable the full set:

```
*.wikidata.org              query.wikidata.org
*.gov.sa                    data.gov.sa  mc.gov.sa  cma.org.sa  sama.gov.sa
*.tadawul.com.sa            *.argaam.com  *.mubasher.info  *.aleqt.com
*.opencorporates.com        api.gleif.org
*.aamaly.sa
*.perplexity.ai             api.anthropic.com  api.openai.com
generativelanguage.googleapis.com   api.groq.com   openrouter.ai
api.apollo.io               api.hunter.io   api.clearbit.com   api.wappalyzer.com
crt.sh                      news.google.com
arabnews.com  saudigazette.com.sa  cnbcarabia.com  alarabiya.net  maal.net  saudifranchise.com
*.yellowpages.com.sa  *.daleel.sa  sa.kompass.com  *.bluepages.com.sa
*.riyadhchamber.com  *.jcci.org.sa  *.chamber.org.sa  *.madina-chamber.org.sa  *.aseerchamber.org.sa
```

Plus your chosen proxy + captcha-solver providers' endpoints.

