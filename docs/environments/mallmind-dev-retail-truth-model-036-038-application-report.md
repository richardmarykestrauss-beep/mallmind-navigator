# mallmind-dev — Retail Truth-Model Migrations 036–038 Application Report (Sprint 2I)

**Outcome: migrations 036, 037, 038 applied to mallmind-dev and hosted-verified. Schema-only — no products, listings, or observations inserted. Rights defaults conservative. Production untouched.**

| | |
|---|---|
| Target project | **mallmind-dev** |
| Project ref | `iivmrlgntspbkpfqoboi` |
| Production ref (FORBIDDEN, untouched) | `qspsouemjtcdcfnivpnt` |
| Migrations applied | `036_retail_truth_model.sql`, `037_products_price_condition_check.sql`, `038_products_price_scope.sql` |
| Branch | `feat/retail-truth-model-036` |

## Execution split (credential boundary)
The operator's Supabase auth and the mallmind-dev DB password live only in the operator's terminal; the assistant's sandboxed shell cannot reach the remote DB. So the **operator** ran `db push` (apply) and the read-only hosted verification SQL in their authenticated session; the **assistant** authored the deterministic migrations, verified the returned results, and ran all local checks.

## Application sequence
- **036 → mallmind-dev** — applied earlier (Sprint 2J), taking remote from 035 → 036.
- **037 + 038 → mallmind-dev** — applied together via `npx supabase db push` after a dry-run proposed exactly `037_products_price_condition_check.sql` then `038_products_price_scope.sql` (no seed, no reset). No auto-retry.
- Exact per-migration server timestamps were not separately captured beyond the migration-history versions below; parity (000–038 matched) is the authority for what landed.

## Migration parity (Gate 5)
Local **000–038** and remote **000–038** — **39/39 matched**, `last_migration = 038`, no missing/divergent version, no `migration repair` used.

## Hosted Gate 6 verification (operator-run SQL, assistant-verified)
| Check | Result |
|---|---|
| migrations | **39** |
| last_migration | **038** |
| `products.price_scope` column | **exists**, **nullable** |
| `products_price_condition_check` constraint | **exists** (037) |
| `products_price_scope_check` constraint | **exists** (038) |
| `publish_verified_observation` contains price_scope projection | **yes** (038) |
| products | **0** |
| retail_source_listings | **0** |
| retail_price_observations | **0** |

## Confirmations
- **Schema-only (036/037/038):** all three are additive/relaxing DDL + one function `CREATE OR REPLACE`. **No** `INSERT`/`UPDATE`/`DELETE` of data. Row counts prove it: products/listings/observations all **0** after apply.
- **No products, listings, or observations were inserted** — confirmed `0 / 0 / 0`.
- **Rights defaults remained conservative** — 036 backfilled every existing `retail_data_sources` row to `lifecycle_state='discovered'` + `rights_review_state='unreviewed'` (tri-state rights booleans left NULL = undetermined); nothing was auto-promoted to `active`/`approved`. The publisher's fail-closed rights gate therefore blocks publication until a human sets rights explicitly.
- **Nullability as designed** — `retail_price_observations.shop_id` and `mall_id` are **nullable**; `public.products.category` is **nullable**; `retail_price_observations.category` was already nullable. (An online-national fact is never forced to claim a branch; an unknown category is never invented.)
- **Price checks exist** — `products_price_condition_check` (037) and `products_price_scope_check` (038) both present on `public.products`, matching the observation vocabulary; both allow NULL.
- **price_scope projects verbatim into products** — `publish_verified_observation` copies `obs.price_scope` into `products.price_scope` in INSERT/UPDATE/audit with no `COALESCE`/invented default (an unknown scope stays `unknown`). Confirmed in the hosted function body and by the local fixture (CASE 12).

## Honest note — post-apply pg-delta / certificate cache warning
After a **successful** `db push`, the Supabase CLI can emit a post-push cache / pg-delta (certificate/schema-cache) warning. This warning is **not** evidence of failure: it occurs *after* the migration statements have committed. The authority for what actually landed is the migration-history parity (000–038 matched, `last_migration=038`) plus the direct hosted schema checks above — all of which are green. No retry or repair was performed on the strength of the warning; success was confirmed by direct verification instead.

## Local verification (assistant, disposable stack — independent of mallmind-dev)
- `verify:db` → **PASS** — `migrations=39 | tables=54 | functions=44 | policies=24`; retail truth-model fixture **ALL 13 CASES PASSED** (incl. CASE 12 price_scope projected verbatim, CASE 13 price_scope CHECK rejects invalid).
- `verify:all` → **PASS** — 14/14.

## Production
Production (`qspsouemjtcdcfnivpnt`) was **never linked, never referenced** in any command; `MALLMIND_ALLOW_PROD` was never set; no `seed.sql`, no reset, no history repair. All work targeted mallmind-dev only. No credentials or secret values are recorded here.

## Readiness verdict — ten-product fixture slice
mallmind-dev now carries the complete retail truth-model schema (scope, rights, price conditions, listing identity, honest nullability) with **zero** retail data. This is the correct, honest foundation for the ten-product vertical slice. That slice remains a **separate, gated** step and has **not** begun: it needs a lawful, rights-`approved` source (the publisher blocks otherwise), evidence-preserving acquisition through the existing durable worker, human review, and truthfully-scoped publication (online facts never rendered as branch stock). **Schema: READY. Source acquisition + publication: not begun — awaiting an approved source.**
