# Venue Packs — the data contract behind mall-agnostic MallMind

A **Venue Pack** is one validated JSON document that describes a venue completely enough for
MallMind Core to navigate it: floors, a spatial graph, destinations, anchors, amenities, evidence
and a small declarative policy block. Core (router, navigation session, anchor providers,
destination search, screens, PWA runtime) consumes packs generically. **Adding a venue means
registering a pack — never editing React screens, the router, the session or adding a
mall-specific conditional.** The zero-code proof is `src/venue/testMallAlpha.zeroCode.test.tsx`.

```
MallMind Core                              Venue Pack Registry (src/venue/registry.ts)
  src/venue/route.ts        router            getVenuePack(id) · listVenuePacks() · validateVenuePack(pack)
  src/components/navigation/navigationSession.ts   registerVenuePack(pack) (tests / future imports)
  src/components/navigation/anchorProvider.ts        bundled packs: src/venue/packs/*.venue.json
  src/venue/search.ts       destination search
  src/venue/evidence.ts     truth wording
  src/venue/instructions.ts directional wording
```

Field verification is an **evidence upgrade to pack data**. It changes wording (claims, arrival
sentences) — never how routing or the session behaves.

## Schema and version

`schema_version: 1` (`src/venue/contract.ts`). Packs with any other version are rejected with one
error and never interpreted. Validation (`src/venue/validate.ts`) reports **every** issue with a
JSON path and a plain message; nothing is repaired or defaulted silently.

## Top-level shape

| Key | Required | Purpose |
|---|---|---|
| `schema_version` | yes | must be `1` |
| `venue` | yes | id, name, deployment state, headline evidence, sources |
| `floors` | yes (≥1) | stable ids, labels, order — whatever the venue has; no implicit "G" |
| `graph` | yes | `distance_unit`, nodes, edges |
| `destinations` | yes (may be empty) | stores/services with arrival node + identity/arrival evidence |
| `anchors` | yes (≥1 start-permitted) | where a visitor may start (manual pick or QR) |
| `amenities` | yes (may be empty) | toilets, lifts, ATMs … with routable flag + evidence |
| `policies` | yes | declarative enums/flags only (no scripts, no templates) |

### `venue`
`id` (slug, used in `/navigate?mall=<id>`), `name`, optional `short_name`, `city`, `country`,
`geo` (only when genuinely known), `deployment { state: internal-pilot | controlled-pilot | public | retired, official, label? }`,
`evidence` (below), optional `sources[] { kind, reference, retrieved?, note? }`, `notes`.

### `floors[]`
`{ id, label, order, aliases?, plan_image? }`. `id` is any short string the venue uses (`G`, `LF`,
`L1`, `Parking`, `Mezzanine` …). Every node must reference a declared floor. `plan_image` must be
prepared at the MallMind plane aspect (1000:620 ±2 %) and carries its own geometry evidence.

### `graph`
- `distance_unit`: `"m"` (every edge carries measured `distance_m`) or `"px"` (every edge carries
  `length_px` as the shortest-path weight; metres only on edges whose measurement is `measured`).
- `nodes[]`: `{ id, name, kind, floor, x_percent, y_percent, evidence { geometry }, source?, notes?, provenance? }`
  with `kind ∈ entrance | corridor | junction | arrival | amenity | landmark | vertical`.
  `provenance` holds scalar facts (source pixels, measurement notes); Core never interprets it.
- `edges[]`: `{ id, from, to, bidirectional? (default true), floor_change?, vertical_kind?, length_px?, distance_m?,
  evidence { geometry, measurement }, instructions? { forward?, reverse? }, source?, notes? }`.
  An edge connecting two floors must declare `floor_change: true`.

### `destinations[]`
`{ id, name, kind ∈ store | service | food | entertainment | landmark, category?, arrival_node, unit?, aliases?,
evidence { identity, arrival, identity_source? }, notes? }`. The route ends at `arrival_node`.

### `anchors[]`
`{ id, node, label, kind ∈ entrance | landmark | kiosk | parking_interface | amenity, start_permitted, qr_eligible?, evidence?, notes? }`.
A QR encodes `/navigate?mall=<venue id>&start=<anchor id>&via=qr`. Older links carrying the
anchor's **node** id still resolve. At least one anchor must be `start_permitted`.

### `amenities[]`
`{ id, kind, name, node, routable, aliases?, evidence { geometry, accessibility? }, notes? }` with
`kind ∈ toilet | accessible_toilet | baby_room | information | atm | lift | escalator | stairs | parking | charging | security | first_aid | food_court | seating`.
Nothing is routable by default; `routable: true` makes it a searchable destination when the policy allows.

### `policies`
```json
{
  "start":        { "default_anchor": "<anchor id>", "allowed_anchor_kinds": ["entrance", "landmark"] },
  "destinations": { "searchable_kinds": ["store", "food"], "include_routable_amenities": true },
  "floors":       { "display": "label" },
  "metrics":      { "show": "when-measured" },
  "instructions": { "generic_fallback": true, "start_prefix": true }
}
```
Every value is an enum or flag. Unknown keys are rejected.

## Evidence model (provenance-aware; never one boolean)

| Concern | Values | Where |
|---|---|---|
| geometry | `schematic` · `source-backed` · `field-verified` | venue headline, each node, each edge, each anchor, plan image |
| identity | `unverified` · `source-backed` · `field-verified` | each destination |
| arrival | `unknown` · `corridor_arrival` · `verified_public_door` | each destination (drives "reached X" vs "mapped arrival point for X") |
| measurement | `unmeasured` · `measured` | venue headline, each edge (measured ⇒ `distance_m` present) |
| accessibility | `unverified` · `verified` | venue headline, amenities |
| field_verification | `not-started` · `pending` · `partial` · `verified` | venue headline |

Claims: `schematic` → "Schematic route preview"; `source-backed` → "Source-backed route";
geometry `field-verified` or field_verification `verified` → "Field-verified route".

A field survey upgrades a pack by editing these values (and adding `distance_m` + `measured`
on the legs it measured). Example, before → after:

```
geometry: source-backed → field-verified      arrival: corridor_arrival → verified_public_door
measurement: unmeasured → measured            field_verification: pending → verified
```

## Metric rules (the truth boundary from PR #54, preserved)

- No px→m conversion. Pixel lengths are shortest-path weights only.
- Metres appear only where an edge is `measured` with `distance_m > 0`.
- A route is metric — metres and minutes shown — only when **every** traversed edge is measured.
  One unmeasured leg makes the whole route unscaled ("Distance not yet measured — no walking time shown").
- `policies.metrics.show: "never"` suppresses metrics even for a fully measured graph.

## Instructions

`instructions.forward` applies to from→to, `instructions.reverse` to to→from. **One is never
derived from the other.** Without text for the direction walked, Core produces a generic sentence
only from topology (the reached node's kind and recorded name; the floor label for a floor change):
"Continue along the walkway." / "Walk toward Pharmacy." / "Take the lift to Upper Mall." No
landmarks are invented. `generic_fallback: false` yields a neutral "Continue to the next point."

## Validation

```
npm run validate:venues     # every bundled pack; also part of npm run verify:all
```
Checks include: schema version, closed policy keys, duplicate ids (floors, nodes, edges,
destinations, anchors, amenities), edges/destinations/anchors/amenities referencing unknown nodes,
self-loops, undeclared floors, floor-crossing edges without `floor_change`, at least one start
anchor, QR-eligible ⇒ start-permitted, unit/measurement/metre consistency, unknown evidence
values, one-way edges with reverse text, plain-text-only strings (no markup, control characters or
template braces), plan-image aspect, coordinate range. Every destination must be reachable from
every start anchor (routability smoke).

## Adding a venue (or a test venue)

1. Write `<id>.venue.json` following this contract (copy `src/venue/fixtures/test-mall-alpha.venue.json`).
2. Production: add it to `BUNDLED` in `src/venue/registry.ts` (the only code touch, and it is a data list).
   Tests / dev harness: `registerVenuePack(pack)` in `beforeAll`, `unregisterVenuePack(id)` after.
3. `npm run validate:venues`, then the QR link `/navigate?mall=<id>&start=<anchor id>&via=qr` works.

## Performance notes

A pack is validated and indexed once (registry cache); search results are cached per venue. Measured
in tests: a 1,000-destination synthetic pack loads and indexes in under a second, searches in a
few milliseconds, and routes in well under a second with the current O(V²) Dijkstra. Expected
limits: 100 destinations — negligible; 500 — still instant; 1,000+ — routing over very large graphs
(thousands of nodes) should move to a heap-based Dijkstra, and search should become an inverted
index. Neither is needed for current venues.

## What must NEVER be fabricated

- Metres or minutes without a measured edge.
- A door (`verified_public_door`) that was not verified on site.
- A floor the venue does not declare, or a "ground floor" assumed by code.
- An instruction for a direction nobody wrote (reversing a sentence is fabrication).
- Landmarks, store positions or geometry not in the pack's sources.
- Accessibility claims without `accessibility: verified`.
- An official deployment (`official: true`) without the operator's sanction.

## Migration from the pre-Sprint-4 datasets

`scripts/venue/migrate-legacy-dataset.mjs` converted the three legacy `*.dataset.json` files
faithfully (values copied verbatim; `on-site-verified` renamed `field-verified`; shop nodes →
destinations with `corridor_arrival`; entrances/landmarks → anchors; a landmark also → an
`information` amenity because the legacy finder listed it; `edge.instruction` → `instructions.forward`
only). The legacy files live in git history at `7d638f9`.
