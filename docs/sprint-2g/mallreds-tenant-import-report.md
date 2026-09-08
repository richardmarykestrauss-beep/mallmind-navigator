# Mall@Reds Tenant Import — Preview Report (Sprint 2G)

**Status: PREVIEW ONLY. Nothing is imported, ingested, or published. No database is touched.**
This report describes a *reviewable* mapping from the verified register to `public.shops` (after migration `035`). Import execution is a separate, human-gated step this sprint deliberately does not perform.

## Inputs & outputs
- **Source of truth:** [`docs/sprint-2f/mallreds-verified-tenant-register.json`](../sprint-2f/mallreds-verified-tenant-register.json) — 113 tenants, the complete current official directory (confirmed complete in 2G; see the register's `recapture_2g` block).
- **Preview:** [`mallreds-tenant-import-preview.json`](mallreds-tenant-import-preview.json) — 113 deterministic import rows.
- **Validator:** [`scripts/retail/validate-mallreds-tenant-import.mjs`](../../scripts/retail/validate-mallreds-tenant-import.mjs) — re-derives the preview from the register (asserts byte-for-byte match) and runs every invariant. Pure `fs` read/write; **no DB, no network, no Supabase client**.
- **Target:** `public.shops`, and **requires migration** `035_mall_directory_truth_fields.sql` (NOT applied remotely in this sprint).

Regenerate/validate:
```
node scripts/retail/validate-mallreds-tenant-import.mjs --emit   # (re)write preview
node scripts/retail/validate-mallreds-tenant-import.mjs          # validate + invariants
```

## Per-tenant preview shape
Every row carries: `canonical_store_id`, `retailer_name`, `branch_name`, `store_number`, nullable `floor`, nullable `zone`, nullable `phone`, nullable `website`, `branch_status`, `verification_status`, `confidence`, `source_reference` (primary URL + owner + supporting URLs), `observed_at`, `last_verified_at`, `unknown_fields`, and a `proposed_db_mapping` giving the exact `public.shops` column values.

## Proposed `shops` mapping (per row, after migration 035)
| Register field | `shops` column | Value for this dataset |
|---|---|---|
| retailer_name | `name` | e.g. "Pick n Pay" |
| store_number | `store_number` (035) | e.g. "50", "31C", "R65", "Kiosk 6" — verbatim |
| floor | `floor` (035: no 'G' default) | **NULL** (directory publishes no floors) |
| zone | `zone` (035) | **NULL** |
| phone | `phone` (migration 001) | official per-store number, or NULL |
| website | `website` (001) | **NULL** |
| category | `category` (035: now nullable) | **NULL** — not published per-store; **do not invent** |
| branch_status | `branch_status` (035) | `listed_current` |
| verification_status | `verification_status` (035) | `official_directory` |
| confidence_score | `confidence_score` (035) | `0.90` |
| observed_at / last_verified_at | `observed_at` / `last_verified_at` (035) | `2026-07-24` |
| primary_source_url | `primary_source_url` (035) | official directory URL |
| source_owner | `source_owner` (035) | "Mall@Reds / Anaprop Property Management (official)" |
| contradiction_notes | `contradiction_notes` (035) | per-row note or NULL |
| normalized_retailer_name | `normalized_retailer_name` (035) | slug, e.g. "pick-n-pay" |
| (per-store hours unknown) | `opening_time` / `closing_time` (035: no default) | **NULL** |

**`canonical_store_id` has no `shops` column** (`shops.id` is a generated uuid). It is the import's idempotency key only; reconciliation uses the natural key **`(mall_id, store_number, name)`** (store number alone is not unique — see below).

## Honest-unknown handling (nothing invented)
- **floor = NULL** for all 113 (the directory publishes no floors). After 035 there is no `'G'` default, so an omitted floor stays NULL. Routing must **defer/omit** a location for a NULL-floor store — it must never render "Ground Floor" (enforced by `describeShopFloor` and tests).
- **category = NULL** for all 113. The directory has a category *filter* but does **not** expose a machine-readable per-store category in the row DOM, so category is genuinely uncaptured. After 035 `shops.category` is nullable; it must be **captured before promotion** (from the directory's category filter, management, or admin classification) — **never invented**.
- **per-store trading hours = NULL** (only mall-level hours are published). After 035 there is no `09:00`/`21:00` default.

## Shared store numbers (documented, not errors)
Two shop numbers appear on two distinct listings in the official directory; both retain the verbatim number, with a canonical-id suffix for uniqueness:
- **#88** → Dis-Chem (`mallreds-shop-88`) + Sunrise Home (`mallreds-shop-88_2`)
- **#80A** → Clothing Junction (`mallreds-shop-80a`) + Homeware & Tech (`mallreds-shop-80a_2`)

The validator allows a duplicate store number **only** for these documented cases; any other duplicate fails.

## Validation results (all pass)
1. no duplicate canonical store IDs — **113 unique**
2. no duplicate tenant/store-number identity — shared numbers limited to the documented set (88, 80A)
3. all store numbers directly evidenced — `official_directory` + source URL on every row
4. all floors NULL unless directly evidenced — **0** invented floors
5. Game excluded — not in the import; recorded in `excluded_pending`
6. every tenant has provenance — source URL + owner + `observed_at` on every row
7. no product or price records in the import
8. no publication action — preview-only; register `ingestion_status = not_ingested`

## Excluded (unchanged from 2F, re-confirmed in 2G)
- **Game** — not in the current official directory (both `/shops/` and `/shops-v2/`); excluded until a tier-1/2 source confirms current tenancy.
- **Incredible Connection (Shop 61)** — third-party only; not in the complete official directory; excluded-pending.

## Stop
This is the end of the reviewable package. **Do not** apply 035 remotely, insert rows, run the worker, or publish. The next step (a future sprint) is a human-approved import that lands these rows in `shops` (after 035), preserving every NULL as "unknown".
