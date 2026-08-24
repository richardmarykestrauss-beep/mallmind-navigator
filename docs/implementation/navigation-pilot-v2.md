# Navigation Pilot v2 — mobile-first Mall@Reds wayfinding

Evolves the merged `/pilot` into a mobile-first, **destination-first** wayfinding experience that
feels closer to the real product, still on the schematic graph. Reuses the existing routing logic +
`IndoorMapCanvas`. No new infrastructure, no live positioning, no product/price dependency, no
routing-engine change, no migrations.

## UX changes

- **Destination-first flow:** "Where do you want to go?" → pick a shop/facility → "Starting from …"
  (changeable, re-routes instantly). More natural for a shopper who knows *what* they want, not
  *where they are*.
- **Store + amenity finder** with **search-as-you-type**, a clear no-result state, and one-tap
  suggestions (stores 🛍️ + facilities: Information Desk, Lifts, Toilets, Food Court).
- **Navigation-style route card:** big destination name, a distance / walk-time / floor summary row,
  the **first instruction highlighted**, then the step list, over the schematic map.
- **Step-by-step mode:** "Step X of N" with Previous / Next / "View full route" (a route-instruction
  viewer — *not* live navigation, no animated user location).
- **Trivial re-selection of start** ("I'm actually at the Information Desk") rebuilds the route
  immediately — the pilot's stand-in for rerouting.
- **Compact honest-status area:** the truth labels moved into a collapsible one-line `<details>` so
  they stay present without dominating the route.
- Bigger tap targets (≥44px), single-column layout, portrait-first, no horizontal scroll.

## Files changed

- `src/components/navigation/mallRedsPilotGraph.ts` — adds schematic amenity anchors (Lifts, Toilets,
  Food Court) + edges; a `pilotPointsOfInterest()` / `searchPilotPois()` finder (stores + amenities,
  honestly limited to connected nodes); and the **`PilotAnchor` positioning-seam abstraction**.
- `src/pages/MallRedsPilot.tsx` — rewritten mobile-first destination-first UI + step mode.
- `src/components/navigation/pilotRoute.test.ts` — expanded to 12 tests (routing + POI/amenity +
  search + anchor).
- `pilotRoute.ts` and `App.tsx` — **unchanged** (routing engine + `/pilot` route intact).

## Shopper flow

`/pilot` → **search or tap a destination** (shop or facility) → route view shows **Going to X**,
a changeable **Starting from** selector, **distance/time/floor**, the schematic map, and turn-by-turn
(or step-by-step). Change start or destination any time; unknown/disconnected destinations fail
honestly.

## Reused components (unchanged)

`IndoorMapCanvas` (renderer, `simulatedPosition={null}` → no live marker), `floorplanModel`
(`toFloorplanModel`, `buildRoutePolyline`), the `pilotBuildRoute` Dijkstra (a faithful port of
`routingService`), and the `RouteStep` shape.

## Future positioning seam (PART 9)

The route consumes only a **`PilotAnchor { nodeId, label, source }`**; `source` ∈ `manual | qr |
native | wifi_rtt | uwb | apple_indoor`. Today the anchor is set by manual selection
(`anchorFromStart(nodeId, "manual")`); a future positioning provider can set the same anchor with a
different `source` **without changing the route UI or engine** — the router never sees `source`.

## Amenities (PART 7)

The pilot now exposes **Information Desk, Lifts, Toilets, Food Court** as routable destinations
alongside the five real tenants. Their **types are real** (categories every mall has) but their
**coordinates are schematic**, at the exact same honesty level as the tenant positions — all covered
by the "pilot schematic · awaiting on-site verification" label. **Verified amenity positions are the
next DATA task**, not a code change: swap the pilot graph for real `mall_nodes`/`mall_edges`.

## Mobile widths tested

320 · 360 · 390 · 430 px (portrait). **No horizontal overflow** at any width (measured
`document.scrollWidth === clientWidth`, e.g. 320→0px, 430→0px). The map is contained in an
`overflow-hidden` box and scales down.

## Exact test results

**Unit (`pilotRoute.test.ts`): 12/12 pass** — start anchors; changing start changes origin; Clicks /
Game / Dis-Chem routes; unknown fails honestly; disconnected fails honestly; instructions+floor on
every step; routing needs only the graph; POI finder exposes tenants + amenities all routable; routes
to an amenity (Toilets); search-as-you-type filters (toil→Toilets); anchor defaults + source
decoupling.

**Browser (`/pilot`, verified via accessibility-tree + JS, viewport 390/320/430):**
1. `/pilot` loads and survives fresh navigation ✅
2. Destination-first finder renders stores + facilities ✅
3. Search-as-you-type: `toil`→Toilets only; `zzz`→honest no-result; empty→all 9 ✅
4. Main Entrance → Clicks routes + renders (summary, map, turn-by-turn) ✅
5. Changing start to Entrance 2 re-routes instantly (first step → "Start at Entrance 2…") ✅
6. Step mode: "Step 1 of 6", Previous disabled at start, Next → "Step 2 of 6", View full route ✅
7. Map shows START/ENTRY/LIFT + destination pins and **no live-position marker** ✅
8. No horizontal overflow at 320/390/430 ✅
9. `npm run verify:all` — **ALL 14 CHECKS PASSED** (incl. frontend build + 12 pilot tests) ✅

**Dev-cache note:** the app registers a service worker; after code changes it can serve stale JS
(seen once as a blank page). Unregistering it / a hard refresh fixes it — a known SW dev-cache
gotcha, not a pilot bug; the production build is unaffected.

## Known limitations

Single Ground floor; schematic geometry/distances (not surveyed); amenities at schematic positions;
five real tenants + four amenities routable (not all 115 tenants); start chosen, not detected; not
accessibility- or emergency-verified.

## Boundaries confirmed

No product/price work; no product publication path; no fabricated prices; no live-positioning claim
(`simulatedPosition={null}`, honest labels); no new infrastructure/migrations/map library; retail
intake pipeline untouched.
