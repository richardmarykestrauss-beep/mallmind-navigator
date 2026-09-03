# Menlyn Park — spatial evidence proof-of-concept (NON-PRODUCTION)

**Status: RED — blocked at evidence retrieval, not at geometry.**
Mission date: 2026-09-03. Branch: `research/menlyn-spatial-poc`. Nothing here is loaded by the
app; the candidate file is a *skeleton* with no coordinates and is deliberately invalid under the
production validator so it cannot be mistaken for data.

## Why RED

Every host holding first-party (or usable secondary) Menlyn evidence was refused by this
session's network egress policy (HTTP 403 on CONNECT from the sandbox proxy, `EGRESS_BLOCKED`
from the harness fetcher). The proxy's own rules forbid retrying or routing around a policy
denial, so no archive mirror or cache was used.

| Host | Purpose | Result |
|---|---|---|
| `www.menlynpark.co.za` | mall map, site maps & access, Clicks tenant page, terms | blocked |
| `www.pareto.co.za` | owner terms / portfolio page | blocked |
| `clicks.co.za` | store finder corroboration | blocked |
| `maps.mapsted.com` | third-party indoor map listing "Menlyn Park" (venue 770) | blocked |
| `en.wikipedia.org`, `www.gauteng.net` | secondary corroboration | blocked |

Only a web-search endpoint was reachable. Search snippets quote the first-party pages, so the
facts below are recorded as **SECONDARY_CORROBORATION** (indirect quotation), never as
first-party. No map image was obtained, so **no coordinate, corridor, junction, door or
distance fact exists in this package**. See `evidence-ledger.json`.

## What the search layer corroborates (unverified until re-fetched)

- Clicks at Menlyn Park: store code **LF 72**, nearest **Entrance 13**, **Orange Parking**,
  **Atterbury Road**, phone 012 348 6161 — matches the mission brief.
- The official map exposes four levels: **LG, G, LF, UF**.
- Entrance 13 is reached from Atterbury Road and serves Orange Parking; Home Affairs is also
  listed near Entrance 13.
- Owner: Pareto Limited (portfolio page exists at `pareto.co.za`). A `/terms/` page exists on
  `menlynpark.co.za`; the snippet describes a POPIA personal-information policy, **not** a map
  licence.
- **New, material lead:** Mapsted lists a venue "Menlyn Park" (`maps.mapsted.com/770`) and
  Mapsted marketing names "Menlyn Mall" as a client. If the official "interactive mall map" is a
  Mapsted embed, the four "floor-map assets" may be vector map data owned/licensed through
  Mapsted, not static images — which changes both the tracing method and the rights question.

## What is still UNKNOWN (blocks a truthful route)

1. The LF map asset itself (URL, format, native resolution, whether static or a Mapsted embed).
2. Whether Entrance 13 opens onto level **LF** or onto another level (a floor transition would be
   required; the tenant page only says "nearest entrance").
3. Corridor topology between Entrance 13 and LF 72, and where Clicks' public frontage meets the
   corridor (polygon vs door).
4. Any scale bar or calibration source. Without one, **no metres** may be claimed.
5. Map reuse terms (view / derive facts / reproduce image / commercial deploy).

## Contract compatibility (checked against `claude-premium-nav-test` @ 676863e)

Current contract: `src/components/navigation/mallRedsPilotDataset.ts` (post PR #53).

| Need | Fits today? | Note |
|---|---|---|
| Percent coordinates on a referenced plan image | **Yes** | `plan_image` per floor; image must be prepared at 1000:620 (±2 %). |
| Per-entity evidence with identity separate from geometry | **Yes** | `evidence`, `tenant.identity_evidence`. |
| Multi-floor route with a transition | **Yes** | `floors[]`, `floor_change` edges; UI follows step floor. |
| Second mall | **No (small)** | `knownWayfindingMalls()` and the graph loader are single-dataset; needs a registry keyed by `mall_id`. |
| **Unscaled (pixel/relative) edge lengths** | **No** | Validator requires `distance_meters > 0`; `pilotRoute` sums metres and derives minutes (÷72). |

Smallest truthful adjustment if no scale is obtained (**not implemented**):
`distance_unit: "m" | "px"` at dataset level (default `"m"`). When `"px"`, edges carry
`length_px > 0` instead of `distance_meters`; the adapter uses `length_px` only as the Dijkstra
weight, sets `metric_distance_available: false`, and `WayfindingPilot` withholds the metre and
minute tiles ("distance not yet measured") while still giving the topological instructions. About
40 lines across validator, adapter and one UI conditional.

## Permission questions for Centre Management / Pareto (ask before any tracing)

1. Who owns the copyright in the mall map artwork shown at `/mall-map/` — Pareto, the centre, or a
   mapping vendor (e.g. Mapsted)?
2. May MallMind **view** and **study** the map to record factual locations (entrance numbers,
   store codes, level assignments) with attribution? (viewing / deriving facts)
3. May MallMind create **derived route data** (corridor centrelines, junction points, entrance
   nodes) from the map for an internal proof of concept? (derivative data, non-commercial)
4. May MallMind **display the map image** inside its app during a supervised pilot? Under what
   attribution? (reproduction)
5. May a derived map or route be **commercially deployed** to shoppers, and on what terms? (commercial)
6. Does the centre have a **scaled leasing / evacuation plan** it can share for measurement, and a
   floor assignment list for entrances?
7. If the interactive map is vendor-hosted, is there an **API or data licence** MallMind should use
   instead of tracing?

## Field-verification checklist (minimum, once a candidate route exists)

1. Stand outside **Entrance 13** (Atterbury Road side, Orange Parking); photograph the entrance
   number sign if permitted.
2. Confirm which **level** the entrance opens onto (LF or other); note any escalator/lift needed.
3. Confirm the **starting corridor direction** matches the first instruction.
4. Walk the route; at each mapped **junction**, confirm the turn and note any unmapped junction.
5. Confirm **Clicks LF 72** public entrance location relative to the mapped arrival point
   (same side of corridor, distance in paces).
6. Record **walking time** (start to arrival) and, optionally, paced or wheel-measured distance per leg.
7. Note accessibility: step-free? ramps? lift required?
8. Photograph junction sightlines and the Clicks frontage where permitted; log date/time.

## Files

- `evidence-ledger.json` — every fact with source, type, date, evidence level, confidence, notes.
- `source-manifest.json` — every URL attempted, with access outcome.
- `menlyn-lf-route-candidate.SKELETON.json` — node/edge ids and required fields only; **no
  coordinates**; intentionally fails the production validator.

## Next action

Allow `www.menlynpark.co.za` (and `www.pareto.co.za`, `maps.mapsted.com`) in the session's network
policy, then re-run this mission: fetch `/mall-map/` and `/site-maps-access/`, capture the LF asset
and its dimensions, and re-decide the gate on actual map forensics.
