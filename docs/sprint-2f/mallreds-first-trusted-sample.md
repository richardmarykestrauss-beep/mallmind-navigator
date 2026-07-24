# Mall@Reds — First Trusted Sample (high-confidence tenants)

**Source of truth:** the official directory `https://www.mallatreds.co.za/shops/` (accessed **2026-07-24**). Every store number and phone below is quoted **verbatim** from that page. **Floors, zones, categories, websites, coordinates, and per-store hours are UNKNOWN and left null** (the directory does not publish them — nothing is inferred).

**Confidence:** all 12 are **0.9** (present in the current official directory with a store number). Cross-category coverage as requested.

> **Requested names not supported by current evidence:** **Game** — *not in the current official directory and not confirmed by any current retailer locator; excluded* (see `mallreds-source-conflicts.md`). **Incredible Connection** — third-party only (Shop 61), retailer locator returned HTTP 403; **medium confidence, excluded-pending**. Neither is forced into this sample.

| # | Retailer (branch) | Category (requested slot) | Store no. | Phone (official) | Confidence |
|---|---|---|---|---|---|
| 1 | Pick n Pay | grocery anchor | 50 | 012 656 9562 | 0.9 |
| 2 | Woolworths | grocery / department anchor | 111 | 012 656 6800 | 0.9 |
| 3 | Clicks | health & beauty / pharmacy | 45 | 012 656 8850 | 0.9 |
| 4 | Dis-Chem | health & beauty / pharmacy | 88 | 012 656 8974 / 012 656 8975 | 0.9 |
| 5 | PEP Stores | value clothing | 40 | 012 656 0230 | 0.9 |
| 6 | Edgars | fashion (department) | 43 | 010 593 8316 | 0.9 |
| 7 | Mr Price | fashion (value) | 108 | 087 049 3669 | 0.9 |
| 8 | Foschini | fashion | 87 | 012 656 5500 | 0.9 |
| 9 | Nando's | food outlet | 114 | 012 656 1426 | 0.9 |
| 10 | Mugg & Bean | food outlet (café) | 06 | 012 656 8987 | 0.9 |
| 11 | Absa | service retailer (bank) | 96 | 012 656 6437 | 0.9 |
| 12 | Mr Price Home | electronics / household | 109 | 012 656 9607 | 0.9 |

## Per-tenant evidence detail

For **every** tenant in the table:
- **Exact evidence:** name + `store_number` + `phone` as printed on `https://www.mallatreds.co.za/shops/` (official mall directory, tier 1), observed 2026-07-24.
- **Known fields:** `retailer_name`, `branch_name` (`… - Mall@Reds`), `store_number`, `phone`, `mall` (address, Anaprop management), mall-level `trading_hours` (Mon–Fri 09:00–19:00 · Sat 08:00–17:00 · Sun 09:00–17:00 · PH 09:00–16:00).
- **Unknown fields (null, not inferred):** `category` (directory has a category filter but per-store category was not captured this pass), `floor`, `zone`, `website`, `latitude`, `longitude`, per-store `trading_hours`.
- **Contradictions:** none specific. General: aggregator sites often show the mall's main line (012 656 8957) rather than the store's own number — the numbers above are the store-specific ones from the official directory.
- **Recommended DB representation:** **do not insert into `shops` yet** (it would lose provenance and stamp a false `floor='G'` / `09:00–21:00`). Land first in the existing provenance/staging tables (`retail_data_sources` + `mall_source_findings` / `mall_store_locations_staged`, which carry `source_url`, `confidence`, `raw_evidence`), then promote to `shops` — with `floor = NULL`, per-store `phone` captured, `verification_status = official_directory`, `confidence_score = 0.9` — only **after** the minimal additive migration in `mallreds-schema-fit-report.md`.

## Notes
- Store **88** is shared by **Dis-Chem** and **Sunrise Home** in the official directory; both retain `store_number = 88` (canonical IDs suffixed for uniqueness) — not an error, recorded as-is.
- This sample is drawn from the 113-tenant verified subset; a full ~140 directory re-capture is a follow-up.
