# Sprint 3A.5 — Clean-Staging Verification Plan

Status: **Documentation only — this sequence is NOT executed in Sprint 3A.5.** It defines the
controlled, **synthetic-fixture-only** verification an operator runs against the new clean-staging
project **after** migrations `000–041` apply (Gate E of the
[provisioning runbook](sprint-3a5-clean-staging-provisioning-runbook.md)). No live retailer, shopper,
or personal data is used. No shopper-facing product is published.

> Run only after Gates A–D pass and the hard blocklist is green. Every write is a synthetic fixture;
> the disposable-PG fixture `scripts/build-os/retail-staging-fixture.sql` is the reference and can be
> adapted to run against the staging DB URL. Capture redacted evidence (runbook PART 11).

## Preconditions

- Target = the new clean-staging project (ref ∉ {`iivmrlgntspbkpfqoboi`, `qspsouemjtcdcfnivpnt`}).
- Migrations `000–041` applied; `supabase_migrations.schema_migrations` = 42 rows.
- The staging service actor (runbook PART 8) seeded (a `profiles.id`).
- `products` row count recorded **before** (baseline for check 18).

## Verification checks (synthetic fixtures only)

| # | Check | Method (read-only or synthetic) | Expected |
|---|-------|--------------------------------|----------|
| 1 | Migration history `000–041` contiguous | `select version from supabase_migrations.schema_migrations order by version` | 42 contiguous versions, no gaps/dupes |
| 2 | Required tables exist | `to_regclass` on `retail_data_sources`, `retail_source_listings`, `retail_price_observations`, `retail_external_location_mappings`, `retail_intake_jobs`, `retail_intake_job_drafts`, `products`, `malls`, `shops`, `admin_audit_log` | all non-null |
| 3 | Required functions exist | `pg_proc`: `stage_retail_feed_observation`, `publish_verified_observation`, `persist_draft_staging_candidate`, `record_draft_promotion`, `list_promotable_drafts`, durable-intake RPCs | all present |
| 4 | RLS enabled where expected | `pg_class.relrowsecurity` on `retail_external_location_mappings`, `retail_price_observations`, `retail_intake_job_drafts`, retail_* | true |
| 5 | public/anon/authenticated cannot execute privileged staging RPCs | `has_function_privilege` for the 28-arg staging RPC + ledger RPCs | false for all three roles |
| 6 | `service_role` can execute only the intended privileged path | `has_function_privilege('service_role', …)` | true for staging + ledger RPCs |
| 7 | Valid controlled source stages a pending observation | synthetic source (partner_licensed/under_review/active) + `stage_retail_feed_observation(...)` | `staged`, `review_status='pending'`, ids null (online) |
| 8 | Invalid actor fails closed | call with a valid-UUID-but-no-profile actor | RPC raises (admin_audit_log FK) — no row staged |
| 9 | Suspended source fails | source `lifecycle_state='suspended'` | `rejected` |
| 10 | Revoked source fails | `lifecycle_state='revoked'` | `rejected` |
| 11 | Retired source fails | `lifecycle_state='retired'` | `rejected` |
| 12 | Expired rights fail | `rights_review_state='expired'` | `rejected` |
| 13 | Identical replay does not duplicate | stage same identity twice | 2nd → `replayed`, single row |
| 14 | Conflict is reviewable | same identity, different content | `conflict`, both retained, not overwritten |
| 15 | Traceability fields populate | stage with `p_intake_job_id`/`p_intake_draft_ref` | `intake_job_id`/`intake_draft_ref` set on the observation |
| 16 | Legacy 26-argument compatibility | call with the pre-040 26-arg signature | resolves; `staged`; trace fields null |
| 17 | Durable promotion recovery | ledger RPCs: persist candidate → stage → (skip record) → `list_promotable_drafts` returns it → re-stage → `replayed` → record | one observation, no duplicate |
| 18 | `products` receives no write | `products` row count after = before; no staged obs has `published_product_id` | equal / zero shopper writes |
| 19 | Fabricated-price logic not invoked | code review + no scrape-prices path present/called | confirmed absent |
| 20 | No live retailer/personal data used | all fixtures synthetic (`dc000000…`, `da000000…` ids) | confirmed |

## Result

Record a single **GO / NO-GO** for clean staging. **GO** requires checks 1–18 pass, 19–20 confirmed,
and `products` unchanged. Any failure → **NO-GO → abandon + recreate** (runbook PART 10); never repair
the hosted project in place. On GO, the staging project becomes the integration-proof environment for
future sprints (still not production; still gated by the publication boundary, which stays Sprint 3B
for shopper-facing projection integrity).
