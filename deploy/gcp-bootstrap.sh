#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT.}"
: "${RUNASIS_PUBLIC_ORIGIN:?Set RUNASIS_PUBLIC_ORIGIN to the final Vercel HTTPS origin.}"
: "${RUNASIS_ALLOWED_ATHLETE_ID:?Set RUNASIS_ALLOWED_ATHLETE_ID to your numeric Strava athlete id.}"
: "${STRAVA_CLIENT_ID:?Set STRAVA_CLIENT_ID.}"
: "${STRAVA_CLIENT_SECRET:?Set STRAVA_CLIENT_SECRET.}"

RUNASIS_REGION="${RUNASIS_REGION:-us-west1}"
RUNASIS_SERVICE="${RUNASIS_SERVICE:-runasis-api}"
RUNASIS_BUCKET="${RUNASIS_BUCKET:-${GOOGLE_CLOUD_PROJECT}-runasis-data}"
RUNASIS_QUEUE="${RUNASIS_QUEUE:-runasis-sync}"
RUNASIS_APP_SA_NAME="${RUNASIS_APP_SA_NAME:-runasis-app}"
RUNASIS_TASK_SA_NAME="${RUNASIS_TASK_SA_NAME:-runasis-tasks}"
RUNASIS_APP_SA="${RUNASIS_APP_SA_NAME}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
RUNASIS_TASK_SA="${RUNASIS_TASK_SA_NAME}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"

retry_command() {
  local attempt=1
  local max_attempts=12
  until "$@"; do
    if (( attempt >= max_attempts )); then
      return 1
    fi
    echo "Waiting for Google Cloud IAM propagation (attempt ${attempt}/${max_attempts})..."
    sleep 5
    attempt=$((attempt + 1))
  done
}

case "${RUNASIS_PUBLIC_ORIGIN}" in
  https://*) ;;
  *) echo "RUNASIS_PUBLIC_ORIGIN must start with https://." >&2; exit 1 ;;
esac

gcloud config set project "${GOOGLE_CLOUD_PROJECT}"
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtasks.googleapis.com \
  firestore.googleapis.com \
  iamcredentials.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com

if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database="(default)" \
    --location="${RUNASIS_REGION}" \
    --type=firestore-native \
    --delete-protection
fi

if ! gcloud storage buckets describe "gs://${RUNASIS_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${RUNASIS_BUCKET}" \
    --location="${RUNASIS_REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

if ! gcloud iam service-accounts describe "${RUNASIS_APP_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNASIS_APP_SA_NAME}" \
    --display-name="Runasis Cloud Run application"
fi
if ! gcloud iam service-accounts describe "${RUNASIS_TASK_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNASIS_TASK_SA_NAME}" \
    --display-name="Runasis Cloud Tasks caller"
fi

retry_command gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
  --member="serviceAccount:${RUNASIS_APP_SA}" \
  --role="roles/datastore.user" \
  --condition=None
retry_command gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
  --member="serviceAccount:${RUNASIS_APP_SA}" \
  --role="roles/cloudtasks.enqueuer" \
  --condition=None
retry_command gcloud storage buckets add-iam-policy-binding "gs://${RUNASIS_BUCKET}" \
  --member="serviceAccount:${RUNASIS_APP_SA}" \
  --role="roles/storage.objectAdmin"
retry_command gcloud iam service-accounts add-iam-policy-binding "${RUNASIS_TASK_SA}" \
  --member="serviceAccount:${RUNASIS_APP_SA}" \
  --role="roles/iam.serviceAccountUser"

if ! gcloud tasks queues describe "${RUNASIS_QUEUE}" --location="${RUNASIS_REGION}" >/dev/null 2>&1; then
  gcloud tasks queues create "${RUNASIS_QUEUE}" --location="${RUNASIS_REGION}"
fi
gcloud tasks queues update "${RUNASIS_QUEUE}" \
  --location="${RUNASIS_REGION}" \
  --max-attempts=100 \
  --max-retry-duration=86400s \
  --max-concurrent-dispatches=1 \
  --max-dispatches-per-second=1

ensure_secret() {
  local name="$1"
  local value="$2"
  if ! gcloud secrets describe "${name}" >/dev/null 2>&1; then
    gcloud secrets create "${name}" --replication-policy=automatic
  fi
  printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=-
  retry_command gcloud secrets add-iam-policy-binding "${name}" \
    --member="serviceAccount:${RUNASIS_APP_SA}" \
    --role="roles/secretmanager.secretAccessor"
}

if [[ -z "${RUNASIS_SESSION_SECRET:-}" ]]; then
  RUNASIS_SESSION_SECRET="$(openssl rand -base64 48)"
fi
ensure_secret "runasis-strava-client-id" "${STRAVA_CLIENT_ID}"
ensure_secret "runasis-strava-client-secret" "${STRAVA_CLIENT_SECRET}"
ensure_secret "runasis-session-secret" "${RUNASIS_SESSION_SECRET}"

gcloud run deploy "${RUNASIS_SERVICE}" \
  --source=. \
  --region="${RUNASIS_REGION}" \
  --service-account="${RUNASIS_APP_SA}" \
  --no-invoker-iam-check \
  --default-url \
  --ingress=all \
  --cpu=1 \
  --memory=2Gi \
  --concurrency=8 \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=1800 \
  --startup-probe="httpGet.path=/healthz,httpGet.port=8080,timeoutSeconds=10,periodSeconds=10,failureThreshold=12" \
  --readiness-probe="httpGet.path=/healthz,httpGet.port=8080,timeoutSeconds=10,periodSeconds=10,failureThreshold=3,successThreshold=1" \
  --set-env-vars="RUNASIS_BOOTSTRAP=1,GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},RUNASIS_DEPLOYMENT_MODE=cloud,RUNASIS_STORAGE_BACKEND=gcp,RUNASIS_OWNER_ID=primary,RUNASIS_STORAGE_BUCKET=${RUNASIS_BUCKET},RUNASIS_PUBLIC_ORIGIN=${RUNASIS_PUBLIC_ORIGIN},STRAVA_REDIRECT_URI=${RUNASIS_PUBLIC_ORIGIN}/auth/strava/callback,RUNASIS_ALLOWED_ATHLETE_ID=${RUNASIS_ALLOWED_ATHLETE_ID},RUNASIS_TASK_LOCATION=${RUNASIS_REGION},RUNASIS_TASK_QUEUE=${RUNASIS_QUEUE},RUNASIS_TASK_SERVICE_ACCOUNT=${RUNASIS_TASK_SA}" \
  --set-secrets="STRAVA_CLIENT_ID=runasis-strava-client-id:latest,STRAVA_CLIENT_SECRET=runasis-strava-client-secret:latest,RUNASIS_SESSION_SECRET=runasis-session-secret:latest"

RUNASIS_CLOUD_RUN_URL="$(gcloud run services describe "${RUNASIS_SERVICE}" \
  --region="${RUNASIS_REGION}" \
  --format='value(status.url)')"

gcloud run services update "${RUNASIS_SERVICE}" \
  --region="${RUNASIS_REGION}" \
  --update-env-vars="RUNASIS_CLOUD_RUN_URL=${RUNASIS_CLOUD_RUN_URL},RUNASIS_TASK_AUDIENCE=${RUNASIS_CLOUD_RUN_URL}" \
  --remove-env-vars="RUNASIS_BOOTSTRAP"
retry_command gcloud run services add-iam-policy-binding "${RUNASIS_SERVICE}" \
  --region="${RUNASIS_REGION}" \
  --member="serviceAccount:${RUNASIS_TASK_SA}" \
  --role="roles/run.invoker"

echo
echo "Cloud Run: ${RUNASIS_CLOUD_RUN_URL}"
echo "Vercel build env: RUNASIS_API_ORIGIN=${RUNASIS_CLOUD_RUN_URL}"
echo "Strava callback: ${RUNASIS_PUBLIC_ORIGIN}/auth/strava/callback"
