# Sprint 8 — Garden Route Mall demonstration

What MallMind can show Garden Route Mall management today, how it was built, what is real, what is
simulated, and what is not yet known. Base: Venue Pack `garden-route-mall` **v2**
(`src/venue/packs/garden-route-mall.venue.json`). Screenshots: `docs/navigation/screenshots/sprint-8/`.

## The claim we can make

> "We built this for your centre from publicly available information and an AI-assisted workflow,
> with a human approving every fact. Give us your plans and tenant schedule and we turn it into
> production."

Everything below is either (a) source-backed and shown as a **Mapped route — not yet walked on
site**, (b) identity-only and shown as **Listed, route not yet mapped**, or (c) **DEMO / SIMULATED**
and labelled as such on screen. Nothing is presented as field-verified; no metres, minutes, doors,
floors, hours, stock or prices are invented.

## Destination coverage

| Destination | Unit | Category | Identity | Arrival geometry | Routable from Entrance 4 |
|---|---|---|---|---|---|
| Woolworths | 9 | Department store | source-backed (map label + directory) | source-backed walkway point | yes (2 steps) |
| Clicks | 37 | Health & beauty | source-backed (map label + directory + clicks.co.za) | source-backed walkway point | yes (7 steps) |
| Pick n Pay | 41 | Department store | source-backed (map label + directory) | source-backed walkway point | yes (9 steps) |
| Dis-Chem | 122/123 | Health & beauty | source-backed (official category pages) | **unknown** | no — listed only |
| Food Lover's Market | 131 | Department store* | source-backed (official category pages) | **unknown** | no — listed only |
| Game | 129 | Department store | source-backed (official category pages) | **unknown** | no — listed only |

\* The venue's own directory files Food Lover's Market under "Department Stores"; the pack keeps the
venue's category and adds `supermarket` / `groceries` / `fresh produce` as aliases so visitors find it
either way.

"Mapped route" means the walkway points and the order of turns come from the official mall map and
were approved by a reviewer; nobody has walked them. "Listed, route not yet mapped" means the tenant
and its unit number are confirmed by the venue's public pages but no one has placed its arrival
point on the map. The app says so in those words.

## Search vocabulary

A small closed vocabulary (`src/venue/vocabulary.ts`): `health_beauty`, `supermarket`,
`department_store`, `food_drink`. Each has search terms ("pharmacy", "chemist", "groceries") and
product hints ("shampoo", "milk"). A product hint renders **"You may find shampoo at these places.
MallMind doesn't know stock or prices."** — never "Clicks has shampoo". Unknown words give an honest
"No match"; the analytics event classifies the miss (typo / alias gap, known category absent,
unknown) without ever storing the visitor's text.

## Demo journeys (all pass in the browser QA, `docs/navigation/screenshots/sprint-8/`)

| | Journey | Entry | What to show |
|---|---|---|---|
| A | Entrance 4 → Woolworths | `/navigate?mall=garden-route-mall&start=grm-entrance-4&via=qr` | QR start, 2 steps, arrival wording "mapped arrival point" |
| B | Entrance 4 → Clicks | same | 7 steps along the main walkway, honest "Then:" previews |
| C | Entrance 4 → Pick n Pay | same | 9 steps, longest route |
| D | Category search | type "pharmacy" then "shampoo" | Clicks (routable) + Dis-Chem (listed only); product-hint wording |
| E | Known but unmapped | choose Dis-Chem | "Dis-Chem is listed at Garden Route Mall, but MallMind does not yet have a verified route to this store." |
| F | Offline continuity | start a route, switch to flight mode | steps keep advancing; **Offline — directions saved on this phone**; reload still restores the walk |
| G | Simulated closure | append `&demo_overlay=grm-clicks-unavailable`, then `&demo_overlay=none` | DEMO banner, Clicks unavailable, others unaffected; removal restores the identical route |
| H | Invalid QR | `&start=entrance-99` | "That starting point is not on this mall's map" and the finder stays usable |

Also available: `&demo_overlay=grm-entrance-4-unavailable` (no start → "No MallMind starting point
is available…").

## What is simulated

Only the two `demo_overlay` fixtures. They are activated by an explicit query parameter, are
labelled "DEMO / SIMULATED operational state — Not a real Garden Route Mall condition" on screen,
and are cleared with `demo_overlay=none`. No real closure, outage or live condition is shown
anywhere.

## What is still unknown (say so if asked)

- Walking distances and times (the sheet is unscaled; nothing is measured).
- Door positions, store entrances, accessibility, step-free continuity.
- Whether the centre has more than one level: the public map is a single sheet.
- Arrival points for Dis-Chem, Food Lover's Market, Game — and every other tenant.
- Entrances 1 and 2 (not visible on the public sheet). Only Entrance 4 is a start.

## Rights

The pack reproduces no artwork. The public mall map was used as a *source* for walkway topology
and unit labels (rights `public_no_reuse` in the pack's `sources`); the category pages were used
for tenant identity (same rights class). Nothing was upgraded to "permitted".

## How it was built (the factory story, honestly)

`venue-factory/dry-runs/garden-route-mall/` replays the v1 → v2 revision: the sources and the
research extraction (facts G04–G06 for the three listed-only tenants, category and alias facts),
the reviewer's accept decisions with reasons, the compiler's diff (3 destinations added, **empty
geometry diff**) and the publish gate. The extraction was done by a person reading public pages;
there is no extraction worker or reviewer UI yet, and the v2 pack was applied as a hand-reviewed
edit of v1 with the dry-run as its evidence trail.

## What we need from the centre to go to production

1. Floor plans (CAD/PDF) with a scale, or permission to walk and measure.
2. The tenant schedule (unit → tenant, with changes).
3. Which entrances carry QR codes, and where the information desk is.
4. A named person who may declare temporary closures (the operational overlay actor).
5. Permission to reproduce any artwork we would show (none is shown today).
