# MallMind — Deploy to Cloud Run

Node.js + TypeScript backend deployed to Cloud Run in **africa-south1** (Johannesburg).  
No frontend changes. No database migration. Backend only.

---

## Region Decision

| Service | Region | Notes |
|---------|--------|-------|
| Cloud Run | `africa-south1` | ~15 ms from SA — lowest latency for SA users |
| Artifact Registry | `africa-south1` | Co-located with Cloud Run for fast image pulls |
| Cloud Build | `africa-south1` | Regional build, layer cache co-located with registry |
| Secret Manager | Global | Accessible from any region; default auto-replication |
| Vertex AI (Phase 4) | `africa-south1` | Supported — custom model inference only. Requires europe-west4 for AutoML/data-labeling features |

---

## 1. Required Google Cloud APIs

Enable all of these once per project. They persist — no need to re-enable per deploy.

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  vertexai.googleapis.com \
  sqladmin.googleapis.com \
  bigquery.googleapis.com \
  --project=YOUR_PROJECT_ID
```

> `sqladmin` and `bigquery` are not used in Phase 2 but enabling them now avoids
> a separate step when Phase 5 (Cloud SQL) and Phase 6 (BigQuery) begin.

---

## 2. One-Time Setup

### 2a. Create the Artifact Registry repository

```bash
gcloud artifacts repositories create mallmind \
  --repository-format=docker \
  --location=africa-south1 \
  --description="MallMind backend Docker images" \
  --project=YOUR_PROJECT_ID
```

Verify:
```bash
gcloud artifacts repositories list \
  --location=africa-south1 \
  --project=YOUR_PROJECT_ID
```

### 2b. Authenticate Docker to Artifact Registry

Run this once on any machine that will push images manually:
```bash
gcloud auth configure-docker africa-south1-docker.pkg.dev
```

### 2c. Grant Cloud Build permission to deploy Cloud Run

The Cloud Build service account needs two roles:

```bash
# Get your project number first
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

# Cloud Run Admin — allows Cloud Build to deploy services
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

# Service Account User — allows Cloud Build to act as the Cloud Run runtime SA
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Secret Manager Secret Accessor — allows Cloud Build to read secrets during deploy
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 3. Required Secrets in Secret Manager

Create each secret once. After creation, update the value with `versions add` — never
recreate the secret (that would break all existing `:latest` references).

### SUPABASE_URL

```bash
echo -n "https://your-project-ref.supabase.co" | \
  gcloud secrets create supabase-url \
    --data-file=- \
    --replication-policy=automatic \
    --project=YOUR_PROJECT_ID
```

### SUPABASE_SERVICE_ROLE_KEY

```bash
echo -n "your-supabase-service-role-key" | \
  gcloud secrets create supabase-service-role-key \
    --data-file=- \
    --replication-policy=automatic \
    --project=YOUR_PROJECT_ID
```

> This is the `service_role` JWT from Supabase → Project Settings → API.  
> It bypasses Row Level Security. Never expose it to the frontend.

### GEMINI_API_KEY

**Option A — Gemini API key** (current, simplest):
```bash
echo -n "your-gemini-api-key" | \
  gcloud secrets create gemini-api-key \
    --data-file=- \
    --replication-policy=automatic \
    --project=YOUR_PROJECT_ID
```

Get your key from [Google AI Studio](https://aistudio.google.com/apikey).

**Option B — Vertex AI** (Phase 4, no API key needed):  
When the backend is migrated to Vertex AI, delete the `GEMINI_API_KEY` secret reference  
from `cloudbuild.yaml` and set `VERTEX_PROJECT_ID` as an env var instead.  
The Cloud Run service account will use Application Default Credentials automatically.

### To update a secret value later

```bash
echo -n "new-value" | \
  gcloud secrets versions add SECRET_NAME \
    --data-file=- \
    --project=YOUR_PROJECT_ID
```

### Verify all three secrets exist

```bash
gcloud secrets list --project=YOUR_PROJECT_ID
```

Expected output includes: `supabase-url`, `supabase-service-role-key`, `gemini-api-key`

---

## 4. Generate package-lock.json (Required Before First Deploy)

The Dockerfile runs `npm ci` which requires a `package-lock.json`.  
If you haven't installed dependencies yet, generate the lock file first:

```bash
cd google-cloud-backend
npm install
cd ..
git add google-cloud-backend/package-lock.json
git commit -m "chore: add package-lock.json for Cloud Run build"
git push
```

> This only needs to be done once. After that, Cloud Build generates it inside Docker.

---

## 5. Deploy Using Cloud Build

Cloud Build reads `cloudbuild.yaml` from the repo root. It:
1. Builds the Docker image from `google-cloud-backend/`
2. Pushes both `:COMMIT_SHA` and `:latest` tags to Artifact Registry
3. Deploys to Cloud Run with secrets injected at runtime

### Submit a build from your local machine

```bash
# Set your project first (do this once per terminal session)
gcloud config set project YOUR_PROJECT_ID

# Trigger the build from the repo root
gcloud builds submit \
  --config cloudbuild.yaml \
  --region africa-south1 \
  .
```

The `.` at the end is the source directory — the repo root.  
Cloud Build uploads the entire repo as the build source.

### Trigger automatically via GitHub

1. Go to [Cloud Build → Triggers](https://console.cloud.google.com/cloud-build/triggers)
2. Connect your GitHub repository
3. Create a trigger:
   - **Event**: Push to branch
   - **Branch**: `^google-cloud-migration-plan$` (or `^main$` when ready)
   - **Config file**: `cloudbuild.yaml` (autodetected at repo root)
   - **Region**: `africa-south1`

After this, every `git push` to the branch triggers an automatic build and deploy.

---

## 6. Environment Variables and Secrets

### How secrets are injected at runtime

The Cloud Run service receives secrets as environment variables — the values are
never stored in the image or the service definition (only references are stored).

The mapping in `cloudbuild.yaml`:

```yaml
--set-secrets=SUPABASE_URL=supabase-url:latest,\
              SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,\
              GEMINI_API_KEY=gemini-api-key:latest
```

Format: `ENV_VAR_NAME=secret-manager-secret-name:version`  
Using `:latest` means the service always picks up the newest version of each secret
without requiring a redeployment.

### Plain environment variables (non-secret)

These are baked into the Cloud Run service definition (visible in the console — safe
for non-sensitive config):

| Variable | Value | Source |
|----------|-------|--------|
| `NODE_ENV` | `production` | cloudbuild.yaml |
| `GOOGLE_CLOUD_PROJECT` | `$PROJECT_ID` | cloudbuild.yaml (auto-injected) |
| `GOOGLE_CLOUD_LOCATION` | `africa-south1` | cloudbuild.yaml |
| `PORT` | `8080` | Dockerfile ENV (Cloud Run also injects this) |

### To add or change an env var without redeploying from source

```bash
gcloud run services update mallmind-backend-dev \
  --region africa-south1 \
  --set-env-vars KEY=VALUE \
  --project=YOUR_PROJECT_ID
```

### To add a new secret reference to the running service

```bash
gcloud run services update mallmind-backend-dev \
  --region africa-south1 \
  --update-secrets=NEW_VAR=new-secret-name:latest \
  --project=YOUR_PROJECT_ID
```

---

## 7. Manual Deploy (Without Cloud Build)

If you want to deploy without Cloud Build — useful for quick one-off deploys
from a machine that has Docker and gcloud installed:

```bash
# 1. Set project
gcloud config set project YOUR_PROJECT_ID

# 2. Build locally
docker build \
  -t africa-south1-docker.pkg.dev/YOUR_PROJECT_ID/mallmind/mallmind-backend:manual \
  google-cloud-backend/

# 3. Push
docker push africa-south1-docker.pkg.dev/YOUR_PROJECT_ID/mallmind/mallmind-backend:manual

# 4. Deploy
gcloud run deploy mallmind-backend-dev \
  --image=africa-south1-docker.pkg.dev/YOUR_PROJECT_ID/mallmind/mallmind-backend:manual \
  --region=africa-south1 \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60s \
  --set-env-vars=NODE_ENV=production,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=africa-south1 \
  --set-secrets=SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,GEMINI_API_KEY=gemini-api-key:latest \
  --project=YOUR_PROJECT_ID
```

---

## 8. Verify the Deployment

Cloud Run will output a URL when the deploy finishes:
```
Service [mallmind-backend-dev] revision [mallmind-backend-dev-xxxxx] has been deployed
and is serving 100 percent of traffic.
Service URL: https://mallmind-backend-dev-xxxxxxxxxx-ew.a.run.app
```

### Test GET /health

```bash
# Replace with your actual Cloud Run URL
SERVICE_URL=$(gcloud run services describe mallmind-backend-dev \
  --region africa-south1 \
  --project=YOUR_PROJECT_ID \
  --format='value(status.url)')

curl "${SERVICE_URL}/health"
```

Expected response:
```json
{
  "status": "ok",
  "service": "mallmind-cloud-backend",
  "version": "0.1.0",
  "timestamp": "2026-05-08T10:00:00.000Z",
  "environment": "production",
  "google_cloud_project": "YOUR_PROJECT_ID"
}
```

> `/health` makes no database calls — it confirms the container started and Express
> is running. If secrets are misconfigured, the server exits before this route is
> reachable (startup validation in `server.ts` requires `SUPABASE_URL` and
> `SUPABASE_SERVICE_ROLE_KEY`).

### Test POST /detect-active-mall

```bash
curl -X POST "${SERVICE_URL}/detect-active-mall" \
  -H "Content-Type: application/json" \
  -d '{"lat": -26.1076, "lng": 28.0567}'
```

### Test GET /admin-stats

```bash
curl "${SERVICE_URL}/admin-stats"
```

---

## 9. Monitoring and Logs

### Stream live logs

```bash
gcloud beta run services logs tail mallmind-backend-dev \
  --region africa-south1 \
  --project=YOUR_PROJECT_ID
```

### View logs in Cloud Logging

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="mallmind-backend-dev"' \
  --limit=50 \
  --project=YOUR_PROJECT_ID \
  --format='value(timestamp, textPayload)'
```

### Cloud Run console

<https://console.cloud.google.com/run?project=YOUR_PROJECT_ID>

---

## 10. Cost Estimate (africa-south1, Tier 2 pricing)

At zero traffic with `--min-instances=0` (scales to zero):

| Resource | Free tier / month | Approx cost beyond |
|----------|-------------------|-------------------|
| CPU | 180,000 vCPU-seconds | $0.000100/vCPU-s |
| Memory | 360,000 GiB-seconds | $0.000011/GiB-s |
| Requests | 2 million | $0.40/million |
| Cloud Build | 120 build-minutes | $0.003/min |

A low-traffic dev service costs **~$0/month** within free tier.  
At moderate traffic (100k req/month), estimated cost is **< $5/month**.

---

## What Is Not Changed

- The React frontend still calls Supabase Edge Functions directly
- All Supabase Edge Functions remain deployed and active
- No data has been migrated or moved
- No production traffic is routed to this backend yet

See `docs/google-cloud-migration-plan.md` for the full 7-phase migration roadmap.
