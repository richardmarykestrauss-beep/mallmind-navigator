# Navigation Spatial Data Layer v1 — Mall@Reds

Extracts the Mall@Reds pilot's spatial information out of a hardcoded graph literal and into an
explicit, reusable **spatial dataset** that MallMind can later replace with verified real-world
geometry — **without** changing the routing engine, the page, or the renderer. `/pilot` behaviour is
functionally identical; only the *source* of the graph changed (data-driven, not a code literal).

This is not a new mapping engine. No migrations, no Supabase, no product/price changes, no indoor
positioning, no QR, no MapLibre/PostGIS, no routing-algorithm change, no invented geometry.

## Core principle: evidence lives in the DATA

Every spatial entity can declare its truth level, and it does so in the dataset, not in the UI:

| level | meaning | in this dataset |
| --- | --- | --- |
| `schematic` | illustrative position/distance, awaiting verification | **all** current geometry |
| `source-backed` | derived from a document (register, leasing plan) | none yet (spatial) |
| `on-site-verified` | surveyed / photographed on site | none yet |

The dataset also declares `dataset_status: schematic` and `evidence_status: unverified`. **No
Mall@Reds coordinate is marked source-backed or verified.** A tenant's factual *identity* (e.g.
`Clicks = Shop 45`, from the verified tenant register) is recorded **separately** on the node's
`tenant` block and never upgrades the spatial `evidence` of its coordinate — a source-backed identity
sitting next to a schematic position stays schematic.

## Selected dataset format

A single self-contained JSON file:

`src/components/navigation/data/mall-reds-pilot.dataset.json`

It uses the **same field vocabulary as the existing `map-assets/sandton-nms-lower` asset pack**
(`x_percent` / `y_percent` percent coordinates, `type`, `floor`, `distance_meters`, `floor_change`,
per-entity confidence/evidence, a `layout`-style header with `viewBox`, `coordinate_system`,
`source_policy`, `reality_label`). Two deliberate, minimal extensions over the Sandton files:

- **stable `node_id`** as the join key (Sandton keyed edges by unique `name`; the pilot has five
  `Concourse` corridor nodes that share a name, so a stable id is required);
- **`evidence`** on every node/edge and a **`tenant`** identity block on shops.

### Why not `map-assets/` and not a `.ts` module?

- The Sandton pack in `map-assets/` is consumed by **Node importer scripts** via `fs.readFileSync`
  (see `scripts/map-assets/import-sandton-nms-*.mjs`); nothing in the **frontend bundle** imports
  from `map-assets/`. The pilot dataset is consumed by the **frontend**, so it lives with the
  frontend (`src/components/navigation/data/`) and is imported directly. It keeps the map-assets
  *conventions* while resolving cleanly through Vite, Vitest and `tsc`.
- JSON (not a `.ts` const) is deliberate: the whole point is that a non-code artefact — a real
  leasing plan or directory-board trace — can **replace the data** without touching code.
- `resolveJsonModule: true` was added to `tsconfig.app.json` so the typed JSON import is clean under
  `npm run typecheck` (Vite/Vitest already handle JSON natively).

## Adapter flow

```
MallRedsPilot.tsx
  → mallRedsPilotGraph.ts        (finder / anchors / derived graph — public API unchanged)
     → mallRedsPilotDataset.ts   (ADAPTER: validate + map dataset → BackendNodeLike/BackendEdgeLike)
        → data/mall-reds-pilot.dataset.json   (the spatial DATA)
  → pilotBuildRoute()            (unchanged Dijkstra port of routingService)
  → toFloorplanModel() → IndoorMapCanvas   (unchanged renderer)
```

`mallRedsPilotDataset.ts` is the single seam. `loadPilotSpatialDataset()` validates the dataset
(unique node ids, in-range coordinates, edges reference real nodes, positive distances, known
evidence levels) and maps it onto the **existing** backend `mall_nodes` / `mall_edges` contract
(`BackendNodeLike` / `BackendEdgeLike`) the pilot already consumed. `mallRedsPilotGraph.ts` now
derives `MALL_REDS_PILOT_NODES` / `MALL_REDS_PILOT_EDGES` from that loader instead of holding a
literal; all its finder/anchor helpers and its public exports are unchanged.

## Files changed

| file | change |
| --- | --- |
| `src/components/navigation/data/mall-reds-pilot.dataset.json` | **new** — the spatial dataset (16 nodes, 15 edges, evidence + tenant identity) |
| `src/components/navigation/mallRedsPilotDataset.ts` | **new** — typed dataset contract + validator + adapter (`loadPilotSpatialDataset`) |
| `src/components/navigation/mallRedsPilotDataset.test.ts` | **new** — 10 tests (integrity, evidence, identity-vs-geometry, future-swap proof) |
| `src/components/navigation/mallRedsPilotGraph.ts` | derives the graph from the adapter; adds `pilotDatasetStatus()`; finder/anchor API unchanged |
| `tsconfig.app.json` | `resolveJsonModule: true` (typed JSON import) |
| `docs/implementation/navigation-spatial-data-layer-v1.md` | this document |

`MallRedsPilot.tsx`, `pilotRoute.ts`, `IndoorMapCanvas`, `floorplanModel.ts` and the existing
`pilotRoute.test.ts` were **not** modified — the extraction is behind the stable graph API.

## Data classification (this dataset)

- `dataset_status: schematic`, `evidence_status: unverified`.
- All 16 nodes and 15 edges: `evidence: schematic`.
- `Clicks` node carries `tenant.shop_number: "45"`, `identity_evidence: "source-backed"`, cited to
  `docs/sprint-2f/mallreds-verified-tenant-register.json (mallreds-shop-45)` — while its coordinate
  stays `evidence: schematic`. Other tenants have `shop_number: null`,
  `identity_evidence: "unverified"` (their register numbers are not yet transcribed here).
- Tenant NAMES and amenity TYPES are real; every position and distance is schematic.

## Behaviour-preservation results

Verified on the **production bundle** (`npm run build` → `vite preview`, mobile 375×812, cold load):

| check | result |
| --- | --- |
| `/pilot` mounts, no React/hook error, no error-boundary fallback | ✅ |
| Destination-first finder: 5 stores + 4 facilities (9 POIs) | ✅ 9 |
| Main Entrance → Clicks | ✅ 66 m, 4 steps, map renders |
| Entrance 2 → Game (change start re-routes) | ✅ 40 m, "Start at Entrance 2…" |
| Amenity route (Toilets) | ✅ "arrived at Toilets" |
| Step mode ("Step 1 of N", Prev/Next) | ✅ "Step 1 of 3" |
| Search-as-you-type (`toil`→Toilets, `zzz`→no-result) | ✅ |
| No live-position marker (`simulatedPosition={null}`) | ✅ absent |
| No horizontal overflow (scrollWidth − clientWidth) | ✅ 0 |
| Honest schematic disclaimers present | ✅ |

(The dev server showed transient Radix/HMR dep-optimize console noise while hot-reloading during
testing; the production bundle is clean. The current page uses native `<details>`, not Radix
`Collapsible`.)

## Exact tests

- **`mallRedsPilotDataset.test.ts` (new, 10 tests):** dataset parses + derives a graph; every edge
  endpoint resolves; edges are two distinct nodes with positive distance + validator passes; tenant
  POIs link (`linked_shop_id` routes); entrance/start anchors link to real nodes; evidence stays
  `schematic`/`unverified` for every entity; Clicks identity `source-backed` does **not** upgrade its
  schematic coordinate; derived graph matches the pre-extraction shape (16 nodes / 15 edges / 9 POIs
  / Clicks at 35,80 / entry edge 22 m); **future-swap proof** — a hypothetical `on-site-verified`
  3-node dataset routes through the *same* adapter + engine unchanged (29 m); the validator rejects a
  dangling edge.
- **`pilotRoute.test.ts` (existing, 12 tests):** unchanged, still green — proving the routing engine
  and its contract are untouched.
- **`npm run verify:all`:** ALL 14 checks PASSED (frontend build + 362 frontend tests + Mall@Reds
  import validation + backend harnesses).

## How a verified Mall@Reds dataset replaces the schematic one

When a real directory-board photo / Anaprop leasing plan / surveyed geometry is obtained, the swap is
a **DATA-only** change:

1. Produce a new dataset in the same shape (JSON), or edit
   `data/mall-reds-pilot.dataset.json` in place, setting:
   - real `x_percent` / `y_percent` for each entity, real `distance_meters` on edges;
   - `evidence: source-backed` (from a plan) or `on-site-verified` (surveyed) per entity;
   - `dataset_status` / `evidence_status` accordingly;
   - each tenant's real `shop_number` + `identity_evidence` (Clicks is already `45`).
2. If the dataset lives in a new file, change the one import in `mallRedsPilotDataset.ts`
   (or pass it to `loadPilotSpatialDataset(source)`).
3. Run `npm run verify:all`. The validator enforces structural integrity; the honest labels remain
   until `evidence_status` says otherwise.

**No change** is needed to `MallRedsPilot.tsx`, `pilotRoute.ts`, `IndoorMapCanvas`,
`floorplanModel.ts`, or the finder/anchor helpers. This is proven structurally by the future-swap
test, which drives a verified-shaped dataset through the identical adapter and routing engine.

## Boundaries confirmed

No product/price work, no publication path, no migrations, no Supabase, no new infrastructure, no
positioning/QR/MapLibre/PostGIS, no routing-algorithm change. Current geometry remains
**schematic / unverified**; the only source-backed fact represented is Clicks' shop number (identity,
not position), already present in the repository's verified tenant register.
