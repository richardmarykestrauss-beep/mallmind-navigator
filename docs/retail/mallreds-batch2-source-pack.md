# Mall@Reds Catalogue Batch 2 — Source & Evidence Pack

| | |
|---|---|
| **Sprint** | 22E — Mall@Reds Catalogue Batch 2 Source Pack |
| **Baseline commit** | `c8084659458622dc048c14259983de350f952d13` |
| **CSV** | `scripts/retail/mallreds_batch2_source_pack.csv` |
| **Status** | ⚠️ **PLANNING PACK — DO NOT APPLY WITHOUT REVIEW.** Prices are placeholders; every row is staged `manual_fact_entry`/`csv_manual` (→ needs_review tier) until real evidence is captured. |

## 1. Purpose

Add 25 products across 5 confirmed Mall@Reds shops through the full trust
pipeline — the first volume exercise under
[source-registry-v1.md](./source-registry-v1.md) discipline. Every row cites
a registered source and carries an evidence placeholder that an operator
fills in before any `--apply`.

## 2. Source rules (from Source Registry v1)

- Every row cites a registered source by exact name — no "misc manual CSV".
- Nothing claims Verified without a real evidence method; **all rows ship as
  `manual_fact_entry` + `csv_manual`**, which the trust mapper can only ever
  publish as needs_review tier. Rows are upgraded (trust_state `verified` +
  real method + evidence note) only after evidence exists.
- No raw scraper outputs. No direct product writes. Review gate mandatory.

## 3. Shops / categories (all confirmed in live data — none invented)

| Shop | shop_id | Floor/Unit | Category | Products |
|---|---|---|---|---|
| Game | `…0001` | G / Shop G01 | Electronics & small appliances | 5 |
| Checkers | `…0002` | G / Shop G05 | Groceries | 5 |
| Woolworths | `…0003` | G / Shop G10 | Food | 5 |
| Clicks | `…0004` | G / Shop G15 | Health & Beauty / pharmacy | 5 |
| PEP | `…0005` | G / Shop G20 | Clothing / basic home | 5 |

Shop presence confirmed by read-only query of the live `shops` table on
2026-06-12 — **zero rows require shop confirmation**. Dis-Chem and Mr Price
are *not* present at Mall@Reds in our data, so pharmacy = Clicks and
apparel = PEP; the Dis-Chem newsletter lane stays a future source for malls
where Dis-Chem exists.

## 4. Proposed product list (placeholder prices — confirm before apply)

- **Game:** Samsung Galaxy A16 LTE 128GB · Defy 20L Microwave (DMO381) ·
  Russell Hobbs 1.7L Kettle · JBL Go 4 Speaker · Sunbeam 2-Slice Toaster
- **Checkers:** Jacobs Krönung 200g · Nescafé Ricoffy 750g · Huletts White
  Sugar 2.5kg · Sunlight Dishwashing Liquid 750ml · Fatti's & Moni's
  Macaroni 500g
- **Woolworths:** Ayrshire Full Cream Milk 2L · Free Range Large Eggs 6s ·
  Soft White Bread 700g · Chicken Breast Fillets 600g · Still Water 1.5L
- **Clicks:** Panado 24s · Colgate Total 100ml · Dove Original Roll-On 50ml ·
  Clicks Vitamin C 500mg 100s · Johnson's Baby Wipes 80s
- **PEP:** Men's Crew Neck T-Shirt · Ladies' Basic Leggings · Kids' School
  Socks 3-Pack · Men's Canvas Sneakers · Bath Towel 70×130cm

Product names chosen for stability (staple SKUs, weekly-stable prices) and
deliberate near-duplicate avoidance against existing catalogue rows (the
existing Samsung 32"/LG 40" TVs, JBL Tune 215TWS, etc. are not repeated).

## 5–6. Evidence plan per shop

| Shop | Intended registered source | Evidence to capture (placeholder format in CSV `source_note`) |
|---|---|---|
| Game | **MallMind Phone Verification — Mall@Reds** | who called · number/source · date · price+stock confirmed |
| Checkers | **MallMind Phone Verification — Mall@Reds** | same |
| Clicks | **MallMind Phone Verification — Mall@Reds** | same |
| Woolworths | **Retailer Website Public Page Evidence** (+ phone if online/in-store doubt) | woolworths.co.za URL · screenshot/snapshot · date checked |
| PEP | **MallMind Store Visit Evidence** | shelf photo filename · date · who visited (PEP has limited online pricing) |

## 7. Verification state policy

**Every row remains `manual_fact_entry`/`csv_manual` (needs_review) until
its evidence exists.** Upgrade procedure per row, before `--apply`:
1. Capture evidence (call/snapshot/photo); fill the evidence placeholder in
   `source_note` with real values; correct the price to the verified figure.
2. Change `trust_state` → `verified` and `verification_method` → `phone` /
   `website` / `store_visit` for that row only.
3. Rows without evidence at apply time stay as-is — they stage safely as
   needs_review and can be upgraded later via review. **No row is ever
   hand-promoted to Verified without its artefact.**

## 8. Staging flow (later sprint, after pack review)

1. `node scripts/retail/import-csv-staging.mjs --file scripts/retail/mallreds_batch2_source_pack.csv` (**dry run**)
2. Review the dry-run plan; fix issues; re-run dry.
3. `--apply` (Cloud Shell, service role) → rows staged as observations.
4. Admin → Retail Review: approve **only evidence-backed rows**; leave
   placeholder rows pending/needs_more_info.
5. `node scripts/retail/publish-staged-observations.mjs` dry-run, then
   `--apply` → approved-only publisher writes products.
6. `npm run demo:smoke -- --live` + spot-check shopper labels.

## 9. Operator effort estimate

| Activity | Est. |
|---|---|
| Phone batches (Game, Checkers, Clicks = 15 products; one call per shop covering 5 products) | ~15 min/call × 3 = **45 min** |
| Woolworths website checks + snapshots (5) | ~3 min each = **15 min** |
| PEP store visit incl. 5 shelf photos | **~30 min** (single visit) |
| CSV evidence/price updates (25 rows) | **~25 min** |
| Staging dry-runs + apply + admin review (25 obs) | **~35 min** |
| Publisher dry-run + apply + smoke | **~15 min** |
| **Total** | **≈ 2h45m ⇒ ~6.6 operator-minutes per verified product** |

Call batch strategy: one call per shop, read the 5-product list to the
staff member, record all answers in one note — far cheaper than per-product
calls. Best calling window: weekday mid-morning.

## 10. Acceptance checklist before any `--apply`

- [ ] Evidence captured and referenced in `source_note` (no `[placeholder]`
      brackets remaining on rows being approved)
- [ ] Source name matches Source Registry v1 exactly
- [ ] No fake verification: `verified` rows all have a real method + artefact
- [ ] No raw scraper source anywhere
- [ ] Mall/shop ids confirmed (done — 2026-06-12 live check)
- [ ] Price date recorded per row
- [ ] `valid_to` recorded for any special (none proposed in this pack —
      `is_on_special=false` everywhere; no invented specials)
- [ ] Dry-run output reviewed before apply

## 11. Risks

- **Price drift:** placeholder prices will differ from shelf reality — by
  design they must be replaced at evidence time; never apply placeholders as
  verified.
- **Store presence:** mitigated — all 5 shops confirmed in live data.
- **National vs shelf price:** Woolworths online prices may differ in-store;
  the reviewer notes this and may keep such rows at "needs confirmation".
- **Duplicate naming:** product names chosen to avoid collisions with the
  existing catalogue; the publisher's ambiguity refusal is the backstop.
- **Source legal status:** all sources used are `manual_fact_entry`-class,
  active, legally clean per Registry v1; no feeds/aggregators involved.
- **Stock honesty:** `in_stock=true` placeholders must be confirmed on the
  same call/visit as the price, or set honestly.

## 12. Immediate next step

1. Review this pack (product selection, shops, evidence plan).
2. Capture evidence per §5 (the three phone calls, five website checks, one
   PEP visit).
3. A later approved sprint runs the staging flow in §8 — **dry-run first,
   nothing applied without the §10 checklist passing**.
