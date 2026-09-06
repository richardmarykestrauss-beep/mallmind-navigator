# Garden Route Mall — live field pilot (controlled, NON-PRODUCTION)

**Decision (reopened 2026-09-03): GREEN for source-backed, unscaled topology — two Sunday routes
from Entrance 4, awaiting field verification.** Branch `feat/garden-route-live-pilot`. Nothing here
is an official Garden Route Mall deployment; the map artwork is not in the repository.

## 1. Sources

The mall's web properties, the owner's site and the Webflow CDNs remained blocked by the session
egress policy (see `source-manifest.json`). The mission owner supplied two images directly:

- `garden-route-mall-original.png` — the official mall map (the "Click here to view MALL MAP"
  lightbox asset on `https://www.gardenroutemall.co.za/garden-route-mall-shops`). **Authoritative
  spatial source.** Rendered in the session at **417×888 px**; native file dimensions unverified.
- `garden-route-mall-enhanced-reference.png` — an AI-upscaled redraw (859×1832). **Used only to read
  labels** (entrance digits, unit numbers). No coordinate, boundary or route geometry was taken from
  it.

Tenant identities come from the official directory as quoted by search snippets (see
`evidence-ledger.json`); the map's own labels corroborate Game 129, Woolworths 9, Edgars 29,
Pick n Pay 41, Cinema 86a and unit 37/38.

## 2. Forensics on the original (417×888, origin top-left)

Readable: two store columns run north–south with the **main walkway** drawn as the dark channel
between them (small service icons sit inside it). West column: Game (129) with 131/124/126/124a/124b,
red 122/123, 121/120/118, **Woolworths (9)**, 12–16, 17/18a/19, yellow 20–27, **Edgars (29)**,
28a, 30, 33, 34, **37/38**, 35/36. East column: purple 119/116/7/8, 110/112/113, 109, 106–102; blue
92b/92/94/87, **Cinema (86a)**, 65a/65b, 95/83/81/61, 72/74/71/69, 62/61/54/56, 49/45/50, **Pick n
Pay (41)**. Entrances **3, 4, 5, 6, 7** are labelled on the **east** facade, each with a passage
between two blocks leading west to the walkway. Amenities: toilets at ≈(148,262) and ≈(248,745),
ATM 2b/2d markers in the Entrance 4 passage, ATM 90 near 94, Elite Car Wash and EV charging outside.
One sheet, no level labels, **no scale bar**, no north arrow.

Uncertain: the Entrance 7 digit (reads 1 or 7 on the original; 7 on the enhanced copy); walkway
centreline positions (±5 px ≈ ±1.2 % x / ±0.6 % y); Entrances 1 and 2 are not on the sheet, so the
"Centre Management near Entrance 2" landmark is unusable; store doors are not drawn.

| Node | Source px (x, y) | Source % | Plane % (x padded) | Evidence |
|---|---|---|---|---|
| Entrance 4 (facade gap between 7/8 and 110/112, ATM markers in the passage) | 212, 338 | 50.84, 38.06 | 50.24, 38.06 | FIRST_PARTY_VISUAL |
| Main walkway at Entrance 4 passage | 150, 345 | 35.97, 38.85 | 45.92, 38.85 | FIRST_PARTY_VISUAL |
| Woolworths corridor arrival | 146, 330 | 35.01, 37.16 | 45.64, 37.16 | FIRST_PARTY_VISUAL (door: field) |
| Main walkway at Entrance 5 passage | 138, 468 | 33.09, 52.70 | 45.08, 52.70 | FIRST_PARTY_VISUAL |
| Main walkway at Entrance 6 passage | 133, 608 | 31.89, 68.47 | 44.73, 68.47 | FIRST_PARTY_VISUAL |
| Walkway bend near Edgars | 142, 662 | 34.05, 74.55 | 45.36, 74.55 | FIRST_PARTY_VISUAL |
| Main walkway at Entrance 7 passage | 165, 705 | 39.57, 79.39 | 46.96, 79.39 | FIRST_PARTY_VISUAL (digit: field) |
| Walkway bend at the toilets | 186, 752 | 44.60, 84.68 | 48.43, 84.68 | FIRST_PARTY_VISUAL |
| Clicks (37/38) corridor arrival | 205, 787 | 49.16, 88.63 | 49.76, 88.63 | FIRST_PARTY_VISUAL (door: field) |
| Pick n Pay corridor arrival | 218, 806 | 52.28, 90.77 | 50.66, 90.77 | FIRST_PARTY_VISUAL (door: field) |

Plane mapping: the source aspect is 0.47, so it is padded 121.73 % of its width on each side to the
1000:620 plane: `x_percent = (x_percent_source + 121.73) / 3.43467`, `y` unchanged. Every node in
the dataset carries `source_px_x/y` and `x/y_percent_source` so the derivation is reproducible.

## 3. Routes (dataset `src/components/navigation/data/garden-route-mall.dataset.json`, 10 nodes, 9 edges, one level)

**Route A — Entrance 4 → Woolworths (2 legs).** Chosen because Entrance 4 is clearly labelled on
the original, its passage is marked by the two ATM symbols, and Woolworths' frontage faces the
walkway directly opposite that passage: the shortest, least ambiguous route on the sheet.

**Route B — Entrance 4 → Pick n Pay (8 legs, Clicks 37/38 passed on leg 7).** Chosen because it
follows the single continuous main walkway past four side passages (Entrances 5, 6, 7) and two
bends to the unmistakable Pick n Pay block at the southern end — the most junction-rich route the
sheet supports without inventing geometry. Clicks is a third destination on the same path.

Instructions are written for the Entrance 4 → south direction only (the only start), so no edge is
ever traversed against its wording. Edge pixel lengths: 62, 16, 124, 140, 55, 49, 51, 40, 23.

## 4. Distance: unavailable

No scale bar. `distance_unit: "px"`; `distance_meters` is absent; the app shows "Distance not yet
measured — no walking time shown." Sunday's paces are recorded **per leg** in the checklist; a
single measured leg is not used to calibrate the map, and metric routing would require every edge to
be measured separately.

## 5. Sunday URLs

- Both routes: `/navigate?mall=garden-route-mall&start=grm-entrance-4` → tap **Woolworths** (A) or
  **Pick n Pay** (B); **Clicks** is also offered.
- Testing mount without the app shell: `/pilot?mall=garden-route-mall&start=grm-entrance-4`.

The phone shows "Garden Route Mall · source-backed preview", "Distance not yet measured — no walking
time shown", "Source-backed route preview. Distance not yet measured. Your position is not tracked."
and, in the details, "Not an official Garden Route Mall deployment. Controlled pilot only."

## 6. Rights

The map is the mall's published artwork; nothing seen grants reproduction or derivation. The app
draws only the derived graph (a schematic route over dark ground); `plan_image` is null. See
`permission-request-draft.md` (not sent).

## 7. Files

`evidence-ledger.json` (v2, 20 facts), `source-manifest.json` (v2), `field-test-checklist.md`
(route-specific), `permission-request-draft.md`.

## 8. Next action

Walk Route A then Route B on Sunday with the checklist, recording each leg's paces separately, the
Entrance 7 digit and the three store doors; then upgrade the dataset's per-entity evidence to
`on-site-verified` only for what was confirmed.
