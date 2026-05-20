#!/usr/bin/env bash
# =============================================================================
#  ProspectSA — Reset & Re-deploy
#
#  Use whenever a new DB migration is added OR you want to nuke local state.
#  Steps:
#    1. Tear down all containers + volumes (postgres data WILL be wiped)
#    2. Prune Docker images + build cache (reclaims 10-15 GB typically)
#    3. Pull latest main from origin (force-sync local main to remote)
#    4. Rebuild the app image without cache (forces fresh migration apply)
#    5. Start everything detached
#    6. Tail logs until "ProspectSA ready" (Ctrl-C to exit tail)
#
#  After boot, start.sh re-applies every lib/db/drizzle/*.sql migration
#  (idempotent via CREATE TABLE IF NOT EXISTS), then auto-reloads
#  seed_data.sql (2041 companies + 6942 executives — ~30 sec).
#
#  Usage:
#    bash scripts/reset-and-deploy.sh
#    bash scripts/reset-and-deploy.sh --skip-pull   # don't touch git
#    bash scripts/reset-and-deploy.sh --keep-seed   # don't wipe postgres
# =============================================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
say()  { echo -e "${CYAN}▶${NC}  ${BOLD}$*${NC}"; }
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }

SKIP_PULL=0
KEEP_SEED=0
for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=1 ;;
    --keep-seed) KEEP_SEED=1 ;;
    -h|--help)   sed -n '2,21p' "$0"; exit 0 ;;
    *) warn "Unknown flag: $arg" ;;
  esac
done

echo ""
echo -e "${BOLD}${CYAN}ProspectSA — Reset & Re-deploy${NC}"
echo "================================"
echo ""

# 1. Tear down
say "Stopping containers..."
if [ "$KEEP_SEED" = "1" ]; then
  docker compose down 2>&1 | tail -3 || true
  ok "Containers stopped (seed volume PRESERVED)"
else
  docker compose down -v 2>&1 | tail -3 || true
  ok "Containers + volumes wiped (seed will auto-reload on next boot)"
fi

# 2. Prune
say "Pruning Docker images + build cache..."
BEFORE=$(df --output=avail / 2>/dev/null | tail -1 || echo 0)
docker system prune -af --volumes 2>&1 | tail -2 || true
docker builder prune -af 2>&1 | tail -2 || true
AFTER=$(df --output=avail / 2>/dev/null | tail -1 || echo 0)
RECLAIMED_KB=$((AFTER - BEFORE))
RECLAIMED_GB=$((RECLAIMED_KB / 1024 / 1024))
[ "$RECLAIMED_GB" -gt 0 ] && ok "Reclaimed ~${RECLAIMED_GB} GB" || ok "Cache pruned"

# 3. Pull
if [ "$SKIP_PULL" = "0" ]; then
  say "Syncing local main → origin/main (hard reset)..."
  git fetch origin main 2>&1 | tail -1
  git checkout main 2>&1 | tail -1
  git reset --hard origin/main 2>&1 | tail -1
  HEAD_SHA=$(git rev-parse --short HEAD)
  HEAD_MSG=$(git log -1 --pretty=%s)
  ok "On main @ ${HEAD_SHA} — \"${HEAD_MSG}\""
else
  warn "--skip-pull set; using whatever is checked out"
fi

# 4. Rebuild
say "Rebuilding app image (no cache — picks up new migrations + code)..."
docker compose build --no-cache --pull app

# 5. Start
say "Starting containers..."
docker compose up -d

# 6. Tail
echo ""
ok "Boot started. Tailing logs — press Ctrl-C when you see 'ProspectSA ready'."
echo ""
sleep 2
docker compose logs -f app
