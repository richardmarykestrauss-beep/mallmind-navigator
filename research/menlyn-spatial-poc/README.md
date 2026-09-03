# Menlyn Park — spatial evidence proof-of-concept (NON-PRODUCTION)

**Decision (reopened 2026-09-03): GREEN for a source-backed, unscaled corridor route
Entrance 13 → Clicks LF 72.** Topology and positions come from the official Lower First Level
map; no metres are claimed; the Clicks door is a field-verification item.
Branch `research/menlyn-spatial-poc`. Nothing here is loaded by the app.

## 1. Sources and access

The session's egress policy still blocks `menlynpark.co.za` (pages and the JPG), `pareto.co.za`,
`clicks.co.za` and `maps.mapsted.com`. The mission owner supplied the official LF map image
directly and re-verified the tenant-page text facts on the official site on 2026-09-03. The
image is **not** stored in this repository; the dataset references its URL:
`https://www.menlynpark.co.za/wp-content/uploads/2023/07/Lower-First-Level-Map.jpg`.
Full detail: `source-manifest.json`, `evidence-ledger.json` (17 facts).

## 2. Image forensics (what the LF sheet proves)

Analysed from a 1280×853 rendering of the official JPG (native size unverified; percentages
are scale-invariant). Origin top-left, x right, y down. Precision ≈ ±8 px (±0.6 % x, ±1.0 % y).

| Feature | Source px | % of source | Evidence |
|---|---|---|---|
| Entrance 13 (circled marker on the mall boundary under orange P5 parking) | 636, 196 | 49.69, 22.98 | FIRST_PARTY_VISUAL |
| North–south public corridor from Entrance 13 (between mr price home W and Ackermans E) | x ≈ 636, y 205→485 | — | FIRST_PARTY_VISUAL |
| Cross corridor junction (east–west band, x ≈ 505→700) | 636, 355 | 49.69, 41.62 | FIRST_PARTY_VISUAL |
| Clicks store block (logo centroid), immediately west of the corridor | 590, 415 | 46.09, 48.65 | FIRST_PARTY_VISUAL |
| Corridor point abreast of Clicks (arrival) | 636, 415 | 49.69, 48.65 | FIRST_PARTY_VISUAL |
| Clicks storefront door | not depicted | — | UNKNOWN / field |
| Scale bar, north arrow, dimensions | none on sheet | — | UNKNOWN (metres) |

Entrance 13 is drawn on the LF sheet itself, so the route needs **no floor transition**. Walking
south from Entrance 13, Clicks is on the shopper's **right**.

## 3. Route graph (`menlyn-lf-route-candidate.json`)

3 nodes, 2 edges, one floor (LF), one junction, no turns:

1. `menlyn-lf-entrance-13` (entrance) → 2. `menlyn-lf-spine-x-upper` (corridor junction) →
3. `menlyn-lf-clicks-lf72-arrival` (shop, `linked_shop_id: menlyn-clicks-lf72`, tenant LF 72
FIRST_PARTY_EXPLICIT).

Edges: 159 px then 60 px on the 1280-wide rendering (12.42 % and 4.69 % of image width), both
purely vertical along the same corridor band. Wall/corridor validation was performed twice (recorded
in the file): no edge crosses a store or wall, no diagonal, no junction skipped, no rejected edges.
Instructions: start at Entrance 13 → walk straight in → continue straight across the cross corridor →
Clicks is on your right, just past the crossing.

Plane coordinates: the MallMind plane is 1000:620; the source is 1.50, so it must be padded
symmetrically in width (3.743 % of source width each side). `x_percent = (x_percent_source + 3.743)
/ 1.07486`, `y` unchanged. `node scripts…/validate-candidate.mjs` checks the derivation (33 checks).

## 4. Distance status: **unavailable**

The sheet has no scale bar or dimension. Edge lengths are recorded in pixels and percent only;
`distance_meters` is `null`. Metres must not be derived from assumed building size. A single
on-site measurement of either leg (wheel or paced) would calibrate the whole sheet.

## 5. Contract compatibility (integration `claude-premium-nav-test` @ 676863e)

| Need | Fits today? |
|---|---|
| Percent coordinates on a referenced plan image, per-entity evidence, tenant identity separate from geometry, single floor | **Yes** |
| 1000:620 plane | **Yes**, after padding the prepared image (documented) |
| Unscaled edges (`distance_meters` null, `length_px`) | **No** — validator requires `distance_meters > 0`; `pilotRoute` sums metres and derives minutes |
| A second mall | **No (small)** — `knownWayfindingMalls()` and the graph loader are single-dataset |

**Smallest truthful change (not implemented):** add optional dataset field
`distance_unit: "m" | "px"` (default `"m"`). When `"px"`: validator requires `length_px > 0` (or
`length_pct`) instead of `distance_meters`; the adapter maps the pixel length into
`distance_meters` **only as the Dijkstra weight** and sets `metricDistanceAvailable: false` on the
loaded dataset; `WayfindingPilot` hides the metre and minute tiles and shows "distance not yet
measured" when that flag is false. Roughly 40 lines in `mallRedsPilotDataset.ts` and
`WayfindingPilot.tsx`; no migration, no renderer change. The multi-mall registry is a separate,
equally small change.

## 6. Rights

The traced artwork is a static JPG under `menlynpark.co.za/wp-content/uploads/`, so the geometry
derives from centre/Pareto artwork (Mapsted, if used for the interactive map, is a second rights
holder to ask about). Nothing seen grants reproduction, derivation or commercial deployment.
`plan_image.url` is null until confirmed. Questions for Pareto / Centre Management:

1. Who owns the copyright in the level map artwork (Pareto, the centre, a vendor)?
2. May MallMind view and study it to record factual locations, with attribution?
3. May MallMind create derived route data (corridor centrelines, junctions, entrances) for an
   internal proof of concept?
4. May MallMind display the map image inside its app during a supervised pilot?
5. May a derived map or route be deployed commercially, on what terms?
6. Is a scaled leasing or evacuation plan available for measurement?
7. If the interactive map is vendor-hosted, is there an API/data licence MallMind should use instead?

## 7. Field verification (minimum)

1. Stand outside Entrance 13 (Atterbury Road / Orange Parking); photograph the entrance number if permitted.
2. Confirm it opens directly onto the Lower First Level with no stairs, ramp or lift.
3. Confirm the corridor runs straight ahead (south on the sheet) with mr price home on the RIGHT
   (west) and Ackermans on the LEFT (east); record the actual side of each anchor store.
4. Walk to the cross corridor; confirm it is the first junction and that the route continues straight.
5. Confirm Clicks LF 72 is on the right just past the crossing; record where its door is and which
   corridor it faces.
6. Time the walk; pace or wheel-measure both legs to calibrate the sheet.
7. Note step-free continuity; photograph the junction and the Clicks frontage where permitted.

## 8. Files

- `menlyn-lf-route-candidate.json` — the candidate (research shape: `distance_unit: "px"`).
- `validate-candidate.mjs` — standalone structural/geometric checks (33 pass).
- `evidence-ledger.json`, `source-manifest.json`.
- The earlier empty skeleton was removed.

## 9. Next action

Obtain written confirmation from Menlyn Park Centre Management / Pareto that MallMind may derive
route data from, and display, the Lower First Level map for a supervised pilot; on the same visit,
pace the two legs to calibrate distance.
