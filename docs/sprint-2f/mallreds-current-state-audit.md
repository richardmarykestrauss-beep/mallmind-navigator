# Mall@Reds Current-State Audit — Sprint 2F

**Type:** Read-only discovery & gap audit. Nothing deployed, migrated, scraped, or written to any live system.
**Base branch:** `claude-premium-nav-test`  ·  **Audit branch:** `feat/mallreds-reality-proof-2f-audit`
**Method:** static inspection of the committed repository (git), including diffs of the unmerged `mallreds-*` WIP branches. **This audit has no access to the live Supabase project**, where the running app's operational data actually lives.

> **The single most important finding:** Mall@Reds barely exists *in the repository*. Its `mall_id` (`f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c`) appears in only **3 committed files** — a demo QA checklist, smoke tests, and an env example. There are **zero** committed Mall@Reds stores, products, or map nodes. Everything a shopper would see is either in the unaudited live database or on two unmerged WIP branches. The reality proof therefore cannot be *verified from the repo* today, and the first blocker is simply **getting real, evidence-backed Mall@Reds data into a governed, measurable state.**

Machine-readable companions in this folder:
`mallreds-store-inventory.json` · `mallreds-product-coverage.json` · `mallreds-navigation-audit.json` · `mallreds-retailer-targets.json` · `mallreds-gap-register.json`

---

## Task 1 — Inventory of current Mall@Reds data

| Reference type | Where (committed, base branch) | Count |
|---|---|---|
| `Mall@Reds` / `Mall at Reds` / `Reds Mall` text | 11 files (docs + google-dev-agent + AdminDashboard.tsx) | 34 occurrences |
| Mall@Reds `mall_id` `f4a2c1b3-…` | `docs/MALLMIND_DEMO_QA_CHECKLIST.md`, `google-dev-agent/src/smokeTests.ts`, `google-dev-agent/.env.example` | 3 files |
| Mall@Reds committed **store** rows (seed/migration) | — | **0** |
| Mall@Reds committed **product** rows | — | **0** |
| Mall@Reds committed **map nodes / edges** | — | **0** |
| Mall@Reds coordinates | `.env.example:31`, `smokeTests.ts:294` | lat −25.8537, lng 28.1878 (The Reeds, Centurion) |
| Named Mall@Reds store | `docs/MALLMIND_DEMO_QA_CHECKLIST.md` | 1 (“Game”, Ground Floor) |
| Mall@Reds product/store data on **unmerged** branches | `mallreds_seed_starter.csv` (11), `mallreds_batch2_source_pack.csv` (26) | 37 product rows, 5 shop_ids |

**seed.sql seeds 8 *other* malls** (Canal Walk, Cresta, Eastgate, Gateway, Mall of Africa, Menlyn Park, Sandton City, V&A Waterfront) with **110 products / 58 shops — none for Mall@Reds** and zero “reds” references. Mall/floor-plan assets, entrances, escalators, lifts, stairs, parking entrances, route fixtures, store coordinates, shop numbers, trading hours, retailer branches, product offers, source evidence, catalogue records, verified prices, and availability claims for Mall@Reds are **all absent from the repository**; where they exist they live only in the live DB or as unmerged placeholders.

## Task 2 — Store directory audit

Full records in `mallreds-store-inventory.json`. Summary:

- **Committed Mall@Reds stores on the base branch: 0.**
- Five `shop_id` placeholders exist on unmerged branches; only `…0001` is named (“Game”). Store names for `…0002`/`…0004` are **not recorded** (only product brands hint at Woolworths/PEP/Clicks for the others — not invented into the records).

| store_id (suffix) | store_name | classification | notes |
|---|---|---|---|
| …0001 | Game | **DEMO_ONLY** | named in QA checklist; Electronics; Ground Floor; no shop no./node/hours/phone |
| …0002 | (unknown) | **PLACEHOLDER** | grocery products only; no store name |
| …0003 | (Woolworths — inferred) | **PLACEHOLDER** | food products branded Woolworths |
| …0004 | (unknown; Clicks item present) | **PLACEHOLDER** | health & beauty products |
| …0005 | (PEP — inferred) | **PLACEHOLDER** | clothing/home products branded PEP |

Classification totals: COMPLETE 0 · PARTIAL 0 · PLACEHOLDER 4 · DEMO_ONLY 1 · UNKNOWN 0.

## Task 3 — Product coverage audit

Full breakdown in `mallreds-product-coverage.json`. Summary:

- **Real, evidence-backed Mall@Reds products in the repo: 0.**
- The only Mall@Reds product data in git is **37 rows of CSV on two unmerged branches**: 11 in `mallreds_seed_starter.csv` (2 claim verification — one phone-verified Hisense 43″ FHD, one website-verified Woolworths yoghurt), 26 in `mallreds_batch2_source_pack.csv` (**every row marked “DO NOT APPLY until evidence captured”**).
- The **110 committed seed products** are all **DEMO-grade** (the seed INSERT never sets `data_quality_status`, which defaults to `'demo'`) and belong to the 8 other malls.
- **No `image_url`, `sku`, or `gtin` columns exist** on `products` at all — image/SKU/GTIN coverage is structurally 0.
- The flagship **“43-inch TV”** scenario has **no committed backing for Mall@Reds** (0 seed products for the mall; 0 43″ TVs in seed). It only works if the live DB happens to hold such a row.

Separation requested: real evidence-backed = **0** · manually entered (unmerged) = **11** · synthetic test = **0** · demo fixtures (other malls) = **110** · placeholders (unmerged) = **26** · stale = unknown (live DB not audited).

## Task 4 — Current shopper path audit

Traced query: *“Find me a 43-inch TV under R5,000 at Mall@Reds.”*

1. **Frontend:** `src/pages/AssistantPage.tsx` (conversational) — active mall from `ShoppingSessionContext.selectedMall`; a separate numeric budget input (prose “R5,000” is **not** parsed into the `budget` field). `src/pages/SearchPage.tsx` is a parallel direct-search path.
2. **Client switch:** `if (isGoogleBackendConfigured())` (`src/lib/googleBackendClient.ts`) → **Google Cloud Run `POST /assistant`**; else **Supabase edge fn `ai-assistant`**. Only `/assistant` is called; `/recommend-products` and `/build-route` run server-side inside it.
3. **Backend:** `google-cloud-backend/src/routes/assistant.ts` → `geminiService.runAssistant()` (Vertex `gemini-2.5-flash`, forced first tool = `recommend_products`). Edge equivalent uses **Anthropic Claude Haiku 4.5** + a `search_web` tool.
4. **Retrieval:** `productService.recommendProducts()` — `shops WHERE mall_id=X` → `products WHERE shop_id IN (…) AND name ILIKE %term% [AND price<=budget] ORDER BY price LIMIT 30`.
5. **Filtering:** text via `ILIKE` on `products.name` (so “43”/“43-inch” must be a substring of the name); price **only if** the LLM extracts `budget`; category optional; brand never filtered.
6. **Mall filter:** enforced via the shop join (not advisory).
7. **Branch filter:** none — granularity stops at `shop_id`.
8. **Evidence filter:** **none.** Verification affects only ranking (`scoreProduct`) and a display badge. A demo, unverified TV is fully eligible and can be “Best pick”.
9. **Freshness filter:** **none.** `price_verified_at` only drives a 7-day expiry badge; stale prices are still returned. The assistant path also does **not** filter `in_stock` (SearchPage does).
10. **Recommendation spine / governed eligibility:** **does not exist on this branch** (no `recommendationSpine`, `getShopperEligibleOffers`, `fabric`, or eligibility module in `src`).
11. **Gemini/LLM:** query understanding + phrasing only; it **cannot fabricate** a product — the product array is exactly what the DB query returned; deterministic fallbacks phrase from DB rows.
12. **Route:** on route intent, Dijkstra over `mall_nodes`/`mall_edges` (persisted to `shopping_routes`), else synthesized fallback steps.
13. **Render:** `RecommendationCard` (trust badge from `trust_state`) + a route card.

**Where the shopper path bypasses governance:** Retail Intelligence Fabric / evidence vault → **absent**; governed eligibility → **absent**; durable intake → present elsewhere but **unused** by the read path; evidence-backed publication gating → **absent** from reads; branch-level availability → **not modeled**. Net: verification and provenance influence *ordering and wording*, **never inclusion**.

## Task 5 — Navigation audit

Full detail in `mallreds-navigation-audit.json`. Summary:

- **Map:** hand-authored **2.5D SVG** over a Postgres **node/edge graph** (`mall_nodes`/`mall_edges`, migration 005). No GeoJSON/raster/map library. `indoorMapModel.ts` **does not exist**; routing is `buildRoute.ts` + `routingService.ts`. Geometry is **synthetic** (real `y_coordinate` ignored; edge distances = `Δx·5+30`).
- **Floors:** `mall_nodes.floor` text label; multi-floor; two inconsistent labeling conventions.
- **Nodes/edges:** fully runtime data-driven; **no hardcoded frontend graph**. Auto-generated in SQL from `shops`. The only rich fixture is a **hardcoded mock for Mall of Africa levels 3 & 5** (not Mall@Reds). **Mall@Reds committed nodes/edges/store-node links: 0.**
- **Store↔node:** `mall_nodes.linked_shop_id`. **0 committed for Mall@Reds.**
- **Special nodes:** schema supports entrance/escalator/lift/stairs/parking/etc., but the customer map **only renders shops + entrances**; the rest are stored but invisible.
- **Route algorithm:** real **Dijkstra** (duplicated in 3 places), greedy multi-stop, ETA = distance/72 m·min⁻¹.
- **Start point:** inferred (entrance node), **no positioning**.
- **Movement:** **no** animation/simulation/live tracking; position advances only on manual “Done” tap.
- **Positioning:** **no BLE/Wi-Fi RTT/UWB/compass/accelerometer/QR/NFC/camera.** GPS is **outdoor mall-selection only**. The on-map **“GPS” badge + “Prototype Tracking” label are decorative and overstate capability.**
- **Offline:** service worker caches app shell only and **bypasses Supabase**, so maps/routing **do not work offline**.
- **Admin tooling:** **Map Factory** 8-stage pipeline exists; AI defaults to **mock**; a default deployment yields the Mall-of-Africa fixtures, not real extracted maps.
- **Known defects:** fake GPS badge; synthetic geometry sold as a floor plan; dead ternary hiding unit numbers; two routing impls persisting the same JSONB columns in **incompatible formats**; `current_anchor_node_id` read but never written; vertical/parking nodes never rendered.

For Mall@Reds, `smokeTests.ts` itself documents the failure mode: *“Shop ID has no matching node in mall_nodes … Route returned 0 steps.”* Routing works only if the **live DB** has a real graph — which the repo cannot confirm.

## Task 6 — Retailer reuse potential

Full detail in `mallreds-retailer-targets.json`. National multi-branch chains associated with Mall@Reds (repository evidence only, no live research):

| Retailer | Branch record | Product source | Reusable across malls | Priority category |
|---|---|---|---|---|
| **Game** | demo/placeholder (…0001) | unmerged CSV (electronics) | **Yes — already in seed for 6 malls** | Electronics (matches TV demo) |
| **Woolworths** | placeholder (…0003) | unmerged CSV (food) | Likely (national anchor) | Grocery/Food |
| **PEP** | placeholder (…0005) | unmerged CSV (clothing/home) | Likely (large footprint) | Clothing/value |
| **Clicks** | inferred (…0004) | unmerged CSV (health & beauty) | Likely (national pharmacy) | Health & Beauty |
| grocery anchor | placeholder (…0002) | unmerged CSV (groceries) | Unknown — cannot name from repo | Grocery |

**Suitable for reusable national connectors: 4** (Game, Woolworths, PEP, Clicks). **Game is the standout** — already modeled across six malls in seed.sql. **But there is no retailer or canonical-offer entity, so any national catalogue must currently be duplicated per mall** — reuse is an aspiration, not a capability.

## Task 7 — Database & schema readiness

Full detail in `mallreds-product-coverage.json` context and below. Can the schema model `canonical product → retailer → retailer offer → retailer branch → mall membership → branch availability → evidence → freshness → publication`? **Largely no.**

- **Base `malls`/`shops`/`products` tables are not in the repo at all** — created in the Supabase dashboard; migrations only `ALTER … ADD COLUMN`. So some facts (PKs, `in_stock` default/nullability) are **unverifiable from git**.
- **Canonical product: none.** A product is **copied per mall** — the same SKU is a distinct `products` row per branch (e.g. `Samsung Galaxy S24` duplicated 7+ times in seed). Identity is only the `(name, brand, model)` string.
- **Retailer (chain): none.** A “shop” is one branch; chain identity is an unnormalized `shops.name` string.
- **Retailer offer: none** (price is conflated onto the per-branch product row).
- **Mall membership:** `shops.mall_id` **column**; the FK to `malls` is **not declared in any migration** (inferred).
- **Evidence:** **no product-linked observation table** with `source/observed_at/valid_to`. Provenance is fragmented across single-slot inline fields and staging queues (`price_correction_reports`, `mall_source_findings`) that **never write back to products**.
- **Freshness:** only `price_verified_at` (manual) + a manual `'stale'` flag. No `observed_at`/`valid_to`.
- **Publication status:** **none for products** (a product is live on insert). Only *maps* have a `draft→…→published` lifecycle (migration 019).
- **Branch availability:** `products.in_stock` boolean — **no UNKNOWN state**, no `availability_observed_at`; all demo rows hardcode `true`, so unknown stock is presented as live stock.

**Verdict:** One national retailer offer **cannot** safely support multiple mall branches today without duplication, and branch availability **cannot** be represented as UNKNOWN. These are schema-design gaps (SCHEMA-01/02/03) — **no migration is created in this audit** (out of scope).

## Task 8 — Output files

Created in `docs/sprint-2f/`: this document plus `mallreds-store-inventory.json`, `mallreds-product-coverage.json`, `mallreds-navigation-audit.json`, `mallreds-retailer-targets.json`, `mallreds-gap-register.json` (gap register uses the required schema; 20 gaps: 8 critical / 7 high / 5 medium).

## Task 9 — Priority ranking: top 15 actions to reach the reality proof

Effort units: XS / S / M / L / XL. Dimensions scored H/M/L. “Reuse” = leverage across other malls. “Dep. risk” = dependency/sequencing risk.

| # | Action | Shopper impact | Acquisition leverage | Reuse | Effort | Dep. risk | Evidence required |
|---|---|---|---|---|---|---|---|
| 1 | **Read-only export of live Mall@Reds data** (stores/products/nodes for `f4a2c1b3`) so the reality proof is measurable (META-01) | H | H | M | **XS** | L | none (read-only) |
| 2 | **Acquire & verify the full Mall@Reds store directory** — name, shop no., floor, hours, phone (STORE-01/02) | H | H | M | **L** | M | official directory + on-site/phone |
| 3 | **Capture real, evidence-backed offers per store**, incl. a real 43″ TV under R5k at the electronics anchor (PROD-01/03) | H | H | M | **L** | M | phone/website/store-visit evidence |
| 4 | **Design the retailer → canonical-offer → branch-availability model** (SCHEMA-01/02) — design only, migration later | H | H | **H** | **M** | H | none (design) |
| 5 | **Add governed shopper eligibility** (evidence + freshness gate before results) (SHOP-01/02) | H | M | **H** | **M** | M | depends on evidence model |
| 6 | **Build the Mall@Reds node/edge graph** with entrances + vertical transitions, every store linked to a node (NAV-01) | H | M | M | **L** | M | real floor plan |
| 7 | **Honest positioning UX** — remove fake GPS/“Tracking” badges; adopt a truthful start/advance model (NAV-02) | H | M | **H** | **S** | L | none |
| 8 | **Add `image_url` / `sku` / `gtin` to products** (design + additive change, later) (PROD-02) | M | M | **H** | **S** | M | none |
| 9 | **Product-linked evidence/observation entity** (source, observed_at, valid_to) (EVID-01) | M | H | **H** | **M** | H | design |
| 10 | **Publication gate for offers** (staging vs published) (EVID-02) | M | M | **H** | **M** | H | depends on #4/#9 |
| 11 | **Tri-state branch availability + observed_at** (never show unknown as live stock) (SCHEMA-02) | M | M | **H** | **S** | M | design |
| 12 | **Deterministic budget/size query parsing** (don’t rely on the LLM for the price cap) (SHOP-03) | M | L | **H** | **S** | L | none |
| 13 | **Consolidate the two routing implementations** + fix JSONB format mismatch and dead code (NAV-04) | M | L | **H** | **S** | M | none |
| 14 | **Render vertical-transition & parking nodes; use real coordinates; offline map cache** (NAV-03) | M | L | M | **M** | M | floor plan |
| 15 | **Triage the unmerged `mallreds-*` branches** — promote reusable scripts/templates, retire placeholders (STORE-03) | L | M | M | **S** | L | none |

Sequencing note: #1 unblocks measurement; #4/#9 are the schema spine that #5/#10/#11 depend on; #2/#3/#6 are the acquisition core that proves one real mall.

## Task 10 — Validation

Repository-safe checks only (`git status`, `npm run build`, `npm test`). Results recorded in the final report. No production code was altered; this sprint adds only audit artifacts under `docs/sprint-2f/`.

---

### Confirmation

Nothing was **deployed, migrated, or scraped**. No cloud resources were created. No live retailer websites were accessed. No migrations were added or changed. This audit only **read** the repository and **wrote** documentation under `docs/sprint-2f/`.
