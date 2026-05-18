#!/usr/bin/env bash
# Stop ProspectSA servers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
[ -f .api.pid ]   && kill "$(cat .api.pid)"   2>/dev/null && echo "API server stopped"
[ -f .scout.pid ] && kill "$(cat .scout.pid)" 2>/dev/null && echo "Scout stopped"
rm -f .api.pid .scout.pid
echo "ProspectSA stopped."
