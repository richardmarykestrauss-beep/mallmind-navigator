-- Sprint 2I (follow-on) — migration 037: products.price_condition CHECK constraint.
--
-- Forward-only correction. Migration 036 added public.products.price_condition and a
-- CHECK for products.availability_scope, but NOT a CHECK for price_condition — leaving
-- that column unconstrained free text while the observation column
-- (retail_price_observations.price_condition) is CHECK-guarded. This migration adds ONLY
-- the missing constraint so the projected product column carries the same vocabulary.
--
-- Safety: additive constraint only. NULL is allowed (an unprojected price_condition is
-- honestly NULL). No INSERT/UPDATE/DELETE of data — existing NULLs are preserved. No RLS
-- policy change, no GRANT change, no other object touched. Migration 036 is NOT edited or
-- reapplied. NOT auto-applied to any hosted project — see the rollback file.

do $$ begin
  alter table public.products
    add constraint products_price_condition_check
    check (price_condition is null or price_condition in
      ('standard','loyalty','promotional','bulk','bundle','online_only','unknown'));
exception when duplicate_object then null; end $$;

comment on constraint products_price_condition_check on public.products is
  'price_condition, when present, must be one of the truth-model conditions '
  '(standard|loyalty|promotional|bulk|bundle|online_only|unknown). NULL is allowed = not projected.';
