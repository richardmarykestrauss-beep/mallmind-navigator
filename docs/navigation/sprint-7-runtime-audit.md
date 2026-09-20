# Sprint 7 — runtime audit (written before the unification changes)

Baseline: `claude-premium-nav-test` at `4009bdd` (PR #61 merged). Date 2026-09-20.

## The two paths as they exist at the baseline

### PATH A — manual destination search (canonical since Sprint 4)

| Stage | File / symbol |
|---|---|
| Venue resolution | `src/pages/NavigateScreen.tsx` (`parseWayfindingAnchor`, `getWayfindingMall`) |
| Spatial truth | `src/venue/packs/*.venue.json` via `src/venue/registry.ts` (glob + `bundle.json`) |
| Destination vocabulary | `src/venue/search.ts` (`searchDestinations`, `searchableDestinations`) |
| Router | `src/venue/route.ts` `buildRoute` (Dijkstra, one-way edges, directional wording, metric only when every hop is measured) |
| Session | `src/components/navigation/navigationSession.ts` (pure reducer) |
| Experience | `src/components/navigation/WayfindingPilot.tsx` (search → overview → walking → arrival) |
| Persistence | `navigationSessionStore.ts` (localStorage, 2 h) |
| Analytics | `navigationEvents.ts` → `trackEvent` (best-effort) |
| Tests | `WayfindingPilot.test.tsx`, `navigationSession.test.ts`, `venue.test.ts`, `testMallAlpha.zeroCode.test.tsx`, `factoryTestCentre.e2e.test.tsx`, browser QA scripts |
| Backend dependency | none |

### PATH B — assistant navigation (legacy, retired by this sprint)

| Stage | File / symbol |
|---|---|
| Entry | `src/pages/AssistantPage.tsx` `sendMessage` → `sendAssistantMessage` (`POST /assistant`) |
| Intent | `google-cloud-backend/src/services/geminiService.ts`: deterministic bypass (`extractDirectRouteDestination` → `findRouteShopsByName` on Supabase `shops`), Gemini function calling with tool `build_route { shop_ids, summary }`, and a "route intent safety net" that forces a route from `recommend_products` results |
| Router | `google-cloud-backend/src/services/routingService.ts` `buildRoute` / `buildRouteNoSession` → `routingCore.ts` Dijkstra over Supabase `mall_nodes` / `mall_edges`; writes `shopping_routes` |
| Fabrication risk | `buildFallbackRouteSteps` synthesises "Find <shop> …" steps with `node_id: ""` and `distance_meters: 0` when no graph exists |
| Endpoint | `POST /build-route` (`routes/buildRoute.ts`, mounted in `server.ts`) — also called directly by `AssistantPage.handleNavigateToShop` |
| Transport | `AssistantResponse { route_steps, route_id, build_route, route_shop_ids, route_summary }` (`src/lib/googleBackendClient.ts`) |
| Frontend state | `ShoppingSessionContext` `setActiveRoute(routeId, steps)`, `activeRouteSteps`, `loadRoute` (reads `shopping_routes`), plus `routeStops` (a non-spatial shop checklist from `SearchPage` "Find & Compare" and the assistant fallback) |
| UI | `NavigateScreen` mode 2: its own map (`schematicModelFromRoute` from step coordinates, floor chips), "Done" per step, progress %, XP toast, "🎉 Route complete!", `routeWalk*` / `mapRenderMode` helpers |
| Data source | Supabase `mall_nodes`, `mall_edges`, `shops`, `shopping_sessions`, `shopping_routes` |
| Tests | backend `test:routing` (`routingServiceHarness.ts`, pure core), `test:shopping-assistant` (`shoppingAssistantHarness.ts`, pure engine; asserts `build_route === false` on deterministic shopping results) |
| Other consumers of the backend router | `routes/mapFactory.ts` uses `mapFactoryRouteGraphBuilderService` (its own graph builder), not `routingService`; `mallRouteGraphStagingService.ts` has its own `buildRouteNodeCandidates`. No other consumer of `/build-route` exists in the repository. |

### The identity gap between the paths

The app's `selectedMall` is a Supabase `malls` row (uuid). Venue Packs are keyed by slug (`mallreds-pilot`, `menlyn-park`, `garden-route-mall`). Nothing links the two today; the assistant works in uuid space and the navigation runtime in pack space. Unification therefore needs a small, data-driven venue lookup from the mall's name (no production ids in the repository, by policy).

## What the AI actually decides today

Gemini (or the deterministic bypass) chooses shop ids from the retail directory; the backend Dijkstra then chooses corridors over `mall_nodes`. When no graph exists the backend invents a stop list dressed as route steps. The customer-facing UI then renders that as a route. That is the second spatial truth this sprint removes.

## Unification decisions taken into implementation

1. The assistant returns a `navigation_request` (the destination the visitor asked for, as a phrase and, when it came from a product, the shop name) — never steps, ids from a spatial graph, distances or times.
2. The frontend resolves that request against the active Venue Pack's search vocabulary into a `NavigationIntent { type: "navigate", venue_id, destination_id }`, or reports `ambiguous` (candidates) / `unknown`.
3. A resolved intent opens `/navigate?mall=<venue>&to=<destination>` and the same runtime (router → session → Navigation Experience V2) takes over from the visitor's current trusted start.
4. `/build-route` is unmounted; `routingService` / `routingCore` stay (harness-tested, used by nothing customer-facing) and are marked legacy.
5. `NavigateScreen` mode 2's route-step experience is removed; the non-spatial "stop list" checklist from Find & Compare stays as a clearly separate feature with no map and no step semantics.

## Post-unification (end of Sprint 7)

| Question | Answer |
|---|---|
| Spatial truths in the customer build | **One**: bundled Venue Packs routed on the device (`src/navigation/dataAuthority.test.ts` guards it) |
| Assistant output | `navigation_request` intent; `route_steps` / `route_id` deprecated, always empty |
| `/build-route` | unmounted and deleted; no server-side router replaced it; `routingService.ts` LEGACY (harness only) |
| `NavigateScreen` mode 2 | removed (map from step coordinates, floor chips, per-step Done, progress %, XP toast) |
| Stop list | kept as a labelled non-spatial checklist; "Guide me" hands each shop to the runtime as an intent |
| Identity gap | `findVenueForMall(mallName)` by normalised name; no production ids in the repo; `no_venue` when no pack |
| Multi-floor | connectors, directed expansion, cost ≠ distance, preference, confirmed-floor map (`multi-floor-foundation.md`) |
| Real venues | untouched; router output byte-identical to the base branch for the regression journeys |

Full write-ups: `unified-navigation-runtime.md`, `multi-floor-foundation.md`.
