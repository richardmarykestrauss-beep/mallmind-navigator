# Sprint 4 — mall-specific assumption audit

Scope: navigation-related code on `claude-premium-nav-test` at `7d638f9` (after PR #56), before the
Venue Pack work. Classification: **A** legitimate fixture/data · **B** legitimate demo/reference ·
**C** core hard-coding that must move into Venue Pack data/policy · **D** unrelated, untouched.

Search terms: `mallreds`, `mall-at-reds`, `mall@reds`, `menlyn`, `garden-route`, `grm-`, `entrance-main`,
`info-desk`, store ids, `"G"`, `normalizeFloorLabel`, `Ground Floor`, `estimateRoute`, `isInternal`,
`corridor|junction`, mall-specific conditionals, hard-coded destination / instruction rules.

## Pre-implementation findings

| # | Location | Finding | Class | Disposition (this sprint) |
|---|---|---|---|---|
| 1 | `mallDatasets.ts:38` `DEFAULT_WAYFINDING_MALL_ID = mallRedsDataset.mall_id` | Default venue is a specific mall id in code | C | Registry order decides the default (`listVenuePacks()[0]`); no mall id in code |
| 2 | `mallDatasets.ts:20-25` imports of three dataset JSONs + `SOURCES` | Registry is fine, but the file header is mall-specific documentation | B→C | Replaced by `src/venue/registry.ts` (bundled pack list is data) |
| 3 | `mallDatasets.ts` `START_NODE_TYPES = {entrance, landmark}` | Start policy hard-coded on node types | C | Anchors are explicit pack entities with `start_permitted` |
| 4 | `mallDatasets.ts` `AMENITY_TYPES` set + `type === "shop"` destination rule | Destination/amenity eligibility hard-coded | C | Destinations + amenities are explicit pack entities; policy decides searchability |
| 5 | `pilotRoute.ts:78-81` `isInternal()` name regex (`corridor|junction|spine|node N`) | Instruction logic keyed on node NAMES | C | Node `kind` from the pack (`corridor`, `junction`, …); no name regex |
| 6 | `pilotRoute.ts:137,147` `floor: to.floor ?? "G"` | Implicit "G" floor | C | Floor is required on every pack node; no default |
| 7 | `pilotRoute.ts` single `edge.instruction` used for both directions | Reversing a leg reuses the forward sentence | C | Directional `instructions.forward` / `instructions.reverse`; generic fallback only from topology |
| 8 | `WayfindingPilot.tsx:216,388,503,508` `?? "G"`, `normalizeFloorLabel(...)` for display | Floor label display invents "Ground Floor"/"Level 1" from ids | C | Labels come from the pack's `floors[]` |
| 9 | `WayfindingPilot.tsx:281` `data-testid="mallreds-pilot"` | Pilot-era name on a generic component | C (cosmetic) | Renamed `wayfinding-pilot` |
| 10 | `WayfindingPilot.tsx` `truthCopy()` wording branches on `datasetStatus`/`metric` | Wording derived from data (not mall-specific) but from the old contract | B→C | Now derived from Venue Pack evidence via `src/venue/evidence.ts` |
| 11 | `routeEvidence.ts` tier from `datasetStatus` + `fieldVerified` | Old contract flags | C | Uses `venue.evidence.geometry` / `field_verification`; arrival from destination `evidence.arrival` |
| 12 | `NavigateScreen.tsx:49-60,160-166` `estimateRoute()` — 50 m + 80 m/stop + 40 m/floor, minutes = m/72 | **Fabricated metres/minutes** for assistant stop lists | C (truth violation) | Removed; no metrics when the route has no measured spatial steps |
| 13 | `NavigateScreen.tsx:84,190` `"Ground Floor"` default floor | Implicit floor | C (legacy mode 2) | Neutral fallback; legacy assistant mode noted as debt |
| 14 | `floorplanModel.ts:92-105` `normalizeFloorLabel()` maps blank→"Ground Floor", `G`→"Ground Floor", `L1`→"Level 1" | Geometric bucketing + display in one function | C (partly) | Kept as **bucketing key** only (consistent on both sides); display labels come from the pack; blank never occurs for packs (validator) |
| 15 | `floorplanModel.ts:110-125` `mapNodeType()` substring matching, `isInfraName()` regex | Canvas node typing by name/type substrings | B (renderer heuristic for hosted backend graphs) | Packs pass explicit legacy types through the adapter; regex remains for the hosted backend model only |
| 16 | `mallRedsPilotGraph.ts` (Mall@Reds-bound helpers) | Test/back-compat bindings to one mall | B | Kept as a thin reference shim over the registry, used by tests only |
| 17 | `pages/MallRedsPilot.tsx`, `App.tsx` `/pilot` route name | Page named after one mall | C (cosmetic) | Renamed `WayfindingPilotPage.tsx` |
| 18 | `wayfindingAnchor.ts` header examples (`mallreds-pilot`, `menlyn-park`) | Comment examples | B | Untouched |
| 19 | `demoFloorplan.ts` (Mall@Reds ground-floor demo model) | Canvas test fixture | A | Untouched (renderer tests) |
| 20 | `scripts/navigation/generate-demo-qr.mjs` `ANCHORS` list of three malls | Demo asset list | B | Untouched (deployment track parked) |
| 21 | `src/lib/shopLocation.ts` `'G'`→"Ground Floor" for DB store floors | Directory text, not navigation | D | Untouched |
| 22 | `src/lib/ingestion/seed.ts`, `csv.ts`, admin pages, `fabric/*` | Retail/ingestion references to malls | D | Untouched |
| 23 | `pages/AssistantPage.tsx:1288` "Mall@Reds (Centurion)" hint copy | Assistant demo copy | B | Untouched (not navigation logic) |
| 24 | Garden Route dataset notes: "instructions written for Entrance 4 → south only" | Data limitation, not code | A | Migrated faithfully as `instructions.forward` only; the reverse direction has no text and gets a topology-only generic sentence |
| 25 | `WALK_METERS_PER_MINUTE = 72` in `pilotRoute.ts` | Global walking pace | B | Kept (applies only to measured routes); policy hook noted as debt |
| 26 | `mallRedsPilotDataset.ts` legacy contract (`dataset_status`, `field_verified`, `tenant`) | Old single-format contract | C | Replaced by the Venue Pack contract; invariants re-tested in `src/venue/validate.test.ts` |

## Post-implementation review

See the "Residual hard-coding" section at the end of this file (filled in after implementation).

## Residual hard-coding after implementation (2026-09-13)

Re-run of the same search over `src/` (excluding tests, packs, fixtures and the unrelated
retail/ingestion/admin code):

| # | Location | What remains | Class | Verdict |
|---|---|---|---|---|
| R1 | `src/venue/registry.ts` `BUNDLED = [mallRedsPack, menlynParkPack, gardenRouteMallPack]` | The list of bundled packs | A (data list) | Acceptable — this IS the registry; adding a venue appends a pack |
| R2 | `src/components/navigation/mallRedsPilotGraph.ts` (`getWayfindingMall("mallreds-pilot")`) | Reference bindings used by legacy tests only | B | Technical debt: retire when the tests that import it are ported to the registry API |
| R3 | `src/components/navigation/demoFloorplan.ts` (Mall@Reds "Ground Floor" demo model) | Renderer test fixture | A | Acceptable (canvas unit tests only) |
| R4 | `src/components/navigation/floorplanModel.ts` `normalizeFloorLabel()` → "Ground Floor" for blank, `G`→"Ground Floor", `L1`→"Level 1"; `mapNodeType()` / `isInfraName()` substring heuristics | Geometric bucketing key + hosted-backend node typing | B (bucketing) / debt (heuristics) | Packs never produce a blank floor and never display this label; the hosted backend indoor-map model (`getIndoorMapModel`) still relies on the heuristics. Must-fix before an ingestion pipeline feeds hosted graphs: bucket by pack floor id and type by pack kind |
| R5 | `src/pages/NavigateScreen.tsx` legacy mode 2 (assistant routes / stop lists) | Uses the hosted backend graph and `normalizeFloorLabel` chips; no fabricated metrics any more (`routeMetrics`) | debt | Technical debt: the assistant route mode predates Venue Packs; fold it into the session model or retire it |
| R6 | `src/venue/route.ts` `WALK_METERS_PER_MINUTE = 72` | Global pace for measured routes only | B | Acceptable now; a `policies.metrics.walk_m_per_min` hook is a one-line addition when a venue needs it |
| R7 | `src/venue/search.ts` `AMENITY_WORDS` (English synonyms per amenity kind) | Generic vocabulary, not venue-specific | B | Acceptable; localisation is a later concern |
| R8 | `src/components/navigation/wayfindingAnchor.ts` header comment examples | Comments only | B | Acceptable |
| R9 | `src/pages/AssistantPage.tsx` "Mall@Reds (Centurion)" hint copy | Assistant demo copy, not navigation | D | Untouched |
| R10 | `src/lib/shopLocation.ts` 'G' → "Ground Floor" for DB store floors | Directory text from the retail schema | D | Untouched |
| R11 | `scripts/navigation/generate-demo-qr.mjs` `ANCHORS` | Demo QR list (deployment track, parked) | B | Should read `qr_eligible` anchors from the registry in the ingestion sprint |
| R12 | Garden Route pack: instructions exist for the Entrance 4 → south direction only | Data limitation, faithfully migrated | A | Not code; the reverse direction gets topology-only sentences until someone writes them |

Removed this sprint (were class C): the Mall@Reds default id constant, the `START_NODE_TYPES` /
`AMENITY_TYPES` policies, the `isInternal()` name regex, the implicit `"G"` floors in the router and
the wayfinding screen, single-direction `edge.instruction`, the old `dataset_status`/`field_verified`
truth flags, `estimateRoute()` (fabricated 50 m + 80 m/stop metres), the `MallRedsPilot` page name and
the `mallreds-pilot` test id.

Verdict: navigation Core is venue-agnostic for bundled packs. Remaining venue-specific code is
either a data list (R1), a test/demo fixture (R2, R3), or the legacy hosted-backend path (R4, R5),
which the ingestion sprint must either convert to Venue Packs or retire.
