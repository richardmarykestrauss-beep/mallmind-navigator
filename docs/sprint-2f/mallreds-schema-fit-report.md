# Mall@Reds Tenant Directory — Schema-Fit Report

**Question:** can the current committed schema (migrations 000–034) honestly store this real tenant directory with provenance? **Answer: partially — a small additive migration is required to avoid losing provenance and to represent unknown floor/status honestly.** No migration is created in this sprint (per the stop gate); this report is the exact gap.

## Existing contracts (verbatim, migration 000)

**`public.malls`** (+ `001` geo additions): `id`, `name`, `city NOT NULL`, `province NOT NULL`, `address`, `latitude numeric(10,8)`, `longitude numeric(11,8)`, `total_floors`, `total_shops`, `is_active`, `created_at`; `001` adds `lat`, `lng`, `address`, `phone`, `website`, `google_place_id`, `rating`. → Mall-level identity, coordinates, phone, website are supported.

**`public.shops`**: `id`, `mall_id → malls(id)`, `name NOT NULL`, `category NOT NULL`, `floor text DEFAULT 'G'`, `unit_number text`, `description`, `logo_url`, `opening_time time DEFAULT '09:00'`, `closing_time time DEFAULT '21:00'`, `is_active boolean DEFAULT true`, `created_at`.

**Provenance/staging tables** (already present): `retail_data_sources` (026 — `source_type`, `name`, `retailer_name`, `mall_id`, `shop_id`, `base_trust`, `legal_status`, `is_active`), `mall_source_findings` (012 — `raw_snippet`, `confidence`, `status`, nullable `shop_id`/`product_id`), `mall_store_locations_staged` (013 — `raw_evidence`, `confidence`, `extraction_method`, `source_url`, `google_places_verified`).

## Can it represent `retailer → branch → mall`?

- **mall** → `malls` ✓
- **branch** → `shops` (one row = one branch in one mall) ✓
- **retailer (chain)** → **NOT modelled.** There is no retailer/chain entity; retailer identity is only the unnormalized `shops.name`. `retail_data_sources.retailer_name` is a free-text label, not a normalized chain. → **Gap** (acceptable short-term; a Woolworths chain is implied by `shops.name`).

## Field-by-field fit vs the register

| Register field | shops column | Verdict |
|---|---|---|
| retailer_name / branch_name | `name` | ✓ |
| store_number | `unit_number` (text) | ⚠️ usable, but semantically "unit" not "shop number" |
| floor | `floor text DEFAULT 'G'` | ❌ **footgun** — default `'G'` silently invents a floor. Must insert `floor = NULL` explicitly to keep "unknown". No honest unknown by default. |
| zone | — | ❌ not supported |
| phone | — | ❌ **not on `shops`** (only on `malls`). The official directory's per-store phones have nowhere to live. |
| website | — | ❌ not on `shops` |
| latitude / longitude | — | ❌ not on `shops` (only `malls`) |
| trading_hours | `opening_time`/`closing_time` (defaults 09:00/21:00) | ⚠️ per-store hours are unknown; defaults would invent hours. Insert NULL. |
| branch_status (operating / temp-closed / former / unknown) | `is_active boolean` | ❌ boolean can't express temporarily-closed / former / unknown |
| verification_status | — | ❌ not on `shops` |
| confidence_score | — | ❌ not on `shops` |
| primary_source_url / observed_at / last_verified_at | — | ❌ not on `shops` (can live in `retail_data_sources` / `mall_source_findings`) |

## Would inserting real tenants NOW lose provenance?

**Yes, if inserted directly into `shops`.** `shops` carries no source URL, verification status, confidence, observed_at, or per-store phone — so a raw insert would strip exactly the evidence that makes this dataset trustworthy, and would silently stamp `floor='G'` and `09:00–21:00` hours that are **not** proven. Provenance *can* be preserved by first landing the register in `retail_data_sources` + `mall_source_findings`/`mall_store_locations_staged` (which do have `source_url`, `confidence`, `raw_evidence`) and only promoting to `shops` after review.

## Exact schema gap / recommended minimal migration (NOT created here)

To store this directory honestly and keep provenance on the branch record, an **additive** migration would add to `shops`:
- `store_number text` (or formally adopt `unit_number` as the shop number)
- `phone text`, `website text`
- `branch_status text CHECK (branch_status in ('operating','temporarily_closed','former','unknown')) DEFAULT 'unknown'`
- `verification_status text`, `confidence_score numeric(3,2)`
- `primary_source_url text`, `source_owner text`, `observed_at timestamptz`, `last_verified_at timestamptz`
- and change/relax the `floor`/`opening_time`/`closing_time` **defaults** so "unknown" is representable without inventing `'G'` / `09:00–21:00` (e.g. drop the defaults, allow NULL).

Optionally a normalized `retailers` (chain) table + `shops.retailer_id` for reuse across malls (deferred; matches the Sprint-2F gap register `SCHEMA-01`).

**Decision:** a minimal additive migration **is required** before an honest, provenance-preserving insert. Until then, land the register in the existing provenance/staging tables, not directly in `shops`. Per the sprint stop gate, **no migration and no insert are performed now.**
