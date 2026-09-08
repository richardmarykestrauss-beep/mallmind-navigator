# Mall@Reds Directory — Schema Design & Fit (Sprint 2G)

Supersedes the *analysis* in `docs/sprint-2f/mallreds-schema-fit-report.md` and records the **implemented** minimal additive correction (`035_mall_directory_truth_fields.sql`). No migration is applied remotely in this sprint.

## Current `shops` shape (verified against migrations)
From `000_baseline_schema.sql` + `001_add_geo_columns.sql` + `009_admin_data_foundation.sql`:
`id, mall_id, name NOT NULL, category NOT NULL, floor text DEFAULT 'G', unit_number text, description, logo_url, opening_time time DEFAULT '09:00', closing_time time DEFAULT '21:00', is_active bool DEFAULT true, created_at, lat double precision, lng double precision, phone text, website text, google_place_id text, deleted_at timestamptz.`

### Correction to the 2F report
The 2F schema-fit report stated `phone`/`website` are **not** on `shops`. **That was wrong** — both were added to `shops` in migration `001` (`lat, lng, phone, website, google_place_id`). So 035 does **not** re-add them; it only surfaces `phone`/`website` on the TypeScript `Shop` type.

## The three invented-value footguns (all corrected by 035)
| Constraint | Why it's a footgun | 035 fix |
|---|---|---|
| `floor text DEFAULT 'G'` | An omitted floor silently becomes a **fabricated Ground-floor claim** | `DROP DEFAULT` — omitted floor stays **NULL** = unknown |
| `category text NOT NULL` | Forces a **made-up category** for tenants whose category isn't published per-store | `DROP NOT NULL` — NULL = unknown |
| `opening_time/closing_time DEFAULT '09:00'/'21:00'` | Omitted hours become **fabricated trading hours** | `DROP DEFAULT` — omitted hours stay NULL |

Existing legitimate values are **preserved** — 035 never runs an `UPDATE` to rewrite data to NULL (respecting "do not rewrite unknown existing data as NULL without evidence").

## Fields added by 035 (all nullable, additive)
`store_number, zone, branch_status, verification_status, confidence_score numeric(3,2), observed_at, last_verified_at, primary_source_url, source_owner, contradiction_notes, normalized_retailer_name`, plus check constraints (`branch_status`, `verification_status`, `confidence_score`), one index `shops(mall_id, store_number)`, and column comments describing evidence semantics. RLS is unchanged (the existing "Anyone can view shops" SELECT policy covers new columns); no new GRANTs; no seed data.

## Normalized-retailer decision — **B: DEFER** (with a lightweight slug)
Assessed A (add a `retailers`/chain table now) vs B (defer to product acquisition) vs C (use an existing source/canonicalization layer).

**Evidence:**
- **No chain entity exists** anywhere in migrations 000–034 (`grep` for `create table … retailers/chains` → none). Retailer identity today is the unnormalized `shops.name`; `retail_data_sources.retailer_name` is free text.
- **No current use case cross-references a chain across malls.** Navigation is per-mall; nothing joins "all Woolworths across malls".
- **No products are acquired this sprint**, which is where a normalized retailer would earn its keep (dedup catalogues across branches).
- The sprint explicitly excludes a **"broad retailer-domain redesign."**

**Decision:** **B — defer** the normalized `retailers` table until product acquisition. To avoid rework later, 035 adds a lightweight `normalized_retailer_name` **slug column** on `shops` (a nod to C — canonicalization without a new entity). This lets a future migration introduce `retailers` + `shops.retailer_id` by grouping on the slug, with **zero** change to already-imported rows.

## Does inserting now lose provenance?
**Not after 035.** The branch row can carry `store_number`, `phone`, `verification_status`, `confidence_score`, `primary_source_url`, `source_owner`, `observed_at`, `last_verified_at`, `contradiction_notes`. Before 035, a raw `shops` insert would strip all of that and stamp a false `floor='G'` / `09:00–21:00`. The provenance/staging tables (`retail_data_sources`, `mall_store_locations_staged`) remain available as the review layer; 035 makes the **promoted** `shops` row honest.

## Application impact (see also the import report)
- The frontend `Shop` type was already `floor/category/unit_number: string | null`; 035's new columns were added to the type as nullable. Routing is already NULL-tolerant (funnels through `normalizeFloorLabel`, geometry-only).
- Shopper-facing floor text now uses `describeShopFloor()` → unknown reads **"Floor not yet verified"**, never "Ground Floor" or the literal `"null"` (two real defects fixed in `NavigateScreen.tsx`).

## Rollback
See `supabase/rollback/035_mall_directory_truth_fields_rollback.sql`. It drops the added columns/index/constraints and, by default, does **not** re-impose the invented-value defaults (re-adding `category NOT NULL` would fail if any honest NULL category exists — clean those first, never invent).
