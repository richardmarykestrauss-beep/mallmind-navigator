# Sprint 8 — pre-sprint audit (written before any behaviour change)

Base: `claude-premium-nav-test` at `8b8da3a` (PR #62 merged). Read-only findings; every line below is a
repository fact unless marked *inference*.

## 1. Current Garden Route visitor experience

- Venue `garden-route-mall` (`src/venue/packs/garden-route-mall.venue.json`, pack_version 1,
  `controlled-pilot`, `official: false`, geometry `source-backed`, measurement `unmeasured`,
  field verification `pending`). One floor (`L1`), `distance_unit: px`, no `plan_image`.
- 10 nodes, 9 edges, 9 forward-only instructions (wording carried from the legacy dataset and
  recorded as a provenance gap in the dry-run ledger). One start anchor: **Entrance 4** (QR-eligible).
- Routes: Entrance 4 → Woolworths (2 legs), → Clicks (7 legs), → Pick n Pay (8 legs). No metres,
  no minutes ("Distance not yet measured"). Router output is byte-identical to the previous release.
- Visitor copy: "Garden Route Mall · Mapped route", "Mapped route · not yet walked on site ·
  distance not measured", details say controlled pilot, not an official deployment.

## 2. Current Garden Route destinations

| Destination | Unit | Category in pack | Aliases | Routable | Identity evidence | Arrival evidence |
|---|---|---|---|---|---|---|
| Woolworths | 9 | none | none | yes | secondary corroboration (directory snippet G03) | corridor arrival |
| Clicks | 37 | none | none | yes | secondary corroboration (G01 + clicks.co.za) | corridor arrival |
| Pick n Pay | 41 | none | none | yes | secondary corroboration (G02) | corridor arrival |

Known tenant identities in the research ledger with **no traced geometry**: Dis-Chem 122/123 (G04),
Game 129 (G05), Food Lovers Market 131 (G06). The forensics table names Game (129) and the red
122/123 block on the west column but records no measured pixels for them. Amenities seen on the sheet
(toilets ≈(148,262) and ≈(248,745), ATM markers) are not in the pack. Entrances 3, 5, 6, 7 are labelled
on the sheet; only Entrance 4 is a start.

## 3. Evidence limitations

- The official map image is not in the repository (rights `unknown`); the directory pages are
  `public_no_reuse` search snippets; the pages themselves were never fetched.
- No scale bar (G19), no level labels (G20), store doors not drawn, Entrance 7 digit uncertain.
- Centre Management "near Entrance 2" is UNKNOWN (G12). Nothing in the ledger supports opening hours,
  accessibility or a second level.
- The contract cannot express a known tenant without an arrival node: `arrival_node` is a required
  string referencing a node (`validate.ts:332`), and `searchableDestinations` filters to connected
  nodes (`search.ts:53`). `category` exists on the contract but search never indexes it.

## 4. Current analytics events

- `src/lib/analytics.ts` `trackEvent` → Supabase `app_events` via the anon key, with `user_id` when
  logged in. Navigation events (`navigationEvents.ts`): destination_selected, route_overview_opened,
  navigation_session_started, navigation_step_advanced/back, location_update_opened,
  navigation_reanchored, navigation_arrived, navigation_restarted, navigation_unroutable,
  navigation_failed, plus `navigation_intent` and `ai_route_triggered` (with raw query text).
- No session identifier, no client timestamp, no venue-open or QR-landing event, no event for an
  invalid link anchor, no destination-search or no-result event. `search_events` is product search only.
- A second pipeline (`analyticsClient.ts` → backend `analytics_events`) carries assistant and retail
  events with `query_text`.

## 5. PWA / offline state

`public/sw.js` precaches `/`, `/index.html`, manifest and two icons only; build assets are cached
on first fetch; registration happens on `window.load` (`src/main.tsx`); `skipWaiting` on install with
no update flow; caches are keyed by a hand-edited constant; no ErrorBoundary around the lazy routes
(`src/App.tsx`); the persisted session (`navigationSessionStore.ts`, key `…session.v2`, 2 h TTL)
carries no pack version; no offline indicator; no iOS procedure. Packs are bundled by
`import.meta.glob` into a 61 KB lazy chunk shared by the Navigate and Assistant routes.

## 6. Legacy spatial writers

- `google-cloud-backend/src/services/mapFactory/*` (admin-only) still writes `mall_nodes` /
  `mall_edges`; `googleAiProviderService.ts` calls Gemini for the legacy pipeline; default provider mock.
- `/indoor-map-model` (`server.ts:78`) is mounted public, unauthenticated and without a rate limiter,
  serving the legacy graph. No frontend caller (`dataAuthority.test.ts` guards customer sources).
- `routingService.ts` / `routingCore.ts` remain for the routing harness only.

## 7. Auth / security assumptions

- One global `profiles.is_admin` boolean; backend `requireAdmin` copies in ~10 route files.
- `/admin/data-ingestion` and `/admin/data-command-center` are not wrapped in `AdminGuard`.
- Storage bucket `mall-map-assets` (migration 018): public read; **insert and delete allowed for any
  authenticated user**; SVG and PDF accepted into a public bucket.
- Factory approval `reviewer` is free text; publishing authority is whoever runs the CLI and merges.

## 8. Operational-state capability

None. Connector `availability` is static pack data (changing it means a factory revision). Supabase
`shops.branch_status` exists but is not read by navigation. No closure, outage, or temporary-hours
model; no operational audit log (only `admin_audit_log` for admin retail/research actions).

## 9. What this sprint changes (bounded)

A. Garden Route: known-but-unroutable destinations (additive contract), categories and a small alias
vocabulary, no new geometry. B. Operational overlay applied at load, with an append-only operational
log seam and a visibly labelled DEMO simulation. C. Session-scoped, user-id-free pilot events with a
QR funnel and search-miss classification. D. Service worker precache, early registration, update
flow, pack-version-bound session restore, error boundary, offline indicator, iOS procedure.
E. `/indoor-map-model` no longer anonymous, bucket write policies tightened to admins, stronger
data-authority guard, retirement note.
