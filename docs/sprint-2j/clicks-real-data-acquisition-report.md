# Clicks Real-Data Read-Only Sample — Acquisition Report (Sprint 2J)

**Status: LOCAL read-only acquisition + parsing test. Nothing written to any database, nothing published, no branch/stock claim.** Source classified `legal_status=reference_only`, `lifecycle_state=testing`, `rights_review_state=unreviewed` — which the publisher blocks from publication by design.

## Method & compliance
- **Public pages only**, official domain `clicks.co.za`. No login, no cart/checkout, no `/searchProducts` (the one product endpoint `robots.txt` disallows), no hidden/private API, no CAPTCHA/anti-bot bypass, no proxy rotation.
- **robots.txt honored:** wildcard block disallows only `/cart`, `/checkout`, `/my-account`, `/searchProducts` (none used). `Crawl-delay: 10s` — **honored** (a 10s wait between the two page loads). **Total page loads: 2.**
- **Visit-window flag (honest):** `robots.txt` states a preferred crawl window `04:00–08:45 UTC`; this sample was observed at **2026-07-30T16:28Z**, outside it. `Visit-time` is a non-standard/advisory directive (ignored by mainstream crawlers) and I kept volume to 2 low-impact reads with the 10s delay — **but any future *automated* pilot should schedule inside that window.**
- **No images** downloaded or referenced; **no long marketing descriptions** copied. Only the factual fields below were captured.
- Capture was **deterministic DOM** (rendered text), not model summarisation.

## Source URLs
**Category listing (where prices/promo were read):**
`https://clicks.co.za/beauty/hair/shampoo/c/OH300024` — "Shampoos | Cleanse, Nourish & Revitalize - Clicks"

**Canonical product pages (the 10 records):**
| # | source_product_id | Brand | Product | Pack | Price | Condition | URL |
|---|---|---|---|---|---|---|---|
| 1 | 388251 | Portia M | Marula Shampoo | 400ml | R79.99 | promotional | `/portia-m_marula-shampoo-400ml/p/388251` |
| 2 | 204942 | Organics For Kids | 2in1 Shampoo & Conditioner Strawbelicious | 400ml | R71.99 | promotional | `/organics-for-kids_2in1-shampoo-and-conditioner-strawbelicious-400ml/p/204942` |
| 3 | 204947 | Organics For Kids | 2in1 Shampoo & Conditioner Coconutty | 400ml | R71.99 | promotional | `/organics-for-kids_2in1-shampoo-and-conditioner-coconutty-400ml/p/204947` |
| 4 | 134302 | Organics | Daily Care 2-in-1 Shampoo & Conditioner Aloe Vera | 1L | R110.00 | standard | `/organics_daily-care-2-in-1-shampoo-and-conditioner-aloe-vera-1l/p/134302` |
| 5 | 197328 | Organics | Repair & Care Shampoo Shea Butter | 1L | R110.00 | standard | `/organics_repair-and-care-shampoo-shea-butter-1l/p/197328` |
| 6 | 197326 | Organics | Anti-Dandruff 2-in-1 Shampoo & Conditioner Green Tea | 1L | R110.00 | standard | `/organics_anti-dandruff-2-in-1-shampoo-and-conditioner-green-tea-1l/p/197326` |
| 7 | 311530 | Organics | Anti Hair Loss Shampoo Ginseng & Almond Oil | 1L | R110.00 | standard | `/organics_anti-hair-loss-shampoo-ginseng-and-almond-oil-1l/p/311530` |
| 8 | 114052 | Organics | Daily Hair Care Shampoo Aloe Vera | 400ml | R68.99 | promotional | `/organics_daily-hair-care-shampoo-aloe-vera-400ml/p/114052` |
| 9 | 197321 | Organics | Silky Smooth Shampoo Argan Oil | 1L | R110.00 | standard | `/organics_silky-smooth-shampoo-argan-oil-1l/p/197321` |
| 10 | 114056 | Organics | Hair Repair Shampoo Shea Butter | 400ml | R68.99 | promotional | `/organics_hair-repair-shampoo-shea-butter-400ml/p/114056` |

(All 10 are shampoos; a non-shampoo "hair butter" tile on the same page was deliberately excluded.)

## What was directly observed
- Stable product id (`/p/<id>`), brand, full product name, current price, "On promo" badge (5 of 10), "Delivered in 1–2 working days" + "Add to basket" (online channel), on the **category listing**.
- Product-page spot-check (#388251): confirmed the same price (R79.99), title, and online-delivery state.

## What was inferred (and flagged)
- **pack_size** parsed from the product name (`400ml` / `1L`) — factual and unambiguous, but derived, not a separate field.
- **availability_scope = `online`** — inferred from "Add to basket" + "Delivered in 1–2 working days" (an online-channel state). It is **not** a branch or in-store claim.
- **price_condition** — `promotional` where the tile showed "On promo", else `standard`.

## What remains unknown (kept NULL — never invented)
- **barcode / GTIN** — not published on Clicks public pages (category or product). NULL for all 10.
- **original_price** — "On promo" is shown but no "Was R…"/strikethrough price appears anywhere, so the discount **cannot be quantified**. NULL for all 10.
- **retailer_sku** — no separate SKU is exposed; the `/p/<id>` is the **only** stable identifier.
- **variant / scent** — embedded in the product name (e.g. "Aloe Vera", "Green Tea"), not a separate labelled field. NULL.

## Price nature: standard, promotional, loyalty, bulk, or unclear?
- **Standard:** 5 (the R110.00 Organics 1L range showed no promo badge).
- **Promotional:** 5 (badged "On promo"), but **unquantified** — no reference price is published.
- **Loyalty:** none observed at the item level. (Clicks runs a ClubCard programme and the page's filters include "You Pay Less"/"Pay Day Savings", but no per-item loyalty price was shown on these tiles — so `price_condition=loyalty` was **not** asserted for any record.)
- **Bulk / bundle:** none in this sample (the category exposes "Bulk Offers"/"3 For 2" filters, but none of these 10 tiles carried a multi-buy condition).
- **Unclear:** the promotional/original-price relationship (discount amount) is unclear and left unknown.

## Why nothing here can be described as Mall@Reds branch stock
- Every record has `shop_id = NULL`, `mall_id = NULL`, `availability_scope = online`, `price_scope = online_national`, `branch_availability_confirmed = false`.
- The pages are the **national online catalogue**; they prove an online-delivery channel, **not** stock or price at the Mall@Reds branch. No page linked a product to a physical store.
- The truth model enforces this structurally: a branch claim requires `availability_scope='branch_confirmed'` + a shop that belongs to the mall (publisher gate). The shopper-safe preview renders "Availability not confirmed" / "National online price" for every record (validated in `clicksSample.test.ts`).

## Missing stable identifiers
- No GTIN/barcode and no retailer SKU are public → cross-retailer product matching would rely on `brand + name + pack_size` until a GTIN source exists. The `/p/<id>` is stable and unique **within Clicks** (good for refresh/dedup of the same listing).

## Parser ambiguity
- "On promo" without a reference price → discount not computable (original_price NULL).
- Promo badge appears on the **listing** tile but the **product page** for #388251 did not surface a promo badge or "Was" price — a listing-vs-PDP inconsistency worth noting; the listing badge was treated as authoritative for `promotion_indicator`.
- Brand vs name boundary and variant/scent are name-embedded; only `pack_size` was safely parsed out.

## Local validation
`src/lib/retail/clicksSample.test.ts` runs the sample through the real truth-model code (`validateCandidate`, `dedupeCandidates`, `retailTruth` helpers): **15/15 pass**, covering all 14 required assertions (10 records; official Clicks URLs; source URLs; observed_at; no shop_id/mall_id; price_scope online_national; no branch_confirmed; no image storage; no publication/DB write; string ids preserve leading zeros; unknown fields NULL; promo not flattened; shopper-safe preview says Mall@Reds availability not confirmed).

## Recommendation — is Clicks technically suitable for a permissioned pilot?
**Technically promising, with two data-quality gaps to close via permission.**
- **Strengths:** clean public pages (no bot challenge encountered), a **stable per-product id** (`/p/<id>`) ideal for refresh/dedup, reliable brand/name/pack/price/promo capture, and an honest online-national scope that fits the truth model without any branch fabrication.
- **Gaps a pilot must close (needs the retailer, not scraping):** (1) **no GTIN/barcode** → weak cross-retailer identity; (2) **no reference price** → promotions can't be quantified; (3) **loyalty (ClubCard) pricing** is not exposed per item; (4) **branch-level stock/price** is entirely absent — online-national only.
- **Compliance:** stay within `robots.txt` (10s crawl-delay, avoid `/searchProducts`, prefer the 04:00–08:45 UTC window), no images/long descriptions. But the **right** path is a **permissioned feed/CSV** (which would also supply GTIN, reference prices, and loyalty semantics) — at which point the source's `rights_review_state` moves to `approved` and `legal_status` off `reference_only`. **Until then this stays reference-only and unpublishable.**

**Verdict: suitable as a pilot *candidate* — pursue a permissioned retailer feed rather than scaling public-page extraction.**
