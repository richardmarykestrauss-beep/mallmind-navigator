-- Sprint 2G rollback — reverses 035_mall_directory_truth_fields.sql.
--
-- Additive/relaxing migration → reversible. Run ONLY after confirming no data or
-- code depends on the added columns, and understanding the caveats below.
-- NOT auto-applied.
--
-- CAVEATS (why this is "safe rollback GUIDANCE", not a blind revert):
--   • Re-adding the OLD defaults/NOT NULL can FAIL or FABRICATE data:
--       - `alter column category set not null` FAILS if any row now has a NULL
--         category (i.e. an honestly-unknown category was written). Resolve those
--         rows first — DO NOT invent a category to satisfy the constraint.
--       - Re-adding DEFAULT 'G' / '09:00' / '21:00' only affects FUTURE inserts;
--         it does NOT retro-fill existing NULLs (good — no fabrication).
--   • Dropping the added columns permanently discards any provenance captured in
--     them. Export first if those rows matter.
--
-- The default posture below DROPS the added columns and index, and DROPS the
-- constraints, but deliberately DOES NOT re-impose the invented-value defaults or
-- category NOT NULL (re-imposing them is the dangerous part). Uncomment the final
-- block only if you have a specific reason and have cleaned up NULLs first.

-- Drop the index and check constraints.
drop index if exists public.shops_mall_store_number_idx;

alter table public.shops drop constraint if exists shops_branch_status_check;
alter table public.shops drop constraint if exists shops_verification_status_check;
alter table public.shops drop constraint if exists shops_confidence_score_check;

-- Drop the added columns.
alter table public.shops
  drop column if exists store_number,
  drop column if exists zone,
  drop column if exists branch_status,
  drop column if exists verification_status,
  drop column if exists confidence_score,
  drop column if exists observed_at,
  drop column if exists last_verified_at,
  drop column if exists primary_source_url,
  drop column if exists source_owner,
  drop column if exists contradiction_notes,
  drop column if exists normalized_retailer_name;

-- OPTIONAL — restore the original (invented-value) defaults/NOT NULL. Leave
-- commented unless you specifically need the pre-035 behaviour back. The
-- `set not null` will FAIL if any shops.category is NULL — clean those first.
-- alter table public.shops alter column floor        set default 'G';
-- alter table public.shops alter column opening_time set default '09:00';
-- alter table public.shops alter column closing_time set default '21:00';
-- alter table public.shops alter column category     set not null;
