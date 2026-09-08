# Retail Pending-Review Staging Bridge — Sprint 2L-B

The staging bridge is the first step that writes a canonical retailer-feed candidate into the
**existing** truth-model tables — but only ever at `review_status='pending'`, behind human
review and the unchanged publication gate. It adds no parallel tables for observations; it
reuses `retail_source_listings` + `retail_price_observations` from migrations 026/036.

## Trust boundary (unchanged, extended by one hop)

```
authorised feed
  → RetailerFeedContractV1 (Sprint 2K/2L-A: validate, dedupe, decimal-safe cents, identity)
  → canonical candidate
  → approved external-location mapping  (ONLY source of internal ids, and only if branch-scoped)
  → stage_retail_feed_observation()     ← NEW: pending DB staging (this sprint)
  → human review                        (existing, out of scope here)
  → publish_verified_observation()      (existing gate, unchanged, unreachable from staging)
```

Staging **never** verifies, approves, publishes, or makes anything shopper-visible.

## Migration 039 (additive, append-only)

`supabase/migrations/039_retail_feed_staging_bridge.sql` adds:

- **`public.retail_external_location_mappings`** — governed external-branch → internal-id map.
  Internal ids (`internal_shop_id`, `internal_mall_id`, `internal_retailer_id`) are set only on
  an `approved` row, which the DB *forces* to carry provenance:
  - `relm_one_approved_per_branch_uidx` — unique partial index: at most one `approved` mapping
    per `(retailer_source_id, external_branch_id)`, so conflicting approved mappings cannot
    silently coexist.
  - `relm_approved_requires_metadata` CHECK — an `approved` row must have `approved_by`,
    `approved_at`, `internal_shop_id`, `internal_mall_id`, `source_reference`,
    `external_branch_id`. "Approved but missing ids/provenance" is structurally impossible.
  - `relm_validity_coherent`, `relm_identity_present` — validity window + identity sanity.
  - RLS enabled with **no** anon/authenticated policy.
- Six additive columns on `retail_price_observations`: `branch_external_id`,
  `feed_content_hash`, `feed_source_row`, `feed_file_name`, `feed_parse_warnings`,
  `staged_actor` (all nullable; only the RPC ever sets `staged_actor`).
- **`public.stage_retail_feed_observation(...)`** — the fail-closed staging RPC (below).

Reverse script: `supabase/rollback/039_retail_feed_staging_bridge_rollback.sql` (not auto-run).

## The staging RPC — fail-closed by construction

`stage_retail_feed_observation(p_actor, p_source_id, …canonical candidate fields…)`:

- **SECURITY DEFINER** with `set search_path = pg_catalog, public`; all objects
  schema-qualified; fully parameterised (no dynamic SQL); `service_role`-only EXECUTE.
- Accepts **no** caller-supplied `verified` / `approved` / `published` / `verified_by` /
  `internal_shop_id` / `internal_mall_id` field — those cannot be injected through the feed.
- **Rights gate** — rejects when the source `legal_status ∈ {reference_only,
  needs_legal_review}` or `rights_review_state ∈ {rejected, expired}`.
- **Validation** — product name, positive integer-cent price, `observed_at`, and a present
  product identity (`source_product_id`/`retailer_sku`/`gtin`) are required, else `rejected`.
- **Mapping resolution** — a branch-scoped candidate resolves internal ids *only* from a
  unique, `approved`, currently-valid, same-retailer mapping. Draft/expired/future/unknown/
  name-only/wrong-retailer all fail closed to `mapping_required` (branch intent, not staged)
  or `retailer_mismatch` — never a guessed id. Online-scoped candidates stage with null ids.
- **Idempotency** — a deterministic identity hash reuses the existing unique-pending-hash
  index. Identical replay → `replayed` (no duplicate); same identity + different content →
  `conflict` (not staged); genuinely new/changed → `staged`.
- **Write** — upserts `retail_source_listings`, inserts `retail_price_observations` at
  `review_status='pending'`, `trust_state='needs_review'`, `verification_method=null`,
  `staged_actor=p_actor`; writes an `admin_audit_log` row. Returns a coded `outcome`.

Outcomes: `staged`, `replayed`, `conflict`, `mapping_required`, `rejected` (+ `mapping_outcome`
detail: `resolved`, `retailer_mismatch`, `mapping_collision`, `mapping_invalid`, `ambiguous`).

## Proven case matrix (real Postgres — `retail-staging-fixture.sql`)

| Case | Scenario | Asserted result |
|------|----------|-----------------|
| C1 | online-national standard | `staged` pending, internal ids **null**, not verified |
| C2 | promotional (was-price) | `staged`, `price_condition='promotional'`, `original_price=89.99` (not flattened) |
| C3 | approved branch mapping | `staged`, `resolved`, internal ids **from the mapping only** |
| C4 | draft mapping | `mapping_required`, not staged |
| C5 / C5b | expired / future mapping | `mapping_required`, not staged |
| C6 | unknown branch code | `mapping_required`, not staged |
| C7 | branch name only, no code | `mapping_required`, `ambiguous` |
| C7b | mapping for a different retailer | `retailer_mismatch` |
| C8 | identical replay of C1 | `replayed`, no duplicate |
| C9 | same item, changed price | `staged` (new observation) |
| C10 | same identity, different content | `conflict`, not staged |
| C11 | `reference_only` source | `rejected` (rights gate) |
| C12 / C13 | negative price / missing identity | `rejected` |
| C14 | leading-zero id `000123` | preserved verbatim (no numeric coercion) |
| C15 | SQL-injection string in a field | stored as **data**; `products` table intact |

Plus constraint proofs (2nd approved mapping rejected; approved-without-ids rejected),
publication-boundary proofs, and security proofs — see the other 2L-B reports.
