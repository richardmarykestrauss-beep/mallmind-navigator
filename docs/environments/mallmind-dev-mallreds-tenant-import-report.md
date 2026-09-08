# mallmind-dev — Mall@Reds Controlled Tenant Import Report (Sprint 2H Gate 2)

**Outcome: 1 Mall@Reds mall row + 113 verified tenant shops imported into mallmind-dev, verified at exact parity with the reviewed preview. Schema/data honest (every unknown NULL). No products. Production untouched.**

| | |
|---|---|
| Target project | **mallmind-dev** |
| Project ref | `iivmrlgntspbkpfqoboi` |
| Production ref (FORBIDDEN, untouched) | `qspsouemjtcdcfnivpnt` |
| Execution timestamp | **2026-07-29 17:57 SAST** |
| Deterministic mall ID | **`78f7e19f-4f14-100e-b151-8f93404beaec`** = `md5('mallmind:mall:mallreds')::uuid` |
| Rows inserted | 1 mall + 113 shops (`shops_inserted = 113`) |

The returned `mall_id` matched the value computed deterministically **before** execution, confirming the reviewed SQL ran verbatim.

## Execution split (credential boundary)
The operator's Supabase auth and the mallmind-dev DB password live only in the operator's terminal; the assistant's sandboxed shell cannot reach the remote DB. So the **operator executed** the reviewed transaction and the verification SQL in their authenticated Dashboard SQL editor (postgres role, which bypasses RLS), and the **assistant** prepared the deterministic artifacts, verified the returned results, and ran all local checks.

## Source artifacts
- **Register:** `docs/sprint-2f/mallreds-verified-tenant-register.json` (113 tenants; complete current official directory)
- **Preview:** `docs/sprint-2g/mallreds-tenant-import-preview.json` (113 deterministic import rows)
- **Generator:** `scripts/retail/generate-mallreds-import-sql.mjs` (pure fs; no DB/network)
- **Transaction:** `docs/sprint-2h/mallreds-tenant-import.sql`
- **Rollback:** `docs/sprint-2h/mallreds-tenant-import-rollback.sql`
- **Verification:** `docs/sprint-2h/mallreds-tenant-import-verify.sql`

## File hashes (SHA-256)
| File | SHA-256 |
|---|---|
| `mallreds-tenant-import.sql` | `606f67c8ed9208ff7d4e0c79305da11a59ff775e4ee0af3fc98fe490fa4c68a2` |
| `mallreds-tenant-import-rollback.sql` | `283763dc911ec5f988379c121bec1f10b147191a52f0f044edb007e24d1d8c40` |
| `mallreds-tenant-import-verify.sql` | `9c070f098d9a48365c8bd71b7e68363a38f25189c1c89110c287a4bf0bc8b0f2` |

## Pre-import counts (Gate 2, read-only)
`malls = 0`, `shops = 0`, `products = 0`, `retail_data_sources = 1`; no Mall@Reds mall row; migration history 000–035 (36).

## Post-import counts (Gate 9, hosted single-row verification)
| Field | Value | Expected |
|---|---|---|
| malls | 1 | 1 |
| malls_by_name | 1 | 1 |
| shops | 113 | 113 |
| products_total | 0 | 0 |
| floor_null | 113 | 113 |
| category_null | 113 | 113 |
| zone_null | 113 | 113 |
| opening_null | 113 | 113 |
| closing_null | 113 | 113 |
| provenance_complete | 113 | 113 |
| distinct_store_numbers | 111 | 111 (88 & 80A shared) |
| game_count | 0 | 0 |
| incredible_count | 0 | 0 |
| shops_rls_enabled | true | true |
| **preview_db_mismatch_count** | **0** | **0** |
| **unexpected_shops_on_mall** | **0** | **0** |

## Unknown-field assertions (honest NULLs, nothing invented)
For all 113 shops: `floor = NULL` (113), `category = NULL` (113), `zone = NULL` (113), `opening_time = NULL` (113), `closing_time = NULL` (113). `unit_number` and `website` are also NULL (verified via the parity check's `unknown_not_null` clause, which contributes to `preview_db_mismatch_count = 0`).

## Provenance completeness
All 113 shops carry `store_number`, `primary_source_url`, `source_owner`, and `observed_at` (`provenance_complete = 113`), with `branch_status = listed_current`, `verification_status = official_directory`, `confidence_score = 0.90`, `observed_at = last_verified_at = 2026-07-24`, source `https://www.mallatreds.co.za/shops/`, owner `Mall@Reds / Anaprop Property Management (official)`.

## Shared store-number cases (documented, not errors)
`distinct_store_numbers = 111` for 113 shops — exactly the two documented shared numbers:
- **#88** → Dis-Chem (`mallreds-shop-88`) + Sunrise Home (`mallreds-shop-88_2`)
- **#80A** → Clothing Junction (`mallreds-shop-80a`) + Homeware & Tech (`mallreds-shop-80a_2`)

Both `_2` rows carry an explicit `contradiction_notes` recording the shared number; the verbatim `store_number` is preserved, never invented.

## Excluded tenants
`game_count = 0`, `incredible_count = 0` — **Game** and **Incredible Connection** are absent (both excluded-pending; not in the complete official directory).

## RLS / policy state
`shops_rls_enabled = true`. The import ran as a role that bypasses RLS (postgres/service_role); no policy was added or changed; only the pre-existing public SELECT policy exists (no anon/authenticated write path). The import inserted no grants and no policies.

## Preview-to-database parity
**`preview_db_mismatch_count = 0`** and **`unexpected_shops_on_mall = 0`** — every imported row matches its source preview exactly, and no shop is attached to the mall that is not one of the 113 expected deterministic ids.

## Products unchanged
`products_total = 0` before and after — **no product or price rows** were created. No route nodes/edges, no publication.

## Rollback readiness
`docs/sprint-2h/mallreds-tenant-import-rollback.sql` (SHA-256 `283763dc…`) is ready and **not executed**. It rebuilds the same 113 deterministic ids, asserts the mall exists once and exactly 113 imported shops exist and all belong to this mall, refuses if any product or any other FK-dependent row references them, deletes only `where mall_id = <mall> and id = any(<113 ids>)`, raises an **exception** (not warning) unless exactly 113 shops then exactly 1 mall are deleted, and is fully atomic.

## Honest audit note
There are **no database triggers** on `public.malls`/`public.shops`, and `admin_audit_log` is written only by application code — so this **direct SQL import generated no `admin_audit_log` row**. The durable record of this change is: this report, the deterministic committed SQL (with hashes), and the migration/data state itself.

## Safety confirmations
- No products ingested; no prices; no offers/publication.
- No durable worker invocation; no Cloud Run change; no `mallmind-backend-dev` change.
- No route graph (`mall_nodes`/`mall_edges`) rows; no mall-map ingestion.
- Migration history untouched (still 000–035); `seed.sql` not run; database not reset.
- Production (`qspsouemjtcdcfnivpnt`) never linked, never referenced; `MALLMIND_ALLOW_PROD` never set.
- No credentials or secret values recorded here.

## Readiness verdict — first lawful retailer-product sample
The Mall@Reds tenant directory is now present and honest in mallmind-dev (1 mall, 113 provenance-bearing shops, every unknown NULL). This is the correct foundation for a **later, separately-gated** first retailer-product sample. That step is **not** started here and must clear its own gate: lawful sourcing (retailer feed / licensed / permitted), the existing provenance + human review + publication path (`retail_data_sources` → observations → `publish_verified_observation`), category capture before any shopper-facing location claim, and no floor/route fabrication. **Schema + tenants: READY. Product acquisition: not begun — awaiting its own approval.**
