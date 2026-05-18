# ProspectSA — Setup

End-to-end setup for local dev, VPS, cloud VM, or Docker. The Docker path is the fastest — see [`DEPLOY_README.md`](DEPLOY_README.md) for one-command bring-up.

**Required at minimum:**
- Node.js 24, pnpm
- PostgreSQL 16
- One LLM key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)

**Optional `AI_INTEGRATIONS_*` proxy:** `lib/config/env.ts` will route through `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` (with matching `_BASE_URL`) when set, falling back to direct keys otherwise. Useful behind a corporate gateway.

---

## System requirements

Install these once on your machine:

```bash
# Node.js 24 (via nvm — recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 24
nvm use 24

# pnpm (package manager)
npm install -g pnpm@latest

# Python 3.11+ (for Scout OSINT microservice)
# macOS:   brew install python@3.11
# Ubuntu:  sudo apt install python3.11 python3.11-venv
# Windows: winget install Python.Python.3.11

# uv (Python package manager — faster than pip)
curl -LsSf https://astral.sh/uv/install.sh | sh

# PostgreSQL 14+
# macOS:   brew install postgresql@16 && brew services start postgresql@16
# Ubuntu:  sudo apt install postgresql-16 && sudo systemctl start postgresql
# Docker:  docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:16
```

Playwright browsers (needed for scraping features):
```bash
npx playwright install chromium
```

---

## Step 1 — Database

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE enrich;"

# OR with Docker (simplest):
docker run -d \
  --name prospectsa-db \
  -e POSTGRES_DB=enrich \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:16
```

Set in `.env`:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/enrich
```

---

## Step 2 — Install dependencies

```bash
pnpm install
```

This installs all workspace packages: api-server, prospect-sa, mockup-sandbox,
all lib/* packages, and scripts.

---

## Step 3 — Fill in missing API keys in .env

Open `.env` and add:
```
ANTHROPIC_API_KEY=sk-ant-...   # console.anthropic.com
PERPLEXITY_API_KEY=pplx-...    # perplexity.ai/api
GEMINI_API_KEY=AIza...         # aistudio.google.com
```

OpenAI, Apollo, and Explorium are already pre-filled.

---

## Step 4 — Apply schema and seed data

```bash
# Create all 30+ tables
pnpm --filter @workspace/db run db:push

# Seed Option A — Direct SQL (fastest, no LLM calls needed):
psql $DATABASE_URL -f seed_data.sql
# → 2,041 companies + 6,942 executives loaded immediately

# Seed Option B — Auto-seed on first boot:
# The server detects empty tables and seeds from gz files automatically.
# Just start the server (Step 5) and wait ~30 seconds.
```

Verify seed:
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM companies;"    # → 2041
psql $DATABASE_URL -c "SELECT COUNT(*) FROM executives;"   # → 6942
```

---

## Step 5 — Start all services

Open 3 terminal windows:

**Terminal 1 — API server:**
```bash
pnpm --filter @workspace/api-server run dev
# Listening on http://localhost:3000
```

**Terminal 2 — Frontend:**
```bash
pnpm --filter @workspace/prospect-sa run dev
# Running at http://localhost:5173
```

**Terminal 3 — Scout OSINT microservice (optional but recommended):**
```bash
cd artifacts/python-scout
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8099
# Running at http://localhost:8099
```

---

## Step 6 — Verify everything works

```bash
curl http://localhost:3000/api/healthz
# → {"status":"ok"}

curl http://localhost:3000/api/readyz
# → {"status":"ok"}

curl http://localhost:3000/api/companies/stats
# → {"total":2041,"byCity":{...},"byIndustry":{...}}
```

Open the frontend: **http://localhost:5173**

---


## Production build

```bash
# TypeScript check
pnpm run typecheck

# Build everything
pnpm run build
# → artifacts/api-server/dist/index.js (esbuild)
# → artifacts/prospect-sa/dist/ (Vite)

# Run production API server
NODE_ENV=production node artifacts/api-server/dist/index.js
```

Serve the frontend with nginx or any static file server:
```nginx
server {
    listen 80;
    root /path/to/artifacts/prospect-sa/dist;
    try_files $uri /index.html;

    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

---

## Process management (production)

```bash
# Install PM2
npm install -g pm2

# Start API server
pm2 start artifacts/api-server/dist/index.js \
  --name prospectsa-api \
  --env production

# Start Scout
pm2 start \
  "cd artifacts/python-scout && uv run uvicorn main:app --host 0.0.0.0 --port 8099" \
  --name prospectsa-scout

# Save PM2 config + auto-restart on reboot
pm2 save
pm2 startup
```

---

## Docker Compose (full stack)

```yaml
# docker-compose.yml
version: '3.9'
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: enrich
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./seed_data.sql:/docker-entrypoint-initdb.d/seed.sql

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:password@db:5432/enrich
      PORT: 3000
      NODE_ENV: production
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      PERPLEXITY_API_KEY: ${PERPLEXITY_API_KEY}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      APOLLO_API_KEY: ${APOLLO_API_KEY}
      APOLLO_CLIENT_SECRET: ${APOLLO_CLIENT_SECRET}
      APOLLO_ACCESS_TOKEN: ${APOLLO_ACCESS_TOKEN}
      EXPLORIUM_API_KEY: ${EXPLORIUM_API_KEY}
      SCOUT_URL: http://scout:8099
    depends_on:
      - db

  scout:
    build:
      context: ./artifacts/python-scout
      dockerfile: Dockerfile
    ports:
      - "8099:8099"

  frontend:
    build:
      context: ./artifacts/prospect-sa
      dockerfile: Dockerfile
    ports:
      - "5173:80"
    depends_on:
      - api

volumes:
  pgdata:
```

**Dockerfile.api:**
```dockerfile
FROM node:24-slim
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/ ./lib/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @workspace/api-server run build
CMD ["node", "artifacts/api-server/dist/index.js"]
```

**artifacts/python-scout/Dockerfile:**
```dockerfile
FROM python:3.11-slim
RUN pip install uv
WORKDIR /app
COPY requirements.txt .
RUN uv pip install --system -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8099"]
```

**artifacts/prospect-sa/Dockerfile:**
```dockerfile
FROM node:24-slim AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install && pnpm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

---

## Environment variable reference (quick)

| Variable | Source | Required |
|---|---|---|
| `DATABASE_URL` | Your PostgreSQL | ✅ |
| `PORT` | Set to 3000 | ✅ |
| `OPENAI_API_KEY` | Pre-filled ✅ | ✅ |
| `ANTHROPIC_API_KEY` | console.anthropic.com | ✅ for Masaar/Claude |
| `PERPLEXITY_API_KEY` | perplexity.ai/api | ✅ for Signals/Intel |
| `GEMINI_API_KEY` | aistudio.google.com | Recommended |
| `APOLLO_API_KEY` | Pre-filled ✅ | For contacts |
| `EXPLORIUM_API_KEY` | Pre-filled ✅ | For firmographics |
| `SCOUT_URL` | http://localhost:8099 | For OSINT features |
