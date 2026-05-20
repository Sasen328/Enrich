#!/usr/bin/env bash
# ============================================================
#  ProspectSA — Sync prototype + frontend changes into prod
#
#  What this does:
#    1. Pull latest main
#    2. Verify the SA Market sidebar removal landed
#    3. Verify the v8 composer prototype landed
#    4. Restart docker app (no -v so seed survives)
#    5. Tail logs until ready
#
#  Usage on the Codespace / VPS / Oracle VM:
#    bash scripts/sync-prod.sh
# ============================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "▶ Pulling latest main…"
git fetch origin main
git checkout main
git reset --hard origin/main

echo "▶ Verifying changes landed…"
test -f docs/prototypes/ai-chat-composer.html || { echo "✗ composer prototype missing"; exit 1; }
grep -q "SA Market (Tadawul shareholders" artifacts/prospect-sa/src/components/layout/AppSidebar.tsx || echo "⚠ SA Market guard not found — check sidebar"
echo "✓ files present"

echo "▶ Rebuilding app container (no volume wipe — seed preserved)…"
docker compose build app
docker compose up -d

echo "▶ Tailing logs… (Ctrl-C when you see 'ProspectSA ready')"
docker compose logs -f app
