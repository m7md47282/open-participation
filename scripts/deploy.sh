#!/usr/bin/env bash
# Build the Docker image and run it with docker compose.
# Usage: scripts/deploy.sh          (localhost)
#        scripts/deploy.sh --lan    (QR codes use this machine's LAN address, so a phone can scan them)
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop and retry." >&2; exit 1; }

if [[ ! -f .env ]]; then
  echo "Creating .env with freshly generated signing keys"
  cp .env.example .env
  sed -i.bak "s/^GRANT_SIGNING_KEY=.*/GRANT_SIGNING_KEY=$(openssl rand -hex 32)/" .env
  sed -i.bak "s/^CDN_SIGNING_KEY=.*/CDN_SIGNING_KEY=$(openssl rand -hex 32)/" .env
  rm -f .env.bak
fi

if [[ "${1:-}" == "--lan" ]]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$LAN_IP" ]] || { echo "Could not detect a LAN address." >&2; exit 1; }
  HOST_PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2)"
  sed -i.bak "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=http://${LAN_IP}:${HOST_PORT:-3000}#" .env && rm -f .env.bak
fi

BASE_URL="$(grep -E '^PUBLIC_BASE_URL=' .env | cut -d= -f2)"
HOST_PORT="$(grep -E '^HOST_PORT=' .env | cut -d= -f2)"
HOST_PORT="${HOST_PORT:-3000}"

docker compose up --build -d

echo -n "Waiting for the app"
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:${HOST_PORT}/healthz" >/dev/null; then
    echo
    echo "Running."
    echo "  Admin page:  ${BASE_URL}/admin"
    echo "  Health:      http://localhost:${HOST_PORT}/healthz"
    echo "  Logs:        docker compose logs -f"
    echo "  Stop:        scripts/stop.sh"
    exit 0
  fi
  echo -n "."
  sleep 1
done
echo
echo "The app did not become healthy. Recent logs:" >&2
docker compose logs --tail 50 >&2
exit 1
