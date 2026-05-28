#!/usr/bin/env bash
# Replit boot script for ProspectSA. Installs deps, builds the frontend + API,
# syncs the DB schema, then starts the stack (start.sh runs Scout + Node API).
set -euo pipefail

echo "→ Enabling pnpm via corepack"
corepack enable >/dev/null 2>&1 || npm i -g pnpm@9

echo "→ Installing JS dependencies"
pnpm install --frozen-lockfile || pnpm install

echo "→ Installing Python Scout dependencies"
if command -v uv >/dev/null 2>&1; then uv sync || true
else python3 -m pip install -r artifacts/python-scout/requirements.txt || true; fi

echo "→ Building frontend + API"
pnpm run build

# start.sh: drizzle push + SQL migrations, launches Python Scout, then the Node API.
exec bash start.sh
