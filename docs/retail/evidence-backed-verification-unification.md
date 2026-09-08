# Evidence-Backed Verification Unification (Sprint 20A.8)

**Status:** implemented on branch `assistant-20a8-evidence-verification-unification-v1` — **migration 027 not applied; nothing deployed.**

## Goal

Connect and harden MallMind's *existing* retail provenance components so that a
product can only become newly `manually_verified` — or have its verification
freshness renewed — from an **approved, evidence-backed `retail_price_observation`**.
No parallel verification system was created.

## Authoritative data flow

```
evidence (snapshot)  ─┐
retail_data_source   ─┤→ retail_price_observation ──(approved)──┐
                                                                 │
            shared verification policy (deterministic gate)  ────┤
                                                                 ▼
                 publish_verified_observation() RPC (atomic, server-side)
                                                                 │
                                  ┌──────────────────────────────┤
                                  ▼                              ▼
                    products row (verified projection)   observation marked
                    + price_valid_until                  published + linked
                                  │
                                  ▼
                    priceTrust → shopper-safe label
```

## Observation vs product responsibilities

| | `retail_price_observations` | `products` |
| --- | --- | --- |
| Role | **Historical source of truth** | **Current shopper-facing projection** |
| Evidence | source + snapshot + method + confidence + validity | none stored directly |
| Lifecycle | pending → approved → published | continuously projected |
| Verified? | decided by the policy | reflects the last published observation |

The product row never becomes the system of record. Each verified product traces
back through `data_source` (`source_id`, `snapshot_id`) and the observation's
`published_product_id` link.

## Source and evidence requirements (the policy — 20A.8A)

`retailVerificationPolicy.evaluateObservationVerification()` is a **pure,
deterministic** gate. It reuses the existing trust doctrine
(`mapTrustStateToProductQuality`, `isVerifiedQuality`) and the ambiguity refusal
from `retailNameMatcher`. An observation is eligible to project a verified price
only when **all** hold:

- observation exists and `review_status === 'approved'` (and not already published);
- `price > 0`; `observed_at` present;
- `verification_method` is recognised (migration-026 vocabulary);
- linked **source** exists, `is_active`, and is not `needs_legal_review` / `reference_only`;
- an **evidence snapshot** is linked when the method requires one
  (`phone`, `website`, `flyer`, `receipt`, `store_visit`, `retailer_confirmation`);
- product / mall / shop identity is consistent;
- the product match is **not ambiguous**;
- `confidence` meets the per-method threshold (0.60–0.70);
- it maps to a **verified tier** — `manual_fact_entry` + `csv_manual` (or any
  non-evidence method) stays `needs_review` and is refused;
- the **validity window has not expired**.

It returns `{ eligible, projectedQuality, projectedVerifiedAt, projectedValidUntil,
confidence, blockers[], warnings[] }`. Online-only methods (`website`,
`affiliate_feed`, `partner_feed`) raise an admin-facing warning **not to present
an online price as an in-store price**.

### Canonical verification-policy matrix (single source of truth)

Defined once in `retailVerificationPolicy.METHOD_POLICY` (TypeScript) and mirrored
exactly by the SQL RPC (`publish_verified_observation`, migration 027). A parity
test in the retail-core harness pins these values.

| Method | Allowed legal states (source) | Snapshot required | Min confidence | Default validity | Can become `manually_verified`? | Notes / limitations |
|---|---|---|---|---|---|---|
| `store_visit` | active, not needs_legal_review/reference_only | yes | 0.60 | 14 days | yes | In-store evidence |
| `receipt` | same | yes | 0.60 | 14 days | yes | PII redacted; proves the past |
| `retailer_confirmation` | same | yes | 0.60 | 14 days | yes | Direct retailer confirmation |
| `phone` | same | yes | 0.65 | 14 days | yes | Current gold standard |
| `flyer` | same | yes | 0.65 | 7 days | yes | National flyer ≠ branch shelf |
| `website` | same | yes | 0.70 | 7 days | yes | **Online ≠ in-store** (warning) |
| `affiliate_feed` | active + **licensed** | no (feed is evidence) | 0.70 | 2 days | yes | Online only; licence required |
| `partner_feed` | active + **partner_licensed** | no | 0.70 | 2 days | yes | Online only; contract required |
| `csv_manual` | n/a | no | 0.60 | 7 days | **NO** | Bootstrap only → `needs_review` |
| `user_submission` | n/a | no | 0.60 | 7 days | **NO** | Corroboration only; never self-verifies |

A method with **Can verify = NO** (`csv_manual`, `user_submission`) can never
produce a verified projection even if `trust_state` claims `verified` — enforced
in both the TS policy and the SQL RPC.

## Validity / freshness policy (20A.8D)

Priority for a product's `price_valid_until`:

1. the observation's explicit `valid_to`;
2. method/source policy: `observed_at + METHOD_VALIDITY_DAYS`
   (store_visit/receipt/retailer_confirmation/phone = 14d; flyer/website = 7d;
   affiliate/partner feed = 2d);
3. conservative fallback of 7 days.

`calculatePriceTrust` now reads `products.price_valid_until`: a verified price
expires after that instant. **Backwards compatible** — when `price_valid_until`
is absent it falls back to the legacy fixed 7-day window from `price_verified_at`,
so existing callers and rows are unaffected. Expired evidence **degrades** trust
(verified → expired/medium with an honest caution); it is never auto-refreshed.

## Admin verification behaviour (20A.8B)

`POST /admin/verify-product-price` no longer manufactures verified state from
`product_id + method + data_source`. It now requires `{ observation_id }`,
validates through the policy, and publishes via the RPC. The legacy request shape
**fails safely** with a migration message — it never silently bypasses evidence.

## Price-correction behaviour (20A.8C)

`POST /price-corrections/admin/:id/review` `approve` no longer writes a verified
price with a hard-coded `confidence_score = 85`. Two safe outcomes only:

- **`observation_id` supplied** → publish that approved, evidence-backed
  observation through the policy + RPC;
- **otherwise** → stage a **pending, user-submitted** observation (requires
  `source_id`) for evidence review; the product is left untouched. A user report,
  user memory, or admin opinion alone can never create verified trust — staged
  corrections enter as `user_submitted` (confidence from source policy, not 85)
  and map to `needs_review`, never a verified tier.

## Transactional publish behaviour (20A.8E)

`public.publish_verified_observation(observation_id, admin_id, verified_by)` is a
`SECURITY DEFINER` RPC (migration 027) that performs, in **one transaction**:
authorise (`admin_id` must resolve to a current admin; `verified_by` is
attribution only) → re-validate eligibility (defence in depth) → take an advisory
lock on `(shop_id, normalized name)` → resolve the product → **guarded
update-or-insert** of the projection (incl. `price_valid_until`) → mark the
observation `published` + set `published_product_id`/`published_at` → write
`admin_audit_log`. It uses a locked `search_path` and schema-qualified objects,
**refuses already-published observations** (no double publish), enforces row-level
mall/shop identity guards, returns safe errors without leaking secrets, and
`EXECUTE` is revoked from `PUBLIC`/`anon`/`authenticated` and granted to
`service_role` only.

### Product-resolution truth table (RPC + publisher)

| Observation case | Behaviour | Result |
|---|---|---|
| Exact existing `product_id` (live) | identity-guarded UPDATE of that product only | `action: update` |
| One unique `shop_id` + normalized-name match | identity-guarded UPDATE of that product | `action: update` |
| >1 shop+name match (ambiguous) | refused — never auto-picks | error (cardinality_violation), HTTP 422 pre-check |
| No match | guarded INSERT (insert_new doctrine), advisory-lock-protected | `action: insert` |
| Already published | refused (idempotent-safe) | error (unique_violation) |
| Product mall mismatch | refused by identity guard | error (check_violation) |
| Product shop mismatch | refused by identity guard | error (check_violation) |
| Concurrent duplicate publish (same obs) | row lock + published check serialises → second call refused | one publish only |
| Concurrent new-product publish (same shop+name) | advisory xact lock serialises → one insert, second sees the match → update | no duplicate product |

There is **no blind upsert and no name-only overwrite**: an existing exact
product is only updated after identity guards; creation follows the Retail
Intelligence Core insert-new doctrine and cannot create duplicates.

## Shopper-language guarantees

Internal tokens (`manual_fact_entry`, `csv_manual`, `manually_verified`,
`retail_observation`, `needs_review`, evidence IDs) never reach shoppers — those
remain confined to admin/audit surfaces and the `data_source` provenance string.
Shopper-facing labels continue to come from `priceTrust` / the shopper trust
labels. Expired evidence degrades the label honestly.

## Legacy helper status (20A.8F)

`scripts/retail/reverify-demo-prices.mjs` is marked **legacy / demo-only**. It
must not be the long-term freshness mechanism; the documented path is to capture
evidence, create + approve an observation, and publish it through
`/admin/verify-product-price`.

## Migration & rollout risks

1. **Apply migration 027 in Supabase (staging first) BEFORE deploying** the
   backend. Until applied, the two routes return a clear *"apply migration 027"*
   `503` rather than verifying.
2. The RPC re-validates rules that the TS policy also checks (intentional
   defence-in-depth duplication); keep the two in sync if thresholds change.
3. `price_valid_until` is additive and nullable; existing verified rows keep the
   legacy 7-day behaviour until they are re-published through an observation.
4. The Node policy pre-check + RPC are exercised by the pure `RC13`/`RC14`
   harness sections; the **DB write path and RPC were not run against a live
   database** in this sprint and require staging verification before production.
