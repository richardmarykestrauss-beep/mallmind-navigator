# MallMind — Security & Environment Checklist

**Last updated:** 2026-05-15 (Sprint 11)

This document covers every environment variable used by MallMind, explains which values are public vs private, and provides checklists for local development, staging, and production deployment.

---

## 1. Environment Variable Reference

### Frontend (`VITE_*` — safe to include in browser bundle)

| Variable | Required | Public? | Description |
|----------|----------|---------|-------------|
| `VITE_SUPABASE_URL` | ✅ Yes | ✅ Public | Your Supabase project URL. Format: `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ✅ Yes | ✅ Public | Supabase anon / publishable key. Enforces RLS — not a secret. |
| `VITE_GOOGLE_BACKEND_URL` | ❌ Optional | ✅ Public | Cloud Run service URL. Leave blank to use Supabase Edge Functions. |
| `VITE_VAPID_PUBLIC_KEY` | ❌ Optional | ✅ Public | VAPID public key for Web Push. The private key lives in backend secrets only. |

> **Why are these "public"?**
> Vite embeds all `VITE_*` variables into the compiled JS bundle, which is served to the browser.
> Never put a secret (service role key, private API key) in a `VITE_*` variable.

### Google Cloud Run Backend (`google-cloud-backend/.env`)

| Variable | Required | Public? | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | ✅ Yes | ✅ Public | Same project URL as frontend. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | 🔴 **SECRET** | Bypasses all RLS. Backend-only. Never in frontend. |
| `GEMINI_API_KEY` | ✅ Yes* | 🔴 **SECRET** | Gemini AI API key. Use Vertex AI ADC in production instead. |
| `VERTEX_PROJECT_ID` | Optional | ✅ Public | GCP project ID for Vertex AI (production AI path). |
| `GOOGLE_CLOUD_LOCATION` | Optional | ✅ Public | Vertex AI region (e.g. `us-central1`). |
| `GOOGLE_CLOUD_PROJECT` | Optional | ✅ Public | GCP project ID. |
| `PORT` | Optional | ✅ Public | HTTP server port. Cloud Run injects `8080` automatically. |
| `NODE_ENV` | Optional | ✅ Public | `development` or `production`. |
| `CORS_ORIGINS` | Optional | ✅ Public | Comma-separated allowed origins for CORS. |

\* Required for Gemini API key path. If using Vertex AI with ADC, this can be omitted.

### Supabase Edge Functions (Supabase Vault / Dashboard Secrets)

| Secret | Description |
|--------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase for all Edge Functions |
| `ANTHROPIC_API_KEY` | Claude API key (used by `ai-assistant` function) |
| `GEMINI_API_KEY` | Gemini fallback key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key (used by `notify-price-drops`) |

### Nightly Scraper (`scripts/scraper/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ Yes | 🔴 **SECRET** — Service role key for price writes |
| `GOOGLE_PLACES_API_KEY` | Optional | For mall discovery enrichment |

---

## 2. Key Classification

### Public keys (safe in frontend bundle and git-tracked examples)

These values are designed to be visible. Security comes from access controls configured in your services, not from keeping these strings secret.

| Key | Why it's public |
|-----|----------------|
| `VITE_SUPABASE_URL` | Project identifier — not a credential |
| `VITE_SUPABASE_ANON_KEY` | Supabase "publishable" key. Row Level Security policies control what it can access. An attacker with this key can only do what anonymous users are allowed to do. |
| `VITE_GOOGLE_BACKEND_URL` | A URL endpoint — not a credential. The backend enforces its own auth. |
| `VITE_VAPID_PUBLIC_KEY` | Public half of asymmetric key pair. Must be shared with browsers to subscribe to push. |

### Private keys (never in frontend, never in git)

| Key | Risk if exposed |
|-----|----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses all RLS.** Attacker gets full read/write on every table. Rotate immediately if leaked. |
| `ANTHROPIC_API_KEY` | Allows unlimited Claude API charges on your account. |
| `GEMINI_API_KEY` | Allows unlimited Gemini API charges on your account. |
| `VAPID_PRIVATE_KEY` | Allows sending push notifications to all subscribed users. |
| `GOOGLE_PLACES_API_KEY` | Allows Places API calls — may incur costs. |

---

## 3. Local Development Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-org/mallmind-navigator.git
cd mallmind-navigator

# 2. Install frontend dependencies
npm install

# 3. Set up frontend env (Supabase path — no backend required)
cp .env.example .env.local
# Edit .env.local and fill in:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY
#   VITE_VAPID_PUBLIC_KEY (optional — only needed for push notification testing)
#   VITE_GOOGLE_BACKEND_URL (optional — only needed if testing Cloud Run backend)

# 4. Start the dev server
npm run dev

# 5. (Optional) Set up the Cloud Run backend locally
cd google-cloud-backend
cp .env.example .env
# Edit .env and fill in:
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY  ← get from Supabase Dashboard > Project Settings > API
#   GEMINI_API_KEY              ← get from Google AI Studio
npm install
npm run dev  # starts on port 3001
```

---

## 4. Where to Find Each Value

| Value | Source |
|-------|--------|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → anon/public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role (never share) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys |
| `GEMINI_API_KEY` | https://aistudio.google.com → Get API Key |
| `VITE_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Generate once: `npx web-push generate-vapid-keys` |

---

## 5. Production Deployment Checklist

### Frontend (Vite build / Netlify / Vercel / Firebase Hosting)

- [ ] Set `VITE_SUPABASE_URL` in your hosting platform's environment variables
- [ ] Set `VITE_SUPABASE_ANON_KEY` in your hosting platform's environment variables
- [ ] Set `VITE_VAPID_PUBLIC_KEY` if push notifications are active
- [ ] Set `VITE_GOOGLE_BACKEND_URL` to the production Cloud Run URL (or leave blank for Edge Functions)
- [ ] Confirm `npm run build` succeeds with no missing-env warnings in the build output
- [ ] Confirm the build output (`dist/`) does NOT contain the service_role key (grep for it)

### Google Cloud Run backend

- [ ] Service role key is stored in **Google Secret Manager** (not in plain env var)
- [ ] Gemini API key is stored in **Google Secret Manager**
- [ ] `NODE_ENV=production` is set
- [ ] CORS origins are restricted to your production frontend domain(s)
- [ ] Cloud Run service requires authenticated requests OR has its own auth middleware
- [ ] Admin routes (`/admin/*`) check `is_admin` server-side on every request

### Supabase Edge Functions

- [ ] `ANTHROPIC_API_KEY` is stored in Supabase Vault (not in function code)
- [ ] `VAPID_PRIVATE_KEY` is stored in Supabase Vault
- [ ] `admin-stats` function checks JWT + `is_admin` (confirmed ✅)
- [ ] All other admin functions check JWT + `is_admin`

### Supabase RLS

- [ ] `profiles` table: users can only read/update their own row
- [ ] `price_alerts` table: users can only read/write their own alerts
- [ ] `push_subscriptions` table: users can only read/write their own subscriptions
- [ ] `parking_spots` table: users can only read/write their own spots
- [ ] `shopping_list_items` table: users can only read/write their own items
- [ ] `products`, `shops`, `malls`, `best_deals` view: readable by anon (public data)
- [ ] `achievements` table: readable by anon (definitions are public)
- [ ] `user_achievements` table: users can only read their own

---

## 6. Pre-Launch Security Checklist

Run this before any public launch:

- [ ] **No hardcoded keys in source code** — `grep -r "supabase\.co" src/` should return zero results
- [ ] **No service role key in frontend** — `grep -r "service_role" src/` should return zero results
- [ ] **`.env.local` is gitignored** — `git status` should not show it
- [ ] **`google-cloud-backend/.env` is gitignored** — `git status` should not show it
- [ ] **`.env.example` is committed** — `git status` shows it tracked
- [ ] **Admin route requires auth** — open `/admin` in an incognito tab → should show "Sign in required"
- [ ] **Non-admin user cannot access admin** — sign in as a normal user → `/admin` should show "Access denied"
- [ ] **`npm run build` passes** with no undefined-env warnings
- [ ] **Rotate any keys that were previously hardcoded in git history**

---

## 7. Key Rotation Procedure

The Supabase anon key was previously hardcoded in multiple source files and is now in git history. While the anon key is "public by design", the following steps should be taken to invalidate the old key:

1. **Generate a new anon key:** Supabase Dashboard → Project Settings → API → "Regenerate API Key" (anon)
2. **Update `.env.local`** with the new key
3. **Update any CI/CD secrets** with the new key
4. **Redeploy** the frontend
5. **Optionally clean git history** with `git filter-branch` or BFG Repo Cleaner if you want to remove the old key from history (aggressive — only if required by your security policy)

> Note: The old JWT-format anon key expires in 2099 (per the `exp` claim in the token). Rotation is recommended practice, not strictly required, since the anon key is by design a public key.

---

## 8. Architecture Security Summary

```
Browser / Frontend
  ├── supabaseClient.ts       Uses anon key (RLS-enforced, public)
  ├── googleBackendClient.ts  Uses Cloud Run URL (no secrets)
  └── env.ts                  Reads all config from VITE_* env vars only
          │
          ▼
Supabase Edge Functions        Uses service_role from Supabase Vault
          │
Google Cloud Run Backend       Uses service_role from Secret Manager
          │
          ▼
Supabase PostgreSQL (RLS)
```

**Attack surface:**
- An attacker who intercepts the frontend bundle gets: Supabase URL, anon key, Cloud Run URL. With these they can query public tables (limited by RLS). They cannot access admin routes, other users' data, or perform any operation not permitted for anonymous users.
- The service_role key never appears in frontend code. It lives only in Supabase Vault (for Edge Functions) and Google Secret Manager (for Cloud Run).
