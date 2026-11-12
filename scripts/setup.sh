#!/usr/bin/env bash
# Install dependencies for backend and frontend (skipped when already installed).
set -euo pipefail
cd "$(dirname "$0")/.."

major="$(node -p 'process.versions.node.split(".")[0]')"
if (( major < 22 )); then
  echo "Node 22 or newer is required (found $(node -v))." >&2
  exit 1
fi

[[ -d backend/node_modules ]] || (cd backend && npm ci --no-audit --no-fund)
[[ -d frontend/node_modules ]] || (cd frontend && npm ci --no-audit --no-fund)
