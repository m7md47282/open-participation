#!/usr/bin/env bash
# Development mode with live reload: backend on :3000 (tsx watch), Angular dev server on :4200
# proxying /api and /cdn to the backend. Open http://localhost:4200/admin
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/setup.sh

export PUBLIC_BASE_URL="http://localhost:4200"
(cd backend && npm run dev) &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT INT TERM

cd frontend && npx ng serve --open=false
