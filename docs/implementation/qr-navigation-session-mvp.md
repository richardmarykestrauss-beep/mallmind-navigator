# Sprint 3 — QR-anchored navigation session MVP

Branch `feat/qr-navigation-session-mvp` (from `claude-premium-nav-test` after PR #55).
Turns MallMind's routing capability into a real visitor navigation session **without** live
positioning: the visitor scans a QR code (a MallMind deep link), picks a destination, starts
navigation, steps through instructions **manually**, can re-anchor at another trusted point, and
reaches an evidence-honest arrival state.

No Garden Route geometry was modified. Field verification remains an external evidence upgrade.

## 1. Visitor journey (as implemented)

```
scan QR  →  /navigate?mall=<id>&start=<anchor>&via=qr
         →  mall + trusted start resolved (anchorProvider.ts, one trust gate)
         →  "Where do you want to go?"  (destination_selection)
         →  route calculated            (route_ready | unroutable)
         →  Start navigation            (navigating: Step n of N, instruction, "Then: …", floor,
                                         metres only when the dataset is measured)
         →  Next step / Previous        (manual; "MallMind does not track your movement")
         →  Update my location          (manual pick of another trusted start, or scan another QR)
              → destination kept, start replaced, route recalculated, steps reset, "Route updated"
         →  I’m there                    (arrived: "You’ve reached the mapped arrival point for X."
                                         or, for an on-site-verified node, "You’ve reached X.")
         →  New destination / Restart
```

## 2. Architecture

| Layer | File | Role |
|---|---|---|
| AnchorProvider | `src/components/navigation/anchorProvider.ts` | `validateAnchor(mallId, anchorId, source)` is the single trust gate (mall exists → node exists in that mall → node is a permitted start). `manualAnchorProvider`, `qrAnchorProvider` (raw scanned text → deep link → gate). Reserved seams `native / wifi_rtt / uwb / apple_indoor` exist only as types; `anchorProviderFor()` returns `null` for them. |
| Deep link | `src/components/navigation/wayfindingAnchor.ts` | Existing `?mall=&start=` parsing now routes through the gate. Optional `via=qr` marks a scanned code so the UI can say "from the QR code you scanned"; any other value → `url`. `qrLinkFor()` builds the canonical QR payload. |
| NavigationSession | `src/components/navigation/navigationSession.ts` | Pure reducer: `select_destination`, `clear_destination`, `start_navigation`, `next_step`, `previous_step`, `reanchor`, `restart`. States `destination_selection → route_ready → navigating → arrived`, plus `unroutable`. Reuses `pilotBuildRoute` (Dijkstra over the registry graph). |
| Evidence boundary | `src/components/navigation/routeEvidence.ts` | `routeClaim()` → "Schematic route preview" / "Source-backed route" / "Field-verified route" from the existing `dataset_status` + `field_verified` flags. `arrivalWording()` uses the destination node's own `evidence` (`on-site-verified` → "You’ve reached X."; anything else → "mapped arrival point"). Nodes now carry `evidence` through the adapter (`BackendNodeLike.evidence`). |
| Events seam | `src/components/navigation/navigationEvents.ts` | `navigation_session_started / step_advanced / step_back / reanchored / arrived / failed`, emitted through an injected sink; screens wire it to the existing best-effort `trackEvent`. Never blocks navigation (throwing sink is swallowed). |
| Re-entry store | `src/components/navigation/navigationSessionStore.ts` | Remembers `{mall, anchor, destination, status}` in `localStorage` for 2 h so a **second QR scan** (a fresh page load from the camera app) keeps the destination and re-anchors. Ids only; no position, no history. |
| UI | `src/components/navigation/WayfindingPilot.tsx` | Session-driven views: finder → route view (+ **Start navigation**) → focused step view (Next / Previous / Update my location / Restart) → arrival. Map uses a static numbered **step ring** (`IndoorMapCanvas markerStyle="step"`), never the pulsing position marker. |
| Screens | `src/pages/NavigateScreen.tsx`, `src/pages/MallRedsPilot.tsx` | Unchanged mounts; header subtitle now shows the evidence claim; events wired. |

## 3. QR implementation

- Canonical URL: `<origin>/navigate?mall=<mall-id>&start=<anchor-id>&via=qr`. The pre-existing
  `/navigate?mall=&start=` form (no `via`) stays valid and resolves as a `url` anchor.
- Generator: `node scripts/navigation/generate-demo-qr.mjs` (local `qrcode` dev dependency, no
  external API, no backend). The origin comes from ONE seam — `VITE_PUBLIC_APP_ORIGIN` (`.env.local`
  or the environment; `src/lib/env.ts` exposes the same variable to the app) or `--origin`. Without a
  valid `https://` origin the script exits non-zero; it never encodes a guessed hostname. Output is a
  labelled SVG poster ("DEMO / PILOT QR — NOT OFFICIAL SIGNAGE") plus a PNG per anchor and a
  `manifest.json`. **No assets are committed** until the app has a published origin
  (`docs/qr-demo/README.md`); the earlier `https://mallmind.app` assets were removed because that
  host was never verified.
- Validation on scan: mall must be bundled, anchor must be a node of that mall, and permitted as a
  start. Failures render a notice and fall back to manual start selection. Non-MallMind payloads
  (other hosts' paths, `javascript:`, `mailto:`, free text) are rejected by `qrAnchorProvider`; the
  app never redirects and labels always come from the registry (no HTML from the URL).

## 4. PWA / offline findings

Checked with Chromium (Playwright) against the production build served by `vite preview`:

- Deep links survive normal PWA routing (`manifest.json` scope `/`, SPA routes in `App.tsx`).
- Refresh on `/navigate?…` keeps the query parameters and, via the re-entry store, the session.
- Offline re-open of a previously loaded session works: the service worker (`public/sw.js`)
  serves the cached shell (network-first with offline fallback) and hashed assets (cache-first);
  the deep link restored the navigating session while offline.
- Larger offline requirements (recorded, not built): no offline indicator in the UI; Supabase and
  Cloud Run calls simply fail silently offline; the first visit must complete online before any
  offline re-open works; no precaching of route datasets beyond what the JS bundle contains
  (datasets are bundled, so routing itself is offline-capable).
- Hosting (deployment truth, 2026-09-08): the frontend is the Lovable project "MallMind
  Navigator" (`5abb25db-a7ba-4373-bfd4-8b0241bc8b36`), linked to this repository's `main`. It is
  **not published** (`is_published: false`); the only URL is the editor preview
  `https://id-preview--5abb25db-….lovable.app`, which serves `main` at `98a7fe6f` (2026-05-06) —
  152 commits behind `claude-premium-nav-test`, so it does not contain the navigation session.
  Lovable's own hosting serves `index.html` for client-side routes (SPA fallback), so no
  `vercel.json` / `_redirects` / Firebase rewrite is needed there and none is added; if the app is
  ever moved to another host, that host's SPA fallback must be configured. Live cold-open tests of
  the deep links could not be run from the build container (egress to `lovable.app` is denied), and
  none would be meaningful until the branch is published. Public hostnames seen in the repo
  (`mallmind.app` in the backend CORS harness, `mallmind.co.za` in a bot user-agent) are not
  verified deployments.

## 5. Mobile UX and accessibility

- Tested at 320 / 390 / 430 px: QR landing, destination selection, Start navigation, step view,
  Next, Previous, arrival, Update my location, route recalculation (manual and deep-link
  re-entry), invalid anchors, unroutable destination, Menlyn and Mall@Reds regressions. No
  horizontal overflow; primary controls ≥ 44 px.
- Semantic buttons throughout; focus moves to the step card on every step/route change; the
  re-anchor panel is a labelled group with `aria-current="location"` on the current start; state is
  never colour-only (text "Step n of N", "Route updated", arrival wording); SVG route animation
  and the legacy pulsing marker respect `prefers-reduced-motion`.
- No accessible-route claim is made anywhere ("Not accessibility-verified").

## 6. Remaining hard-coded mall assumptions (input to the next sprint — Venue Pack)

1. `DEFAULT_WAYFINDING_MALL_ID` is Mall@Reds (`mallDatasets.ts`); the Navigate tab without a link
   silently routes over the Mall@Reds pilot.
2. `mallRedsPilotGraph.ts` still exports Mall@Reds-bound helpers used by older tests.
3. `startOptions()` treats node types `entrance` and `landmark` as starts, and `pointsOfInterest()`
   treats a fixed set of amenity types as destinations — policy that should come from the venue pack.
4. Floor label normalisation (`normalizeFloorLabel`: G / L1 / Level 1 …) and the default floor
   `"G"` are hard-coded in `floorplanModel.ts` / `pilotRoute.ts`.
5. `pilotRoute.ts` `isInternal()` recognises corridor nodes by a name regex (`corridor|junction|spine`).
6. `WALK_METERS_PER_MINUTE = 72` is a global constant (only used for measured datasets).
7. Route instructions in the Garden Route dataset are written for one direction (Entrance 4 → south);
   the engine does not know instruction directionality, so a future start elsewhere needs
   per-direction instructions in the dataset contract.
8. `NavigateScreen.tsx` mode 2 (assistant-built routes) still uses `estimateRoute()` with invented
   80 m-per-stop metres for `routeStops` — legacy, outside this sprint, should be removed or gated by
   the same distance-truth rule.
9. Test ids (`mallreds-pilot`) and the `/pilot` route name (`MallRedsPilot.tsx`) carry the pilot's
   original mall name.
10. The public origin now has one seam (`VITE_PUBLIC_APP_ORIGIN`), but it is empty until the app is
    published; the backend CORS harness still carries its own `https://mallmind.app` literal.

## 7. Tests

- `anchorProvider.test.ts` — valid QR/deep link, invalid mall, invalid anchor, anchor of another mall,
  manual vs qr sources, malformed payloads (no redirect / no markup), reserved seams, `via=qr`.
- `navigationSession.test.ts` — creation, route start, next, previous, arrival, re-anchor (destination
  preserved, route recalculated, steps reset), unroutable + recovery, restart, evidence wording,
  metric preservation vs unscaled suppression, re-entry store.
- `WayfindingPilot.test.tsx` — full journey in the component, manual re-anchor, in-page second QR,
  deep-link re-entry restore, unroutable UI, measured Mall@Reds, event seam with a throwing sink.
- Existing suites updated only for the evidence-aware arrival wording and the Start-navigation flow.
