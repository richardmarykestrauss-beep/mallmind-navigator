# MallMind — Google Cloud Backend

Node.js + TypeScript + Express backend for MallMind.  
Phase 2 of the Google Cloud migration — connects to the **existing Supabase database**.  
The current Supabase Edge Functions remain live and unchanged.

---

## What this is

This is a Cloud Run–ready backend that mirrors the Supabase Edge Function API surface:

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check (no DB call) |
| `/detect-active-mall` | POST | GPS → nearest mall + create/resume shopping session |
| `/recommend-products` | POST | Scored product search for a mall |
| `/build-route` | POST | Dijkstra indoor routing via mall_nodes/mall_edges |
| `/assistant` | POST | Gemini 2.0 Flash assistant with function calling |
| `/admin-stats` | GET | Platform metrics from Supabase |

**Data source:** Existing Supabase Postgres database (same tables as the live app).  
**AI model:** Gemini 2.0 Flash via Google Generative AI SDK (`GEMINI_API_KEY`).  
**The current frontend still points to Supabase.** This backend runs in parallel.

---

## Required Environment Variables

Copy `.env.example` to `.env` and fill in real values.  
**Never commit `.env` to version control.**

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key — server-side only, never expose to frontend |
| `GEMINI_API_KEY` | ⚠️ | Required for `/assistant`. Get from [Google AI Studio](https://aistudio.google.com) |
| `GOOGLE_CLOUD_PROJECT` | Optional | GCP project ID (used for future Vertex AI / BigQuery) |
| `GOOGLE_CLOUD_LOCATION` | Optional | GCP region e.g. `us-central1` |
| `PORT` | Optional | Server port. Cloud Run sets this to `8080` automatically |
| `NODE_ENV` | Optional | `development` or `production` |
| `ALLOWED_ORIGIN` | Optional | Frontend origin for CORS in production (e.g. `https://mallmind.app`) |

---

## Run Locally

### Prerequisites
- Node.js 20+
- A Supabase project with the MallMind schema (migrations 001–006)

### Steps

```bash
# 1. Navigate to this folder
cd google-cloud-backend

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your real SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY

# 4. Start the dev server (auto-restarts on file changes)
npm run dev
```

The server starts on `http://localhost:8080`.

---

## Test /health

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "mallmind-cloud-backend",
  "version": "0.1.0",
  "timestamp": "2026-05-08T10:00:00.000Z",
  "environment": "development",
  "google_cloud_project": "not-set"
}
```

---

## Test Other Routes

```bash
# Detect nearest mall (replace with real coordinates)
curl -X POST http://localhost:8080/detect-active-mall \
  -H "Content-Type: application/json" \
  -d '{"lat": -26.1076, "lng": 28.0567}'

# Recommend products
curl -X POST http://localhost:8080/recommend-products \
  -H "Content-Type: application/json" \
  -d '{"mall_id": "1", "query": "TV", "budget": 5000}'

# Admin stats
curl http://localhost:8080/admin-stats
```

---

## Build for Production

```bash
npm run build
# Output: dist/
```

---

## Deploy to Cloud Run

### Prerequisites
1. [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
2. A GCP project with Cloud Run API enabled
3. Billing enabled on the project

### Steps

```bash
# 1. Set your project
gcloud config set project YOUR_PROJECT_ID

# 2. Build and push the Docker image to Artifact Registry
gcloud builds submit \
  --tag gcr.io/YOUR_PROJECT_ID/mallmind-backend \
  google-cloud-backend/

# 3. Deploy to Cloud Run
gcloud run deploy mallmind-backend \
  --image gcr.io/YOUR_PROJECT_ID/mallmind-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID" \
  --set-secrets "SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,GEMINI_API_KEY=gemini-api-key:latest"
```

> **Secrets via Secret Manager** (recommended):  
> Store `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` in Secret Manager, not as plain env vars.
> The `--set-secrets` flag above maps them automatically.

### Verify deployment

```bash
# Cloud Run will give you a URL like:
# https://mallmind-backend-xxxxxxxx-uc.a.run.app

curl https://mallmind-backend-xxxxxxxx-uc.a.run.app/health
```

---

## Project Structure

```
google-cloud-backend/
├── src/
│   ├── server.ts               # Express app + startup validation
│   ├── lib/
│   │   ├── supabase.ts         # Singleton Supabase service-role client
│   │   ├── haversine.ts        # Great-circle distance formula
│   │   └── types.ts            # Shared TypeScript types (mirrors DB schema)
│   ├── services/
│   │   ├── mallService.ts      # detectActiveMall, getSession
│   │   ├── productService.ts   # recommendProducts with scoring
│   │   ├── routingService.ts   # Dijkstra on mall_nodes/mall_edges
│   │   └── geminiService.ts    # Gemini function calling assistant
│   └── routes/
│       ├── health.ts
│       ├── detectActiveMall.ts
│       ├── recommendProducts.ts
│       ├── buildRoute.ts
│       ├── assistant.ts
│       └── adminStats.ts
├── Dockerfile                  # Multi-stage build for Cloud Run
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## What Is Not Changed

- The React frontend still calls Supabase directly
- All Supabase Edge Functions remain deployed and active
- No data has been migrated
- This backend is additive — it adds a parallel path, not a replacement

See `docs/google-cloud-migration-plan.md` for the full migration roadmap.

---

## Notes

- `/admin-stats` has no auth enforcement yet — marked `DEV_ONLY` in the response. Auth middleware will be added in Phase 7 (Firebase Auth).
- CORS is open (`*`) in development. Set `ALLOWED_ORIGIN` in production.
- The Dijkstra route builder (`/build-route`) returns `fallback: true` when no navigation graph exists for a mall. The frontend should handle this gracefully.
