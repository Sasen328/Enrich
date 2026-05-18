# ProspectSA — Deployment Guide
## Docker Desktop + Cloudflare Tunnel (Free, POC)

---

## What's in this package

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds full stack — Node + Python Scout + browsers |
| `docker-compose.yml` | Wires app + PostgreSQL, single command startup |
| `start.sh` | Container process orchestrator |
| `.env.docker` | Environment variable template |
| `patches/lead-factory.ts` | **Bug fix** — replaces `artifacts/api-server/src/routes/lead-factory.ts` |
| `patches/main.tsx` | **Bug fix** — replaces `artifacts/prospect-sa/src/main.tsx` |
| `patches/orcengine-seed-endpoint.ts` | **Missing endpoint** — insert into `artifacts/api-server/src/orcengine/routes.ts` |

---

## Prerequisites

Install these once on your machine:

1. **Docker Desktop** → https://www.docker.com/products/docker-desktop/
2. **Cloudflare CLI** → https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/

---

## Step 1 — Apply the patches to your codebase

Copy the deployment files into the ROOT of your ProspectSA repo:

```bash
# From inside your ProspectSA repo root:

# Copy deployment files
cp /path/to/this-package/Dockerfile .
cp /path/to/this-package/docker-compose.yml .
cp /path/to/this-package/start.sh .
cp /path/to/this-package/.env.docker .

# Apply Bug Fix 1: lead-factory double-prefix (kills Lead Factory + Signals + Relationship Intel)
cp /path/to/this-package/patches/lead-factory.ts artifacts/api-server/src/routes/lead-factory.ts

# Apply Bug Fix 2: auth token on raw fetch calls
cp /path/to/this-package/patches/main.tsx artifacts/prospect-sa/src/main.tsx
```

For the **missing seed endpoint**, open:
`artifacts/api-server/src/orcengine/routes.ts`

Find this line (around line 452):
```
  app.get("/api/orcengine/templates", async (req, res) => {
```

Insert the entire contents of `patches/orcengine-seed-endpoint.ts`
**directly above** that line.

---

## Step 2 — Configure your environment

```bash
cp .env.docker .env
```

Open `.env` and fill in at minimum:

```
ANTHROPIC_API_KEY=sk-ant-...     ← REQUIRED for OrcEngine, Lead Factory, Masaar
GEMINI_API_KEY=AIza...           ← Recommended for SA Market + bilingual features
OPENAI_API_KEY=sk-...            ← Optional fallback
```

Everything else is optional. The app boots and most features work with just `ANTHROPIC_API_KEY`.

---

## Step 3 — Build and start

```bash
# First run — builds the Docker image (takes 5-10 minutes)
docker compose up --build

# Subsequent runs — fast start
docker compose up
```

Watch the logs. You should see:
```
✓  Database schema up to date
✓  Python Scout running (PID ...)
   ProspectSA ready → http://localhost:3000
```

Open http://localhost:3000 — your app is live locally.

---

## Step 4 — Expose publicly with Cloudflare Tunnel

Open a NEW terminal window while docker compose is running:

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a URL like:
```
https://some-random-words.trycloudflare.com
```

Share that URL. Anyone with it can access your live app from anywhere.
The tunnel stays active as long as the command is running.

---

## Stopping the app

```bash
# Stop containers (keeps database data)
docker compose down

# Stop + wipe all data (clean slate)
docker compose down -v
```

---

## Troubleshooting

**App won't start — database connection refused**
→ Wait 10 seconds and check `docker compose ps` — PostgreSQL takes a moment to be ready.
→ The app auto-retries via the healthcheck dependency.

**Build fails at pnpm install**
→ Make sure `pnpm-lock.yaml` is committed and unchanged.
→ Run `docker compose build --no-cache` to force a clean build.

**Playwright/Chromium errors in logs**
→ These are non-fatal warnings. The app falls back to Cheerio for most scraping.
→ Masaar CR scraping (mc.gov.sa) requires a CAPTCHA solver key — add `NOPECHA_API_KEY` or `AZCAPTCHA_API_KEY`.

**Port 3000 already in use**
→ Change the port mapping in `docker-compose.yml`:
```yaml
ports:
  - "4000:3000"   # Access on http://localhost:4000
```

**Python Scout failed to start**
→ Non-fatal. The Node API server runs fine without it.
→ Scout provides deep crawl, OSINT harvest, and social scan features.
→ Check logs with: `docker compose logs app | grep Scout`

---

## Features that work without any optional keys

| Feature | Works without optional keys? |
|---------|------------------------------|
| MeshBase (companies + executives) | ✅ Yes — uses seeded data |
| Dashboard stats | ✅ Yes |
| OrcEngine research | ✅ Yes — needs ANTHROPIC_API_KEY |
| Lead Factory | ✅ Yes — needs ANTHROPIC_API_KEY |
| SA Market shareholders/executives | ✅ Yes — uses seeded data |
| Signal Intelligence (scan) | ✅ Yes — needs ANTHROPIC_API_KEY |
| Masaar database harvest | ⚠️ Partial — needs CAPTCHA solver for mc.gov.sa |
| AI enrichment (deep) | ⚠️ Partial — needs ANTHROPIC + GEMINI |
| Apollo contact enrichment | ❌ Needs APOLLO_API_KEY |
| Proxy rotation | ❌ Needs proxy provider keys |

---

## Production (Oracle Cloud Always Free)

When ready to move from local to always-on cloud:

1. Create Oracle Cloud account (free, credit card for verification only)
2. Provision ARM VM: 4 OCPUs, 24GB RAM (Ampere A1 — Always Free tier)
3. Install Docker on the VM
4. Push your repo to GitHub
5. Clone on Oracle VM and run `docker compose up -d`
6. Set up Cloudflare Tunnel as a systemd service for permanent public URL

That gives you a permanent free URL with the full engine running 24/7.
