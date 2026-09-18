# Sprint 6 — pre-sprint UX architecture audit (2026-09-17, before implementation)

Baseline: `claude-premium-nav-test` at `bd65101` (PR #60 merged). Scope: every visitor-facing
navigation path. Written before any Sprint 6 code change.

## The journey as it exists today

| Stage | Where it lives | What the visitor sees |
|---|---|---|
| Open Navigate | `NavigateScreen` mode 1 → `WayfindingPilot embedded` | Header "Navigate · <mall> · source-backed route" + "Where do you want to go?" search with autofocus |
| Venue resolved | `parseWayfindingAnchor(search)` → registry; unknown mall → **silently falls back to the default mall** with a small amber notice | No way to pick a venue; the wrong mall's search appears |
| Start resolved | link/QR anchor or the venue's default anchor | "Starting from Entrance 4 · from the QR code you scanned" (12px line under the search box) |
| Destination selected | `select_destination` → route built immediately | Jumps to the "route view": destination card with a native `<select>` for the start, 2–3 summary tiles, **Start navigation**, map, full step list, status line |
| Route displayed | same view | Evidence badge "Source-backed route" twice (header subtitle + Directions row); "2 legs" tile |
| Navigation started | `start_navigation` → "navigating" | Step card (Step 1 of 3 · Floor Mall level (single sheet)), instruction 18px, "Then: …", Previous/Next, note, **Update my location + Restart row**, map (200px, below the fold), status line |
| Step progressed | Next/Previous (manual) | Marker ring at the *start* of the current leg; completed/remaining not distinguishable except by opacity |
| Re-anchored | "Update my location" → inline panel "Where are you now?" | List of start anchors; "Route updated — now starting from X … Your steps start again from here" |
| Arrived | `arrived` | Green card, "Previous" + "New destination"; no "navigate from here", no restart |
| Restarted | "Restart" (ghost button) → `route_ready` | Back to the route view (not to step 1 of walking) |

## Findings

### Duplicate / competing experiences
1. **Two visitor navigation UIs in one screen.** `NavigateScreen` mode 2 (assistant-built routes from `/build-route`) renders its own route preview: "Done" buttons per step, XP toast, floor chips, "Map: venue pack / Map: schematic" label, a `PositionMarker` (pulsing) at the current step, "🎉 Route complete!". It shares nothing with the Venue Pack session model.
2. **Two mounts of the same component** (`/navigate` embedded and `/pilot` standalone with its own header "<mall> · Wayfinding").
3. Legacy helpers still shipped: `mallRedsPilotGraph.ts`, `pilotRoute.ts`, `routeWalk*.ts` (simulated-walk maths), `mapRenderMode.ts`, `demoFloorplan.ts` — used by tests only.

### Pilot-era / developer language leaking into the UI
- "No match for “x” **in this pilot**." · header "Wayfinding" · "Pilot schematic · not an official floorplan · route preview only" · "Source-backed route preview" · "Schematic route preview" · map caption "**Schematic floorplan generated from MallMind route graph**" · "Route preview · not live GPS" · "Map: venue pack" · `data-dataset-status` · "corridor point" · "Controlled pilot only".
- Evidence enums are shown almost raw ("source-backed", "field-verified") in header subtitle and badges.

### Dead ends and hidden actions
- Unknown venue: "MallMind does not have a map for this mall yet." with nothing to do.
- Unroutable: alert with the router's message and "Try another starting point above" — the start control is a native select above; no explicit actions.
- Arrival: only "New destination" (and a still-enabled Previous). No "Navigate from here", no restart.
- "Change" (destination), "Back" arrow, "New destination", "Restart" all reset in slightly different ways; Restart lands on the overview, not on step 1.

### Layout problems
- **320 px: the "Update my location + Restart" row clips "Restart"** — `flex gap-2` with `Restart` as a fixed-width ghost button and `Update my location` `flex-1`; no wrap, MobileShell clips overflow (`overflow-hidden`).
- In walking mode the map sits *below* the controls and the disclaimer; on a 320×568 phone the current instruction, Next and the map never fit together.
- Previous and Next have equal visual weight (`flex-1` both); Next is 44 px tall but not dominant.
- Bottom app nav (absolute, ~100 px) stays visible in walking mode and competes with Next; no safe-area handling (`viewport-fit=cover` absent, no `env(safe-area-inset-bottom)`).
- Destination names `truncate` (single line) — long names are cut.

### Inconsistent evidence wording
- Overview badge: "Source-backed route"; status line: "Source-backed route preview. Distance not yet measured. Your position is not tracked."; disclaimer summary: "Source-backed route preview · not yet walked on site · distance not measured"; header: "source-backed route". Four phrasings for one fact.
- "Distance not yet measured — no walking time shown." repeated in the unscaled tile AND the status line AND the details.

### Route / map mismatches
- The step marker sits at the polyline point with `stepIndex === session.stepIndex`, i.e. the **start** of the current leg (the previous waypoint), while the instruction text describes reaching the **end** of the leg. Completed and remaining legs differ only by opacity; the current leg is not distinguished; no non-colour cue.
- The map camera pads the bounds of the *whole* route in every mode (no per-leg context in walking mode).
- Legacy mode 2 draws a pulsing `PositionMarker` at the current step — a pseudo-position cue.

### Backend-dependent behaviour
- None on the bundled path (verified in Sprint 4/5 tests). `trackEvent` is fire-and-forget. Legacy mode 2 depends on `/build-route` (assistant) but does not fetch maps any more.

### Duplicated / fragile state
- `NavigateScreen` derives `showWayfinding` from both the link and the shopping-session route; two unrelated "route" concepts coexist (`activeRouteSteps` vs `NavigationSession`).
- Session persistence stores only mall/anchor node/destination/status and **restores only on a url/qr re-entry**; a plain refresh during walking loses the route and the step; the step index is never stored.
- Browser back leaves `/navigate` entirely mid-walk (all journey states share one URL and no history entry).

### Unreachable / stale
- `/pilot` is reachable but undocumented for visitors; `mapRenderMode.ts`, `routeWalk*.ts` are dead for visitors.

## Decisions taken into implementation
1. One experience: `WayfindingPilot` becomes the orchestrator of five product states (search → overview → walking → arrival, plus unroutable) with product language; legacy mode 2 stays for assistant routes but adopts the honest step marker and loses nothing else (reported as residual).
2. Walking mode = focus mode: app bottom nav and page header hidden, sticky Previous / Next bar with safe-area padding; map compact and above the fold; the 320 px row is replaced by a single "Update my location" action and a "More" row that wraps.
3. Map/step contract: the current instruction's target waypoint carries the numbered marker; completed / current / remaining legs use width + dash + opacity + labels, not colour alone; overview fits the route, walking fits the current leg with context.
4. Evidence language: Preview route / Mapped route / Verified route; details in a "Route details" disclosure; legally important lines kept and reworded for people.
5. Session store v2 (anchor id + source + step index), restored on refresh for the same venue within the existing 2 h TTL; walking mode pushes one history entry so Back returns to the overview instead of leaving the app.
