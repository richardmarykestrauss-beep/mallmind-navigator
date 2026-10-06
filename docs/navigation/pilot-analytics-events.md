# Pilot analytics events (privacy-light by default)

Sprint 8. Code: `src/navigation/pilotSession.ts`, `src/navigation/pilotEvents.ts`,
`src/components/navigation/navigationEvents.ts`, sinks in `NavigateScreen` / `WayfindingPilotPage`.

## Identity

- **Session id**: a random id per visit (`crypto.randomUUID`), stored in `sessionStorage` only
  (one tab; gone when the tab closes), rotated after **2 hours** (the navigation session TTL).
  Never derived from an account, device, cookie or advertising identifier; never shared across
  malls; never joined across visits.
- **No user id**: navigation events are written with `user_id = null` even when the visitor is
  signed in. (Assistant and retail events in the older pipelines are unchanged.)
- **No position**: there is no continuous position in MallMind; anchors are discrete, visitor-chosen.
- **No raw search text**: a search event carries a classification (`query_class`, `result_count`,
  `categories`, `miss_reason`, `nearest_known` — a known vocabulary word, never the visitor's text)
  and the query length.
- Forbidden detail keys are stripped defensively: `user_id, userId, email, phone, lat, lng, latitude,
  longitude, device_id, advertising_id, query, query_text`.

## Delivery

Best-effort inserts into Supabase `app_events` (`event_type`, `mall_id` = venue id, `metadata` with
`session_id`, `ts` (client ISO timestamp) and the detail). Failures are swallowed; offline events are
dropped (no queue). Analytics never blocks or breaks navigation.

## Events

| Event | When | Detail |
|---|---|---|
| `venue_opened` | the Navigate screen resolves a venue | `via`: qr / link / direct |
| `qr_landing` | the URL carries `via=qr` | `anchor_status`: ok / invalid / mall / none |
| `qr_anchor_valid` | a link or QR start anchor resolved | `anchor_id`, `via` |
| `qr_anchor_invalid` | a link or QR start anchor was rejected | `reason` (visitor wording), `via` |
| `destination_search` | a typed query settled (400 ms) with results | `query_length`, `query_class` (name/alias/unit/kind/category/product_hint), `result_count`, `categories` |
| `destination_search_no_result` | a settled query had no result | as above plus `miss_reason` (possible_typo_or_alias_gap / known_category_absent / unknown), `nearest_known` |
| `destination_selected` | a destination chosen | base* + `kind` |
| `route_overview_opened` | route computed | base* + `steps`, `metric` |
| `navigation_session_started` | Start navigation | base* + `steps`, `metric` |
| `navigation_step_advanced` / `navigation_step_back` | Next / Previous | base* + `step` |
| `navigation_reanchored` | start changed (manual or second QR) | base* + `from`, `routable` |
| `navigation_unroutable` | no route (not mapped / unavailable / no path) | base* + `reason` |
| `navigation_arrived_confirmed` | **the visitor confirmed the final step** | base* |
| `navigation_restarted` | route restarted from the overview | base* |
| `location_update_opened` | "Update my location" opened | `destination`, `anchor`, `status` |
| `navigation_intent` | a destination intent from the assistant / stop list resolved | `source`, `status` |

\* base = `destination`, `destination_category` (label), `anchor` (node), `anchor_id`, `anchorSource`,
`evidence` (route tier), `floor_changes` (connector rides on the route).

## Semantics that must not be misread

- `navigation_arrived_confirmed` is a tap on the last step. It is **not** physical arrival and is
  **never** footfall. MallMind has no sensor that could know the visitor reached the shop.
- `route_overview_opened` counts demand for a destination, not visits to it.
- A search miss is a demand signal only after the quality gates: `possible_typo_or_alias_gap`
  should first feed alias curation; `known_category_absent` is the candidate "visitors look for X
  and we have none" signal; `unknown` is noise until classified.

## Funnel

QR open (`qr_landing`) → valid anchor (`qr_anchor_valid`) → first search (`destination_search`) →
selection (`destination_selected`) → overview (`route_overview_opened`) → start
(`navigation_session_started`), all on one `session_id` with client timestamps, so QR placement and
friction can be compared per anchor during a pilot. No dashboard exists; the sequence is tested in
`src/pages/NavigateScreen.test.tsx`.

## What is measurable now / not yet

Measurable: destination and category demand, failed-search classes, route starts, step
confirmations, re-anchors, unroutable requests (and why), floor-change presence, QR validity and
funnel timing. Not measurable: abandonment (no heartbeat), dwell, physical arrival, footfall,
repeat visits (by design).
