-- Sprint 2E rollback — reverses 034_retail_intake_durable_rpcs.sql.
-- Additive migration → reversible. NOT auto-applied. Run only after confirming
-- no worker depends on these RPCs. (Dropping the columns is optional: they are
-- additive and harmless; drop them only if a full revert is required.)

drop function if exists public.intake_job_reconciliation(uuid);
drop function if exists public.fail_intake_job(uuid, text, bigint, text, text);
drop function if exists public.finalize_intake_job(uuid, text, bigint, text);
drop function if exists public.claim_intake_job(uuid, text, integer);
drop function if exists public.create_intake_job(uuid, text, text, text, text, text, integer, bigint, integer, integer, boolean, text, boolean);

drop index if exists public.retail_intake_jobs_identity_idx;

-- Restore 033's commit_intake_chunk (drops the durable product-index insert).
-- Re-apply the function body from supabase/migrations/033_retail_intake_durable.sql
-- BEFORE dropping the table below, otherwise the live worker commits will fail:
--   \i supabase/migrations/033_retail_intake_durable.sql  -- (idempotent; re-creates 033's version)
-- Then, only once no worker is running:
-- drop table if exists public.retail_intake_product_index;
-- drop table if exists public.retail_intake_job_drafts;
--
-- Rolling back the product index costs cross-chunk conflict detection on resumed
-- jobs; drafts still stage and review still gates, so no unreviewed data escapes.

-- Optional full revert of the additive columns:
-- alter table public.retail_intake_jobs drop column if exists trace_id;
-- alter table public.retail_intake_jobs drop column if exists is_fixture;
