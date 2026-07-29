# mallmind-dev — Migration 035 Application Report (Sprint 2H, Gate 1)

**Outcome: `035_mall_directory_truth_fields.sql` applied to mallmind-dev and verified. Schema-only change. No tenant imported. Production untouched.**

| | |
|---|---|
| Target project | **mallmind-dev** |
| Project ref | `iivmrlgntspbkpfqoboi` |
| Production ref (FORBIDDEN, untouched) | `qspsouemjtcdcfnivpnt` |
| Migration applied | `supabase/migrations/035_mall_directory_truth_fields.sql` |
| Date applied | 2026-07-29 |
| Migrations after apply | local **000–035**, remote **000–035**, **36/36 matched** |

## Execution split (honest attribution)
The operator's Supabase CLI login and the mallmind-dev DB password live in the operator's interactive terminal and are **not** reachable from this assistant's sandboxed shell. To keep the credential boundary intact, remote steps were run **by the operator** in the authenticated terminal using commands/SQL prepared here; the assistant **verified** every result and ran all **local** checks.

- **Operator-executed (authenticated terminal):** Gate 2 `migration list`, Gate 3 `db push --dry-run`, Gate 4 `db push` (apply), Gate 5 `migration list` (parity), Gate 6 read-only hosted SQL.
- **Assistant-executed (local):** Gate 1 repo/target guard, Gate 7 `verify:db` / `verify:all`, this report, the commit/push.

## Gate 1 — Repository & target verification (assistant, local)
Branch `chore/mallmind-dev-apply-migration-035` off latest `origin/claude-premium-nav-test` (`3b39ffa`); tree clean; `035` present; nothing after 035; local migration count **36**; repo Supabase link resolves to `iivmrlgntspbkpfqoboi`; dev target guard passed (`target=dev ref=iivm********`); `MALLMIND_ALLOW_PROD` unset; no production ref in any executed command. (Auth was initially absent in the assistant shell; the operator confirmed CLI auth before Gate 2.)

## Gate 3 — Dry run (operator)
`npx supabase db push --dry-run` against the linked dev project proposed **only** `035_mall_directory_truth_fields.sql` as pending — no seed, no reset, no other migration. (Confirmed by the operator; the subsequent apply + 36/36 parity corroborate that only 035 landed.)

## Gate 4 — Apply (operator)
`npx supabase db push` completed successfully; `035_mall_directory_truth_fields.sql` applied to mallmind-dev. No auto-retry. No seed. No reset.

## Gate 5 — Migration history parity (operator)
`npx supabase migration list` → local **000–035**, remote **000–035**, **all 36 versions matched**; no missing local or remote version; no divergence; no `migration repair` used.

## Gate 6 — Hosted schema contract verification (operator-run SQL, assistant-verified)
Read-only catalog + count queries against mallmind-dev. All results match the required post-migration contract:

**Invented-value defaults removed / unknown representable**
| Column | Nullable | Default | Verdict |
|---|---|---|---|
| `floor` | YES | NULL | ✅ default `'G'` removed |
| `category` | YES | NULL | ✅ NOT NULL relaxed, no invented default |
| `opening_time` | YES | NULL | ✅ default `'09:00'` removed |
| `closing_time` | YES | NULL | ✅ default `'21:00'` removed |

**New 035 columns** — all **11** present, all nullable, `confidence_score` = **numeric(3,2)**:
`store_number, zone, branch_status, verification_status, confidence_score, observed_at, last_verified_at, primary_source_url, source_owner, contradiction_notes, normalized_retailer_name`.

**Constraints** (3): `shops_branch_status_check`, `shops_confidence_score_check`, `shops_verification_status_check`.
**Index** (1): `shops_mall_store_number_idx` — btree on `(mall_id, store_number)`.
**Comments**: `commented_columns = 15` (all migration-defined column comments present).

**RLS & policies**
- RLS on `public.shops`: `rls_enabled = true` (`rls_forced = false`, unchanged baseline).
- Policies: **only** `"Anyone can view shops"` — `SELECT`, role `public`, `qual = true`. **No** INSERT/UPDATE/DELETE policy exists → anon/authenticated writes remain blocked by RLS.

**Grants (honest caveat):** the post-state grant listing shows the pre-existing table-level grants for `anon/authenticated/postgres/service_role`; migration 035 contains **no `GRANT` statements** (verified in the migration source), so no broad grant was introduced. Noted honestly: the post-migration grant query alone is a point-in-time snapshot and does not by itself constitute an independent pre/post diff — the "no new grant" conclusion rests on the migration source containing no GRANT plus RLS remaining enabled with no write policy.

**Row counts (schema-only proof)**
| Table | Count | Note |
|---|---|---|
| `shops` | **0** | no tenant rows created; 0 rows ⇒ none rewritten |
| `malls` | **0** | unchanged |
| `products` | **0** | no product data |
| `retail_data_sources` | **1** | unchanged |

Because `shops` held **0** rows before and after, no existing shop row could have been rewritten by the default/nullability changes.

## Gate 7 — Application safety verification (assistant, local)
Run against the **disposable local** stack / build — independent of mallmind-dev.
- `verify:db` → **PASS** — `migrations=36 | tables=53 | functions=44 | policies=24` (recorded earlier in this session on identical code; includes the 035 column/default/nullability assertions).
- `verify:all` → **PASS 13/13**, including the **Mall@Reds tenant-import validation** step.

**Warning (local infrastructure only):** a later re-run of `verify:db` in the same session could not start the disposable local Supabase stack (`analytics/storage/pg_meta/studio` containers reported *unhealthy* during `supabase start`, before any migration/contract assertion runs). This is a local Docker health flake unrelated to migration 035 or mallmind-dev — the same `verify:db` passed cleanly earlier in the session on the identical commit, and the hosted mallmind-dev contract (Gate 6) is verified directly. No code changed between the passing and failing runs.

## Safety confirmations
- **Only migration 035 was applied** (dry-run proposed only 035; 36/36 parity confirms no other migration landed).
- **No tenant import ran** — `shops = 0`; the 113-tenant preview remains preview-only.
- **No product data acquired** — `products = 0`.
- **No worker invocation, no Cloud Run change, no mallmind-backend-dev change.**
- **`seed.sql` was not run; the database was not reset; migration history was not repaired.**
- **Production (`qspsouemjtcdcfnivpnt`) was untouched** — never linked, never referenced in any command, `MALLMIND_ALLOW_PROD` never set.
- **No credentials or secret values are recorded in this report.**

## Readiness verdict — separate tenant-import gate
mallmind-dev now carries the `shops` truth-field schema (035) required to import the 113 verified Mall@Reds tenants **honestly** (nullable floor/category/hours, provenance columns, constraints). The schema side is **READY**. The tenant import remains a **separate, human-gated** step and did **not** occur here. Before that import gate: confirm the import still validates (`npm run test:mallreds-import`), decide category-capture handling (category stays NULL until evidenced), and run the insert under its own approval — landing every unknown as NULL, never invented.
