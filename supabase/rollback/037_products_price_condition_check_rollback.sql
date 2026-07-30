-- Sprint 2I rollback — reverses 037_products_price_condition_check.sql.
-- Drops only the added constraint. No data change. NOT auto-executed.
alter table public.products drop constraint if exists products_price_condition_check;
