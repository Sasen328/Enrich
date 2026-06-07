#!/usr/bin/env bash
# Codespaces / devcontainer one-time setup.
# Installs PostgreSQL 16 locally (no docker-compose), wires pnpm + Playwright,
# creates the DB, runs migrations, and seeds. Idempotent — safe to re-run.
set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${CYAN}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }

# ── 1. pnpm via corepack ─────────────────────────────────────────────────────
info "Enabling pnpm via corepack"
corepack enable >/dev/null 2>&1 || sudo npm i -g pnpm@9
ok "pnpm: $(pnpm --version 2>/dev/null || echo missing)"

# ── 2. PostgreSQL 16 (local, no docker) ──────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  info "Installing PostgreSQL 16"
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/postgresql.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y postgresql-16 postgresql-client-16
fi
ok "psql: $(psql --version)"

info "Starting PostgreSQL"
sudo service postgresql start
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='prospectsa'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE prospectsa WITH LOGIN PASSWORD 'prospectsa' SUPERUSER"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='prospectsa'" | grep -q 1 \
  || sudo -u postgres createdb -O prospectsa prospectsa
ok "PostgreSQL ready · DATABASE_URL=postgresql://prospectsa:prospectsa@localhost:5432/prospectsa"

# ── 3. .env (idempotent) ─────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cat > .env <<EOF
DATABASE_URL=postgresql://prospectsa:prospectsa@localhost:5432/prospectsa
PORT=3000
NODE_ENV=development
SCOUT_URL=http://localhost:8099
# Add at least one LLM key to unlock AI features (see docs/ENV.md):
# OPENROUTER_API_KEY=
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# GEMINI_API_KEY=
# GROQ_API_KEY=
# DEEPSEEK_API_KEY=
# MOONSHOT_API_KEY=
# PERPLEXITY_API_KEY=
EOF
  ok ".env created"
fi

# ── 4. JS deps ───────────────────────────────────────────────────────────────
info "Installing JS dependencies (pnpm)"
pnpm install --frozen-lockfile || pnpm install
ok "pnpm install complete"

# ── 5. Playwright Chromium (for scraper layers 2/3) ─────────────────────────
info "Installing Playwright Chromium + system libs"
pnpm exec playwright install --with-deps chromium >/dev/null 2>&1 || \
  warn "Playwright install had issues — power-scraper L2/L3 may be degraded"

# ── 6. Python Scout deps ─────────────────────────────────────────────────────
info "Installing Python Scout dependencies"
if command -v uv >/dev/null 2>&1; then
  uv sync 2>/dev/null || true
else
  python3 -m pip install --user -q -r artifacts/python-scout/requirements.txt 2>/dev/null || \
    warn "Scout dependencies skipped — Scout features will be unavailable"
fi

# ── 7. DB migrations ─────────────────────────────────────────────────────────
info "Running Drizzle migrations"
set -a; source .env; set +a
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db push --force 2>&1 | tail -5 || \
  warn "drizzle-kit push had errors — SQL fallback will run on first start.sh"

# Apply SQL migrations as a safety net (matches start.sh logic)
if [ -d lib/db/drizzle ]; then
  for sql in $(ls lib/db/drizzle/*.sql 2>/dev/null | sort); do
    PGPASSWORD=prospectsa psql -h localhost -U prospectsa -d prospectsa -v ON_ERROR_STOP=0 -q -f "$sql" >/dev/null 2>&1 || true
  done
fi

echo ""
ok "Codespace ready. Start the stack with:  bash start.sh"
echo "   API → :3000   ·   Frontend dev → :5173   ·   Scout → :8099"
