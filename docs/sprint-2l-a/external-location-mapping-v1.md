# ExternalRetailLocationMappingV1 — Governed External Branch Mapping

**Version 1.0.0 · Sprint 2L-A · local contract + resolver only. No hosted rows, no migration, no publication.**

## Purpose
Resolve an **external** retailer branch reference (code or name) to **internal** MallMind entities — but only when a unique, approved, currently-valid, unambiguous, provenance-bearing mapping for the **same retailer** exists. It exists so that a feed's external branch code can *never* mint an internal id on its own.

## Truth boundary (the whole point)
A feed row may carry an external branch code or name. That fact alone must **never** produce an internal MallMind branch/shop/mall id or a branch-confirmed shopper publication. Without one unique, approved, currently-valid mapping: retain the external branch info, keep internal ids **null**, emit the correct warning/quarantine, and prevent branch-confirmed status. A mapping proves **identity alignment only** — never current stock, current price, product availability, retailer permission, or shopper-publication eligibility.

## Record shape
`mapping_id`, `mapping_version`, `retailer_source_id`, `external_branch_id`, `external_branch_name`, `external_mall_id`, `external_mall_name`, `internal_retailer_id`, `internal_shop_id`, `internal_mall_id`, `status`, `match_method`, `approved_by`, `approved_at`, `valid_from`, `valid_until`, `source_reference`, `notes`, `created_at`, `updated_at`. Nullable where facts are unknown.

## Statuses
`draft` · `pending_review` · `approved` · `rejected` · `expired` · `superseded`.

## Eligibility (a mapping may be USED only when)
1. `status = approved`; 2. currently within its validity period; 3. `retailer_source_id` matches the feed; 4. external branch identity matches **deterministically** (by `external_branch_id`); 5. not superseded; 6. no collision/ambiguity; 7. required internal ids present (`internal_shop_id` + `internal_mall_id`); 8. provenance present (`source_reference`).

It must **not** be used when it is draft, pending, rejected, expired, superseded, outside validity, missing approval/provenance/internal-ids, ambiguous, colliding, or for a different retailer.

## Resolver outcomes (stable codes)
`resolved` · `unmapped` · `ambiguous` · `mapping_unapproved` · `mapping_expired` · `mapping_not_yet_valid` · `mapping_rejected` · `mapping_superseded` · `mapping_collision` · `retailer_mismatch` · `invalid_mapping`.

- **Deterministic id match only.** Resolution requires an `external_branch_id` match. **Name-only** lookups never resolve — any name match returns `ambiguous` (a name is not a deterministic identity). The resolver **never silently picks the first** of several candidates.
- **Collision:** more than one approved+valid mapping for the same `(retailer, external_branch_id)` → `mapping_collision` (no id returned).
- **Retailer mismatch:** the branch id exists but only for a different retailer → `retailer_mismatch`.
- **Not-yet-valid vs expired:** `valid_from` in the future → `mapping_not_yet_valid`; past `valid_until` (or `status=expired`) → `mapping_expired`.
- **Invalid:** approved+valid but missing internal ids or provenance → `invalid_mapping`.

## Importer integration
`makeResolveBranch(resolver)` produces the importer's `opts.resolveBranch(rec)` hook. On `resolved`, the normalized record's `internal_shop_id`/`internal_mall_id`/`internal_branch_id` are set **only** from the approved mapping; `branch_mapping_status='resolved'`. On any other outcome, internal ids stay **null**; a branch-intending row (`branch_confirmed`/`branch_specific`) is **quarantined** (cannot substantiate a branch claim), and a non-branch row referencing an unknown branch is warned. Availability is **never** upgraded by a mapping — a resolved mapping on an online row keeps `availability_scope='online'`.

## Fixture outcomes (`example-location-mappings.json`, now = 2026-07-31T12:00:00Z)
| mapping | status | branch | resolver outcome |
|---|---|---|---|
| map-0001 | approved | KH-APPROVED | **resolved** |
| map-0002 | draft | KH-DRAFT | mapping_unapproved |
| map-0003 | pending_review | KH-PENDING | mapping_unapproved |
| map-0004 | rejected | KH-REJECTED | mapping_rejected |
| map-0005 | expired | KH-STATUS-EXPIRED | mapping_expired |
| map-0006 | superseded | KH-SUPERSEDED | mapping_superseded |
| map-0007a/b | approved×2 | KH-COLLIDE | mapping_collision |
| map-0008a/b | approved×2 (name-only) | "Kingdom Reds" | ambiguous |
| map-0009 | approved | KH-MISMATCH (other retailer) | retailer_mismatch (from kingdom feed) |
| map-0010 | approved (no provenance) | KH-NOPROV | invalid_mapping |
| map-0011 | approved (no internal ids) | KH-NOIDS | invalid_mapping |
| map-0012 | approved | KH-VALID | **resolved** |
| map-0013 | approved (future valid_from) | KH-FUTURE | mapping_not_yet_valid |
| map-0014 | approved (past valid_until) | KH-DATE-EXPIRED | mapping_expired |

Structurally invalid: 0. All entities/UUIDs are **fictional**; this is a local contract + resolver only — no hosted rows, no migration.
