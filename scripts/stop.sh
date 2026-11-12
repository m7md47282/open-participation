#!/usr/bin/env bash
# Stop and remove the Docker deployment. Data is in memory, so it resets.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down
