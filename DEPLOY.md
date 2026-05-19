# ProspectSA — Deploy Guide

The **only** deploy guide for this repo. Covers everything from a zero-coding-experience laptop install to an always-on production server.

There are four sections:

- **Section 1 — Quick start on your laptop** (≈ 30 min, zero coding skills required)
- **Section 2 — Share a public URL** (free, temporary or permanent)
- **Section 3 — Always-on hosting** — there's no "free + mobile-only + always-on" option for this app size. Options: Your own laptop + Cloudflare Tunnel (truly free, only "up" when laptop is on) · Oracle Cloud Ampere A1 (truly free + always-on, one-time desktop setup)
- **Section 4 — Technical reference** (env vars, smoke tests, ops, troubleshooting, pre-deploy checklist)

---

## Section 1 · Quick start on your laptop

### 1.1 · Install the two tools you need (one-time)

| Tool | Why | Where |
|---|---|---|
| **Docker Desktop** | Runs ProspectSA in a sandbox so you don't have to install Node / Python / PostgreSQL separately. | https://www.docker.com/products/docker-desktop |
| **Git** | Downloads the code. | https://git-scm.com/downloads |

After installing Docker Desktop, **open it** — you'll see a whale icon in your menu bar (Mac) or system tray (Windows). Wait until the whale stops animating.

Verify in Terminal (Mac) or PowerShell (Windows):

```bash
docker --version       # should print something like "Docker version 27.x"
git --version
```

### 1.2 · Get the code

```bash
cd Desktop
git clone https://github.com/Sasen328/ProspectSA_Full.git
cd ProspectSA_Full
```

Windows PowerShell users: same commands work.

### 1.3 · Set up your `.env` file (this is where your API keys live)

```bash
cp .env.docker .env
```

Windows: `copy .env.docker .env`

Now open the `.env` file in any text editor (TextEdit on Mac, Notepad on Windows, or VS Code) and paste your keys. **At minimum you need ONE LLM key**. The cheapest path is OpenRouter with free-models mode:

```env
DATABASE_URL=postgresql://prospectsa:prospectsa_secret@db:5432/prospectsa
PORT=3000
API_TOKEN=                                          # leave blank for local dev
FRONTEND_ORIGIN=http://localhost:3000

# Pick ONE of these LLM keys at minimum:
OPENROUTER_API_KEY=sk-or-v1-...                     # cheapest — see below
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...

# When using OpenRouter, also set this to route through free models:
NEXUS_PREFER_FREE_MODELS=true

# Highly recommended (free dev tier — 1000 queries/month):
TAVILY_API_KEY=tvly-dev-...
```

Save the file.

> **How to get the keys (all free to sign up):**
> - OpenRouter: https://openrouter.ai/keys
> - Tavily: https://tavily.com
> - Anthropic Claude: https://console.anthropic.com
> - OpenAI: https://platform.openai.com/api-keys

### 1.4 · Start the app

In Terminal / PowerShell, inside the `ProspectSA_Full` folder:

```bash
docker compose up --build
```

**First time only:** this takes 5–10 minutes while Docker downloads everything. You'll see a lot of text scrolling — that's normal. You'll know it's ready when you see:

```
[db]  PostgreSQL ready to accept connections
[app] Server listening on port 3000
```

### 1.5 · Open it

In any browser: **http://localhost:3000**

That's it. ProspectSA is running.

### 1.6 · Stop and restart later

To stop: press **Ctrl+C** in the terminal (or **Cmd+C** on Mac).

To restart later (much faster, no rebuild):

```bash
cd ~/Desktop/ProspectSA_Full
docker compose up
```

To fully shut down and free memory: `docker compose down`. Your data is kept between restarts. To wipe everything: `docker compose down -v`.

### 1.7 · Update later when new changes land

```bash
cd ~/Desktop/ProspectSA_Full
git pull
docker compose up -d --build
```

---

## Section 2 · Share a public URL

### Option A — Cloudflare Tunnel (free, temporary, ≈ 5 min)

This gives a public URL like `https://abc-random.trycloudflare.com` that anyone can open. Stays up as long as your laptop is on and `docker compose` is running.

1. Install `cloudflared`:
   - Mac: `brew install cloudflared`
   - Windows / Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

2. **Keep `docker compose up` running** in your first terminal.

3. In a **second** terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

4. Cloudflare prints a `https://*.trycloudflare.com` URL. Share that with anyone — they can open it from any device anywhere.

5. To stop sharing: **Ctrl+C** in the second terminal.

### Option B — Caddy or nginx on your own VPS

If you have a domain name and want TLS automatically:

```caddy
prospectsa.example.com {
  reverse_proxy localhost:3000
}
```

Caddy auto-issues Let's Encrypt certs. Or use the standard nginx + certbot recipe.

---

## Section 3 · Always-on hosting

**Two truly-free options.** Both run the same `docker compose` stack you tested locally in Section 1.

### Option A · Laptop + Cloudflare Tunnel — free, mobile-deployable

This is the **only** path that's reliably **$0 forever AND mobile-controllable** for an app this size. It's not always-on — only "up" when your laptop is on — but every other constraint is met.

1. **One-time:** install Docker Desktop on your laptop ([instructions in Section 1](#section-1--quick-start-on-your-laptop)). After this, you control everything from your phone.
2. **From your phone:** open the GitHub mobile app or `github.com` in your phone browser. Any commit you push triggers a redeploy when you run `git pull && docker compose up -d --build` on the laptop. (Or use GitHub Desktop's auto-fetch + a small shell script that re-runs compose.)
3. **For a public URL:** install `cloudflared` on the laptop once and run `cloudflared tunnel --url http://localhost:3000` in a terminal. It prints a `https://*.trycloudflare.com` URL anyone can open. No DNS, no firewall, no payment.
4. **To make it permanent:** create a named tunnel in your Cloudflare dashboard (also free) and run `cloudflared` as a system service so it survives reboots.

Honest caveat: the moment your laptop sleeps or loses power, the app goes down. For a B2B prospecting tool that needs to harvest leads overnight, that's a real limitation. If you need 24/7 uptime AND $0, the only option is **Oracle Cloud Always-Free (Option B)** — set it up once with a friend, and it runs forever on Oracle's machines.

### Option B · Oracle Cloud Always-Free — free + always-on

Puts ProspectSA on a server that runs 24/7 even when your laptop is off. **Permanently free** with Oracle Cloud's "Always Free" Ampere A1 tier (4 ARM cores + 24 GB RAM — plenty for ProspectSA). The Dockerfile is multi-arch so it runs on ARM.

#### Step 1 · Create the VM

1. Sign up at https://www.oracle.com/cloud/free/. Credit card needed for ID verification only; they don't charge it.

2. **Compute → Instances → Create instance.** Choose:
   - **Image:** Ubuntu 22.04
   - **Shape:** "Ampere" → `VM.Standard.A1.Flex` → set **OCPUs = 4** and **Memory = 24 GB**
   - **Networking:** keep defaults; tick "Assign a public IPv4 address"
   - **SSH keys:** "Generate a key pair for me" → **download both files**

3. Click **Create**. Wait ~2 min until status = "Running". Copy the **Public IP Address** (e.g. `129.213.45.67`).

#### Step 2 · Connect to the server

Mac/Linux:

```bash
chmod 600 ~/Downloads/ssh-key-<date>.key
ssh -i ~/Downloads/ssh-key-<date>.key ubuntu@<your-server-ip>
```

Windows: use PuTTY — load the `.ppk` key file. See https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/accessinginstance.htm

#### Step 3 · Install Docker + Git

Paste these one by one:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
exit
```

Log out, log back in (same SSH command) so the docker group permission applies.

#### Step 4 · Open the firewall

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 22/tcp
sudo ufw --force enable
```

Also in the Oracle web console: **VCN → Security Lists → Default Security List → Add Ingress Rule**: source `0.0.0.0/0`, destination port `3000`, TCP. Save.

#### Step 5 · Deploy

```bash
git clone https://github.com/Sasen328/ProspectSA_Full.git
cd ProspectSA_Full
cp .env.docker .env
nano .env
```

In `nano`, paste your API keys. **Ctrl+O Enter** to save, **Ctrl+X** to exit.

```bash
docker compose up -d --build
```

First build on the free ARM tier: 10–15 min. The `-d` runs it in the background so you can close SSH.

#### Step 6 · Open it

Visit `http://<your-server-ip>:3000` from any browser. Done — ProspectSA is online 24/7.

#### Step 7 · (Optional) Permanent custom domain

```bash
sudo curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login              # opens a browser link
cloudflared tunnel create prospectsa
cloudflared tunnel route dns prospectsa app.yourdomain.com
sudo cloudflared service install
```

Full config-file docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/

---

## Section 4 · Technical reference

### 4.1 · Required env vars

| Var | Why |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (auto-managed by docker-compose) |
| `PORT` | API server port (no default — must be set) |
| `API_TOKEN` | Bearer token gate. **Never leave unset in production.** Generate: `openssl rand -hex 32` |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins |
| One of: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Nexus needs ≥1 LLM provider |

### 4.2 · Recommended env vars (still free)

| Var | Effect |
|---|---|
| `NEXUS_PREFER_FREE_MODELS=true` | Prepends OpenRouter `:free` model variants in every Nexus tier — zero LLM cost |
| `TAVILY_API_KEY` | Preferred free-search backend (1000 queries/month dev tier) |
| `SEARXNG_URL` | Fallback web-search if Tavily is unavailable |
| `GROQ_API_KEY` | Free tier; fastest LLM inference |
| `GEMINI_API_KEY` | Free tier; bilingual Saudi market features |
| `PERPLEXITY_API_KEY` | Real-time web research (paid; optional) |

Optional providers: `HUNTER_API_KEY`, `APOLLO_*`, `EXPLORIUM_API_KEY`, `APIFY_API_KEY`, captcha solvers, proxy mesh credentials. Everything in `.env.docker` is optional unless marked required.

### 4.3 · Smoke tests after boot

```bash
# Health
curl http://localhost:3000/api/healthz                                # {"status":"ok"}
curl http://localhost:3000/api/readyz                                 # DB connected

# Auth gate (only if API_TOKEN set)
curl -H "Authorization: Bearer $API_TOKEN" \
     http://localhost:3000/api/lead-factory/jobs                      # 200, jobs:[]

# End-to-end (uses LLM key, ~60s)
curl -X POST -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inputMode":"segment","mode":"company","icpDescription":"SaaS Riyadh 50-200","targetCount":5}' \
     http://localhost:3000/api/lead-factory/start
# Then GET /api/lead-factory/stream/lf-<n> from EventSource to watch agents 1-7
```

### 4.4 · UI pages to sanity-check

| URL | Should render |
|---|---|
| `/` | Dashboard with stats |
| `/lead-factory/person` | Person-mode filter panel |
| `/lead-factory/company` | Company-mode filter panel |
| `/lead-factory/results?jobId=…` | Result table with CSV / XLSX / PDF / PPT / JSON export buttons + bulk publish/reject |
| `/signal-intelligence/tree` | Live tree, green pulse on SSE push |
| `/relationship-intel/tree?jobId=…` | Org chart + adjacency + outreach plan |

### 4.5 · Live harvest modules (already wired)

| Module | What it pulls |
|---|---|
| `lib/free-search.ts` | Tavily → SearXNG → Google HTML |
| `lib/google-news-scraper.ts` | news.google.com RSS |
| `lib/saudi-news-rss.ts` | Maal · Mubasher · Al Eqtisadiah · Argaam (AR+EN) · Arab News |
| `lib/sanctions-screen.ts` | OFAC SDN + UN consolidated + EU consolidated (daily cache) |
| `orcengine/deep-research.ts` | Recursive web research via Nexus + free-search |
| `lib/free-sources.ts` | GLEIF, OpenCorporates, Wikidata, Clearbit, GitHub, Wappalyzer, etc. |
| `scout-client.ts` → Python Scout | Site intel, OSINT, sanctions, contracts |

### 4.6 · Operations

```bash
# Update
git pull && docker compose up -d --build

# Tail logs
docker compose logs -f app
docker compose logs -f db

# DB backup
docker exec prospectsa_db pg_dump -U prospectsa prospectsa > backup_$(date +%F).sql

# Stop / wipe
docker compose down                # stop, data persists
docker compose down -v             # stop + wipe DB
```

### 4.7 · Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` | Docker Desktop not installed or not running |
| `app` container restarts on first boot | DB not ready yet — healthcheck auto-retries (~20s) |
| `pnpm install` fails | `docker compose build --no-cache`; confirm `pnpm-lock.yaml` is committed |
| Playwright / Chromium errors | The Dockerfile installs all libs. Outside Docker: set `CHROMIUM_EXECUTABLE_PATH` |
| Port 3000 in use | Change `"3000:3000"` → `"4000:3000"` in `docker-compose.yml` |
| Python Scout failed to start | Non-fatal. API runs fine without it. `docker compose logs app \| grep Scout` to debug |
| 401 on every `/api/*` | `API_TOKEN` set but frontend missing it. Either unset `API_TOKEN` in dev, or set `VITE_API_TOKEN` in `artifacts/prospect-sa/.env.local` to the same value and rebuild |
| First sanctions scan slow | First call downloads OFAC + UN + EU XMLs in parallel (~10s); cached daily |

### 4.8 · Pre-deploy checklist

Before going public:

- [ ] All previously-committed keys (`ANTHROPIC`, `OPENAI`, `PERPLEXITY`, `GEMINI`, `TAVILY`, `HUGGING_FACE`, `APOLLO_*`, `EXPLORIUM`, `MANUS`, `OPENROUTER`, `GROQ`) are **rotated** at the provider dashboards. They were public in git history before the `.env` purge.
- [ ] `.env` is in `.gitignore` and not tracked (verify: `git ls-files | grep .env`).
- [ ] `API_TOKEN` is set to a strong random value.
- [ ] `FRONTEND_ORIGIN` is set to your production origin (not `*`).
- [ ] At least one LLM provider key is valid.
- [ ] `curl http://<host>:3000/api/readyz` returns 200.
- [ ] At least one Lead Factory dry-run completes successfully end-to-end.

### 4.9 · What it costs

| Component | Cost |
|---|---|
| Docker, Cloudflare Tunnel, Oracle Cloud Always Free, OpenRouter `:free`, Tavily dev tier | **$0** |
| Anthropic / OpenAI / Gemini paid LLMs | Pay-as-you-go (optional) |
| Apollo / Hunter / proxies / captcha solvers | Pay-as-you-go (optional) |

If you use only OpenRouter + Tavily + Oracle Free Tier, total monthly cost is **$0**.

### 4.10 · What you don't need

- ❌ Replit (purged from this repo)
- ❌ Vercel / Netlify (the API serves the built frontend itself)
- ❌ Managed Postgres (`docker compose` spins one up — use a managed one in prod if you prefer)
- ❌ Apollo / ZoomInfo / Crunchbase / Lusha / Cognism / D&B / Bombora / Refinitiv (all paid B2B prospecting APIs are optional)
