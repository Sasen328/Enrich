# Replicating ProspectSA on Replit

ProspectSA is one **pnpm monorepo** — the API server, frontend, and Python Scout
are interdependent, so you upload the **entire repository**, not a subset. There
is no "just these files" shortcut; the parts share the workspace, the DB schema,
and the lockfile.

## 1. What to upload (the whole repo)

Import the repo into Replit (GitHub import is easiest, or upload the full tree).
The pieces that must be present:

| Path | Why it's needed |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc` | Monorepo + exact dependency install |
| `tsconfig*.json` | TypeScript build |
| `artifacts/api-server/**` | Express API (the server you run) |
| `artifacts/prospect-sa/**` | React/Vite frontend (built + served by the API) |
| `artifacts/python-scout/**` | Python OSINT microservice (port 8099) |
| `lib/**` | Shared DB schema (`lib/db`), API spec, integrations |
| `lib/db/drizzle/*.sql` | DB migrations applied at boot |
| `prospectsa_schema.sql`, `seed_data.sql` | Schema + seed data (optional but recommended) |
| `pyproject.toml` / `artifacts/python-scout/requirements.txt` | Python deps |
| `setup.sh`, `start.sh` | Migrate + launch Scout + Node |
| `.replit`, `replit.nix`, `replit-run.sh` | Replit run/build config (in this repo) |
| `scripts/**` | Seed import helpers |

You do **not** need any Docker files — they were removed; Replit runs the stack
natively via `replit-run.sh`.

## 2. Modules (Replit "Configure" panel)

Enable: **nodejs-24**, **python-3.11**, **postgresql-16**. `replit.nix` also
pulls in `chromium` for the Playwright/power-scraper layers.

## 3. Secrets (Replit "Secrets" tab)

Required:
- `DATABASE_URL` — your Replit PostgreSQL connection string
  (`postgresql://USER:PASSWORD@HOST:PORT/DB`). Data persists in PG's storage.

At least one LLM provider key (more = better fallback coverage):
- `OPENROUTER_API_KEY` (recommended — unlocks the whole NEXUS waterfall incl. Kimi)
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
  `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY` (Kimi), `PERPLEXITY_API_KEY`

Optional (degrade gracefully if unset): `APOLLO_API_KEY`, `EXPLORIUM_API_KEY`,
`CAPMONSTER_API_KEY` / `AZCAPTCHA_API_KEY` / `NOPECHA_API_KEY`, `SCOUT_URL`
(defaults to `http://localhost:8099`), `API_TOKEN` + `FRONTEND_ORIGIN` (set these
before exposing publicly — see `docs/ENV.md`).

> The swarm output report needs at least one LLM key. With none set,
> `/api/swarm/start` streams a `degraded_mode` notice and the report shows a
> "set a NEXUS provider key" message instead of generated text.

## 4. Run

Press **Run**. `replit-run.sh` will: enable pnpm → `pnpm install` →
install Python deps → `pnpm build` (frontend + API) → `start.sh` (drizzle
migrations + Python Scout on 8099 + Node API on `PORT`/3000). The app serves the
built frontend at the web preview URL; SwarmBoard is at `/swarm`.

## 5. Verify

```bash
curl localhost:3000/api/healthz
curl -N -X POST localhost:3000/api/swarm/start -d '{"brief":"Saudi fintech 50-500 employees","useKimi":true}'
```

The SSE stream should emit coordinator → parallel agents → a final fused report.
Full env reference: `docs/ENV.md`. Operator guide: `docs/OPERATOR_GUIDE.md`.
