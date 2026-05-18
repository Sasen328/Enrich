# ProspectSA — Deploy Without Replit

Self-contained guide to bring ProspectSA up on **any machine that can run Docker**: your laptop, a VPS, an Oracle Cloud free-tier ARM VM, AWS Lightsail, Hetzner, etc. Replit is not used anywhere.

The reference flow is `docker compose up`. Everything below assumes you have the repo cloned and you're in its root.

---

## Step 0 · Prereqs

| Need | How |
|---|---|
| Docker Engine + Compose | https://docs.docker.com/engine/install/ (Linux) or Docker Desktop (Mac/Windows) |
| A box with ≥ 4 GB RAM, ≥ 20 GB disk | Any modern VPS or laptop |
| Outbound HTTPS allowed | For LLM / search / harvester calls |
| (Optional) Cloudflare account | For a permanent public URL via Cloudflare Tunnel |

Verify Docker is ready:

```bash
docker --version          # >= 24
docker compose version    # >= v2
```

---

## Step 1 · Configure environment

```bash
cp .env.docker .env
```

Open `.env` and set **at minimum**:

```env
# Required to boot
DATABASE_URL=postgresql://prospectsa:prospectsa_secret@db:5432/prospectsa
PORT=3000
API_TOKEN=$(openssl rand -hex 32)         # paste the output here
FRONTEND_ORIGIN=http://localhost:3000

# At least ONE LLM key — Nexus needs one to function
ANTHROPIC_API_KEY=sk-ant-...
# OR
OPENAI_API_KEY=sk-...

# Zero-cost LLM path (highly recommended):
OPENROUTER_API_KEY=sk-or-...
NEXUS_PREFER_FREE_MODELS=true
```

**Strongly recommended (still free):**

```env
TAVILY_API_KEY=tvly-dev-...      # 1000 free queries/month — preferred search backend
SEARXNG_URL=https://searx.be      # any public SearXNG instance for fallback
```

Everything else (Apollo, Hunter, BrightData…) is **optional** — the app boots without them.

⚠️ **Security:** `.env` is committed to the repo with placeholder keys. Before any public deploy:

```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "stop tracking .env"
# rotate every key at its provider dashboard
```

---

## Step 2 · Build + start

```bash
docker compose up --build         # first run, builds the image (5–10 min)
docker compose up -d              # subsequent starts, detached
docker compose logs -f app        # tail logs
```

Healthy startup looks like:

```
[db]  PostgreSQL ready to accept connections
[app] ✓ Database schema up to date
[app] ✓ Python Scout running on :8099
[app]   Server listening on port 3000
```

Open **http://localhost:3000** — the React frontend is served by the API server at root.

---

## Step 3 · Smoke tests

```bash
curl http://localhost:3000/api/healthz                                # {"status":"ok"}
curl http://localhost:3000/api/readyz                                 # DB connected
curl -H "Authorization: Bearer $API_TOKEN" \
     http://localhost:3000/api/lead-factory/jobs                      # 200, jobs:[]

# End-to-end (uses LLM key — takes ~60s):
curl -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
     -d '{"inputMode":"segment","mode":"company","icpDescription":"SaaS Riyadh 50-200 employees","targetCount":5}' \
     http://localhost:3000/api/lead-factory/start
# Returns {"ok":true,"jobId":"lf-<n>"}; then watch /api/lead-factory/stream/lf-<n>
```

UI pages worth opening once for sanity:

| URL | Should render |
|---|---|
| `/` | Dashboard with stats |
| `/lead-factory/person` | Filter panel + run preview |
| `/lead-factory/company` | Same, company mode |
| `/lead-factory/results?jobId=…` | Result table + CSV/XLSX/PDF/PPT/JSON buttons |
| `/signal-intelligence/tree` | Live tree, green-pulse on SSE push |
| `/relationship-intel/tree?jobId=…` | Org chart + adjacency + outreach plan |

---

## Step 4 · Make it public

### Easiest: Cloudflare Tunnel

In a separate terminal (Docker stack still running):

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public `https://*.trycloudflare.com` URL. Tunnel stays up as long as the command runs. For a permanent named tunnel + DNS, follow the [Cloudflare named-tunnel guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/) and run `cloudflared` as a systemd service.

### Or: Caddy reverse-proxy on a VPS

```bash
# Caddyfile
prospectsa.example.com {
  reverse_proxy localhost:3000
}
```

Caddy auto-issues Let's Encrypt certs.

### Or: nginx + certbot

Standard reverse-proxy snippet — proxy `prospectsa.example.com` to `localhost:3000`, run `certbot --nginx` to get TLS.

---

## Step 5 · Always-on (recommended hosts)

| Host | Why | Cost |
|---|---|---|
| **Oracle Cloud Always Free** (Ampere A1: 4 OCPU, 24 GB RAM, ARM) | Largest free tier. The Dockerfile is multi-arch (linux/amd64 + linux/arm64). | $0 forever (within free-tier limits) |
| **Hetzner CCX23** | Strong perf/€ ratio | ~€15/month |
| **AWS Lightsail 4 GB** | Familiar AWS shell | ~$20/month |
| **DigitalOcean Droplet 4 GB** | One-click Docker | ~$24/month |

Steps on the VM: install Docker, clone the repo, copy your `.env`, `docker compose up -d --build`, attach Cloudflare Tunnel as a systemd service.

---

## Step 6 · Operational extras

### Update the running stack

```bash
git pull
docker compose pull           # if you ever pin to registry images
docker compose up -d --build
```

### Stop / wipe

```bash
docker compose down            # stop, data persists
docker compose down -v         # stop + wipe DB
```

### Backup database

```bash
docker exec prospectsa_db pg_dump -U prospectsa prospectsa > backup_$(date +%F).sql
```

### Tail logs

```bash
docker compose logs -f app
docker compose logs -f db
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `app` container restarts on first boot | `db` not ready yet — auto-retries via healthcheck; wait 20s. |
| `pnpm install` fails inside build | `docker compose build --no-cache`; confirm `pnpm-lock.yaml` is committed. |
| Playwright / Chromium errors | The Dockerfile installs all required libs. If you build outside Docker, set `CHROMIUM_EXECUTABLE_PATH`. |
| Port 3000 in use | Change `"3000:3000"` to `"4000:3000"` in `docker-compose.yml`. |
| Python Scout failed to start | Non-fatal. API runs fine without it. `docker compose logs app \| grep Scout` to debug. |
| All `/api/*` return 401 | `API_TOKEN` is set but client missing it. Either unset `API_TOKEN` in dev, or set `VITE_API_TOKEN` in `artifacts/prospect-sa/.env.local` to the same value and rebuild. |
| Sanctions cache is slow on first run | First call to `screenSanctions()` loads OFAC + UN + EU XMLs in parallel (~10s); cached daily after that. |

---

## Step 7 · Verifying the data-source surface

The app pulls from **76 catalogued sources** in `lib/data-sources.ts` plus **9 sector-keyword categories** in `SAUDI_SECTOR_KEYWORDS`. Live harvesters (already wired):

| Module | Free? | Engine that calls it |
|---|---|---|
| `lib/free-search.ts` (Tavily → SearXNG → Google) | ✅ | Lead Factory Agent 2 |
| `lib/google-news-scraper.ts` | ✅ | Signals |
| `lib/saudi-news-rss.ts` (Maal + Mubasher + Al Eqtisadiah + Argaam + Arab News) | ✅ | Signals |
| `lib/sanctions-screen.ts` (OFAC + UN + EU) | ✅ | Signals |
| `orcengine/deep-research.ts` (recursive web research) | ✅ | OrcEngine route |
| `lib/free-sources.ts` (GLEIF, OpenCorporates, Wikidata, Clearbit, GitHub, Wappalyzer, …) | ✅ | Lead Factory + Enrichment |
| `scout-client.ts` → Python Scout (deep OSINT) | ✅ | Signals, Lead Factory, Person Intel |

Captcha-gated / portal-scrape sources in the catalogue (Najiz, NCBE, MoCI new-CR feed, SaudiCEOs, SaudiBODs, Wathiq browser portal) need bespoke browser-automation passes — listed as deferred harvester work.

---

## Step 8 · What you don't need

- ❌ Replit account / `.replit` config / `modules.yaml` — purged from the repo.
- ❌ Apollo / ZoomInfo / Crunchbase / Lusha / Cognism / D&B / Bombora / Refinitiv — all paid B2B APIs are optional or excluded.
- ❌ Vercel / Netlify — the API server serves the built React frontend itself.
- ❌ A managed Postgres provider — `docker compose` spins one up. Use a managed one in prod if you want.

If you do nothing else, `docker compose up --build` from a clean checkout with a valid `.env` is sufficient to run the entire stack.
