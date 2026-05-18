# Status & Path to 100% Functional

## What works today

- Express API server boots, ~150 endpoints across 18 routers respond.
- PostgreSQL schema (Drizzle) is complete and seeds via `seed-import` + `seed-meshbase`.
- React/Vite frontend renders all pages and consumes the API.
- 3 engines fully on Nexus: **Signals**, **Lead Factory**, **MeshBase enrichment**.
- Lead Factory now bridges into the unified `companies` + `executives` pool (Agent 7).
- Lead Factory can auto-trigger Signals + Relationship/Network Intel via `autoEnrichDownstream` flag.
- Manual re-publish endpoint: `POST /api/lead-factory/results/:jobId/publish`.
- Centralized env config via `lib/config/env.ts`.
- All 4 outdated Claude model strings updated to `claude-sonnet-4-6`.

## What's needed for 100% functional

Ordered by blast radius. Each item carries a rough effort estimate.

### Blocker tier — must-have before any deploy beyond local dev

1. **Authentication on the API** — ✅ DONE.
   `authRequired` middleware in `lib/middleware/auth.ts`. Reads `API_TOKEN` from env. Exempts `/api/healthz` and `/api/readyz`. If `API_TOKEN` is unset, logs a warning and allows requests (dev only).

2. **Lock down CORS** — ✅ DONE.
   `app.ts` now reads `FRONTEND_ORIGIN` (single value or comma-separated). Unset = `*` with a startup warning.

3. **Bound the in-memory job registries** — ✅ DONE.
   New `lib/job-registry.ts` provides a single `JobRegistry` class with `maxEntries` cap and oldest-first eviction. Adopted by `lead-factory-engine.ts`, `signal-monitor.ts`, `relationship-intel-engine.ts`, `masar-harvester.ts`. Caps: 200 (lead factory) / 100 (signal, relationship) / 50 (masar).

4. **Graceful shutdown** — ✅ DONE.
   `index.ts` handles SIGTERM/SIGINT, flips `/healthz` to 503 via `lib/lifecycle.ts`, calls `server.close()` with a `SHUTDOWN_GRACE_MS` cap (default 15s), and exits cleanly. A second signal forces immediate exit.

5. **Deepen the health check** — ✅ DONE.
   `/healthz` now returns 503 during shutdown. New `/readyz` runs `SELECT 1` and returns 503 if the DB is unreachable. Both exempt from auth.

### Correctness tier — silent failures + broken contracts

6. **FK constraints on cross-table IDs** — ✅ DONE (mostly).
   `lead_factory_results.jobId` → cascade; `publishedLeadId`, `publishedCompanyId` → set null. `prospecting_results.jobId` → cascade. **Blocked:** `builder_companies.job_id` is `text` while `builder_jobs.id` is `serial` — type mismatch; add a follow-up migration that picks the canonical key (either change `builder_companies.job_id` to int + join, or join via `builder_jobs.legacy_job_id`). TODO comment left in `lib/db/src/schema/builder_companies.ts`.

7. **Surface SSE errors to the client** — ✅ DONE.
   New `lib/sse.ts` exposes `pipeEmitterToSse(req, res, emitter)`. Wraps `res.write` in try/catch, emits `{ type: "stream_error", message }` on `emitter.emit("error", ...)`, ships a periodic heartbeat, cleans up listeners on client disconnect. Lead Factory, Relationship Intel, and Signals stream routes adopted it.

8. **Stop returning 200 from `lead-factory/start` when the job will fail** — ✅ DONE.
   Brief is now Zod-validated via `leadFactoryBriefSchema` at the route boundary; bad requests get 400 + `issues`. Pipeline crashes after that point are written to `lead_factory_jobs.errorMessage` so polling clients see the failure.

9. **Audit `Promise.allSettled` + `catch(() => {})` usage** (~2 h)
   68+ instances swallow rejections. For each: either log+emit, or convert to `Promise.all` if rejection should kill the job.

### Functional tier — features the user expects to work but don't

10. **Frontend → generated React Query client** — ⚠ PARTIAL.
   The generated client (`@workspace/api-client-react`) now auto-attaches the bearer token via `setAuthToken()` (called from `prospect-sa/src/main.tsx` reading `VITE_API_TOKEN`). 141+ raw `fetch()` calls across the pages still need to migrate to the generated React Query hooks for type-safe caching/revalidation. Regenerate OpenAPI spec first (`orval`).

11. **`autoEnrichDownstream` UI toggle** (~30 min)
   The flag is wired in the engine and route. Add a checkbox to the Lead Factory wizard so users can enable per-run downstream seeding.

12. **Nexus migration phases 1–4** (~1–2 days)
    Catalogued in [NEXUS_MIGRATION.md](NEXUS_MIGRATION.md). Migrate `sa-market`, `masar`, `masaar`, `orcengine`, `company-intel`, `person-intel` off direct SDK calls. Phase 5 (chat streaming) is blocked on Nexus growing a `nexusStream`.

### Quality tier — won't block launch but compounds tech debt

13. **Centralize normalizers** (~1 h) — three copies of phone/domain normalizers across `lead-factory-engine.ts`, `harvest-2k-push.ts`, `builder-engine.ts`. Move to `lib/utils/normalize.ts`.
14. **Fix `withTimezone: true` on `builder_custom_sources` + `masar_custom_sources` timestamps** (~5 min + migration).
15. **Replace sync `fs` reads in request paths** (`browser-helper.ts`, `crawl4ai-engine.ts`) (~30 min).
16. **Disambiguate `prospecting_*` vs `lead_factory_*` tables** — pick canonical, deprecate the other.

### Operational tier — observability + hardening (newly identified)

17. **No tests exist anywhere** (~2 days for a useful baseline) — zero `*.test.ts`/`*.spec.ts` files, no vitest/jest config. Even smoke tests for the bridge logic, auth middleware, and the Lead Factory pipeline orchestrator would catch most regressions.

18. **Job cancellation** — ✅ MOSTLY DONE.
   `JobRegistry` now mints an `AbortController` per job and exposes `cancel(jobId)`. Cancel endpoints added for Lead Factory, Relationship Intel, Signal Monitor, Masar Harvest. Engines emit a final `{ type: "cancelled" }` SSE event then `done`. **Caveat:** engine internals do not yet poll `getSignal()` between agents — calling cancel will end the SSE stream immediately, but the pipeline may keep running until the next natural breakpoint. Adding `if (signal.aborted) return` checks inside each agent is a small follow-up.

19. **Structured logging** (~2 h) — switch from `console.log` to `pino` with a request-ID middleware. Required for any log aggregator.

20. **Rate limiting** (~1 h) — add `express-rate-limit` on POST endpoints that trigger LLM/Perplexity calls. Combined with auth (#1 done), prevents one bad client from draining the budget.

21. **Cost guardrail on Nexus** (~2 h) — `getSessionUsage()` tracks spend but there's no hard cap. Add a per-job budget that aborts when exceeded.

## Definition of "100% functional"

The system is 100% functional when:

- [ ] No endpoint runs without auth.
- [ ] Every engine routes LLM calls through Nexus (or has a documented reason not to).
- [ ] The frontend uses the generated client; types drift = build failure.
- [ ] Job state is durable across process restart (not just in-memory).
- [ ] FK + cascade rules prevent orphan rows.
- [ ] SSE clients always receive a terminal event (success or error).
- [ ] Every seed/migration runs idempotently from a clean DB.
- [ ] `pnpm typecheck && pnpm build` is green.

Estimated total effort across blocker + correctness + functional tiers: **~5–7 engineering days**.
Add the operational tier (16–20) and total goes to **~7–9 engineering days**.

## Explicitly deferred (cannot be done safely in a single automated pass)

These remain open because they require per-page / per-call-site review with verification I can't run remotely:

- **Frontend ↔ generated client migration** (item 8). 141+ raw `fetch()` calls. Each page needs to swap to the corresponding generated React Query hook and have its state, error UI, and loading shells re-tested. Best done page-by-page in interactive sessions where the dev server is running.
- **Smoke test suite** (item 16). A useful baseline needs vitest config, a test DB, mocks for Perplexity/Apollo/Hunter, and per-engine fixture data. Not safe to scaffold without iteration on real failures.
- **`Promise.allSettled` / silent-catch audit** (item 9). 68+ sites; each needs case-by-case judgment (some legitimately want best-effort, others hide real failures). Mechanical sweep would introduce regressions.
- **Nexus migration Phases 2–5**. `masaar-engine.ts` has 10+ direct SDK call sites and mixes JSON-mode + text streaming; `prosengine-chat.ts` requires Nexus to grow streaming support first (Phase 5).
- **`builder_companies.job_id` FK** — schema-level type mismatch needs a data migration decision before adding the constraint.
- **Cancellation deep-wiring** — the cancel endpoints exist and break the SSE stream, but pipeline internals don't yet poll the `AbortSignal` between agents. Adding `if (registry.getSignal(jobId)?.aborted) return` inside each agent is small but every-call-site work.

## Recently shipped

- Auth middleware (`lib/middleware/auth.ts`) — bearer token via `API_TOKEN`.
- CORS lockdown (`app.ts`) — origin-list via `FRONTEND_ORIGIN`.
- Graceful shutdown (`index.ts` + `lib/lifecycle.ts`) — SIGTERM/SIGINT with `SHUTDOWN_GRACE_MS` drain window.
- Deeper health: `/healthz` flips to 503 during shutdown; new `/readyz` pings the DB.
- Bounded job registries (`lib/job-registry.ts`) — LRU cap, AbortController per job, replaces 4 ad-hoc Maps.
- SSE helper (`lib/sse.ts`) — `pipeEmitterToSse` guarantees terminal `stream_end` / `stream_error`, heartbeat, listener cleanup.
- Frontend auth wiring — `lib/api-client-react` exports `setAuthToken`; `prospect-sa/src/main.tsx` reads `VITE_API_TOKEN`.
- FK constraints: `lead_factory_results` (job → cascade; company/lead → set null), `prospecting_results.jobId` → cascade.
- Request-time brief validation: `leadFactoryBriefSchema` rejects malformed bodies at the route, and pipeline crashes now write to `lead_factory_jobs.errorMessage`.
- Job cancellation: `POST /api/<engine>/jobs/:jobId/cancel` for Lead Factory, Relationship Intel, Signal Monitor, Masar Harvest.
- Nexus migration (Phase 1, partial): `orcengine/prospecting-engine.ts` `_callClaudeJson` now routes through `nexusExtract` (7 call sites auto-migrated). `routes/sa-market.ts` `/profile/generate` now uses `nexusSynthesize`. Removed direct OpenAI/Anthropic SDK instantiations in those files.
