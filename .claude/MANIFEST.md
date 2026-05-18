# Session Changes — 2026-05-18

This folder is a snapshot of every file created or edited in the AI assistance session against the **Replit Enrich app** project at:

```
C:\Users\sgied\OneDrive\Desktop\Nexflow\Enrichment engine\Replit Enrich app
```

All paths in this folder mirror the project's structure — drop the contents back at that root if you want to apply them on top of a stale checkout.

**47 files total**: 14 new docs + 5 new code files + 28 edited files.

---

## How to use this bundle

**Read first:** `docs\OPERATOR_GUIDE.md` (full wiring instructions), then `docs\STATUS.md` (what's done, what's left).

**Apply to the project:** Copy the contents of this folder into the project root, overwriting existing files. Then:

```
pnpm install
pnpm --filter @workspace/db run db:push    # apply new FK constraints
pnpm typecheck                              # confirm nothing broke
```

**Production-only env vars added this session:**

```
API_TOKEN=<openssl rand -hex 32>      # backend
FRONTEND_ORIGIN=https://your-frontend  # backend
VITE_API_TOKEN=<same as API_TOKEN>     # frontend (artifacts/prospect-sa/.env.local)
SHUTDOWN_GRACE_MS=15000                # optional, default shown
```

---

## File inventory

### Docs (14 files)

**Root:**
- `README.md` — project entry point + doc index
- `NEXUS_ENGINE.md` — Nexus reference (unchanged, included for context)
- `DATABASEBUILDER_FEATURE_DOC.md` — Builder reference (unchanged, included for context)

**`docs/` (new this session):**
- `OPERATOR_GUIDE.md` — the big one: setup, env, seeds, per-engine wiring, Nexus, smoke tests, data-source registry per tool, firewall whitelist
- `STATUS.md` — what works, what's left, what shipped, what's deferred
- `SETUP.md` — install / run / seed commands
- `ENV.md` — every env var (LLM, scraping, captcha, auth, shutdown, frontend)
- `ARCHITECTURE.md` — monorepo layout, runtime topology, engine map
- `API.md` — all 18 routers, auth, cancel endpoints
- `DATABASE.md` — Drizzle schema reference, FK map
- `NEXUS_MIGRATION.md` — per-file plan to route LLM calls through Nexus
- `DOC_AUDIT.md` — keep/merge/delete recommendations for legacy `docs/docs/` files

**`docs/engines/` (new this session):**
- `orcengine.md`, `scout.md`, `signals.md`, `lead-factory.md`, `company-intel.md`, `person-intel.md`, `sa-market.md`

### NEW code files (5)

| Path | Purpose |
|---|---|
| `artifacts/artifacts/api-server/src/lib/config/env.ts` | Zod-validated env config singleton — read `env.openaiKey`, `env.API_TOKEN`, etc. |
| `artifacts/artifacts/api-server/src/lib/middleware/auth.ts` | Bearer-token middleware. No-op when `API_TOKEN` unset (dev mode). |
| `artifacts/artifacts/api-server/src/lib/lifecycle.ts` | Process state singleton for graceful shutdown |
| `artifacts/artifacts/api-server/src/lib/job-registry.ts` | Bounded LRU emitter registry + AbortController per job |
| `artifacts/artifacts/api-server/src/lib/sse.ts` | `pipeEmitterToSse` helper — guarantees terminal events, heartbeat, listener cleanup |

### EDITED code files (28)

**Backend entry / wiring:**
- `artifacts/artifacts/api-server/src/app.ts` — CORS lockdown + auth middleware mount
- `artifacts/artifacts/api-server/src/index.ts` — SIGTERM/SIGINT graceful shutdown
- `artifacts/artifacts/api-server/src/routes/health.ts` — `/healthz` shutdown 503 + new `/readyz`

**Routes:**
- `artifacts/artifacts/api-server/src/routes/lead-factory.ts` — `/publish` endpoint, 3 cancel endpoints, SSE migration, brief Zod validation, doomed-job logging
- `artifacts/artifacts/api-server/src/routes/masar-database.ts` — cancel endpoint
- `artifacts/artifacts/api-server/src/routes/sa-market.ts` — Nexus migration (`nexusSynthesize` replaces `new OpenAI()`)

**Libs / engines:**
- `artifacts/artifacts/api-server/src/lib/openai.ts` — reads from `env.openaiKey`
- `artifacts/artifacts/api-server/src/lib/anthropic-service.ts` — reads from `env.anthropicKey` + model upgrade
- `artifacts/artifacts/api-server/src/lib/scout-client.ts` — reads `env.SCOUT_URL`
- `artifacts/artifacts/api-server/src/lib/lead-factory-engine.ts` — companies/executives bridge, `autoEnrichDownstream` flag, `publishExistingResults`, `leadFactoryBriefSchema`, `cancelLeadFactoryJob`, `JobRegistry`
- `artifacts/artifacts/api-server/src/lib/signal-monitor.ts` — `JobRegistry`, `cancelSignalJob`
- `artifacts/artifacts/api-server/src/lib/relationship-intel-engine.ts` — `JobRegistry`, `cancelRelationshipIntelJob`
- `artifacts/artifacts/api-server/src/lib/masar-harvester.ts` — `JobRegistry.attach()`, `cancelHarvestJob`, model upgrade

**Other engines:**
- `artifacts/artifacts/api-server/src/orcengine/prospecting-engine.ts` — Nexus migration; `_callClaudeJson` routes 7 call sites through `nexusExtract`
- `artifacts/artifacts/api-server/src/mass-harvest.ts` — Claude model string upgrade
- `artifacts/artifacts/api-server/src/mass-harvest-fast.ts` — same
- `artifacts/artifacts/api-server/src/prospecting/engine.ts` — same

**Frontend:**
- `artifacts/artifacts/prospect-sa/src/main.tsx` — calls `setAuthToken(import.meta.env.VITE_API_TOKEN)` on bootstrap

**Shared lib (`lib/lib/`):**
- `lib/lib/api-client-react/src/custom-fetch.ts` — added `setAuthToken()`, `getAuthToken()`; bearer header injection
- `lib/lib/api-client-react/src/index.ts` — re-exports `setAuthToken`, `getAuthToken`
- `lib/lib/db/src/schema/lead_factory.ts` — FK constraints (`jobId` cascade, `publishedLeadId`/`publishedCompanyId` set-null)
- `lib/lib/db/src/schema/prospecting_results.ts` — `jobId` cascade FK
- `lib/lib/db/src/schema/builder_companies.ts` — TODO comment for type-mismatch FK (no constraint added)

---

## Summary of behavioral changes

| Capability | Before | After |
|---|---|---|
| API auth | None — open to internet | Bearer token via `API_TOKEN` (exempts `/healthz`, `/readyz`) |
| CORS | `*` | Origin list from `FRONTEND_ORIGIN` |
| Graceful shutdown | None — kills mid-flight jobs | SIGTERM/SIGINT with `SHUTDOWN_GRACE_MS` drain |
| Health check | `{status:"ok"}` always | `/healthz` flips to 503 during shutdown; `/readyz` runs `SELECT 1` |
| Job registries | Unbounded Maps | LRU-capped (200/100/100/50) + AbortController per job |
| SSE error handling | Silent — clients hang on engine throw | Always terminal `stream_end` or `stream_error`; heartbeats; listener cleanup |
| Lead Factory results → unified pool | Stayed in `lead_factory_results` only | A/B-tier leads now upserted into `companies` + `executives` |
| Lead Factory → Signals + Network Intel | Manual only | Auto via `autoEnrichDownstream: true` flag, or manual `POST /publish` |
| Job cancellation | Builder only | Lead Factory, Relationship Intel, Signals, Masar Harvest |
| FK constraints | None on most cross-table IDs | `lead_factory_results.*` and `prospecting_results.jobId` properly referenced |
| Brief validation | Crashed in background after 200 OK | Zod-validated at the route → 400 + `issues`; pipeline crashes log to `errorMessage` |
| Claude model strings | `claude-3-5-sonnet-20241022` / `claude-sonnet-4-20250514` | `claude-sonnet-4-6` (4 files) |
| Nexus coverage | 3 engines routed | 5 engines fully + 8 more call sites via `_callClaudeJson` chokepoint |
| Frontend auth | No header sent | `Authorization: Bearer ${VITE_API_TOKEN}` auto-injected by generated client |

---

## Explicitly NOT changed (deferred — see `docs/STATUS.md` "Explicitly deferred")

- Frontend page-by-page migration off raw `fetch()` (141 sites)
- Vitest/Jest test suite
- 68+ silent `.catch(() => {})` audit
- Nexus migration Phases 2–5 (masaar-engine, prosengine-chat streaming, etc.)
- `builder_companies.job_id` FK (type-mismatch needs migration)
- Pipeline-internal AbortSignal polling (cancel endpoints work; agents don't poll yet)
