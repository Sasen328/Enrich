# ProspectSA Localhost Deployment Guide

This guide shows how to deploy ProspectSA on your localhost using Docker Compose.

It follows **Section 1** of the official [`DEPLOY.md`](../DEPLOY.md) guide.

---

## ⚡ Quick Start (5 min)

```bash
# 1. Clone repo
git clone https://github.com/Sasen328/ProspectSA_Full.git
cd ProspectSA_Full

# 2. Create .env from template
cp .env.docker .env

# 3. Edit .env and add API keys
nano .env  # or open in VS Code / TextEdit / Notepad

# 4. Deploy with Docker
docker compose up --build

# 5. Open in browser
# http://localhost:3000
```

---

## 📋 Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| **Docker Desktop** | Latest | Runs app in a container |
| **Git** | Latest | Clones the repository |
| **One LLM API Key** | Any | Required for AI features |

### Install Docker Desktop
- **Mac/Windows:** https://www.docker.com/products/docker-desktop
- **Linux:** `sudo apt install docker.io docker-compose` or see https://docs.docker.com/install/

After installing, verify:
```bash
docker --version    # Docker version 27.x or later
docker compose version
```

---

## 🚀 Step-by-Step Deployment

### Step 1: Clone the Repository

```bash
cd Desktop  # or wherever you want to put it
git clone https://github.com/Sasen328/ProspectSA_Full.git
cd ProspectSA_Full
```

### Step 2: Create Environment File

```bash
cp .env.docker .env
```

This copies the template with all required and optional variables.

### Step 3: Add Your API Keys

**Edit `.env`** in any text editor (VS Code, TextEdit, Notepad, nano, etc.):

```bash
# Option 1: nano (Terminal editor)
nano .env

# Option 2: VS Code
code .env

# Option 3: Just open .env directly in your text editor
```

**At minimum, set ONE LLM key:**

```env
# Pick ONE of these (all free to sign up):

OPENROUTER_API_KEY=sk-or-v1-...        # ← CHEAPEST (free models)
NEXUS_PREFER_FREE_MODELS=true

# OR

ANTHROPIC_API_KEY=sk-ant-...           # ← Claude (recommended)

# OR

OPENAI_API_KEY=sk-proj-...             # ← GPT-4o
```

**Get keys from:**
- **OpenRouter** (free tier): https://openrouter.ai/keys
- **Anthropic Claude**: https://console.anthropic.com
- **OpenAI**: https://platform.openai.com/api-keys
- **Tavily** (web search, free 1000/month): https://tavily.com

### Step 4: Start the Application

In Terminal / PowerShell, inside the `ProspectSA_Full` folder:

```bash
docker compose up --build
```

**First run takes 5–10 minutes** while Docker downloads and builds everything. You'll see a lot of scrolling text — that's normal.

**You'll know it's ready when you see:**

```
[db]  PostgreSQL ready to accept connections
[app] Server listening on port 3000
```

### Step 5: Open in Browser

Open any browser and go to:

```
http://localhost:3000
```

🎉 **That's it! ProspectSA is running.**

---

## 🛑 Stop / Restart

### Stop the app (keep database)
```bash
Ctrl+C  # in the terminal where docker compose is running
```

### Stop + erase everything
```bash
docker compose down -v
```

### Restart (data persists)
```bash
docker compose up
```

### View logs while running
```bash
# All services
docker compose logs -f

# Just the app
docker compose logs -f app

# Just the database
docker compose logs -f db
```

---

## 🔄 Update to Latest Code

```bash
git pull
docker compose up -d --build
```

The `-d` flag runs in background, so you can close the terminal.

---

## 📊 Database Access

You can connect to the PostgreSQL database directly if needed:

```bash
# From inside your app / scripts only:
DATABASE_URL=postgresql://prospectsa:prospectsa_secret@db:5432/prospectsa

# Or use psql if installed:
psql -h localhost -U prospectsa -d prospectsa
# Password: prospectsa_secret
```

---

## ✅ Verify Everything Works

### Health Checks
```bash
curl http://localhost:3000/api/healthz     # {"status":"ok"}
curl http://localhost:3000/api/readyz      # 200 if DB connected
```

### Test Pages
| Page | URL |
|------|-----|
| Dashboard | http://localhost:3000/ |
| Lead Factory | http://localhost:3000/lead-factory/company |
| Masaar (CR lookup) | http://localhost:3000/masaar |

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| **`docker: command not found`** | Docker Desktop not installed or not running |
| **Port 3000 already in use** | Change in `docker-compose.yml`: `"4000:3000"` instead of `"3000:3000"` |
| **API returns 401 errors** | Leave `API_TOKEN` empty in `.env` for local dev |
| **`app` restarts endlessly** | PostgreSQL not ready yet. Wait 20 seconds. |
| **Playwright / Chromium errors** | Already installed in Docker. This shouldn't happen. Try `docker compose build --no-cache`. |
| **First Masaar run very slow** | Downloads compliance lists (~10s). Cached after. |
| **App won't connect to DB** | Restart: `docker compose restart` or `docker compose down && docker compose up` |

### View detailed logs
```bash
docker compose logs app 2>&1 | head -100  # Last 100 lines of app log
docker compose logs db 2>&1 | tail -50    # Last 50 lines of DB log
```

---

## 📁 What Gets Created

```
ProspectSA_Full/
├── .env                          ← Your config (created by you)
├── docker-compose.yml            ← Already in repo
├── Dockerfile                    ← Already in repo
├── docker_volumes/
│   ├── postgres_data/            ← Database files (persists between restarts)
│   ├── agent_sessions/           ← Masaar browser sessions
│   └── playwright_cache/         ← Browser cache
```

If you run `docker compose down -v`, the volumes are deleted and you start fresh.

---

## 🔐 Security Notes

- `API_TOKEN` left blank for **local dev only**. Never do this in production.
- Database password `prospectsa_secret` is fine for localhost.
- Your `.env` file contains secrets — **never commit it to git** (it's in `.gitignore`).

---

## 📚 Next Steps

1. ✅ App is running — explore the UI
2. 🔑 Add more API keys to `.env` for extra features:
   - `TAVILY_API_KEY` (web search)
   - `PERPLEXITY_API_KEY` (real-time research)
   - `HUNTER_API_KEY` (email discovery)
   - See `.env.docker` for full list

3. 📖 Read the full guide: [`DEPLOY.md`](../DEPLOY.md)
   - Section 2: How to share a public URL (Cloudflare Tunnel)
   - Section 3: Always-on hosting (Railway, Render, Oracle Cloud)
   - Section 4: Technical reference, troubleshooting, cost breakdown

---

## 🤔 Common Questions

**Q: Why Docker instead of running locally?**  
A: Avoids installing Node, Python, PostgreSQL, Chromium separately. One command handles everything.

**Q: Can I use a different database (AWS RDS, Supabase, etc.)?**  
A: Yes. Change `docker-compose.yml` line 62: set `DATABASE_URL` to your cloud DB URL instead of the local `db` service.

**Q: Does it work on Mac / Windows / Linux?**  
A: Yes, anywhere Docker runs.

**Q: Can I deploy this to production?**  
A: Yes. See Section 3 of [`DEPLOY.md`](../DEPLOY.md) for Railway ($5/mo), Render ($7/mo), or Oracle Cloud (free).

---

## 📞 Need Help?

- Check [`DEPLOY.md`](../DEPLOY.md) Section 4 (Technical Reference)
- Check app logs: `docker compose logs app`
- Check DB logs: `docker compose logs db`
- GitHub Issues: https://github.com/Sasen328/ProspectSA_Full/issues

---

**Happy prospecting! 🚀**
