#!/usr/bin/env bash
# Run locally without Docker: build the Angular app and serve everything from the backend on one port.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/setup.sh
(cd frontend && npx ng build)
(cd backend && npm run build)

export PORT="${PORT:-3000}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://localhost:${PORT}}"
export STATIC_DIR="$(pwd)/frontend/dist/frontend/browser"
echo "Admin page: ${PUBLIC_BASE_URL}/admin"
exec node backend/dist/server.js
