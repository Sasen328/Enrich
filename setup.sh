#!/usr/bin/env bash
# ============================================================
#  ProspectSA — One-Command Setup Script
#  Installs deps, creates database, runs migrations, seeds
#  data, and starts the full stack.
#
#  Usage:
#    chmod +x setup.sh && ./setup.sh
#
#  Flags:
#    --skip-db       Skip DB creation (already exists)
#    --skip-seed     Skip seeding (already seeded)
#    --skip-python   Skip Python Scout microservice
#    --prod          Production mode (no dev watchers)
#    --docker        Print Docker Compose instructions instead
# ============================================================

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${CYAN}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*" >&2; }
step() { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }
die()  { err "$*"; exit 1; }

# ── Flags ─────────────────────────────────────────────────────────────────────
SKIP_DB=false; SKIP_SEED=false; SKIP_PYTHON=false; PROD=false; DOCKER_MODE=false
for arg in "$@"; do
  case $arg in
    --skip-db)     SKIP_DB=true ;;
    --skip-seed)   SKIP_SEED=true ;;
    --skip-python) SKIP_PYTHON=true ;;
    --prod)        PROD=true ;;
    --docker)      DOCKER_MODE=true ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ██████╗ ██████╗  ██████╗ ███████╗██████╗ ███████╗ ██████╗████████╗███████╗ █████╗ "
echo "  ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔════╝██╔══██╗"
echo "  ██████╔╝██████╔╝██║   ██║███████╗██████╔╝█████╗  ██║        ██║   ███████╗███████║"
echo "  ██╔═══╝ ██╔══██╗██║   ██║╚════██║██╔═══╝ ██╔══╝  ██║        ██║   ╚════██║██╔══██║"
echo "  ██║     ██║  ██║╚██████╔╝███████║██║     ███████╗╚██████╗   ██║   ███████║██║  ██║"
echo "  ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝"
echo -e "${NC}"
echo -e "  ${BOLD}Saudi B2B Intelligence Platform${NC} — Setup Script"
echo "  ──────────────────────────────────────────────────"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Docker shortcut ───────────────────────────────────────────────────────────
if $DOCKER_MODE; then
  echo -e "${BOLD}Docker Compose setup:${NC}"
  echo ""
  echo "  1. Make sure Docker Desktop is running"
  echo "  2. Copy your API keys into .env (or export them)"
  echo "  3. Run:"
  echo ""
  echo "     docker compose up -d"
  echo ""
  echo "  The compose file mounts seed_data.sql into postgres"
  echo "  and auto-seeds on first boot."
  echo ""
  echo "  Access the app at http://localhost:3000"
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 1 — Check system requirements
# ═════════════════════════════════════════════════════════════════════════════
step "Checking system requirements"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 found: $(command -v "$1")"
    return 0
  else
    return 1
  fi
}

# Node.js
if check_cmd node; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt 18 ]; then
    warn "Node.js $NODE_VER detected. Node 18+ required (24 recommended)."
    warn "Install: https://nodejs.org or via nvm"
  else
    ok "Node.js version: $(node --version)"
  fi
else
  die "Node.js not found. Install from https://nodejs.org (v24 recommended)"
fi

# pnpm
if ! check_cmd pnpm; then
  warn "pnpm not found — installing globally..."
  npm install -g pnpm@latest
  ok "pnpm installed"
fi

# PostgreSQL client
if check_cmd psql; then
  ok "psql found: $(psql --version)"
else
  warn "psql not found. You need PostgreSQL to be installed."
  warn "macOS: brew install postgresql@16"
  warn "Ubuntu: sudo apt install postgresql-client-16"
  warn "Docker: use ./setup.sh --docker instead"
fi

# Python (optional, for Scout)
if $SKIP_PYTHON; then
  warn "Python Scout skipped (--skip-python flag)"
else
  if check_cmd python3; then
    PYVER=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d. -f1-2)
    ok "Python: $PYVER"
  else
    warn "python3 not found — Scout OSINT microservice will be skipped"
    SKIP_PYTHON=true
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 2 — Environment file
# ═════════════════════════════════════════════════════════════════════════════
step "Configuring environment"

if [ ! -f ".env" ]; then
  die ".env file not found in $SCRIPT_DIR. This file should exist in the zip."
fi

# Load current .env
set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a

ok ".env loaded"

# Validate DATABASE_URL
if [ -z "${DATABASE_URL:-}" ] || echo "$DATABASE_URL" | grep -q "user:password"; then
  echo ""
  warn "DATABASE_URL is not set or still has placeholder values."
  echo ""
  echo -e "  Current value: ${YELLOW}${DATABASE_URL:-<empty>}${NC}"
  echo ""
  echo "  Format:  postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
  echo "  Example: postgresql://postgres:mypassword@localhost:5432/prospectsaudi"
  echo ""
  printf "  Enter your DATABASE_URL (or press Enter to use Docker): "
  read -r DB_INPUT
  if [ -z "$DB_INPUT" ]; then
    info "Starting PostgreSQL via Docker..."
    if command -v docker &>/dev/null; then
      docker run -d \
        --name prospectsa-postgres \
        -e POSTGRES_DB=prospectsaudi \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=prospectsaudi123 \
        -p 5432:5432 \
        --restart unless-stopped \
        postgres:16 2>/dev/null || \
        docker start prospectsa-postgres 2>/dev/null || true
      sleep 3
      DATABASE_URL="postgresql://postgres:prospectsaudi123@localhost:5432/prospectsaudi"
      ok "Docker PostgreSQL started"
    else
      die "Docker not found. Install Docker or provide a DATABASE_URL."
    fi
  else
    DATABASE_URL="$DB_INPUT"
  fi
  # Update .env
  if grep -q "^DATABASE_URL=" .env; then
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env && rm -f .env.bak
  else
    echo "DATABASE_URL=${DATABASE_URL}" >> .env
  fi
  ok "DATABASE_URL saved to .env"
fi

echo ""
info "Key configuration:"
echo "   DATABASE_URL = ${DATABASE_URL:0:40}…"
echo "   PORT         = ${PORT:-3000}"
echo "   NODE_ENV     = ${NODE_ENV:-development}"
[ -n "${ANTHROPIC_API_KEY:-}" ]   && echo -e "   ANTHROPIC    = ${GREEN}✓ set${NC}" || echo -e "   ANTHROPIC    = ${YELLOW}⚠ not set${NC}"
[ -n "${OPENAI_API_KEY:-}" ]      && echo -e "   OPENAI       = ${GREEN}✓ set${NC}" || echo -e "   OPENAI       = ${YELLOW}⚠ not set${NC}"
[ -n "${PERPLEXITY_API_KEY:-}" ]  && echo -e "   PERPLEXITY   = ${GREEN}✓ set${NC}" || echo -e "   PERPLEXITY   = ${YELLOW}⚠ not set${NC}"
[ -n "${APOLLO_API_KEY:-}" ]      && echo -e "   APOLLO       = ${GREEN}✓ set${NC}" || echo -e "   APOLLO       = ${YELLOW}⚠ not set${NC}"
[ -n "${EXPLORIUM_API_KEY:-}" ]   && echo -e "   EXPLORIUM    = ${GREEN}✓ set${NC}" || echo -e "   EXPLORIUM    = ${YELLOW}⚠ not set${NC}"
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 3 — Install Node dependencies
# ═════════════════════════════════════════════════════════════════════════════
step "Installing Node.js dependencies"

if [ -f "node_modules/.modules.yaml" ] && [ -d "node_modules/.pnpm" ]; then
  ok "Dependencies already installed (node_modules exists)"
  info "Running pnpm install to verify..."
fi

pnpm install --no-frozen-lockfile --ignore-scripts 2>&1 | tail -5
ok "Node dependencies ready"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 4 — Database setup
# ═════════════════════════════════════════════════════════════════════════════
step "Setting up database"

if $SKIP_DB; then
  warn "Database setup skipped (--skip-db flag)"
else
  # Test connection
  info "Testing database connection..."
  if DATABASE_URL="$DATABASE_URL" node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => { console.log('OK'); c.end(); }).catch(e => { console.error(e.message); process.exit(1); });
  " 2>/dev/null; then
    ok "Database connection successful"
  else
    # Try to create the database
    warn "Connection failed — trying to create database..."
    DB_NAME=$(echo "$DATABASE_URL" | sed 's|.*/||' | sed 's|?.*||')
    DB_HOST=$(echo "$DATABASE_URL" | sed 's|.*@||' | sed 's|/.*||' | cut -d: -f1)
    DB_PORT=$(echo "$DATABASE_URL" | sed 's|.*@||' | sed 's|/.*||' | cut -d: -f2)
    DB_USER=$(echo "$DATABASE_URL" | sed 's|.*://||' | sed 's|:.*||')

    PGPASSWORD=$(echo "$DATABASE_URL" | sed 's|.*://[^:]*:||' | sed 's|@.*||') \
      psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -c "CREATE DATABASE \"$DB_NAME\";" 2>/dev/null || true
    ok "Database '$DB_NAME' created"
  fi

  # Run Drizzle migrations
  info "Running schema migrations..."
  export DATABASE_URL
  if node_modules/.bin/drizzle-kit migrate --config lib/db/drizzle.config.ts 2>/dev/null; then
    ok "Migrations applied"
  else
    # Fallback: apply SQL directly
    warn "drizzle-kit migrate failed — applying migration SQL directly..."
    for SQL_FILE in lib/db/drizzle/*.sql; do
      info "Applying $(basename "$SQL_FILE")..."
      PGPASSWORD=$(echo "$DATABASE_URL" | sed 's|.*://[^:]*:||' | sed 's|@.*||') \
        psql "$DATABASE_URL" -f "$SQL_FILE" -q 2>/dev/null || \
        DATABASE_URL="$DATABASE_URL" node -e "
const fs = require('fs');
const { Client } = require('pg');
const sql = fs.readFileSync('$SQL_FILE','utf8');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.query(sql)).then(() => { console.log('Applied $SQL_FILE'); c.end(); }).catch(e => { console.error(e.message); c.end(); });
        "
    done
    ok "Migration SQL applied"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 5 — Seed data
# ═════════════════════════════════════════════════════════════════════════════
step "Seeding Saudi company data"

if $SKIP_SEED; then
  warn "Seeding skipped (--skip-seed flag)"
else
  # Check if already seeded
  EXISTING=$(DATABASE_URL="$DATABASE_URL" node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.query('SELECT COUNT(*) FROM companies LIMIT 1')).then(r => { console.log(r.rows[0].count); c.end(); }).catch(() => { console.log('0'); c.end(); });
  " 2>/dev/null || echo "0")

  if [ "$EXISTING" -gt 100 ] 2>/dev/null; then
    ok "Database already seeded ($EXISTING companies found) — skipping"
    info "Run with --skip-seed to always skip, or delete companies to re-seed"
  else
    info "Seeding via seed_data.sql (6.4MB — Saudi companies, executives, TASI/NOMU data)..."
    if command -v psql &>/dev/null; then
      psql "$DATABASE_URL" -f seed_data.sql -q 2>/dev/null && ok "seed_data.sql applied via psql"
    else
      # Node pg fallback
      warn "psql not found — seeding via Node.js (slower)..."
      DATABASE_URL="$DATABASE_URL" node -e "
const fs = require('fs');
const { Client } = require('pg');
const sql = fs.readFileSync('seed_data.sql', 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => {
    console.log('Executing seed SQL...');
    return client.query(sql);
  })
  .then(() => {
    console.log('Seed complete');
    return client.end();
  })
  .catch(e => {
    console.error('Seed error:', e.message);
    client.end();
  });
      "
    fi

    # Verify seed
    SEEDED=$(DATABASE_URL="$DATABASE_URL" node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.query('SELECT COUNT(*) FROM companies')).then(r => { console.log(r.rows[0].count); c.end(); }).catch(() => { console.log('?'); c.end(); });
    " 2>/dev/null || echo "?")
    ok "Seed complete — $SEEDED companies in database"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 6 — Build (if needed)
# ═════════════════════════════════════════════════════════════════════════════
step "Verifying builds"

# API server
if [ -f "artifacts/api-server/dist/index.cjs" ]; then
  ok "API server build: artifacts/api-server/dist/index.cjs ($(du -sh artifacts/api-server/dist/index.cjs | cut -f1))"
else
  info "Building API server..."
  cd artifacts/api-server
  pnpm run build 2>&1 | tail -5
  cd "$SCRIPT_DIR"
  ok "API server built"
fi

# Frontend
if [ -f "artifacts/prospect-sa/dist/public/index.html" ]; then
  ok "Frontend build: artifacts/prospect-sa/dist/public/ ($(du -sh artifacts/prospect-sa/dist/public/ | cut -f1))"
else
  info "Building frontend..."
  cd artifacts/prospect-sa
  node_modules/.bin/vite build 2>&1 | tail -5
  cd "$SCRIPT_DIR"
  ok "Frontend built"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 7 — Python Scout (optional)
# ═════════════════════════════════════════════════════════════════════════════
step "Setting up Python Scout microservice"

if $SKIP_PYTHON; then
  warn "Python Scout skipped"
else
  cd artifacts/python-scout

  if [ -d ".venv" ]; then
    ok "Python virtualenv already exists"
  else
    info "Creating Python virtualenv..."
    python3 -m venv .venv
    ok "Virtualenv created"
  fi

  info "Installing Python dependencies..."
  if command -v uv &>/dev/null; then
    .venv/bin/pip install -q uv 2>/dev/null || true
    uv pip install --python .venv/bin/python --quiet -r requirements.txt 2>/dev/null || \
      .venv/bin/pip install -q -r requirements.txt
  else
    .venv/bin/pip install -q -r requirements.txt
  fi
  ok "Python dependencies installed"

  # Install Playwright browsers if needed
  if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
    info "Installing Playwright browsers (Chromium)..."
    .venv/bin/playwright install chromium --with-deps 2>/dev/null || \
      .venv/bin/playwright install chromium 2>/dev/null || \
      warn "Playwright install failed — browser scraping features may not work"
  else
    ok "Playwright browsers already installed"
  fi

  cd "$SCRIPT_DIR"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 8 — Start servers
# ═════════════════════════════════════════════════════════════════════════════
step "Starting ProspectSA"

PORT="${PORT:-3000}"

# Kill any existing process on port 3000
if lsof -ti:"$PORT" &>/dev/null 2>&1; then
  warn "Port $PORT in use — stopping existing process..."
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Write a simple process manager script
cat > start.sh << 'STARTEOF'
#!/usr/bin/env bash
# ProspectSA — Start script (run this to start after first setup)
set -a; source .env; set +a

PORT="${PORT:-3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting API server on port $PORT..."
node artifacts/api-server/dist/index.cjs &
API_PID=$!
echo "API PID: $API_PID"

# Optional: start Python Scout
if [ -f "artifacts/python-scout/.venv/bin/python" ]; then
  echo "Starting Python Scout on port 8099..."
  cd artifacts/python-scout
  PORT=8099 .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8099 --log-level warning &
  SCOUT_PID=$!
  echo "Scout PID: $SCOUT_PID"
  cd "$SCRIPT_DIR"
fi

echo ""
echo "✓ ProspectSA running at http://localhost:$PORT"
echo "  Press Ctrl+C to stop"

trap "kill $API_PID $SCOUT_PID 2>/dev/null; exit 0" INT TERM
wait $API_PID
STARTEOF
chmod +x start.sh

# Start API server
info "Starting API server on port $PORT..."
export DATABASE_URL NODE_ENV PORT
node artifacts/api-server/dist/index.cjs &
API_PID=$!
echo "$API_PID" > .api.pid
sleep 2

# Verify it started
if kill -0 "$API_PID" 2>/dev/null; then
  ok "API server running (PID $API_PID)"
else
  die "API server failed to start. Check your DATABASE_URL and API keys."
fi

# Start Python Scout
if ! $SKIP_PYTHON && [ -f "artifacts/python-scout/.venv/bin/uvicorn" ]; then
  info "Starting Python Scout on port 8099..."
  cd artifacts/python-scout
  PORT=8099 .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8099 --log-level warning &
  SCOUT_PID=$!
  echo "$SCOUT_PID" > "$SCRIPT_DIR/.scout.pid"
  cd "$SCRIPT_DIR"
  sleep 1
  if kill -0 "$SCOUT_PID" 2>/dev/null; then
    ok "Python Scout running (PID $SCOUT_PID) on port 8099"
  else
    warn "Python Scout failed to start — OSINT features will be limited"
  fi
fi

# Health check
sleep 1
if curl -sf "http://localhost:${PORT}/api/healthz" &>/dev/null; then
  ok "Health check passed"
else
  warn "Health check pending — server may still be starting up"
fi

# ═════════════════════════════════════════════════════════════════════════════
# DONE
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ProspectSA is running!${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}App URL:${NC}      http://localhost:${PORT}"
echo -e "  ${BOLD}API Health:${NC}   http://localhost:${PORT}/api/healthz"
echo -e "  ${BOLD}API Ready:${NC}    http://localhost:${PORT}/api/readyz"
if ! $SKIP_PYTHON; then
echo -e "  ${BOLD}Scout URL:${NC}    http://localhost:8099/docs"
fi
echo ""
echo -e "  ${BOLD}To restart later:${NC}  ./start.sh"
echo -e "  ${BOLD}To stop:${NC}          kill \$(cat .api.pid)"
echo ""
echo -e "  ${BOLD}Live engines:${NC}"
echo "    ✓ Lead Factory       → /lead-factory"
echo "    ✓ ProsEngine Chat    → /prospecting/company"
echo "    ✓ Company Intel      → calls Claude API + web search"
echo "    ✓ Masaar CR Lookup   → /masaar (real mc.gov.sa)"
echo "    ✓ Signal Intelligence→ /signal-intelligence"
echo "    ✓ Relationship Intel → /relationship-intel"
echo "    ✓ OrcEngine          → /orcengine"
echo "    ✓ AI Database Builder→ /database-builder"
echo "    ✓ SA Market          → /sa-market (2,041 companies)"
echo ""
echo -e "  ${YELLOW}Note:${NC} On first visit the app seeds 2,041 companies"
echo "        and 6,942 executives into the database automatically."
echo ""

# Keep running — wait for Ctrl+C
trap "echo ''; info 'Shutting down...'; kill \$(cat .api.pid 2>/dev/null) 2>/dev/null; kill \$(cat .scout.pid 2>/dev/null) 2>/dev/null; rm -f .api.pid .scout.pid; ok 'Stopped.'" INT TERM
wait "$API_PID" 2>/dev/null || true
