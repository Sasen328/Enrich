#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "🚀 ProspectSA post-start..."

# Start PostgreSQL if installed via devcontainer feature and not already running
if command -v pg_isready >/dev/null 2>&1; then
    if ! pg_isready -q; then
        echo "→ Starting PostgreSQL..."
        sudo service postgresql start || echo "⚠ Could not start PostgreSQL — may be managed externally"
    fi
fi

# Verify .env exists
if [ ! -f .env ]; then
    echo "⚠ No .env file found. Run the post-create setup or create one manually."
fi

echo "✅ Post-start complete"
