# ProspectSA — Deployment Guide

End-to-end production bring-up via Docker. The image bundles the Node API, the React frontend (served as static files by the API), and the Python Scout sidecar.

For local development without Docker, see [`SETUP.md`](SETUP.md).

---

## What's in the deployment surface

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds Node API + Vite frontend + Python Scout into one image |
| `docker-compose.yml` | Wires the app + PostgreSQL 16; single-command bring-up |
| `start.sh` | Container entrypoint — runs migrations, starts Scout, starts API |
| `stop.sh` | Graceful stop helper |
| `.env.docker` | Environment template — copy to `.env` and fill in keys |

The deployment is self-contained: no patch files, no Replit dependency, no external build steps.

---

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose on Linux) — https://www.docker.com/products/docker-desktop/
- (Optional, for public URL) **Cloudflare Tunnel** — https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/

---

## Step 1 — Configure environment

From the repo root:

```bash
cp .env.docker .env
```

Edit `.env` and set, at minimum:

```env
DATABASE_URL=postgresql://prospectsa:prospectsa_secret@db:5432/prospectsa
PORT=3000
API_TOKEN=<openssl rand -hex 32>
FRONTEND_ORIGIN=http://localhost:3000

# At least one LLM key:
ANTHROPIC_API_KEY=sk-ant-...   # OrcEngine, Lead Factory, Masaar
OPENAI_API_KEY=sk-...          # GPT-4o paths
GEMINI_API_KEY=AIza...         # SA Market, bilingual
PERPLEXITY_API_KEY=pplx-...    # Signals, Lead Factory, Intel
```

Everything else in `ENV.md` is optional. The app boots with just `DATABASE_URL` + one LLM key.

---

## Step 2 — Build and start

```bash
# First run — builds the image (5–10 min)
docker compose up --build

# Subsequent runs — fast
docker compose up -d
```

Healthy log output:

```
[db]  PostgreSQL ready to accept connections
[app] ✓ Database schema up to date
[app] ✓ Python Scout running on :8099
[app]   Server listening on port 3000
```

Open **http://localhost:3000** — the React frontend is served by the API server at the root.

---

## Step 3 — Verify

```bash
curl http://localhost:3000/api/healthz                              # {"status":"ok"}
curl http://localhost:3000/api/readyz                               # {"status":"ok"} — DB connected
curl -H "Authorization: Bearer $API_TOKEN" \
     http://localhost:3000/api/lead-factory/jobs                    # auth gate works
```

---

## Step 4 — (Optional) Expose publicly with Cloudflare Tunnel

In a separate terminal while `docker compose` is running:

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public URL like `https://some-words.trycloudflare.com`. The tunnel stays up as long as the command runs.

For a permanent tunnel (named, with DNS), follow the Cloudflare named-tunnel docs and run `cloudflared` as a systemd service.

---

## Stopping

```bash
docker compose down              # Stop containers (data persists in the postgres_data volume)
docker compose down -v           # Stop + wipe the database
```

---

## Production deployment (Oracle Cloud Always-Free, or any VPS)

1. Provision a Linux VM (Oracle Cloud Ampere A1 — 4 OCPU / 24 GB RAM is free-tier).
2. Install Docker + Compose.
3. Clone the repo onto the VM.
4. `cp .env.docker .env`, fill in keys.
5. `docker compose up -d --build`.
6. Set up Cloudflare Tunnel as a systemd service for a permanent public URL.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `app` container restarts repeatedly | DB not ready on first boot | `docker compose ps` — wait for `db` healthcheck to pass; healthcheck dependency auto-retries the app. |
| Build fails at `pnpm install` | Lockfile drift | `docker compose build --no-cache`; ensure `pnpm-lock.yaml` is committed. |
| Playwright / Chromium errors | Missing system libs | Already handled in the Dockerfile. For Masaar CR scraping (mc.gov.sa) add `NOPECHA_API_KEY` or `AZCAPTCHA_API_KEY`. |
| Port 3000 in use | Another service | Change `"3000:3000"` → `"4000:3000"` in `docker-compose.yml`. |
| Python Scout failed | Non-fatal | The API runs fine without it; Scout adds OSINT / site-intel features. `docker compose logs app \| grep Scout`. |
| 401 on every API call | `API_TOKEN` set but client missing it | Set `VITE_API_TOKEN` in `artifacts/prospect-sa/.env.local` to the same value, rebuild the frontend (or leave `API_TOKEN` unset in dev). |

---

## What works without optional keys

| Feature | Needs |
|---|---|
| MeshBase (companies + executives), Dashboard, SA Market shareholders | Seed data only |
| OrcEngine, Lead Factory, Signal Intelligence | `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) |
| Masaar CR harvest | LLM key + CAPTCHA solver key |
| Deep AI enrichment | `ANTHROPIC_API_KEY` + `GEMINI_API_KEY` |
| Apollo contact enrichment | `APOLLO_API_KEY` |
| Proxy rotation | Proxy provider keys |
