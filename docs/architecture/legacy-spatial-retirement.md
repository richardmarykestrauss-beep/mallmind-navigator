# Legacy spatial authority — retirement note (Sprint 8)

The visitor navigation runtime has ONE spatial authority: the bundled Venue Packs
(`src/venue/packs/*.venue.json`), routed on the device. Everything below is what still exists
beside it, what it is used for, and what should happen to it. `src/navigation/dataAuthority.test.ts`
fails the build if a customer navigation source references any of it.

| Component | Status | Used by | Security note | Recommendation |
|---|---|---|---|---|
| `google-cloud-backend/src/services/mapFactory/*` (harvest, extraction, layout, route-graph builder, QA, publish) | **Admin-only, legacy** | `/admin/map-factory/*` routes; `MapFactoryTab` in the admin dashboard; `src/tests/mapFactoryHarness.ts` | Writes `mall_nodes` / `mall_edges`; default AI provider is mock; `googleAiProviderService` fetches admin-supplied URLs with no size cap or host allowlist | **Delete** after confirming no admin workflow depends on it; until then it must never gain a customer consumer. The Venue Pack Factory (`src/venue/factory`) is its replacement. |
| `mall_nodes`, `mall_edges`, `map_factory_*` tables | **Legacy data**, read by admin tooling only | admin dashboard counts, Map Factory, `routingService` harness | RLS: public SELECT, client writes revoked (042) | Keep read-only until the Map Factory is deleted; then drop with a migration. |
| `/indoor-map-model` | **Admin-only since Sprint 8** (was public, unauthenticated, unlimited) | nothing in the frontend (`googleBackendClient.getIndoorMapModel` was removed in Sprint 7) | now `requireAdmin` + the public rate limiter | **Delete** with the Map Factory. |
| `routingService.ts`, `routingCore.ts` | **Test-only** (`test:routing` harness, 28 checks) | harness | none | Delete when the harness is ported to the Venue Pack router, or keep as a frozen regression oracle. |
| `/build-route` | Deleted in Sprint 7 | — | — | — |
| `supabase/functions/build-route` | **Dead** (edge function; no frontend caller) | none | public edge function if deployed | Delete; verify it is not deployed. |
| Storage bucket `mall-map-assets` | **Admin writes only since migration 043** (was any authenticated user) | `MallIntelligenceTab` uploads; public read for admin rendering | public bucket accepting SVG/PDF | Never reuse for Venue Factory customer uploads (guarded by test); plan a private bucket with signed URLs for the factory intake sprint. |
| `src/pages/admin/AdminDashboard.tsx` Map Factory / Mall Intelligence tabs | **Admin-only, legacy** | admins | client gate only; backend re-checks `is_admin` | Freeze; remove with the backend Map Factory. |
| `/admin/data-ingestion`, `/admin/data-command-center` | **Prototype, ungated** (localStorage only) | nobody in production | mislabelled as admin pages | Gate with `AdminGuard` or remove in the retail clean-up. |
| `src/components/navigation/mallRedsPilotGraph.ts` | **Test-only** reference bindings | legacy tests | none | Retire when the tests are ported to the registry API. |

## What is and is not spatial truth

- **Is**: a Venue Pack published by the factory (human approval bound to the draft bytes) and
  bundled by `bundle.json`; the operational overlay applied at load (temporary, never persisted
  into the pack).
- **Is not**: anything the backend Map Factory produces; `mall_nodes` / `mall_edges`; the assistant
  (intent only); any AI output (candidates only, never truth without review).

## Authority model note (for the overlay)

The overlay and the operational log carry an `actor { id, kind: operator | mallmind | demo | system,
display }`. Nothing in the overlay domain references `profiles.is_admin`. The future model is
`operator_id`, venue-scoped roles (operations, marketing) and tenant-scoped roles (a tenant may edit
its own hours and copy, never spatial truth), with reviewer identity recorded in the factory
approval. Not built in Sprint 8.

## Venue identity note

Sprint 8 adds no reliance on normalised venue names: every new Garden Route datum uses the canonical
`garden-route-mall` id, and the demo overlay is keyed by venue id. The future identity model is
`venue_id` (immutable slug), `operator_id`, `property_group_id`, `external_ids` (directory uuid,
Google place id, partner ids) and `aliases`; `findVenueForMall(name)` remains a transitional bridge.

## Registry scale note

The eager pack registry (`import.meta.glob` + `bundle.json`) bundles all packs into one lazy chunk
and validates each at import. Acceptable for the current three venues (42 KB of packs in a 61 KB
chunk); it must move to per-venue lazy loading with a manifest before portfolio scale (tens of
venues). Sprint 8 added 2 KB to one pack and no new venues.
