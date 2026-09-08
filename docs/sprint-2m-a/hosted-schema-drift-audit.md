# Hosted Schema-Drift Audit — Sprint 2M-A

**Remote diff: NOT PERFORMED — blocked at the linked-project identity gate.** No
`supabase db diff`, no catalog query, and no schema export was run against the target
`qspsouemjtcdcfnivpnt` (local CLI is linked to mallmind-dev; relinking prohibited). No artifact
was written under `artifacts/sprint-2m-a/` because no hosted comparison was produced. See
[hosted-project-identity-audit.md](hosted-project-identity-audit.md).

This document therefore records the **repository pre-039 expected schema baseline** that an
operator linked to the target must diff against, plus the classification rubric to apply so that
platform-managed differences are not mistaken for application drift.

## Repository pre-039 expected schema baseline (migrations `000–038`)

Objects that migration 039 **depends on** and that must already exist, with compatible shape,
on a healthy pre-039 remote. Lineage confirmed from repository migrations:

| Object | Kind | Defined by (repo) |
|--------|------|-------------------|
| `public.retail_data_sources` (+ `legal_status`, `rights_review_state`) | table/cols | 026, 036 |
| `public.retail_source_listings` (unique `(source_id, source_product_id)` partial) | table/idx | 026, 036 |
| `public.retail_price_observations` (+ `observation_hash`, `review_status`, `trust_state`, `verification_method`, `price_scope`, `availability_scope`, `price_condition`, `price_condition_label`, nullable `mall_id`/`shop_id`) | table/cols | 026, 029, 036, 038 |
| `public.publish_verified_observation(...)` | function (gate) | 027, 036 |
| `public.malls(id)`, `public.shops(id)` | tables | early core migrations |
| `public.admin_audit_log(admin_id, action, table_name, row_id, new_values)` | table | core admin migrations |
| `gen_random_uuid()` | extension function (pgcrypto / pg ≥13 core) | platform |
| roles `service_role`, `anon`, `authenticated` | roles | Supabase-managed |

## Objects migration 039 CREATES (should NOT pre-exist on a clean pre-039 remote)

| Object | Kind |
|--------|------|
| `public.retail_external_location_mappings` | table |
| `relm_one_approved_per_branch_uidx` | partial unique index |
| `relm_status_check`, `relm_approved_requires_metadata`, `relm_validity_coherent`, `relm_identity_present` | check constraints |
| `retail_price_observations.{branch_external_id, feed_content_hash, feed_source_row, feed_file_name, feed_parse_warnings, staged_actor}` | 6 nullable columns |
| `public.stage_retail_feed_observation(26 args)` | SECURITY DEFINER function |

If any of these already exists remotely **without** 039 in the migration history → material
drift → `NO-GO`.

## Classification rubric (apply to every remote diff line — do NOT treat all as drift)

| Class | Treatment |
|-------|-----------|
| Expected platform-managed difference (auth/storage/realtime schemas, Supabase roles, extensions) | ignore |
| Harmless formatting / ownership difference | ignore |
| Known repository difference (present because a repo migration created it) | expected |
| Manual hosted drift (object exists with no owning migration) | **review / NO-GO if it collides with 039** |
| Migration-history mismatch | **NO-GO** |
| Security-significant drift (RLS off where expected on, broadened grants, altered publisher) | **NO-GO** |
| Blocking collision (039 object exists pre-039, or incompatible type on a dependency) | **NO-GO** |

Focus the diff on the `public` schema: functions, grants, RLS/policies, indexes, constraints,
columns, and migration history. Because 039 is written with `create … if not exists` /
`create or replace` / `add column if not exists`, it is **re-runnable**, but that must **not**
be used to paper over an unrecorded pre-existing object — that is the drift signal.

## Conclusion

- Repository baseline: **defined and internally consistent** (above).
- Remote drift status vs target: **UNVERIFIED** (identity gate) → contributes to `NO-GO` until an
  operator linked to `qspsouemjtcdcfnivpnt` produces an output-only diff and classifies it here.
