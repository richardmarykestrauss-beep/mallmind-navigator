# Navigation-First Pilot — Mall@Reds (schematic)

A lean, honestly-labelled navigation pilot proving the MallMind wayfinding flow **without waiting
for an official floorplan**. Reuses the existing routing logic and renderer; adds no infrastructure,
no live positioning, and no product/price dependency. Route: **`/pilot`**.

## Shopper flow implemented

`/pilot` → choose a **start point** ("Where are you starting?": Main Entrance / Entrance 2 /
Information Desk) → **search or pick a real tenant** → the routing logic builds a route →
it **renders on the existing `IndoorMapCanvas`** with **turn-by-turn steps** → start/destination can
be changed without reloading. Verified live in-browser: picking *Clicks* from *Main Entrance* drew a
route ("~66 m · ~1 min") with steps *Start at Main Entrance… → Continue along the concourse → Walk
toward Clicks → You've arrived at Clicks*, and **no live-position marker**.

## Files changed

- `src/components/navigation/mallRedsPilotGraph.ts` **(new)** — Mall@Reds pilot graph in the existing
  `mall_nodes`/`mall_edges` shape (entrances, Information Desk, corridor spine, real anchor tenants),
  plus `pilotStartOptions()` and an honest `pilotDestinations()` (only connected shops).
- `src/components/navigation/pilotRoute.ts` **(new)** — pure client-side route: a **faithful port of
  `google-cloud-backend/src/services/routingService.ts`** (same Dijkstra, same node/edge shape).
  Never fabricates a route (`fallback`/`found=false`).
- `src/components/navigation/pilotRoute.test.ts` **(new)** — 7 unit tests.
- `src/pages/MallRedsPilot.tsx` **(new)** — the pilot page (picker, search, map, turn-by-turn, labels).
- `src/App.tsx` **(modified)** — adds the `/pilot` route.
- `.claude/launch.json` (local dev preview config only; **not committed**).

## Reused components (unchanged)

`IndoorMapCanvas` (renderer), `floorplanModel.ts` (`toFloorplanModel`, `buildRoutePolyline`,
`FloorplanModel`), the `RouteStep` contract (`ShoppingSessionContext`), and the honest schematic
labelling already built into the canvas.

## Real vs synthetic data

- **Real:** Mall@Reds tenant **names** (Woolworths, Clicks, Dis-Chem, Pick n Pay, Game) — anchors
  confirmed on the official directory; the mall identity.
- **Synthetic / schematic:** node **coordinates**, corridor **edges**, entrance/landmark positions,
  and distances. These are illustrative and **await on-site verification** — clearly labelled as
  such. No fake retailer identities were created; unit positions are not claimed as surveyed.

## Honesty & safety labels (all shown on-screen)

"Pilot schematic — route geometry awaiting on-site verification" · "Not an official Mall@Reds
floorplan" · "Route preview only — live indoor positioning is not active" · "Not verified for
accessibility. Not for emergency or evacuation use" · per-route "Route preview only — this does not
track your live position." The canvas is passed `simulatedPosition={null}` so **no moving marker**
can be mistaken for a detected live position.

## Known limitations

Single floor (Ground) — multi-floor awaits verified data. Geometry/distances are schematic, not
surveyed. Only the 5 curated anchors are routable (the pilot does **not** pretend all 115 tenants are
mapped). Start point is chosen, never auto-detected. Not accessibility-verified; not for emergencies.

## Swapping in verified map data later (data replacement, not a rewrite)

Replace the pilot graph with verified data of the **same shape** — no frontend or routing rewrite:
- **node coordinates** (`x_coordinate`/`y_coordinate`, 0–100) + node **types** (entrance/corridor/
  shop/escalator/lift/landmark) + **floor**;
- **corridor edges** (`from_node_id`/`to_node_id`/`distance_meters`, `floor_change` for vertical
  connectors);
- **entrances** and **vertical connectors** as nodes;
- **`linked_shop_id`** joining shop nodes to the real tenant register (115 tenants already in-repo);
- optionally a real **floorplan image/SVG** for the canvas base layer.
Then either seed real `mall_nodes`/`mall_edges` and call the existing `POST /build-route`, or point
`toFloorplanModel`/`pilotBuildRoute` at the loaded data. The importer for real geometry is **not**
built here.

## Tests & results

- `pilotRoute.test.ts`: **7/7 pass** — start options load valid anchors; changing start changes
  origin; known tenant → multi-segment route; unknown tenant fails honestly; disconnected tenant
  fails honestly; instructions + floor render on every step; routing needs only the graph (no
  product/price input) and every curated destination is genuinely routable.
- In-browser (`/pilot`): pilot renders; Main Entrance → Clicks routes and renders with turn-by-turn;
  all disclaimers visible; no live marker.
- Pilot files typecheck clean; `npm run verify:all` green (see final report).

## Boundaries confirmed

No product/price work introduced; no product publication path; no live positioning claimed; no new
infrastructure, migrations, routing engine, or map library; the product/price intake pipeline is
untouched.
