#!/usr/bin/env bash
# Runs on every Codespace start — make sure PostgreSQL is up.
set -e
sudo service postgresql start >/dev/null 2>&1 || true
echo "✓ PostgreSQL up · DATABASE_URL=$DATABASE_URL"
