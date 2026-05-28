#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "🔧 ProspectSA Codespace Setup"
echo "================================"

# 1. Install pnpm via corepack
echo "→ Enabling corepack / pnpm..."
corepack enable && corepack prepare pnpm@9.15.9 --activate || true

# 2. Install Node dependencies
echo "→ Installing Node dependencies (pnpm)..."
if [ -f pnpm-lock.yaml ]; then
    pnpm install --frozen-lockfile
else
    pnpm install
fi

# 3. Install Playwright Chromium for scraping features
echo "→ Installing Playwright Chromium..."
npx playwright install chromium || echo "⚠ Playwright install skipped — may need manual install"

# 4. Setup Python Scout virtual environment via uv
echo "→ Setting up Python Scout environment..."
if command -v uv &>/dev/null && [ -f artifacts/python-scout/requirements.txt ]; then
    cd artifacts/python-scout
    uv venv .venv || true
    uv pip install -r requirements.txt || echo "⚠ Scout deps install failed — some features will be degraded"
    cd ../..
else
    echo "⚠ uv not available or requirements.txt missing — skipping Scout setup"
fi

# 5. Ensure .env exists for local dev
if [ ! -f .env ]; then
    echo "→ Creating .env from template..."
    cat > .env << 'EOF'
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://prospectsa:prospectsa_secret@db:5432/prospectsa
POSTGRES_PASSWORD=prospectsa_secret
API_TOKEN=dev-token-codespace
FRONTEND_ORIGIN=http://localhost:5173
SCOUT_URL=http://localhost:8099

# --- AI PROVIDERS (add your real keys) ---
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
PERPLEXITY_API_KEY=
HUGGING_FACE_API_KEY=
MANUS_API_KEY=

# --- CONTACT / DATA APIs (optional) ---
APOLLO_API_KEY=
APOLLO_CLIENT_ID=
APOLLO_CLIENT_SECRET=
APOLLO_ACCESS_TOKEN=
EXPLORIUM_API_KEY=
HUNTER_API_KEY=
WAPPALYZER_API_KEY=
EOF
    echo "✅ Created .env — fill in your API keys before starting services"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Fill in API keys in .env (if you haven't)"
echo "  2. Start DB:   sudo service postgresql start  (or use docker compose up db)"
echo "  3. Push schema: pnpm --filter @workspace/db run push --force"
echo "  4. Seed data:  psql \$DATABASE_URL -f seed_data.sql"
echo "  5. Start dev:  pnpm --filter @workspace/api-server run dev"
echo "  6. Start UI:   pnpm --filter @workspace/prospect-sa run dev"
echo ""
