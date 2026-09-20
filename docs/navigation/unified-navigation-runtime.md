# Unified navigation runtime (Sprint 7)

**One spatial truth.** Every route a visitor sees in MallMind comes from the same chain:

```
USER INTENT → DESTINATION RESOLUTION → VENUE PACK → DETERMINISTIC ROUTER → NavigationSession → Navigation Experience V2
```

Before this sprint there were two chains (`docs/navigation/sprint-7-runtime-audit.md`): the
Navigate tab routed over the bundled Venue Pack on the device, while the assistant asked the
backend to build a route over `mall_nodes` / `mall_edges` (or invented a "stop list dressed as
route steps" when no graph existed) and `NavigateScreen` rendered that with its own map, floor
chips, progress and XP. Two routers, two step vocabularies, two maps, two truths. That second chain
is gone.

## The intent boundary

> The AI may decide **what destination the visitor means**. The AI must **not** decide **what
> corridor they walk down**.

The assistant (Gemini via `google-cloud-backend`) is an intent layer. Its `navigate_to` tool and
its deterministic bypass ("take me to X", "where is X") both produce a `navigation_request`:

```json
{ "type": "navigate", "destination_query": "Clicks", "shop_id": "…|null", "shop_name": "…|null",
  "resolution_source": "visitor_phrase | assistant_tool | product" }
```

No geometry, no floors, no instructions, no distances. `route_steps` / `route_id` remain in the
response as deprecated empty fields for one release. `/build-route` is unmounted and deleted, and
no server-side copy of the Venue Pack router replaced it. `routingService.ts` is marked LEGACY and
only feeds the routing harness until its callers are removed.

## Destination resolution (`src/navigation/navigationIntent.ts`)

Resolution runs **on the device against the venue's own vocabulary** — the same names, aliases and
routable amenities destination search uses — and never talks to a backend.

| Result | When | Visitor sees |
|---|---|---|
| `resolved` | exactly one exact name/alias match, or one search hit | "Take me there" → route overview |
| `ambiguous` | several exact matches or several hits (≤ 5) | the candidates; the visitor picks |
| `unknown` | nothing matches ("Banana Kingdom") | "Not on the map yet" + search |
| `no_venue` | the selected directory mall has no Venue Pack | "MallMind can't give directions here yet" |

The validated intent is deliberately tiny: `{ type: "navigate", venue_id, destination_id,
resolved_label, resolution_source }`.

**Hand-off.** A resolved intent opens `/navigate?mall=<venue>&to=<destination>&src=assistant`.
`NavigateScreen` parses it, `WayfindingPilot` validates the id again against the venue and
selects it on a fresh session from the visitor's trusted start (default anchor, or the QR anchor
when the link carries `start=`). From there the router, session and experience are exactly the
manual-search ones — the same steps, byte for byte (`src/pages/NavigateScreen.test.tsx`).

**Identity gap.** The directory keys malls by database id; Venue Packs by slug; no production ids
live in the repository. `findVenueForMall(mallName)` bridges them by normalised name. A mall
without a pack resolves to `no_venue` and says so.

## Router authority

`src/venue/route.ts` is the only router. It is deterministic (Dijkstra with stable tie-breaks over
the loaded graph), unit-aware (`m` / `px`), and the only place that knows routing cost, preference,
floor changes and connector rides (`docs/navigation/multi-floor-foundation.md`). Nothing
customer-facing may fetch a route, a graph or a map from a backend —
`src/navigation/dataAuthority.test.ts` fails the build if a customer navigation source references
`/build-route`, `mall_nodes` / `mall_edges`, `getIndoorMapModel`, stored route state or
step-derived maps.

## What was removed

| Retired | Replacement |
|---|---|
| `NavigateScreen` mode 2 (own map from step coordinates, floor chips, "Done" per step, progress %, XP toast, "Route complete") | Navigation Experience V2 for every route |
| `buildRoute()` client, `BuildRouteResponse`, `getIndoorMapModel()` | none (no customer route from a backend) |
| `activeRouteSteps` / `setActiveRoute` / `loadRoute` / `clearRoute` and `shopping_routes` reads | `NavigationSession` (device, remembered locally) |
| assistant route card (`route_steps` rendering) | intent block: Take me there / candidates / search / no venue |
| `routeMetrics`, `schematicModelFromRoute` | router metrics; Venue Pack map only |
| backend `/build-route`, `buildFallbackRouteSteps`, `findRouteShopsByName` | `navigation_request` |

**Kept, isolated.** The Find & Compare / Deals "stop list" is a non-spatial checklist of shops
(no map, no steps, no distances, no walking directions). Each stop offers "Guide me", which
resolves the shop name as an intent and enters the runtime. It is labelled as not a route.

## Failure behaviour

- Assistant down or backend unreachable: manual search, routing and walking work unchanged
  (the runtime never fetches).
- Backend goes away after a session was created: the remembered session restores and continues.
- Unknown destination id in a link: the visitor lands on search; nothing is invented. A restored
  session wins over a link whose destination is unknown.
- Unknown venue in a link: the honest "no map for this mall yet" state; never a fallback venue.

## Analytics

`ai_route_triggered` now records the resolution status and query; `navigation_intent` records
intents from outside the Navigate screen (stop list). No geometry is logged.
