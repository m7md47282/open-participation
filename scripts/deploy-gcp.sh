#!/usr/bin/env bash
# Deploy to Google Cloud Run at the lowest cost: scale to zero, one instance at most, 256 MiB,
# CPU billed only while handling requests. A demo stays inside the free tier.
#
# Usage: GCP_PROJECT=my-project scripts/deploy-gcp.sh
# Optional: GCP_REGION (default us-central1), GCP_ACCOUNT (gcloud account to use), SERVICE (default open-participation)
#
# Requires: gcloud (logged in), Docker with buildx. The project must have billing enabled.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GCP_PROJECT:?Set GCP_PROJECT to the Google Cloud project ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-open-participation}"
REPO="open-participation"
GCLOUD=(gcloud --project "$GCP_PROJECT" --quiet)
[[ -n "${GCP_ACCOUNT:-}" ]] && GCLOUD+=(--account "$GCP_ACCOUNT")

echo "==> Enabling APIs (Cloud Run, Artifact Registry, Secret Manager)"
"${GCLOUD[@]}" services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

echo "==> Image repository"
if ! "${GCLOUD[@]}" artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1; then
  "${GCLOUD[@]}" artifacts repositories create "$REPO" --location "$REGION" --repository-format docker \
    --description "Open Participation images"
fi
# Keep only the two newest images so storage stays inside the 0.5 GB free tier.
cat > /tmp/op-cleanup-policy.json <<'EOF'
[
  { "name": "keep-two-newest", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 2 } },
  { "name": "delete-the-rest", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
EOF
"${GCLOUD[@]}" artifacts repositories set-cleanup-policies "$REPO" --location "$REGION" \
  --policy /tmp/op-cleanup-policy.json --no-dry-run >/dev/null
rm -f /tmp/op-cleanup-policy.json

echo "==> Signing keys in Secret Manager (created once, never printed)"
PROJECT_NUMBER="$("${GCLOUD[@]}" projects describe "$GCP_PROJECT" --format 'value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for secret in grant-signing-key cdn-signing-key; do
  if ! "${GCLOUD[@]}" secrets describe "$secret" >/dev/null 2>&1; then
    openssl rand -hex 32 | tr -d '\n' | "${GCLOUD[@]}" secrets create "$secret" --replication-policy automatic --data-file -
  fi
  "${GCLOUD[@]}" secrets add-iam-policy-binding "$secret" \
    --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "==> Building the image for linux/amd64 and pushing it"
IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO}/app:$(date +%Y%m%d-%H%M%S)"
"${GCLOUD[@]}" auth configure-docker "${REGION}-docker.pkg.dev" >/dev/null
docker buildx build --platform linux/amd64 -t "$IMAGE" --push .

echo "==> Deploying to Cloud Run"
# The service URL is deterministic, so share links and QR codes can point at it from the first deploy.
PUBLIC_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
"${GCLOUD[@]}" run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --memory 256Mi \
  --cpu 1 \
  --cpu-throttling \
  --concurrency 80 \
  --timeout 60 \
  --set-env-vars "NODE_ENV=production,PUBLIC_BASE_URL=${PUBLIC_URL},TRUST_PROXY=1" \
  --set-secrets "GRANT_SIGNING_KEY=grant-signing-key:latest,CDN_SIGNING_KEY=cdn-signing-key:latest"

echo
echo "Deployed."
echo "  Admin page:  ${PUBLIC_URL}/admin"
echo "  Test cases:  ${PUBLIC_URL}/test-cases"
echo "  Health:      ${PUBLIC_URL}/health"
