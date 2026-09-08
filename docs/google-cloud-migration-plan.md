# MallMind — Google Cloud Migration Plan

**Status:** Planning only. No code has been migrated. The current Supabase app remains the live, working system.  
**Branch:** `google-cloud-migration-plan`  
**Last updated:** 2026-05-08

---

## 1. Current Architecture

### Frontend
- React + Vite + TypeScript
- Hosted (local dev / to be confirmed for production)
- Communicates directly with Supabase REST API and Edge Functions via the Supabase JS client

### Auth
- Supabase Auth (email/password, JWT tokens)
- Profiles stored in `profiles` table linked to `auth.users`

### Database — Supabase Postgres
All tables below are live and in use:

| Table | Purpose |
|-------|---------|
| `malls` | Mall list with lat/lng for nearest-mall detection |
| `shops` | Stores inside each mall (floor, unit, hours) |
| `products` | Product catalogue with prices, specials, brand |
| `profiles` | User profiles, XP, level, subscription status |
| `shopping_sessions` | Active mall sessions per user with GPS, intent, route |
| `mall_nodes` | Navigation graph vertices (one per shop + entrances) |
| `mall_edges` | Navigation graph edges (Dijkstra-ready) |
| `shopping_routes` | Persisted step-by-step routes from build-route |
| `price_alerts` | User price-drop watch list |
| `app_events` | General analytics event log |
| `search_events` | Product search query log |

### Edge Functions (Supabase Deno)

| Function | Role |
|----------|------|
| `ai-assistant` | Claude Haiku conversation with tool use (recommend_products, build_route, check_store_hours) |
| `recommend-products` | Scored product search for a given mall and query |
| `detect-active-mall` | GPS → nearest mall + create/resume shopping_session |
| `build-route` | Dijkstra on mall_nodes/mall_edges → step-by-step route → saved to shopping_routes |
| `notify-price-drops` | Checks price_alerts, sends Web Push on price drop |
| `admin-stats` | Aggregated admin analytics |
| `scrape-prices` | Nightly price ingestion from retailer APIs |

### AI Assistant
- Anthropic Claude Haiku via Supabase Edge Function
- Gemini Flash as web-search fallback (Gemini API key optional)
- Session-aware: receives mall_id, session_id, shopping_intent, GPS

### Notifications
- Web Push API (service worker in `public/sw.js`)
- Push subscriptions stored in `profiles`

---

## 2. Target Google Cloud Architecture

> Nothing below is built yet. This is the intended end state.

### Frontend
- React + Vite + TypeScript — **unchanged**
- Hosting: Firebase Hosting (static assets + CDN) or Cloud Run (if SSR is added later)

### Auth
- Firebase Auth / Google Identity Platform
- Replaces Supabase Auth
- Google Sign-In, email/password
- JWT tokens passed to Cloud Run backend

### Backend APIs
- **Cloud Run** — containerised Node.js / Python services
- Replaces Supabase Edge Functions
- Each current Edge Function becomes a Cloud Run service or route within a single API container
- Scales to zero when idle (cost control)

### Operational Database
- **Cloud SQL — PostgreSQL**
- Same schema as current Supabase Postgres
- Migrated via `pg_dump` / `pg_restore`
- Connection via Cloud SQL Auth Proxy (no public IP)
- Credentials stored in Secret Manager

### AI Assistant
- **Vertex AI — Gemini** (gemini-2.0-flash or gemini-1.5-pro)
- Function calling replaces Anthropic tool use
- Same tool interface: recommend_products, build_route, check_store_hours, save_shopping_intent
- Keeps the same session-context pattern (mall_id, session_id, intent)

### Analytics
- **BigQuery**
- `app_events` and `search_events` streamed from Cloud Run via Pub/Sub or direct BigQuery streaming inserts
- Used for B2B retailer dashboards and product performance reporting
- Does **not** replace the operational Cloud SQL database

### Notifications
- **Firebase Cloud Messaging (FCM)**
- Replaces Web Push API
- Enables iOS push (which Web Push cannot do natively)
- Cloud Run triggers FCM on price drops

### Secrets
- **Secret Manager**
- API keys (Gemini, Google Maps), DB credentials, service account keys
- Accessed by Cloud Run at runtime — never exposed to the frontend

### Maps / Geolocation
- **Google Maps Platform**
- Places API for mall search / autocomplete
- Maps JavaScript SDK for in-app map display (future)
- Directions API for outdoor routing to parking (future)

### Storage
- **Cloud Storage**
- Replaces Supabase Storage
- Product images, receipts, user-submitted price photos

---

## 3. Service Mapping

| Current (Supabase) | Target (Google Cloud) | Notes |
|--------------------|-----------------------|-------|
| Supabase Auth | Firebase Auth / Identity Platform | Schema change for users |
| Supabase Postgres | Cloud SQL PostgreSQL | Same schema, `pg_dump` migration |
| Supabase Edge Functions | Cloud Run APIs | Redeploy as containers |
| Supabase Storage | Cloud Storage | File migration needed |
| `app_events` / `search_events` tables | BigQuery (streaming) | Dual-write during transition |
| Claude Haiku (Anthropic) | Gemini on Vertex AI | Tool definitions rewritten |
| Web Push | Firebase Cloud Messaging | Service worker update required |
| Nearest mall (haversine in Edge Function) | Cloud Run + Google Maps Places API | Maps API optional, haversine works fine |
| RLS policies (Supabase) | Cloud Run middleware auth checks | JWT verification per route |
| Supabase JS client | REST calls to Cloud Run | Frontend API layer rewrite |

---

## 4. Migration Phases

### Phase 1 — Plan Only (current)
- **What:** This document.
- **What is not touched:** Nothing. Supabase app continues to run exactly as-is.
- **Output:** `docs/google-cloud-migration-plan.md` on branch `google-cloud-migration-plan`.
- **Done when:** Plan is reviewed and approved.

---

### Phase 2 — Cloud Run Backend Skeleton
- **What:** Create a minimal Cloud Run service (Node.js or Python) with placeholder routes matching the current Edge Function API surface.
  - `POST /api/detect-active-mall`
  - `POST /api/recommend-products`
  - `POST /api/build-route`
  - `POST /api/ai-assistant`
  - `POST /api/notify-price-drops`
- **What is not touched:** Supabase app, database, frontend, existing Edge Functions.
- **Infrastructure:**
  - Google Cloud project created
  - Cloud Run service deployed (returns stub responses)
  - Secret Manager enabled, no secrets stored yet
- **Done when:** Cloud Run URL responds to health check. No real data.

---

### Phase 3 — Cloud Run Connects to Existing Supabase
- **What:** Cloud Run routes make real queries to the **existing Supabase Postgres** database using the Supabase service role key stored in Secret Manager.
- **Why:** Validates the backend logic before touching the database.
- **What is not touched:** Supabase Auth, Supabase Edge Functions (still live), frontend (still points to Supabase).
- **Test:** Call Cloud Run endpoints manually with Postman or curl. Confirm same results as Supabase Edge Functions.
- **Done when:** Cloud Run `/api/recommend-products` returns the same products as the Supabase function for the same input.

---

### Phase 4 — Gemini Assistant with Function Calling
- **What:** Replace the `ai-assistant` Supabase Edge Function logic inside Cloud Run using Gemini on Vertex AI.
  - Same four tools: `recommend_products`, `build_route`, `check_store_hours`, `save_shopping_intent`
  - Same session-context system prompt
  - Gemini function calling schema replacing Anthropic tool use format
- **What is not touched:** Supabase Edge Functions remain deployed. Frontend still uses Supabase function by default.
- **Test:** A/B test Cloud Run Gemini assistant vs existing Claude assistant via a feature flag in the frontend.
- **Rollback:** Set feature flag back to Supabase function. No data loss.
- **Done when:** Gemini assistant answers product queries correctly for a real mall with real products.

---

### Phase 5 — Cloud SQL PostgreSQL Migration
- **What:** Migrate the operational database from Supabase Postgres to Cloud SQL.
  1. Export full schema + data from Supabase using `pg_dump`
  2. Import into Cloud SQL instance
  3. Set up Cloud SQL Auth Proxy for Cloud Run connections
  4. Run dual-write period: writes go to both Supabase and Cloud SQL
  5. Verify data parity
  6. Switch Cloud Run to Cloud SQL as primary
  7. Switch frontend API calls from Supabase to Cloud Run
- **What is not touched:** Supabase database remains live and read-accessible during transition.
- **Risks:** Data drift during dual-write, connection pooling, RLS replacement with middleware auth.
- **Rollback:** Supabase remains live. Revert frontend env var `VITE_API_URL` to Supabase URL.
- **Done when:** All frontend API calls route through Cloud Run → Cloud SQL and data is consistent.

---

### Phase 6 — BigQuery Analytics
- **What:** Stream `app_events` and `search_events` to BigQuery.
  - Cloud Run writes events to BigQuery (streaming inserts or via Pub/Sub)
  - Build BigQuery views for: top searched products, mall activity, search-to-navigate conversion
  - Connect to Looker Studio for B2B retailer dashboards
- **What is not touched:** Operational Cloud SQL database.
- **Done when:** A BigQuery query returns product search counts per mall for the past 7 days using real data.

---

### Phase 7 — Firebase Auth, Hosting, Notifications
- **What:**
  - Replace Supabase Auth with Firebase Auth
  - Migrate user accounts (email/password) — requires password reset flow for existing users
  - Update frontend to use Firebase Auth SDK
  - Deploy frontend to Firebase Hosting
  - Replace Web Push with Firebase Cloud Messaging (update service worker)
- **What is not touched:** Cloud SQL, Cloud Run, BigQuery (already migrated).
- **Risks:** Existing users must re-authenticate. Push notification subscriptions will be invalidated and must be re-registered.
- **Done when:** A user can sign up, log in, receive a price-drop push notification, and complete a full shopping session end-to-end on the Google Cloud stack with no Supabase dependency.

---

## 5. Risks

### Risk 1 — Breaking the Current Supabase App
- **Likelihood:** High if phases are rushed or merged into main prematurely.
- **Mitigation:** All migration work stays on dedicated branches. Feature flags control which backend the frontend calls. The Supabase URL and anon key remain in the environment until explicitly removed.

### Risk 2 — Secrets Exposed in Frontend
- **Likelihood:** Medium — Cloud Run service account keys or API keys could be accidentally committed.
- **Mitigation:** All secrets go into Secret Manager. The frontend never receives service account keys. Cloud Run uses Workload Identity. `.gitignore` is reviewed before every commit.

### Risk 3 — AI Generating Fake Connected Features
- **Likelihood:** Medium — the assistant could claim stores or routes exist when the navigation graph has no real floor plan data.
- **Mitigation:** The assistant's system prompt explicitly states "do not invent store locations or routes." The `build-route` function returns a `fallback: true` flag when no graph path is found, and the UI shows an estimate rather than false precision.

### Risk 4 — Costs Increasing Too Quickly
- **Likelihood:** Medium — Cloud Run, Cloud SQL, Vertex AI, and BigQuery all have usage-based billing.
- **Mitigation:**
  - Cloud Run scales to zero between requests.
  - Cloud SQL uses a shared-core instance (db-f1-micro) until traffic justifies upgrade.
  - Vertex AI: use `gemini-2.0-flash` (cheapest) until volume requires a larger model.
  - BigQuery: partition tables by date, use streaming inserts only for events (not product queries).
  - Set budget alerts in Google Cloud Console at R500, R2,000, R5,000/month.

### Risk 5 — Data Migration Errors
- **Likelihood:** Medium — schema differences, encoding issues, or UUID vs integer ID mismatches between Supabase and Cloud SQL.
- **Mitigation:**
  - Run `pg_dump` + `pg_restore` in a staging Cloud SQL instance first.
  - Compare row counts per table before switching traffic.
  - Keep Supabase live and readable for 30 days after cutover.

### Risk 6 — Route and Navigation Data Quality
- **Likelihood:** High — mall_nodes and mall_edges were seeded from unit numbers and floor names, not real floor plans. Dijkstra paths may be structurally correct but physically wrong.
- **Mitigation:**
  - NavigateScreen already has a fallback mode (shop-list without graph steps).
  - Label AI-generated routes clearly as "estimated" in the UI.
  - Do not use Google Maps Directions API for indoor routing — it does not support it.
  - Real floor plan data should come from mall operators (B2B relationship).

---

## 6. Rollback Plan

### General Principles
1. **The Supabase app is never deleted until Phase 7 is fully tested and signed off.**
2. **All migration work lives on branches.** Nothing is merged to `main` until manually reviewed and tested.
3. **The frontend uses an environment variable (`VITE_API_URL`) to switch between Supabase and Cloud Run.** Rolling back is a one-line env change + redeploy.
4. **Supabase Edge Functions are not removed or disabled until the Cloud Run equivalent has been running in production for at least 14 days without errors.**
5. **Old environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are not deleted from `.env` until Google replacement is fully operational.**

### Per-Phase Rollback

| Phase | Rollback Action |
|-------|----------------|
| Phase 2 | Delete Cloud Run service. No data affected. |
| Phase 3 | Stop routing to Cloud Run. Supabase functions still live. |
| Phase 4 | Set feature flag to Supabase assistant. Gemini service stays deployed but unused. |
| Phase 5 | Set `VITE_API_URL` back to Supabase URL. Cloud SQL remains but receives no traffic. Supabase DB was never taken offline. |
| Phase 6 | Stop BigQuery streaming inserts. Analytics go dark but operational data is unaffected. |
| Phase 7 | Restore Supabase Auth env vars. Password reset emails go out to affected users. FCM subscriptions must be re-registered. |

---

## 7. What Is Not Changing

The following are **out of scope for this migration** and will not be touched:

- The React + Vite + TypeScript frontend stack
- The product data schema (malls, shops, products tables)
- The shopping session and navigation graph data model
- The scraper scripts (`scripts/scraper/`) — these can run against either Supabase or Cloud SQL
- The gamification system (XP, levels, achievements)
- The B2C subscription model and pricing tiers

---

## 8. Decision Points Before Each Phase

Before starting each phase, the following must be confirmed:

| Phase | Decision Required |
|-------|------------------|
| Phase 2 | Google Cloud project created, billing account set, budget alert configured |
| Phase 3 | Secret Manager enabled, Supabase service role key stored as a secret |
| Phase 4 | Vertex AI API enabled, Gemini API quota confirmed, A/B test plan agreed |
| Phase 5 | Cloud SQL instance provisioned, `pg_dump` tested on staging, dual-write period agreed (minimum 7 days) |
| Phase 6 | BigQuery dataset created, data retention policy agreed, Looker Studio access set up |
| Phase 7 | Firebase project linked to Google Cloud project, user migration strategy agreed, FCM tested on Android + iOS |

---

*This document is the single source of truth for the Google Cloud migration. No infrastructure changes are made until the relevant phase decision point is confirmed. The Supabase app remains live and untouched until explicitly superseded.*
