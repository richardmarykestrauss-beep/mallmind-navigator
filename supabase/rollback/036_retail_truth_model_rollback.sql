-- Sprint 2I rollback — reverses 036_retail_truth_model.sql.
--
-- Additive/relaxing migration → reversible. Run ONLY after confirming nothing depends
-- on the added columns/table, and understanding the caveats. NOT auto-executed.
--
-- CAVEATS:
--   • Restoring publish_verified_observation to the 027 definition removes the rights
--     and branch-claim gates — do that only if you deliberately want the pre-2I behaviour.
--     (This file drops the added columns/table; it does NOT rewrite the function. Re-apply
--     migration 027's function body separately if you truly need the old gate set back.)
--   • `alter column category set not null` will FAIL if any products row now has a NULL
--     category. Resolve those first — never invent a category to satisfy the constraint.
--   • `alter column shop_id/mall_id set not null` on retail_price_observations will FAIL if
--     any row has NULL there (i.e. an online-scoped observation was written). Resolve first.
--   • Dropping retail_source_listings discards captured listing identities; export first.

-- Drop observation indexes + constraints + columns.
drop index if exists public.rpo_source_product_idx;
drop index if exists public.rpo_source_sku_idx;
drop index if exists public.rpo_listing_idx;

alter table public.retail_price_observations
  drop constraint if exists rpo_price_scope_check,
  drop constraint if exists rpo_availability_scope_check,
  drop constraint if exists rpo_price_condition_check,
  drop constraint if exists rpo_branch_confirmed_requires_branch_check,
  drop constraint if exists rpo_min_qty_positive_check,
  drop constraint if exists rpo_bulk_requires_min_qty_check,
  drop constraint if exists rpo_loyalty_requires_label_check,
  drop constraint if exists rpo_standard_no_min_qty_check;

alter table public.retail_price_observations
  drop column if exists listing_id,
  drop column if exists price_scope,
  drop column if exists availability_scope,
  drop column if exists price_condition,
  drop column if exists price_condition_label,
  drop column if exists loyalty_program,
  drop column if exists minimum_quantity,
  drop column if exists promotion_text,
  drop column if exists source_product_id,
  drop column if exists retailer_sku,
  drop column if exists barcode,
  drop column if exists source_url,
  drop column if exists variant,
  drop column if exists pack_size;

-- products additions.
alter table public.products drop constraint if exists products_availability_scope_check;
alter table public.products
  drop column if exists availability_scope,
  drop column if exists price_condition,
  drop column if exists price_condition_label;

-- retail_data_sources additions.
alter table public.retail_data_sources
  drop constraint if exists retail_data_sources_lifecycle_state_check,
  drop constraint if exists retail_data_sources_rights_review_state_check;
alter table public.retail_data_sources
  drop column if exists lifecycle_state,
  drop column if exists rights_review_state,
  drop column if exists commercial_use_allowed,
  drop column if exists storage_allowed,
  drop column if exists image_reuse_allowed,
  drop column if exists description_reuse_allowed;

-- The listing identity table (drops the observations.listing_id FK first via the drop above).
drop table if exists public.retail_source_listings;

-- OPTIONAL — re-impose the old NOT NULLs (each FAILS if any NULL exists; clean first, never invent):
-- alter table public.products alter column category set not null;
-- alter table public.retail_price_observations alter column shop_id set not null;
-- alter table public.retail_price_observations alter column mall_id set not null;
