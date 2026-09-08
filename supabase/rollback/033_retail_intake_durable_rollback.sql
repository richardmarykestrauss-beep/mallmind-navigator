-- Sprint 2D rollback — reverses 033_retail_intake_durable.sql.
--
-- Additive migration → fully reversible. Run ONLY after confirming no other
-- object depends on these tables/functions. NOT auto-applied.

drop function if exists public.commit_intake_chunk(uuid, text, bigint, jsonb);
drop function if exists public.renew_intake_lease(uuid, text, integer, bigint);
drop function if exists public.claim_next_intake_job(text, integer);
drop function if exists public.set_intake_job_control(uuid, text);

drop table if exists public.retail_intake_dedup_keys;
drop table if exists public.retail_intake_events;
drop table if exists public.retail_intake_quarantine;
drop table if exists public.retail_intake_checkpoints;
drop table if exists public.retail_intake_job_chunks;
drop table if exists public.retail_intake_worker_leases;
drop table if exists public.retail_intake_jobs;

drop type if exists public.retail_intake_error_class;
drop type if exists public.retail_intake_status;
