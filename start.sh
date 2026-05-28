#!/usr/bin/env bash
# ============================================================
#  ProspectSA — Runtime Start Script
#  Sequence:
#    1. Resolve Puppeteer → shared Playwright Chromium
#    2. Run Drizzle DB push (schema sync / migrations)
#    3. Start Python Scout sidecar on port 8099 (background)
#    4. Start Node API server on PORT (foreground)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC}  $*"; }
info() { echo -e "${CYAN}→${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*" >&2; }

echo ""
echo -e "${BOLD}${CYAN}  ProspectSA — Starting...${NC}"
echo "  ──────────────────────────────────────────────────"
echo ""

# ── 1. Wire Puppeteer to shared Playwright Chromium ──────────────────────────
info "Resolving shared Chromium path..."
CHROMIUM_PATH=$(find /ms-playwright -name "chrome" -type f 2>/dev/null | head -1 || echo "")
if [ -n "$CHROMIUM_PATH" ]; then
    export PUPPETEER_EXECUTABLE_PATH="$CHROMIUM_PATH"
    ok "Puppeteer → $CHROMIUM_PATH"
else
    warn "Shared Chromium not found at /ms-playwright — Puppeteer will attempt its own download"
fi

# ── 2. Database schema sync ──────────────────────────────────────────────────
# Strategy: try drizzle-kit push first (idiomatic), then ALWAYS apply the
# committed SQL migration files via psql as a safety net. ON_ERROR_STOP=0
# absorbs "relation already exists" so repeat boots are idempotent. After
# both, verify the critical tables exist; bail loudly if not.
info "Running database schema sync (drizzle-kit push)..."
if DATABASE_URL="${DATABASE_URL}" pnpm --filter @workspace/db push --force 2>&1; then
    ok "drizzle-kit push reported success"
else
    warn "drizzle-kit push had errors — relying on SQL migration fallback"
fi

# ── 2a. Safety net: apply lib/db/drizzle/*.sql unconditionally via psql ──────
MIGRATIONS_DIR="$SCRIPT_DIR/lib/db/drizzle"
if command -v psql >/dev/null 2>&1 && [ -d "$MIGRATIONS_DIR" ]; then
    info "Looking for SQL migrations in $MIGRATIONS_DIR ..."
    MIGRATION_FILES=$(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort)
    if [ -z "$MIGRATION_FILES" ]; then
        warn "NO .sql files found in $MIGRATIONS_DIR — volume mount may not be applied"
    else
        info "Found these migration files (in apply order):"
        echo "$MIGRATION_FILES" | while read f; do echo "      $(basename "$f") ($(wc -l <"$f") lines, $(stat -c%s "$f") bytes)"; done
        info "Applying each via psql..."
        MIGRATION_COUNT=0
        for sql in $MIGRATION_FILES; do
            info "  → Applying $(basename "$sql") ..."
            # Don't filter output — we need to see real errors
            psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$sql" 2>&1 \
                | grep -vE "^NOTICE|^CREATE TABLE$|^ALTER TABLE$|^CREATE INDEX$|^INSERT |^$" \
                | sed 's/^/      /' || true
            MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
        done
        ok "Applied $MIGRATION_COUNT SQL migration file(s)"
    fi
else
    warn "psql not installed OR migration dir missing — skipping SQL safety net"
fi

# ── 2b. Verify the critical tables exist; abort boot if not ──────────────────
info "Verifying critical tables exist..."
MISSING_TABLES=()
for tbl in companies executives masar_companies lead_factory_jobs lead_lists leads; do
    if ! psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='$tbl'" 2>/dev/null | grep -q 1; then
        MISSING_TABLES+=("$tbl")
    fi
done
if [ ${#MISSING_TABLES[@]} -gt 0 ]; then
    err "Required tables missing after migration: ${MISSING_TABLES[*]}"
    err "Migrations did not create the required tables. Check DATABASE_URL and re-run: pnpm --filter @workspace/db push --force"
    exit 1
fi
ok "All critical tables present"

# ── 2b. Load seed_data.sql on first boot (when companies table is empty) ─────
# Idempotent: runs only when SELECT count(*) FROM companies = 0. Loads ~2k
# companies + ~7k executives + supporting rows so the app has real data on
# first open instead of empty tables. Subsequent boots skip it.
SEED_FILE="$SCRIPT_DIR/seed_data.sql"
if [ -f "$SEED_FILE" ] && command -v psql >/dev/null 2>&1; then
    info "Checking whether to load seed_data.sql..."
    EXISTING=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM companies" 2>/dev/null | tr -d ' ' || echo "0")
    if [ "${EXISTING:-0}" -eq 0 ]; then
        info "Companies table empty — loading seed_data.sql ($(du -h "$SEED_FILE" | cut -f1))..."
        if psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f "$SEED_FILE" >/tmp/seed.log 2>&1; then
            COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM companies" 2>/dev/null | tr -d ' ' || echo "?")
            ok "Seed loaded — companies: ${COUNT}"
        else
            warn "Seed load reported errors — see /tmp/seed.log inside the container; continuing"
        fi
    else
        ok "Companies table already has ${EXISTING} rows — skipping seed"
    fi
else
    [ -f "$SEED_FILE" ] || warn "seed_data.sql not present in image — skipping"
    command -v psql >/dev/null 2>&1 || warn "psql not installed — skipping seed"
fi

# ── 3. Start Python Scout microservice (background) ──────────────────────────
SCOUT_VENV="/opt/scout-venv"
SCOUT_DIR="$SCRIPT_DIR/artifacts/python-scout"

if [ -f "$SCOUT_VENV/bin/uvicorn" ] && [ -f "$SCOUT_DIR/main.py" ]; then
    info "Starting Python Scout on port 8099..."
    cd "$SCOUT_DIR"
    PORT=8099 GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
        "$SCOUT_VENV/bin/uvicorn" main:app \
        --host 0.0.0.0 \
        --port 8099 \
        --log-level warning \
        --no-access-log &
    SCOUT_PID=$!
    echo "$SCOUT_PID" > /tmp/.scout.pid
    cd "$SCRIPT_DIR"
    sleep 2
    if kill -0 "$SCOUT_PID" 2>/dev/null; then
        ok "Python Scout running (PID $SCOUT_PID)"
    else
        warn "Python Scout failed to start — scraping features will be degraded"
    fi
else
    warn "Python Scout not found — scraping features will be degraded"
fi

# ── 4. Start Node API server (foreground) ────────────────────────────────────
info "Starting Node API server on port ${PORT:-3000}..."
echo ""
echo -e "  ${BOLD}${GREEN}ProspectSA ready → http://localhost:${PORT:-3000}${NC}"
echo ""

# Graceful shutdown: kill Scout when Node exits
cleanup() {
    if [ -f /tmp/.scout.pid ]; then
        SPID=$(cat /tmp/.scout.pid)
        kill "$SPID" 2>/dev/null && ok "Python Scout stopped" || true
        rm -f /tmp/.scout.pid
    fi
}
trap cleanup EXIT INT TERM

exec node artifacts/api-server/dist/index.cjs
