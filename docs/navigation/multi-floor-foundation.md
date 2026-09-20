# Multi-floor architecture foundation (Sprint 7)

Multi-floor **readiness**, not multi-floor data: the contract, loader, router, validator, factory
and experience all understand floor changes; no real venue (Garden Route Mall, Menlyn Park,
Mall@Reds) has any. The synthetic Two Level Test Centre (`src/venue/fixtures/`) exercises it.

## Connector model (`pack.connectors[]`, additive)

A connector is a lift, escalator, stairs or ramp with **landings** on real `vertical` nodes, one
per floor. It carries direction (`both` | `up` | `down`), availability (`open` | `closed`), evidence,
an optional measured ride time and an accessibility evidence value. See
`docs/venue-packs/README.md` for the schema.

**Expansion (loader).** Every open connector becomes directed graph edges between each pair of
its landings, ordered by floor order: `both` ⇒ bidirectional; `up` ⇒ lower → upper only;
`down` ⇒ upper → lower only. A three-floor lift expands to three pairs, deterministically. No hub
nodes; nobody hand-duplicates pairs. A `closed` connector expands to nothing and is therefore
unroutable — routes go around it or fail honestly.

**No fake length.** Connector edges carry `weight: null`, `distance_meters: null`, `floor_change:
true`, `connector_id`. The validator rejects `distance_m`, `length_px` and `measurement:
"measured"` on any floor-change edge: a lift transition never needs `distance_m = 1` or
`length_px = 10` to pass validation.

## Distance ≠ routing cost

The router needs a number to compare "walk 60 m around" with "ride the lift". That number is a
**policy**, not a measurement:

- `policies.routing.connector_cost[kind]` (in the graph's unit) or the router defaults
  (`DEFAULT_CONNECTOR_COST`: m — lift 30, escalator 20, stairs 25, ramp 15; px ×5).
- Cost is used for path selection only. It is **never displayed as metres**, never added to
  `total_distance_meters`, never turned into minutes.

## Route metrics

`RouteResult` distinguishes:

| Field | Meaning |
|---|---|
| `total_distance_meters` | measured **horizontal** metres only (null unless every horizontal hop is measured) |
| `connector_count` | rides on the route |
| `unmeasured_connectors` | rides without a measured `traversal_seconds` |
| `estimated_minutes` | only when the walk is metric **and** every ride is timed; else null |

The experience shows "80 m walking · + 1 ride · time not measured · 6 steps" rather than inventing
a total. Time is never fabricated.

## Route preference (no visitor UI)

`RouteOptions.preference` / `policies.routing.preference`:

- `shortest` (default): cheapest by horizontal length + connector cost.
- `fewest_changes`: adds a large floor-change penalty so the router minimises rides first.
- `step_free`: **excludes** stairs, escalators and connectors with `step_free: field_verified_no`
  rather than penalising them. A lift with `step_free: unknown` remains routable but is not
  claimed accessible.

No preference control is exposed to visitors in this sprint.

## Accessibility truth boundary

`accessibility.step_free ∈ unknown | field_verified_yes | field_verified_no`. The default is
`unknown`; the factory sets a verified value only from an accepted `field_verified` observation.
`lift` is **not** encoded as accessible. The UI makes no accessibility claim anywhere.

## Route steps and instructions

A floor-change step carries `via { connector_id, kind, from_floor, to_floor, traversal_seconds }`.
Wording is plain: "Take the lift to Upper Level." / "Take the escalator up to Upper Mall."; the
walking screen adds "When you are on Upper Mall, tap Next. The map will switch floors then."

## Floor transition semantics (experience)

- The session stays the **manual-step** model: no positioning, no auto-advance.
- The map shows the **last confirmed floor**: on a floor-change step it stays on the floor the
  visitor is still on, draws the connector marker at the landing ("Escalator to Upper Mall"), and
  switches only after that step is confirmed with Next.
- "You are on <floor>" appears in the step counter for multi-floor routes.
- The overview shows a simple floor strip (floors visited, how you change between them), the
  metrics above, and "Includes N floor change(s). You confirm each one yourself."
- Landing nodes are labelled by connector kind on the map (LIFT / ESC / STAIRS / RAMP).

## Factory support

Extraction `connectors[]` → `connector:<id>` facts (attributes + landings) → review → compiler
(`pack.connectors`, `policies.routing` passthrough). Field imports add `connector_timings`
(→ `traversal_seconds`, measured) and `accessibility` observations with subject
`connector:<id>` (→ `field_verified_yes|no`). The compiler rejects floor-change **edge** facts
("declare a connector"), landings on non-vertical nodes or the wrong floor, and non-field timings
or accessibility claims. Output is byte-identical regardless of ledger order.

## Positioning (documented, not implemented)

Two observation types will eventually feed the session; neither exists yet:

- **AnchorObservation** — "the visitor confirmed they are at node X" (QR scan, manual pick,
  arrival, tapping Next on a floor-change step). Discrete, trusted, visitor-initiated. This is
  what the runtime consumes today.
- **PositionObservation** — "a sensor estimates the visitor near (x, y, floor) ± r" (future VPS,
  Wi-Fi RTT, UWB, BLE). Continuous, uncertain, never trusted on its own; would only ever propose a
  re-anchor for the visitor to confirm. Not integrated; no sensor, native or AR dependency exists.

## Validator rules added

No metres / pixels / "measured" on floor-change edges · `vertical_kind` required on floor-change
edges · `connector_id` must name a declared connector · connector ids unique · closed vocabularies
for kind, direction, availability, step_free · evidence object required · `traversal_seconds` ⇔
`measurement: "measured"` (positive, finite) · `accessibility` has only `step_free` · ≥ 2 landings ·
landings on declared floors, distinct per floor, on `vertical` nodes on that floor · `up` / `down`
need two floors of different order · `policies.routing` closed keys, `connector_cost` by kind ≥ 0,
`preference` enum.

## Versioning

All additions are optional; schema version stays 1. Old packs (no `connectors`, no
`policies.routing`, hand-written floor-change edges) load and validate unchanged; the real-venue
routes are byte-identical to the previous release.

## Limitations

- No real venue has connectors; the fixture is synthetic and its metres are invented for tests.
- Connector availability is static pack data; there is no live outage service.
- No visitor-facing preference or accessibility UI.
- The floor strip is a summary, not a cross-section; the map shows one floor at a time.
