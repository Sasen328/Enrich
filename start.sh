#!/usr/bin/env bash
# ============================================================
#  ProspectSA — Docker Container Start Script
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

# ── 2. Drizzle DB push (idempotent — safe to run every boot) ─────────────────
info "Running database schema sync (drizzle-kit push)..."
if DATABASE_URL="${DATABASE_URL}" pnpm --filter @workspace/db push --force 2>&1; then
    ok "Database schema up to date"
else
    warn "Drizzle push had warnings (may be first boot) — continuing"
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
