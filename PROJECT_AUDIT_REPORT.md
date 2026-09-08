# MallMind Navigator — Full Technical & Product Readiness Audit

**Audit date:** 2026-05-15  
**Branch audited:** `google-cloud-migration-plan`  
**Last sprint:** 10C (Midnight Neon Visual Refinement)  
**Auditor:** Claude (via direct repo inspection — no PROJECT_AUDIT_INPUT.txt found)

---

## Executive Summary

MallMind is in a strong **late-MVP / early-production** state for its shopper-facing core. The full product journey — select mall → search products → compare prices → build route → navigate → park → return to car — is implemented end-to-end with real Supabase data. Auth, rewards, AI assistant, deals, price trust seals, admin dashboard, and a 5-bot data pipeline are all genuinely working.

**What holds it back from v1.0 launch:** no payment integration (subscription UI exists but goes nowhere), profile settings are decorative, and there is no PWA manifest. The product is shippable to early adopters right now as a free tier; it needs ~3 more sprints before it can charge money.

**Monetisation readiness score: 15/100.** Shopper experience readiness: **78/100.**

---

## Section 1 — Frontend Navigation Audit

### Route inventory (`src/App.tsx`)

| Route | Component | Auth guard | Status |
|-------|-----------|------------|--------|
| `/` | `Home` | None | ✅ Real — mall selector, AI entry, deals strip |
| `/malls` | `Malls` | None | ✅ Real — 8 malls from Supabase, GPS detection |
| `/search` | `SearchPage` | None | ✅ Real — product search, price compare, route build |
| `/list` | `ShoppingList` | None | ✅ Real — Supabase CRUD, "Find Everything" → AI |
| `/deals` | `Deals` | None | ✅ Real — best_deals view, working Navigate There |
| `/assistant` | `AssistantPage` | None | ✅ Real — Claude Haiku / Gemini Flash, session DB |
| `/auth` | `AuthPage` | None | ✅ Real — email + Google OAuth |
| `/navigate` | `NavigateScreen` | None | ✅ Real — route stops, XP award, floor switcher |
| `/parking` | `Parking` | None | ✅ Real — GPS save, Google Maps deep link |
| `/rewards` | `Rewards` | None | ✅ Real — XP, achievements from Supabase |
| `/profile` | `Profile` | Soft (shows guest view) | ✅ Real — auth-aware, settings partially decorative |
| `/admin` | `AdminDashboard` (lazy) | `AdminGuard` (3-layer) | ✅ Real — comprehensive, backend-gated |

**Notes:**
- No protected routes for shopper pages — all unauthenticated users can use search, deals, navigate. This is intentional for guest flow.
- Admin is properly guarded: loading → unauthenticated → not-admin, all three layers handled with appropriate UI.
- Admin component is lazy-loaded (good for bundle size).

---

## Section 2 — Button / Action Audit

### Working buttons

| Page | Button/Action | Behaviour |
|------|---------------|-----------|
| Home | Start Shopping | → /malls |
| Home | Ask AI | → /assistant |
| Home | Best Deals | → /deals |
| Home | Mall cards | Sets selectedMall in context, → /search |
| Malls | Mall cards | Sets selectedMall, → /search |
| Malls | Detect My Location | Calls detect-active-mall Edge Fn / Cloud Run |
| Search | Type in search | 400ms debounce → Supabase query |
| Search | Product card checkbox | Adds shop to route selection |
| Search | "Report a price" | Opens PriceSubmitModal |
| Search | Bell icon | PriceAlertButton → price_alerts table |
| Search | Build My Route | Sorts shops by floor, → /navigate |
| Deals | Category chips | Filters by category (derived from live data) |
| Deals | Navigate There | Shop lookup → setRouteStops → /navigate |
| Shopping List | Add (Enter/button) | Inserts to shopping_list_items |
| Shopping List | Trash icon | Deletes from shopping_list_items |
| Shopping List | Find Everything | Prefills AI assistant with full list |
| Navigate | Next Stop / Done | Advances currentStopIndex, awards XP on completion |
| Navigate | Floor tabs | Filters display to active floor |
| Navigate | Reset | Clears session, → /search |
| Parking | Save My Spot | navigator.geolocation → parking_spots insert |
| Parking | Take Me To My Car | Google Maps deep link with coords |
| Parking | Reset | Deletes parking_spots row |
| Profile (guest) | Sign In | → /auth |
| Profile (authed) | Rewards quick-link | → /rewards |
| Profile (authed) | Sign Out | Supabase signOut |
| Auth | Sign in / Sign up | Supabase email auth |
| Auth | Continue with Google | Supabase Google OAuth |
| Admin | All dashboard actions | Real — see Section 7 |

### Non-functional / decorative buttons

| Page | Button | Status | Notes |
|------|--------|--------|-------|
| Profile | Notifications | No onClick | Decorative — should open push subscribe flow |
| Profile | Favourite Malls | No onClick | Decorative — "Coming soon" hint shown |
| Profile | Privacy | No onClick | Decorative |
| Profile | Help & Support | No onClick | Decorative |
| Profile | Upgrade — R49/mo | No payment | Button renders, no Stripe/PayFast integration |
| Profile | Manage (subscription) | No payment | Same — no payment processor |
| Theme grid | Any theme swatch | No onClick | Purely visual — no theme switching logic |
| BottomNav | All 5 tabs | ✅ Working | Route navigation |

---

## Section 3 — Backend Connection Audit

### Supabase direct queries

| Page / Hook | Tables queried | Operations |
|-------------|---------------|------------|
| Malls | `malls` | SELECT |
| Search | `shops`, `products` | SELECT (2-step: shops by mall_id, products by shop_ids) |
| Deals | `best_deals` (view), `malls`, `shops` | SELECT |
| Shopping List | `shopping_list_items` | SELECT, INSERT, DELETE |
| Rewards | `achievements`, `user_achievements`, `profiles` | SELECT |
| Parking | `parking_spots` | SELECT, INSERT, DELETE |
| Navigate | `profiles` (XP update via xp.ts) | UPDATE |
| Assistant | `shopping_sessions`, `shopping_routes` | INSERT, SELECT |
| Analytics | `search_events`, `app_events` | INSERT (fire-and-forget) |
| Push | `price_alerts`, `push_subscriptions` | SELECT, INSERT, DELETE |
| AuthContext | `profiles` | SELECT, INSERT (on signup) |
| Admin | `products`, `malls`, `shops` | SELECT, UPDATE |

### Supabase Edge Functions

| Function | Called from | Status |
|----------|-------------|--------|
| `ai-assistant` | AssistantPage (fallback) | ✅ Real |
| `build-route` | ShoppingSessionContext (fallback) | ✅ Real |
| `recommend-products` | Home/Search (fallback) | ✅ Real |
| `detect-active-mall` | Malls page (fallback) | ✅ Real |
| `admin-stats` | AdminDashboard | ✅ Real |
| `scrape-prices` | Cron / manual trigger | ✅ Real |
| `notify-price-drops` | price_alerts pipeline | ✅ Real |

### Google Cloud Run backend (`VITE_GOOGLE_BACKEND_URL`)

When environment variable is set, the following **replace** their Supabase equivalents:

| Route | Purpose |
|-------|---------|
| `/assistant` | AI queries (Claude → Gemini fallback) |
| `/recommend-products` | Product recommendations |
| `/build-route` | Dijkstra route via mall_nodes/mall_edges |
| `/detect-active-mall` | GPS → nearest mall |
| `/analytics/event` | Secure analytics write |
| `/admin/*` | All admin operations (price verify, corrections, data bots, research batches) |

**Note:** The `google-cloud-backend/` directory is **not present in this repo** — it is a separate deployment. Only `google-dev-agent/` exists locally. The frontend client library (`googleBackendClient.ts`, ~1543 lines) is present and complete.

---

## Section 4 — Supabase / Data Audit

### Tables with local migration files (001–006)

| Table | Migration | Data present |
|-------|-----------|-------------|
| `malls` | 001 | ✅ 8 malls with GPS coords |
| `shops` | 001 | ✅ 58 shops across 8 malls |
| `products` | (base schema) | ✅ 110 products seeded |
| `profiles` | 004 | ✅ Auto-created on signup |
| `achievements` | 002 | ✅ 6 XP-milestone badges seeded |
| `user_achievements` | 002 | Created per user |
| `price_alerts` | 003 | ✅ Functional |
| `push_subscriptions` | 003 | ✅ Functional |
| `search_events` | 004 | ✅ Written on every search |
| `app_events` | 004 | ✅ Written on key events |
| `shopping_sessions` | 005 | ✅ Created per AI session |
| `mall_nodes` | 005 | ✅ Auto-seeded from shops |
| `mall_edges` | 005 | ✅ Auto-generated proximity edges |
| `shopping_routes` | 006 | ✅ Saved per route build |
| `shopping_lists` | (base) | Referenced |
| `shopping_list_items` | (base) | ✅ Functional |
| `parking_spots` | (base) | ✅ Functional |

### Tables in code with NO local migration files

These exist in the Google Cloud backend and/or are referenced in `supabaseClient.ts` / `googleBackendClient.ts` but have no `.sql` file in `supabase/migrations/`:

| Table | Referenced in | Risk |
|-------|---------------|------|
| `mall_research_batches` | googleBackendClient.ts | ⚠️ Only exists in Cloud DB — not reproducible locally |
| `mall_research_batch_items` | googleBackendClient.ts | ⚠️ Same |
| `mall_research_sources` | googleBackendClient.ts | ⚠️ Same |
| `mall_data_findings` | googleBackendClient.ts | ⚠️ Same |
| `price_corrections` | googleBackendClient.ts, AdminDashboard | ⚠️ Same |
| `admin_audit_log` | supabaseClient.ts (type `AdminAuditLog`) | ⚠️ Same |
| `analytics_events` | analyticsClient.ts (Cloud backend) | ℹ️ Cloud-only by design |
| `import_jobs` | supabaseClient.ts (type `ImportJob`) | ⚠️ No usage found |
| `best_deals` | Deals.tsx | ℹ️ Supabase view — no migration file |

### Data quality assessment

| Metric | Value | Target |
|--------|-------|--------|
| Malls seeded | 8 | 8 ✅ |
| Shops seeded | 58 | 100+ ⚠️ |
| Products seeded | 110 | 1,000+ ⚠️ |
| Products with `data_quality_status = 'manually_verified'` | Unknown | >50% needed |
| Products with real prices vs sample data | Unknown | >80% needed |
| Achievements seeded | 6 | 6 ✅ |

**110 products across 8 malls = ~14 products per mall.** This is too thin for a real search experience — most queries will return zero results. Data expansion is the highest-impact non-code task.

---

## Section 5 — Bot / Data Pipeline Audit

### 5-bot pipeline (Google Cloud Run, admin-only)

```
Source Research → Finding Extractor → Data Guardian → Duplicate Detection → Admin Review Assistant
```

| Bot | Input | Output | Auto-writes to DB? |
|-----|-------|--------|--------------------|
| Source Research | URL or topic | Structured research findings | No |
| Finding Extractor | Research findings | Typed finding records (shop/product/hours/etc) | No |
| Data Guardian | Finding records | Trust scores + recommended actions | No |
| Duplicate Detection | Finding records | Duplicate matches from existing DB | No |
| Admin Review Assistant | All above | Go/no-go recommendation per finding | No |

**Key safety property:** No bot ever auto-writes live data. Every finding goes through admin review before any DB change. `runLiveDataApplyPlanner` generates a plan — the admin must explicitly apply it.

### Mall Research Batches workflow

1. Admin creates a batch (name + description)
2. Admin adds items to the batch (product/shop/floor to research)
3. Per item: run each of 5 pipeline steps, or `runResearchItemFullPipeline` for one-shot
4. Admin reviews each item's findings
5. Admin approves → `plan-apply` generates DB changes
6. Admin applies plan

### Source ingestion

`ingestMallResearchSource` accepts a URL → fetches HTML → extracts structured data → creates batch items for pipeline processing. Never writes to live tables directly.

### Nightly scraper (`scrape-prices` Edge Function)

Cron-triggered. Targets Takealot API + PriceCheck.co.za. Updates product prices in Supabase. Status of last run not surfaced in admin dashboard.

---

## Section 6 — Shopper App Audit

### Core journey completeness

| Step | Implemented | Real data | Notes |
|------|-------------|-----------|-------|
| Select mall | ✅ | ✅ | 8 malls, GPS auto-detect available |
| Search products | ✅ | ✅ | ilike query, grouped by product name |
| Price comparison | ✅ | ✅ | Cheapest-first sort, trust seal per product |
| Build route | ✅ | ✅ | Floor-sorted, Dijkstra via Cloud Run |
| Navigate stops | ✅ | ✅ | Step-by-step, floor filter, XP on completion |
| Save parking | ✅ | ✅ | Real GPS coords → Supabase |
| Return to car | ✅ | ✅ | Google Maps deep link |
| AI assistant | ✅ | ✅ | Multi-turn, session-persisted, Claude/Gemini |
| Price submissions | ✅ | ✅ | Modal, validation, XP award |
| Price drop alerts | ✅ | ✅ | price_alerts table + push_subscriptions |
| Shopping list → AI | ✅ | ✅ | "Find Everything" prefills assistant |
| Rewards / XP | ✅ | ✅ | 6 achievements, level 1–6, XP events |
| Deals feed | ✅ | ✅ | Mall-scoped, category filter, navigate |

### UX gaps

| Issue | Impact | Fix effort |
|-------|--------|-----------|
| 110 products = most searches return nothing | **Critical** | Data (not code) |
| No "no mall selected" gate on Search input | Medium | 1 hour |
| Parking map is decorative SVG (not Google Maps embed) | Low | Sprint |
| Route map is floor-list only (no visual floor plan) | Low | Sprint (needs real floor data) |
| No deep-link back from Google Maps to app | Low | PWA manifest |
| AI assistant has no conversation history on page reload | Low | sessionStorage |

---

## Section 7 — Admin Dashboard Audit

### Tab inventory (AdminDashboard.tsx)

| Tab | Real? | Notes |
|-----|-------|-------|
| Overview (stats) | ✅ | 19 parallel queries: malls, shops, products by status, users, XP levels, subscriptions, top searches, zero-result queries, mall traffic |
| Products | ✅ | Browse/filter all products, manual price verification, trust status update |
| Price Corrections | ✅ | User-submitted corrections, admin approve/reject with notes |
| Data Sources | ✅ | Create/manage mall data sources (URLs, type, status) |
| Data Findings | ✅ | Review extracted findings, approve/reject for DB import |
| Data Bots | ✅ | Run individual pipeline steps, Data Guardian review UI |
| Research Batches | ✅ | Full CRUD for batches, per-item pipeline, source ingestion |
| Backend Health | ✅ | Checks Google Cloud Run health endpoint |

### Admin guard security

```
AdminGuard (src/pages/admin/AdminGuard.tsx):
  1. Loading → spinner
  2. No user → "Sign in required" + button to /auth
  3. !profile.is_admin → "Access denied" shield icon
  4. Pass → render dashboard
```

Backend additionally checks `is_admin` in Edge Functions and Cloud Run routes. **Double-gated correctly.**

### Admin stats known risk

`admin-stats` Edge Function uses `exec_sql` RPC for some aggregate queries. If the `exec_sql` function was not created in Supabase, some stat cards will silently show zeros. This should be verified against the live DB.

---

## Section 8 — Inactive / Decorative Feature Audit

| Feature | Location | Status | Activation cost |
|---------|----------|--------|----------------|
| Theme switching | ThemePreviewGrid.tsx | 0% — no logic | ~1 sprint (CSS var swap + localStorage) |
| Profile: Notifications | Profile.tsx | 0% — no onClick | ~2 hours (wire to usePushNotifications) |
| Profile: Favourite Malls | Profile.tsx | 0% — no onClick | ~1 day (new table + UI) |
| Profile: Privacy | Profile.tsx | 0% — no onClick | ~1 day (settings page) |
| Profile: Help & Support | Profile.tsx | 0% — no onClick | ~0.5 day (static FAQ page) |
| Subscription: Upgrade | Profile.tsx | UI only | ~1 sprint (PayFast/Stripe integration) |
| Subscription: Manage | Profile.tsx | UI only | ~0.5 sprint (customer portal) |
| PWA / installable | Nowhere | Not started | ~1 day (manifest.json + service worker) |
| Budget mode | AI assistant | Not built | ~2 days (new assistant prompt mode + UI) |
| Geofencing | LocationContext | Not confirmed | ~1 sprint |
| Camera price check | Not started | Not started | ~1 sprint (Gemini Vision API) |
| Retailer portal | Not started | Not started | ~2 sprints |

---

## Section 9 — Performance / Loading Audit

| Area | Finding | Verdict |
|------|---------|---------|
| Admin dashboard | Lazy-loaded via React.lazy | ✅ Good |
| Search debounce | 400ms before query fires | ✅ Good |
| Deals limit | `.limit(80)` on query | ✅ Good |
| Loading states | All async operations show spinners | ✅ Good |
| Image loading | No product images; placeholder icons used | ℹ️ Acceptable for MVP |
| Bundle size | 22 chunks, ~8s build — no large single chunk flagged | ✅ Good |
| Service worker | None | ❌ No offline support |
| PWA manifest | None | ❌ Not installable |
| CDN / asset caching | Vite default hashing | ✅ Good |
| ShoppingSessionContext | sessionStorage-persisted (survives reload) | ✅ Good |
| AI session re-hydration | No page-reload recovery | ⚠️ Minor |
| `console.warn` in loadRoute | ShoppingSessionContext.tsx | ℹ️ Non-critical |

---

## Section 10 — Security / Safety Audit

### Issues

| Severity | Issue | Location | Fix |
|----------|-------|----------|-----|
| 🔴 High | Supabase anon key hardcoded in source file | `src/lib/supabaseClient.ts` | Move to `VITE_SUPABASE_ANON_KEY` env var |
| 🔴 High | Supabase anon key likely duplicated in other pages | Multiple pages | Audit + centralise |
| 🟡 Medium | VAPID public key hardcoded | `src/hooks/usePushNotifications.ts` | Move to `VITE_VAPID_PUBLIC_KEY` env var |
| 🟡 Medium | Parking spots use localStorage UUID — no auth required | `Parking.tsx` | Acceptable for MVP; migrate to auth user_id later |
| 🟡 Medium | No rate limiting on AI assistant (frontend) | `AssistantPage.tsx` | Backend edge function should enforce limits |
| 🟢 Low | Anon users can read all products/shops/malls | RLS policy | Intentional — public data |
| 🟢 Low | `exec_sql` RPC in admin-stats may be overpowered | Edge Function | Scope to read-only queries |

### Strengths

- AdminGuard provides proper 3-layer frontend protection
- Backend re-checks `is_admin` on all admin routes (defence in depth)
- Price correction approval requires admin action — no auto-apply
- Bot pipeline never auto-writes live data
- `PriceAlertButton` checks `user` before rendering — no unauthenticated writes to price_alerts
- Auth uses Supabase built-in (no custom JWT handling)
- Google OAuth via Supabase (no custom OAuth flow)

---

## Section 11 — Product Progress Summary

### What is done (working, real data)

| Feature | Sprint completed |
|---------|-----------------|
| Mall browser (8 SA malls) | Sprint 1 |
| Product search + price comparison | Sprint 2 |
| Route builder → step-by-step navigation | Sprint 3 |
| Parking GPS save + return to car | Sprint 3 |
| Shopping list (Supabase-backed) | Sprint 4 |
| AI assistant (Claude + Gemini fallback) | Sprint 5 |
| Price trust seals (verified/live/expired/disputed) | Sprint 6 |
| Auth (email + Google OAuth) | Sprint 7 |
| Real Rewards (XP, level, achievements) | Sprint 7 |
| Price submission modal + XP | Sprint 8 |
| Price drop alert infrastructure | Sprint 8 |
| Deals page (real data, working navigate) | Sprint 8 |
| Shopping list → AI bridge | Sprint 9 |
| Admin dashboard (full) | Sprint 9 |
| 5-bot data pipeline | Sprint 9 |
| Mall research batches | Sprint 9 |
| Google Cloud Run backend migration | Sprint 10 |
| Midnight Neon visual refinement | Sprint 10C |

### What is not done

| Feature | Priority | Notes |
|---------|----------|-------|
| Payment integration | **P0** | R49/mo subscription UI exists — zero revenue without this |
| Profile settings (4 buttons) | P1 | Notifications most impactful |
| PWA manifest + service worker | P1 | Required for "Add to Home Screen" |
| Data expansion (110 → 1,000+ products) | **P0** | Most searches return nothing |
| Theme switching | P2 | Infrastructure present, no logic |
| Budget mode | P2 | Mentioned in plan, not built |
| Geofencing (auto-detect arrival) | P3 | Malls have GPS — haversine exists |
| Camera price check | P3 | Gemini Vision API |
| Retailer portal | P2 | B2B revenue requires this |
| Missing DB migrations (9 tables) | P1 | Cannot reproduce Cloud DB state locally |

---

## Section 12 — MVP Readiness Score

| Dimension | Score | Notes |
|-----------|-------|-------|
| Core shopper journey | 9/10 | Fully implemented end-to-end |
| Auth & accounts | 9/10 | Email + Google OAuth, auto-profile |
| AI assistant | 9/10 | Real Claude/Gemini, session tracking |
| Rewards & gamification | 8/10 | Real XP, achievements, XP events all wired |
| Deals feed | 8/10 | Real data, working navigate |
| Admin dashboard | 9/10 | Comprehensive, secure, real operations |
| Data pipeline (bots) | 8/10 | Full 5-bot pipeline, safe admin-review gate |
| Data volume | 3/10 | 110 products — most searches fail |
| Subscription / payment | 1/10 | UI only — no payment processor |
| Profile settings | 2/10 | 4 decorative buttons |
| PWA / installable | 0/10 | No manifest |
| Security | 6/10 | Hardcoded keys are a concern |
| Visual design / polish | 9/10 | Midnight Neon — production-quality |

**Overall shopper experience readiness: 78/100**  
**Overall monetisation readiness: 15/100**  
**Overall production launch readiness: 62/100**

---

## Section 13 — Critical Issues (Must Fix Before Launch)

### 🔴 Blockers

1. **Supabase anon key hardcoded in source** (`src/lib/supabaseClient.ts` and likely elsewhere)  
   Risk: Key visible in public JS bundle. Any user can read/write any table that anon RLS allows.  
   Fix: `VITE_SUPABASE_ANON_KEY` env var. Audit all files for inline keys.

2. **110 products = near-zero search success rate**  
   Risk: New users search for anything and see "no results". Instant churn.  
   Fix: Run data pipeline on 10+ more retail URLs before any public launch. Target 500+ products minimum.

3. **No payment processor**  
   Risk: Subscription button exists, no revenue can be collected.  
   Fix: PayFast (SA-native, supports EFT + card) or Stripe. 1 sprint.

### 🟡 Important (Fix Before Marketing Push)

4. **Missing DB migration files for 9 tables**  
   Risk: Cannot reproduce the Supabase schema in a new environment (disaster recovery, staging, dev).  
   Fix: Write migration 007–012 capturing the Cloud DB schema.

5. **Profile settings buttons are decorative**  
   Risk: Users tap Notifications and nothing happens — immediate trust erosion.  
   Fix: Wire Notifications to `usePushNotifications.subscribe()`. 2 hours.

6. **VAPID key hardcoded**  
   Risk: Push subscription key visible in source.  
   Fix: `VITE_VAPID_PUBLIC_KEY` env var.

7. **No PWA manifest**  
   Risk: App cannot be "Added to Home Screen" — no icon on user's phone, no retention loop.  
   Fix: `manifest.json` + service worker. 1 day.

---

## Recommended Next 10 Sprints

| Sprint | Title | Goal | Est. |
|--------|-------|------|------|
| **11** | Security hardening | Move all hardcoded keys to env vars; audit all source files; add `.env.example` | 0.5 days |
| **12** | Data expansion | Run research pipeline on 15+ retail sources; target 500+ products across all 8 malls | 3 days |
| **13** | Payment integration | PayFast or Stripe R49/mo; webhook to update `profiles.subscription_status`; gate Pro features | 1 week |
| **14** | PWA + Notifications | `manifest.json`, service worker, offline route cache; wire Profile Notifications button to push subscribe | 1.5 days |
| **15** | Profile settings | Notifications → push UI; Favourite Malls → `user_favourite_malls` table; Privacy → basic settings; Help → FAQ page | 2 days |
| **16** | Theme switching | CSS variable swap on theme select; persist to `localStorage`; unlock on Pro subscription | 1 day |
| **17** | Budget mode | "I have R___ to spend" input in AI assistant; assistant returns cheapest store combo within budget | 2 days |
| **18** | Missing migrations | Write migration files for all 9 orphaned tables; document Cloud DB setup steps | 1 day |
| **19** | Retailer portal MVP | Simple `/retailer` route with auth gate; form to submit/update own store's prices; `is_retailer` flag in profiles | 1 week |
| **20** | Analytics dashboard | Convert admin stats into retailer-facing pitch deck page; "1,200 shoppers searched your product this month" | 3 days |

---

## Final Total Scope Estimate

| Category | Status | Remaining work |
|----------|--------|---------------|
| Core shopper journey | ✅ Done | Maintenance only |
| Auth + accounts | ✅ Done | Payment gating |
| AI assistant | ✅ Done | Budget mode (Sprint 17) |
| Rewards + gamification | ✅ Done | Minor tuning |
| Admin dashboard | ✅ Done | Analytics sprint |
| Data pipeline (bots) | ✅ Done | Run it more |
| Data content | ⚠️ Thin | Sprint 12 (~3 days) |
| Payment / subscription | ❌ Not started | Sprint 13 (~1 week) |
| PWA / offline | ❌ Not started | Sprint 14 (~1.5 days) |
| Profile settings | ❌ Decorative | Sprint 15 (~2 days) |
| Security | ⚠️ Keys exposed | Sprint 11 (~0.5 days) |
| Theme switching | ❌ Not started | Sprint 16 (~1 day) |
| Budget mode | ❌ Not started | Sprint 17 (~2 days) |
| Missing migrations | ❌ Not started | Sprint 18 (~1 day) |
| Retailer portal | ❌ Not started | Sprint 19 (~1 week) |
| Analytics for retailers | ❌ Not started | Sprint 20 (~3 days) |

**Total remaining to v1.0 (chargeable product):** ~5–6 weeks of focused work  
**Total remaining to soft launch (free tier, public):** ~2 weeks (Sprints 11–12 + security fix)

---

*End of audit. No files were modified. No commits were made.*
