# Deployment Readiness Checklist

This is a **pre-flight checklist for the operator**, not a guarantee. Some checks can only be verified against a running deployment with real keys.

## 1. Secrets — rotate before any public deploy

**⚠️ `.env` is committed to this repo with live-looking API keys** (Anthropic, OpenAI, Perplexity, Gemini, Apollo, HuggingFace, Tavily, Explorium, Manus). Before going public:

```bash
# 1. Rotate every key in .env at the respective provider dashboards.
# 2. Strip .env from git history:
git rm --cached .env
echo ".env" >> .gitignore
# 3. Commit, then BFG / git-filter-repo to purge history if the repo is or will be public.
# 4. Ship .env.docker as the template; operators copy to .env locally.
```

## 2. Required env (minimum to boot)

| Var | Why |
|---|---|
| `DATABASE_URL` | Postgres 16 connection. |
| `PORT` | API port (no default — must be set). |
| `API_TOKEN` | Bearer token gate. **Never leave unset in prod.** Generate with `openssl rand -hex 32`. |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins. |

## 3. Recommended env

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | At least one LLM provider — Nexus needs one to function. |
| `OPENROUTER_API_KEY` + `NEXUS_PREFER_FREE_MODELS=true` | Routes the LLM waterfall through OpenRouter `:free` first. Zero LLM cost (rate-limited). |
| `TAVILY_API_KEY` | Preferred free-search backend. Free dev tier = 1000 queries/month. |
| `SEARXNG_URL` | Free-search secondary; falls back to Google HTML scrape if neither set. |
| `SCOUT_URL` | Default `http://localhost:8099`. Set if Scout runs on a different host. |
| `SHUTDOWN_GRACE_MS` | Default 15000. Tune for your load balancer. |

## 4. Deploy

```bash
cp .env.docker .env       # then edit
docker compose up --build # first run (5–10 min)
docker compose up -d      # daily
```

### Smoke tests after first boot

```bash
curl http://localhost:3000/api/healthz                           # {"status":"ok"}
curl http://localhost:3000/api/readyz                            # {"status":"ok"} = DB connected
curl -H "Authorization: Bearer $API_TOKEN" \
     http://localhost:3000/api/lead-factory/jobs                 # 200 with jobs:[]

# Optional, full path with real keys:
curl -XPOST -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inputMode":"segment","mode":"company","icpDescription":"SaaS Riyadh 50-200","targetCount":5}' \
     http://localhost:3000/api/lead-factory/start
# Then GET /api/lead-factory/stream/:jobId from EventSource to watch agents 1-7.
```

## 5. Per-engine readiness

| Engine | Required keys | Status |
|---|---|---|
| **Lead Factory** | LLM key + (Tavily or Perplexity) | ✅ 100% Nexus-routed; Agent 5 + active validator enabled |
| **Signals** | LLM key | ✅ Multi-source (Scout + Google News RSS); SSE feed live |
| **Relationship Intel** | LLM key | ✅ Tree + side panel + actions |
| **Scout (Python)** | None for boot; provider keys for deep features | ✅ Sidecar in docker-compose |
| **Masaar** (CR lookup) | LLM key + captcha solver | ⚠ Captcha solver key required for mc.gov.sa |
| **Masar** (Wathq) | LLM key | ✅ Cross-references Wathq + Open Data + Amaaly |
| **Database Builder** | LLM key | ✅ |
| **OrcEngine** | LLM key | ✅ Including new `POST /api/orcengine/deep-research` |
| **Company Intel / Person Intel** | LLM key | ✅ Reports render via shared `<IntelReport>` |
| **SA Market** | LLM key | ✅ |
| **MeshBase** | None for boot | ✅ Auto-seeds on first run |

## 6. Frontend pages — quick sanity

After deploy, open each in a browser:

| URL | Expect |
|---|---|
| `/` | Dashboard renders with stats |
| `/lead-factory` | Hub page; "Recent jobs" loads |
| `/lead-factory/person` | Person filter panel renders |
| `/lead-factory/company` | Company filter panel renders |
| `/lead-factory/results?jobId=X` | Result table + export buttons |
| `/signal-intelligence` | List view |
| `/signal-intelligence/tree` | Tree view; "live SSE feed" pulse on new signal |
| `/relationship-intel` | List view |
| `/relationship-intel/tree?jobId=X` | Org chart + adjacency + outreach |
| `/orcengine`, `/masaar`, `/prospecting/...` | Engine UIs |

## 7. Known deferred items (track for follow-up PRs)

1. **LangGraph migration** — plan in `docs/specs/langgraph-migration-plan.md`. Needs `@langchain/langgraph` + `pnpm-lock.yaml` regen in a dedicated PR.
2. ~~**Masaar engine Nexus migration**~~ — **Re-audited:** the 9 "direct" calls in `masaar-engine.ts` are mostly intentional multi-provider parallel fan-out (`Promise.allSettled([Claude, GPT-4o, OpenRouter DeepSeek/Llama/Kimi, Groq, …])`). Collapsing to Nexus would lose the parallelism. Only a handful of standalone calls are real migration candidates; flagged in code but not blocking.
3. **Force-directed network graph** for relationship-intel — currently a sidebar list. Needs `react-flow` / `reactflow` dep in a dedicated lockfile-regen PR.
4. ~~**Saved searches, bulk multi-row actions, column reordering**~~ — **Bulk multi-row actions: SHIPPED** in `/lead-factory/results` (`POST /api/lead-factory/results/:jobId/bulk-action`, `publish` + `reject`). Saved searches + column reordering still deferred (saved searches needs a new schema table).
5. ~~**Generic PDF export**~~ — **SHIPPED.** `POST /api/lead-factory/results/:jobId/export?format=pdf` uses `pdfkit` (already installed). One-page-per-Tier-A-prospect (cap 40) + cover stats.
6. **A11y audit** of new Signals tree, Lead Factory results, Relationship Intel tree.

## 8. What only YOU can verify

This checklist can't substitute for an operator running each happy-path with their own keys. Specifically:

- Apollo / Hunter / Explorium contact resolution — needs valid paid keys.
- Captcha-gated harvesters (Masaar mc.gov.sa) — needs captcha-solver balance.
- LLM cost — even with `NEXUS_PREFER_FREE_MODELS=true` you should watch the first 24 hours' provider dashboards to confirm zero unexpected spend.
- Cloudflare Tunnel binding for the public URL.

Once these pass: the app is **ready to deploy as a beta**. Production hardening (tests, structured logging, rate limits) is tracked separately in `docs/STATUS.md`.
