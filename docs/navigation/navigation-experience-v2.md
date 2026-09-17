# Navigation Experience v2 (Sprint 6)

The visitor-facing navigation product built on the Sprint 4/5 foundation (Venue Packs, deterministic
router, evidence model, anchor providers, `NavigationSession`). One implementation
(`src/components/navigation/WayfindingPilot.tsx`), mounted in the Navigate tab (`NavigateScreen`)
and standalone at `/pilot` for controlled testing. Pre-sprint findings:
`docs/navigation/sprint-6-pre-sprint-ux-audit.md`.

## Canonical journey

```
OPEN / SCAN → START LOCATION → FIND DESTINATION → ROUTE OVERVIEW → START NAVIGATION
           → STEP-BY-STEP WALK (manual Next / Previous) → optional UPDATE MY LOCATION → ARRIVAL → NEXT ACTION
```

| Stage | What the visitor sees | Data it comes from |
|---|---|---|
| Start location | "Starting from **Entrance 4** · Location set from MallMind QR" + **Change start** | trusted anchor (`anchorProvider.ts`); source shown in visitor words only |
| Find destination | "Where do you want to go?" search-as-you-type; results with a plain kind (Store, Food, Toilets, Information, ATM…); Enter picks the first result; no-results offers "Show all places" | Venue Pack destinations + routable amenities (`src/venue/search.ts`); non-routable amenities are never offered |
| Route overview | FROM / TO, whole-route map, **steps** and **floor** (pack label), distance + walking time only when fully measured, otherwise "Distance not yet measured"; claim badge; **Route details**; primary **Start navigation**; **Change destination** / **Update my location** | `NavigationSession` `route_ready` |
| Walking | Going to · Step X of Y + confirmed-steps bar · dominant instruction · map on the current leg · "Then: …" (only when another real instruction follows) · "Not sure where you are? Update my location" · Restart route / Change destination · pinned **Previous / Next** ("I’m there" on the last leg) | `navigating` |
| Arrival | evidence-aware headline + note · **Find another place** · **Navigate from <start>** (only when the venue lists a start at the arrival point) · Not there yet · Restart route | `arrived` |
| Unroutable | "We don’t have a mapped route between these points yet." · Update my location / Choose another destination | `unroutable` |
| Unknown venue | "MallMind doesn’t have a map for this mall yet." + the venues MallMind can guide in | registry |

## State model

`NavigationSession` (pure reducer, unchanged): `destination_selection → route_ready → navigating → arrived`, `unroutable`.
UI mode reported to the host (`onModeChange`): `search | overview | unroutable | walking | arrived | no-venue`.
Walking and arrival are **focus modes**: `NavigateScreen` hides the app header and bottom nav.

Action semantics (§23 of the sprint brief):

| Action | Effect |
|---|---|
| Restart route | same start + same destination, back to step 1 of walking |
| Change destination | keep the trusted start, return to search |
| Update my location | keep the destination, choose a new trusted start, recalculate, progress reset, "Route updated" confirmation |
| Find another place (after arrival) | keep the trusted start (the destination is NOT assumed to be the visitor's position), return to search |
| Navigate from here (after arrival) | only if the venue declares a start-permitted anchor at the arrival node (`anchorAtNode`); otherwise the UI says the next route still starts from the current start |
| Back (arrow, or browser Back) while walking | route overview with the route kept |

## Manual progression — how truth is communicated

MallMind has no live indoor positioning. Every step change is the visitor's tap. The copy says so
where it matters: under the controls ("When you reach this point, tap Next. MallMind does not
track your movement."), in the progress bar's label ("Steps you have confirmed"), and in Route
details. There is no pulsing marker, no "you are here", no automatic arrival, no wrong-turn
detection. Progress = steps confirmed, nothing more.

## Map semantics (`IndoorMapCanvas`)

| Element | Meaning | Rendering (not colour alone) |
|---|---|---|
| START pin | the trusted start | ring + "START" label |
| Destination pin | the arrival point | pin + name label; the only marker on the last leg |
| Completed legs | points the visitor confirmed | thin, solid, faded |
| Current leg | the segment the current instruction describes | wide, glowing, animated flow (static under reduced motion) |
| Remaining legs | not yet walked | dashed, medium |
| Numbered marker | "the point step N takes you to" (`<title>`) | at the current leg's target waypoint |
| Small ring | "the point you last confirmed" | dashed ring, no label |

The current instruction and the highlighted leg always refer to the same graph segment
(`progress.confirmedIndex` = the polyline index of the last confirmed point; the leg is
confirmed → confirmed+1). Overview fits the whole route; walking fits the current leg with one
point of context either side; neither follows the visitor. Captions: "Simplified map · not to
scale" / "Map preview · your position is not tracked".

## Truth language (`src/venue/evidence.ts`)

| Evidence tier | Claim | Arrival headline |
|---|---|---|
| schematic | **Preview route** | "You’ve reached the end of this preview route to X." |
| source-backed | **Mapped route** | "You’ve reached the mapped arrival point for X." |
| field-verified / verified door | **Verified route** / — | "You’ve reached X." (only with `verified_public_door`) |

Route details keep the legally important statements in people words: not an official service of
the centre, distances not measured (no walking time), routes end at the walkway point nearest a
store, accessibility not checked / not for emergency use, MallMind does not track your position.
Raw enums never reach the visitor (guarded by a test).

## Session restore and browser history

`navigationSessionStore.ts` (v2) remembers venue, trusted start (anchor id, node, label, source),
destination, status and the confirmed step for 2 h. On mount for the same venue the session is
rebuilt through the reducer and validated against the pack (unknown destination/start, expired or
malformed records start fresh, silently). A link/QR anchor arriving on top re-anchors the restored
session. Walking mode pushes one history entry so browser Back returns to the overview instead of
leaving the app; refresh restores the confirmed step.

## Backend independence

The bundled path never fetches: packs, routing, search, wording and persistence are local.
Analytics (`navigationEvents.ts` → `trackEvent`) is best-effort; a throwing sink is swallowed
(`safeSink`). Verified with every cross-origin request aborted, in unit tests and in the browser.

## Accessibility

Headings: page `h1` (Navigate) → section `h2` (search label / overview title / current instruction
/ arrival headline). Focus moves to the instruction on every step or route change. Live regions:
route updated and arrival (`role=status`), unroutable (`role=alert`). Every button has a name;
Previous/Next are 56 px tall, ≥ 44 px targets everywhere; progress bar is a `progressbar` with
values; map is `role=img` with a plain label; leg differences use width/dash/opacity plus the
numbered marker, not colour alone; reduced motion disables the flow animation and the destination
pulse; long instructions wrap (`overflow-wrap: anywhere`), destination names clamp to two lines;
controls are pinned with `env(safe-area-inset-bottom)` and `viewport-fit=cover`.
Digital accessibility says nothing about the physical route: accessibility claims appear only when
the pack's evidence is `verified`.

## Analytics events (best-effort seam)

`destination_selected`, `route_overview_opened`, `navigation_session_started`,
`navigation_step_advanced`, `navigation_step_back`, `location_update_opened`,
`navigation_reanchored`, `navigation_arrived`, `navigation_restarted`, `navigation_unroutable`.

## Viewport matrix and artifacts

Browser QA (production build, backend blocked) at 320×568, 360×640, 390×844, 430×932, 768×1024
and 844×390 landscape: overview, walking, Update my location and arrival with clipping/overflow
checks; the former 320 px "Restart" clipping is gone (the walking controls are a pinned
Previous/Next bar; Restart / Change destination are wrapping text actions). Representative
screenshots: `docs/navigation/screenshots/` (dev artifacts, not shipped).

## Known limitations

- The legacy assistant-route preview (`NavigateScreen` mode 2, fed by `/build-route`) still exists
  with its own step list; it now uses the honest step marker but is not the Venue Pack journey.
- `/pilot` remains a second mount of the same component (controlled testing).
- Multi-floor packs render floor labels and `floor_change` steps, but there is no dedicated
  floor-transition UX yet (Sprint 7); nothing in the new UX blocks it (floor comes from the step).
- "Navigate from here" depends on packs declaring start anchors at arrival points; today only
  Mall@Reds' Information Desk qualifies.
- The overview map of a very short route (two adjacent points) still shows the START pin and the
  store label close together; readable, not pretty.
- Store blocks on the simplified map are drawn at a fixed size around the arrival point (no
  polygons in the contract yet).
