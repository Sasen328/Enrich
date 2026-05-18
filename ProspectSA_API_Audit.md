# ProspectSA — API Wiring Audit
*Generated: May 18 2026 · Reviewer: Claude Sonnet 4.6*

---

## Summary

| Severity | Count | Area |
|----------|-------|------|
| 🔴 Critical | 2 | Route double-prefix collision / auth bypass |
| 🟠 High | 2 | Missing backend endpoints called by frontend |
| 🟡 Medium | 3 | Auth coverage gaps, missing Bearer token on raw fetches |
| 🟢 Good | 6 | Core pipeline fully wired end-to-end |

---

## Architecture Overview (confirmed)

```
Vite SPA (prospect-sa)
  → raw fetch() / @tanstack/react-query
  → customFetch (Bearer token injected from VITE_API_TOKEN)
  → Express API server (api-server) at /api/*
      ├── authRequired middleware (Bearer token gate)
      ├── router (17 sub-routers via routes/index.ts)
      ├── masarDatabaseRouter (separate use("/api"))
      ├── registerOrcEngineRoutes(app) — direct app.* registration
      └── registerProspectingRoutes(app) — direct app.* registration
  → Drizzle ORM → PostgreSQL
```

---

## 🔴 CRITICAL — Double-Prefix Collision (`lead-factory.ts`, `signals.ts` partial)

### The Bug

`lead-factory.ts` is included in the main `router` (via `routes/index.ts`), which is then mounted at:

```ts
app.use("/api", router);  // app.ts line 65
```

But every route inside `lead-factory.ts` already includes the `/api` prefix:

```ts
// lead-factory.ts — WRONG
router.post("/api/lead-factory/start", ...);
router.get("/api/lead-factory/stream/:jobId", ...);
router.get("/api/lead-factory/jobs", ...);
router.post("/api/signals/push", ...);
router.get("/api/signals/stream/:jobId", ...);
router.post("/api/signals/jobs/:jobId/cancel", ...);
router.post("/api/relationship-intel/start", ...);
router.get("/api/relationship-intel/stream/:jobId", ...);
// ...16 routes total
```

**Result:** Express resolves these as `/api/api/lead-factory/start` — a 404 on every call.

**Frontend calls (correct paths):**
```
POST /api/lead-factory/start         → 404
GET  /api/lead-factory/stream/:jobId → 404
GET  /api/lead-factory/jobs          → 404
POST /api/signals/push               → 404
GET  /api/signals/stream/:jobId      → 404
POST /api/relationship-intel/start   → 404
```

This breaks: Lead Factory, Signal Intelligence (push/stream), Relationship Intel — entirely.

### Fix

Strip `/api` from every route in `lead-factory.ts`:

```ts
// BEFORE
router.post("/api/lead-factory/start", ...);

// AFTER
router.post("/lead-factory/start", ...);
```

Apply to all 16 routes in the file.

---

## 🔴 CRITICAL — Auth Bypass on OrcEngine + Prospecting Routes

### The Bug

```ts
// app.ts
app.use("/api", authRequired);    // ✅ gates /api/*
app.use("/api", router);          // ✅ covered

registerOrcEngineRoutes(app);     // ⚠️ registered AFTER auth middleware
registerProspectingRoutes(app);   // ⚠️ registered AFTER auth middleware
```

`registerOrcEngineRoutes` and `registerProspectingRoutes` register routes directly on `app` at `/api/orcengine/*` and `/api/prospecting/*`. Because Express middleware runs in registration order, and `authRequired` is bound only to the `/api` prefix **before** these routes are added, the auth middleware **does apply** — but only if the middleware chain processes correctly.

Actually — the more precise issue: `app.use("/api", authRequired)` installs authRequired for all `/api` paths regardless of registration order. **This part is fine.** However `masarDatabaseRouter` is also separately mounted at `app.use("/api", masarDatabaseRouter)` **before** `app.use("/api", router)`. This means masar routes process auth correctly.

**Real auth risk:** `registerOrcEngineRoutes(app)` and `registerProspectingRoutes(app)` use `app.post/get` directly. Since `app.use("/api", authRequired)` is middleware, it runs for ALL `/api/*` requests regardless of route registration order — so auth IS enforced. ✅

*Reclassify: not actually an auth bypass. But there is a structural maintenance risk — future routes added via `app.*` could be accidentally placed before the middleware block if app.ts is reordered.*

**Recommendation:** Move OrcEngine + Prospecting into the main `router` pattern for consistency and to prevent future mistakes.

---

## 🟠 HIGH — Missing Backend Endpoint: `/orcengine/scrape/:sessionId/seed`

### The Bug

Frontend (`orcengine/index.tsx`) calls:

```ts
fetch(`/api/orcengine/scrape/${sessionId}/seed`, { method: "POST" })
```

Backend (`orcengine/routes.ts`) registers:
```ts
app.post("/api/orcengine/scrape", ...)
app.get("/api/orcengine/scrape/:sessionId", ...)
app.post("/api/orcengine/scrape/:sessionId/urls", ...)
app.post("/api/orcengine/scrape/:sessionId/chat", ...)
app.post("/api/orcengine/scrape/:sessionId/generate-report", ...)
// ❌ /scrape/:sessionId/seed — NOT FOUND
```

**Result:** The "Seed to Companies" action in the OrcEngine scrape flow returns 404. UI shows error silently or hangs.

### Fix

Add to `orcengine/routes.ts`:

```ts
app.post("/api/orcengine/scrape/:sessionId/seed", async (req, res) => {
  const { sessionId } = req.params;
  // Extract companies from scrape session and upsert into companiesTable
  // Similar logic to /enrich/:id/save-to-companies
  res.json({ ok: true, seeded: count });
});
```

---

## 🟠 HIGH — MeshBase Stats Endpoint Path Mismatch

### The Bug

Frontend (`MeshBase.tsx`) calls:

```ts
fetch(`${BASE}/api/stats`)
fetch(`${BASE}/api/industry-distribution`)
fetch(`${BASE}/api/executives?limit=6`)
```

Backend (`meshbase.ts`) registers:

```ts
router.get("/stats", ...)
router.get("/industry-distribution", ...)
router.get("/executives", ...)
```

These are inside the main `router`, mounted at `app.use("/api", router)`, so the effective paths are `/api/stats`, `/api/industry-distribution`, `/api/executives` — **these match**. ✅

However `MeshBaseCompanies.tsx` calls:

```ts
fetch(`${BASE}/api/companies?${buildQueryString()}`)
```

And `companies.ts` exports routes at `/companies`, `/companies/:id`, `/companies/stats`, etc. — also correct. ✅

**No mismatch here. Good.**

---

## 🟡 MEDIUM — Raw `fetch()` Calls Bypass the Auth Token Injector

### The Issue

`main.tsx` correctly bootstraps the Bearer token:

```ts
const token = import.meta.env.VITE_API_TOKEN;
if (token) setAuthToken(token);
```

`customFetch` (used by orval-generated hooks like `useGetDashboardStats`) automatically injects `Authorization: Bearer <token>`.

**But** most pages call raw `fetch()` directly:

```ts
// Dashboard.tsx
const r = await fetch(`${BASE}/api/companies/stats`);

// MeshBase.tsx
fetch(`${BASE}/api/stats`)

// leads/index.tsx
fetch(`${BASE}/api/lead-lists/...`)
```

When `API_TOKEN` is set on the backend, these raw fetches get **401 Unauthorized** because they don't include the Bearer header.

### Fix Option A — Wrap raw fetch calls with customFetch

```ts
import { customFetch } from "@workspace/api-client-react";

// Replace:
const r = await fetch(`${BASE}/api/companies/stats`);
// With:
const data = await customFetch(`${BASE}/api/companies/stats`);
```

### Fix Option B — Global fetch interceptor in main.tsx

```ts
const _fetch = window.fetch;
window.fetch = (input, init = {}) => {
  const token = getAuthToken();
  if (token) {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return _fetch(input, { ...init, headers });
  }
  return _fetch(input, init);
};
```

Fix Option B is lower-effort and catches all existing raw fetches across all pages.

---

## 🟡 MEDIUM — Dashboard Uses Both Generated Hook AND Raw Fetch (Mixed Pattern)

`Dashboard.tsx` uses:
- `useGetDashboardStats()` — generated hook, uses `customFetch` ✅
- `useCompanyStats()` — raw `fetch("/api/companies/stats")` ❌
- `useAllSourceStats()` — raw `fetch("/api/lead-lists/stats/all")` ❌

This is inconsistent and will fail when `API_TOKEN` is set. Standardize to one pattern.

---

## 🟡 MEDIUM — FRONTEND_ORIGIN Not Set (CORS Wildcard in Production)

`.env`:
```
FRONTEND_ORIGIN=   # empty
```

`app.ts`:
```ts
if (!allowedOrigins) {
  console.warn("[cors] FRONTEND_ORIGIN is not set — allowing all origins.");
}
```

In production this means any origin can call the API. Before deploying, set:

```
FRONTEND_ORIGIN=https://your-replit-domain.replit.app
```

---

## ✅ CONFIRMED WIRED CORRECTLY

| Route Group | Backend | Frontend | Status |
|-------------|---------|----------|--------|
| `GET /api/healthz` | `routes/health.ts` | Not called by UI (liveness probe) | ✅ |
| `GET /api/companies*` | `routes/companies.ts` | `MeshBaseCompanies.tsx` | ✅ |
| `GET/POST /api/leads*` | `routes/leads.ts` | `leads/index.tsx` | ✅ |
| `GET /api/executives*` | `routes/meshbase.ts` | `MeshBaseExecutives.tsx` | ✅ |
| `GET /api/sa-market/*` | `routes/sa-market.ts` | `sa-market/shareholders.tsx`, `executives.tsx` | ✅ |
| `POST /api/masar/database/harvest` | `routes/masar-database.ts` | `masaar/database.tsx` | ✅ |
| `POST /api/orcengine/research` | `orcengine/routes.ts` | `orcengine/index.tsx` | ✅ |
| `GET /api/signals/recent` | `routes/signals.ts` | `signal-intelligence/index.tsx` | ✅ |
| Auth middleware | `lib/middleware/auth.ts` | `main.tsx` via `setAuthToken` | ✅ (for generated hooks) |
| SSE streams | `lib/sse.ts` | `EventSource(...)` calls | ✅ |

---

## Action Checklist

```
[ ] 1. CRITICAL — Strip /api prefix from all 16 routes in lead-factory.ts
[ ] 2. HIGH     — Add POST /api/orcengine/scrape/:sessionId/seed to orcengine/routes.ts
[ ] 3. MEDIUM   — Add global fetch interceptor in main.tsx (or migrate to customFetch)
[ ] 4. MEDIUM   — Set FRONTEND_ORIGIN in .env before production deploy
[ ] 5. LOW      — Move registerOrcEngineRoutes / registerProspectingRoutes into main router
[ ] 6. LOW      — Standardize Dashboard.tsx to use generated hooks or all customFetch
```

---

*End of audit*
