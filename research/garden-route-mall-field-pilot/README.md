# Garden Route Mall — live field pilot (research branch, NON-PRODUCTION)

**Decision: RED at map retrieval — no geometry has been created.** Branch
`feat/garden-route-live-pilot` (research only, no implementation PR). Mission date 2026-09-03;
target field walk: Sunday 2026-09-06.

Every host holding the official map was refused by this session's network egress policy
(`www.gardenroutemall.co.za`, the legacy `grmall.co.za`, `mydorpie.com`, `www.attacq.co.za`,
plus the Webflow asset CDNs — see `source-manifest.json`). Per the failure-mode rule the pilot was
**not** manufactured. Tenant identity, landmark, contact and rights evidence is prepared below so
that, as soon as the map image is supplied (exactly as for Menlyn), the dataset can be traced,
validated and shipped under the merged multi-mall / unscaled contract from PR #54.

## 1. What to upload (the one blocking input)

The official shops page (`https://www.gardenroutemall.co.za/garden-route-mall-shops`) carries a link
labelled **"Click here to view MALL MAP"**. The site is built on Webflow; that link is almost
certainly a Webflow *lightbox* whose image lives on the Webflow CDN, which is why no normal URL is
visible. Two ways to get the file:

1. **From the page (preferred, native resolution):** on a desktop browser open the shops page,
   right-click the "Click here to view MALL MAP" link → *Inspect*. Inside the `<a class="w-lightbox">`
   element there is a `<script type="application/json" class="w-json">` block; it contains
   `"url": "https://cdn.prod.website-files.com/<site-id>/<hash>_<name>.jpg|png|pdf"` (older sites use
   `uploads-ssl.webflow.com`). Open that URL, save the file, and upload it here together with the URL.
   Alternatively click the link, then right-click the enlarged image → *Open image in new tab* →
   save. Please also note the file's pixel dimensions (browser tab title or file properties).
   **Upload the file itself, not just the URL:** the Webflow CDN hosts are also blocked from this
   session, so a link cannot be fetched here.
2. **On Sunday, from the mall itself:** photograph the printed **"You are here" directory board** at
   the entrance you start from, square-on and in full, plus one photo of the board's legend and any
   scale. This is first-party physical signage and often shows entrance numbers the web map omits.

Upload whichever arrives first; the web image is preferred because it is the same artwork the mall
publishes.

## 2. Tenant truth (first-party directory, corroborated via search snippets)

The official directory could not be fetched directly; the snippets below quote it. Treat as
**FIRST_PARTY_EXPLICIT (owner-verified)** once you confirm them on the shops page on Sunday morning.

| Tenant | Store no. | Phone (directory) | Status |
|---|---|---|---|
| Clicks | 37 | 044 887 0030 | corroborated (directory snippet + clicks.co.za store 261) |
| Pick n Pay | 41 | 044 887 0000 | corroborated (directory snippet) |
| Woolworths | 9 | 044 803 5400 | corroborated (directory snippet) |
| Dis-Chem | 122/123 | — | corroborated (directory snippet) |
| Game | 129 | 044 803 6000 | corroborated (directory snippet) |
| Food Lovers Market | 131 | 044 887 0282 | corroborated (directory snippet) |

Store numbers are identity only. **No adjacency or order is inferred from them.**

Landmark (contact page, via snippet): "The Security offices are located next to the Centre
Management offices." The snippet did **not** include "near Entrance 2"; that part remains
UNVERIFIED and must be read off the official page or the directory board.

## 3. Route selection (to be done on the map, not before)

Candidates, in order of expected ease once the plan is visible: **Pick n Pay (41)**, **Woolworths
(9)**, **Clicks (37)**, Dis-Chem (122/123), Game (129), Food Lovers Market (131). Selection rule:
the entrance whose number is printed on the plan and on the physical signage, the anchor whose
footprint is unmistakably labelled, and the fewest junctions with no floor change — 2 to 6 edges.
Garden Route Mall is widely described as a single-level regional centre; **do not assume this until
the plan shows it.**

## 4. Distance

No scale is expected on a marketing map. The dataset will use `distance_unit: "px"` (merged in
PR #54): pixel lengths as shortest-path weights, `distance_meters` absent, UI shows "Distance not yet
measured — no walking time shown." Sunday's paced/wheeled legs are recorded in the checklist as
**approximate field measurements per edge**; they are not assumed to calibrate the whole image
(marketing plans are not guaranteed to be uniformly scaled).

## 5. Sunday test URL (once the dataset exists)

`/navigate?mall=garden-route-mall&start=<verified-entrance-node-id>` — the mall preselected, start
preselected from the link, destination one tap away, "Source-backed route preview. Distance not yet
measured. Your position is not tracked." and "Not an official Garden Route Mall deployment" in the
details. Until the dataset exists this link fails safely with "MallMind does not have a map for
this mall yet."

## 6. Files

- `evidence-ledger.json` — facts with source, evidence level, confidence.
- `source-manifest.json` — every URL attempted and its outcome.
- `field-test-checklist.md` — Sunday walk protocol (paper/phone notes; no special equipment).
- `permission-request-draft.md` — short, low-friction note to Centre Management (NOT sent).

## 7. Next action

Upload the official mall-map image (or the URL from the lightbox JSON) and its pixel dimensions;
the Garden Route dataset, tests and Sunday URL follow the Menlyn pattern within the same session.
