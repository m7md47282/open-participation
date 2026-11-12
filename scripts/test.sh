#!/usr/bin/env bash
# Type-check and run the end-to-end tests. Request and audit log lines are hidden for readability.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/setup.sh
cd backend
npm run typecheck
npm test 2>&1 | grep -v -E '"msg":"(http|audit)"'
exit "${PIPESTATUS[0]}"
