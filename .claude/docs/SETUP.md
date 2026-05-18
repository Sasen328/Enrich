# Setup

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 24.x |
| pnpm | 9+ (enforced via `preinstall` hook) |
| Python | 3.11+ (only for the Scout microservice) |
| PostgreSQL | 14+ |

## 1. Install

```bash
pnpm install
```

This installs all workspace packages: `artifacts/api-server`, `artifacts/prospect-sa` (frontend), `lib/db`, `lib/api-zod`, `lib/api-client-react`, `scripts`.

## 2. Configure environment

Create `.env` at the repo root (or use Replit Secrets). The bare minimum:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/enrich
PORT=3000
OPENAI_API_KEY=sk-...      # or AI_INTEGRATIONS_OPENAI_API_KEY on Replit
ANTHROPIC_API_KEY=sk-ant-...
```

External-API features (Scout, Lead Factory, Signals, Person Intel) need additional keys — see [ENV.md](ENV.md) for the full list and which engine uses which.

## 3. Database

```bash
# Apply Drizzle schema
pnpm --filter @workspace/db run db:push

# (optional) seed the unified company pool from fixtures
pnpm --filter @workspace/scripts run seed-import
```

The seed step is idempotent — safe to re-run.

## 4. Run

**API server (dev mode, watch + reload):**
```bash
pnpm --filter @workspace/api-server run dev
```
Boots on `PORT` (no default — must be set). On startup it recovers any stuck `lead_lists` jobs and seeds MeshBase if the `companies` table is empty.

**Frontend:**
```bash
pnpm --filter @workspace/prospect-sa run dev
```

**Python Scout microservice** (optional, only needed for OSINT / site-intel / full-scan features):
```bash
cd artifacts/python-scout
uv sync
uv run uvicorn main:app --port 8099
```
Then set `SCOUT_URL=http://localhost:8099` in the API server env.

## 5. Build for production

```bash
pnpm run typecheck   # full monorepo TypeScript check
pnpm run build       # builds all workspaces with esbuild
```

## Replit notes

- `modules.yaml` declares the Nix toolchain.
- `replit.md` documents the canonical Replit workflow.
- AI keys are exposed as `AI_INTEGRATIONS_*` env vars when using Replit's AI Integrations — the code falls back to direct `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` if those are absent.

## Troubleshooting

- **`PORT is required`** — the server intentionally has no port default; set it.
- **Empty company pool** — run the seed script, or let the server auto-seed MeshBase on first boot.
- **Scout endpoints 502** — Python service isn't running, or `SCOUT_URL` is wrong.
- **Captcha endpoints hanging** — set one of `CAPMONSTER_API_KEY` / `AZCAPTCHA_API_KEY` / `NOPECHA_API_KEY`.
- **Playwright errors on Replit** — point `CHROMIUM_EXECUTABLE_PATH` at the Nix-provided binary.
