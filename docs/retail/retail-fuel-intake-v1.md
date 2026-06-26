# Retail Fuel Intake Pipeline V1 (Sprint 20A.9)

**Status:** implemented on `assistant-20a9-retail-fuel-intake-v1`. **Migration 029 not applied; nothing deployed or merged.**

## Purpose

Turn the script-only retail CSV importer into a secure, reusable, **API-backed**
intake pipeline. An authenticated MallMind admin can submit structured retail CSV
data, **validate and preview it without writes** (`dry_run`), then **stage** an
approved import (`apply`) into the existing retail provenance tables. This
*extends* the Sprint 19C/20A.8 system — it is not a parallel architecture.

## Architecture

```
POST /admin/retail-observations/import-csv   (admin bearer auth, both modes)
  → runCsvImport (services/retailCsvImportService.ts)
      → zod request validation
      → intakeRetailCsv (services/retail/retailCsvIntake.ts, PURE)
          parse · validate · sanitise · normalise · hash · in-file dedup · downgrade
      → dry_run: return summary (NO writes)
      → apply:   validate mall/shop refs → stage_retail_csv_import RPC (atomic)
                   source reuse · snapshot reuse · batch · hash dedup · pending observations · audit
  → review queue (existing) → publish_verified_observation (20A.8) → products
```

- **Pure core** `retailCsvIntake.ts` — no Supabase/env/network/fs/Express; only
  `node:crypto` for deterministic hashing. Shared by the API **and** the CLI
  (`scripts/retail/import-csv-staging.mjs`), so validation lives in one place.
- **Service** `retailCsvImportService.ts` — DB glue, returns `{httpStatus, payload}` (unit-tested with a mocked Supabase).
- **RPC** `stage_retail_csv_import` (migration 029) — atomic staging.

## API contract

`POST /admin/retail-observations/import-csv` — `Authorization: Bearer <admin token>`.

Request:
```json
{
  "mode": "dry_run" | "apply",
  "file_name": "woolworths-june-2026.csv",
  "csv_text": "mall_id,shop_id,product_name,...",
  "source": {
    "source_type": "retailer_submission",
    "name": "Woolworths June Catalogue",
    "retailer_name": "Woolworths",
    "legal_status": "retailer_supplied",
    "base_trust": 0.95,
    "license_note": "Submitted directly by retailer",
    "attribution_required": false
  }
}
```
Validation (zod): `mode` enum; non-empty `file_name` (≤255); non-empty `csv_text`
(≤900 KB, below the 1 MB JSON body limit); `source.source_type` and
`legal_status` are the migration-026 enums; `base_trust` 0–1; optional
`retailer_name`, `license_note`, `attribution_required`, `shop_id`.

## CSV schema

Required headers: `mall_id, shop_id, product_name, brand, model, category, price,
original_price, is_on_special, special_description, in_stock, trust_state,
verification_method, valid_to, source_note`.
Optional: `product_id, observed_at, valid_from, confidence`.

Required per row: `mall_id` (UUID), `shop_id` (UUID), `product_name`, non-negative
`price`. Validated: numeric prices; booleans; `confidence` 0–1; timestamps;
allowed `trust_state`/`verification_method`; original/special-price consistency
(warnings); blank rows skipped; duplicate headers and missing required headers are
**structural** errors; in-file duplicate rows; formula-injection sanitisation;
excess columns (warning). A malformed data row is reported with its CSV line
number and does **not** fail the whole file — only an unreadable structure does.

## Dry-run example

```json
{
  "ok": true, "mode": "dry_run", "file_name": "woolworths-june-2026.csv",
  "file_sha256": "…", "total_rows": 20, "valid_rows": 17, "blocked_rows": 3,
  "duplicate_rows_in_file": 1, "category_counts": { "televisions": 5 },
  "warnings": [], "rows_truncated": false,
  "rows": [{ "row_number": 2, "status": "valid", "observation_hash": "…", "duplicate_in_file": false, "warnings": [], "blockers": [] }]
}
```
No DB writes occur. Per-row detail is capped at 200 rows (`rows_truncated`).

## Apply example

```json
{
  "ok": true, "mode": "apply",
  "source_id": "…", "snapshot_id": "…", "batch_id": "…",
  "total_rows": 20, "valid_rows": 17, "staged_rows": 15,
  "skipped_existing_hashes": 2, "blocked_rows": 3,
  "reused_source": false, "reused_snapshot": false,
  "review_status": "pending",
  "next_step": "Review staged observations before publication."
}
```

## Trust and verification restrictions

CSV is **untrusted bulk intake evidence, never verification authority**:
- every staged row is `review_status = 'pending'`;
- a row that declares a **verified-tier** `trust_state` with a non-evidence method
  (`csv_manual`, `user_submission`, none) is **downgraded to `needs_review`** with
  a documented warning;
- a verified-tier declaration with an evidence method is kept but flagged with a
  caution (the CSV is bulk evidence, not per-row proof);
- `csv_manual` can never verify a product;
- the endpoint never publishes to `products`, never calls
  `publish_verified_observation`, never auto-approves. Publication still requires
  admin review **and** the Sprint 20A.8 verification policy.

## Source and snapshot reuse

The RPC **reuses** an existing source matching `source_type + name + retailer_name
+ mall_id + legal_status` that is `is_active` and not `needs_legal_review`/
`reference_only`; otherwise it creates one. Inactive/legally-incompatible sources
are never reused. The evidence snapshot is reused by the existing
`(source_id, content_sha256)` uniqueness; otherwise created. A repeated identical
file therefore reuses source + snapshot and stages 0 new rows.

## Deduplication

`observation_hash` = sha256 of `mall_id|shop_id|name|brand|model|category|price|
original_price|valid_to` (identical to the legacy importer — existing rows
de-duplicate correctly). Dedup happens **within the file** (pure core) and
**against existing observations** (RPC). Counts are honest: `staged_rows` +
`skipped_existing_hashes`.

## Failure behaviour

Apply is **atomic**: `stage_retail_csv_import` runs in one transaction — source
reuse/create, snapshot, batch, dedup, observation inserts and audit either all
commit or all roll back. A controlled validation failure (bad request, no valid
rows, unknown mall/shop) returns a 4xx **before** any write, so no partial batch
is created. An unexpected DB error rolls back atomically and returns a safe 500;
a genuinely-missing RPC/column returns 503 ("pending a database update"). This
removes the old script's orphan-record risk. *(There is intentionally no
persisted `failed` batch: full atomicity means a failed apply leaves no batch at
all, which is safer than a partial one.)*

## Admin review flow

Staged rows land in the existing review queue
(`GET /admin/retail-observations`, `…/:id/review`) as `pending`. An admin
approves with evidence; publication goes through the 20A.8 verification policy +
`publish_verified_observation`.

## Security model

- Admin bearer auth (`profiles.is_admin`) required for **both** dry_run and apply
  (catalogue data may be confidential).
- Service-role key stays server-side; the RPC is `SECURITY DEFINER`, locked
  `search_path`, `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated`, granted to
  `service_role` only; existing RLS posture preserved.
- Raw CSV is never logged or echoed; DB internals are never leaked (safe generic
  errors). No remote URL fetching, no filesystem paths from input, no formula
  execution (formulas neutralised), no image copying, no direct product
  verification/publication, no auto-approval, no silent trust elevation.

## Limits

JSON body ≤ 1 MB; `csv_text` ≤ 900 KB; per-row response detail capped at 200 rows;
one mall per import (mixed shops within that mall are supported).

## Future enhancements

Multipart uploads · Supabase Storage evidence files · retailer self-service
portal · scheduled feeds · API connectors · affiliate-feed connectors ·
catalogue-PDF extraction.
