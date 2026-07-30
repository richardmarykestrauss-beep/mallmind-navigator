-- Sprint 2I rollback — reverses 038_products_price_scope.sql. NOT auto-executed.
--
-- ORDER MATTERS. The migration-038 publish_verified_observation INSERTs/UPDATEs
-- products.price_scope, so you must FIRST restore the migration-036 function body
-- (which does not reference price_scope) — otherwise the next publish call fails at
-- runtime after the column is dropped. Re-apply the CREATE OR REPLACE function block
-- from supabase/migrations/036_retail_truth_model.sql, THEN run the drops below.
--
-- (This file follows the established rollback pattern: it drops the added column/
-- constraint and DOCUMENTS the function-restore step rather than duplicating ~130 lines
-- of function body. A full rollback = restore 036's function, then run this.)

alter table public.products drop constraint if exists products_price_scope_check;
alter table public.products drop column if exists price_scope;
