# Founder Demo Price Re-Verification

Sprint 22B. Helper: `scripts/retail/reverify-demo-prices.mjs`.

## Why this exists

Shopper trust (`google-cloud-backend/src/services/priceTrust.ts`) treats a
`manually_verified` price as **"Verified price" for 7 days** from
`price_verified_at`. After that it degrades to **"Verification expired"**
with a confirm-in-store warning — honest, but it quietly breaks the founder
demo's "Verified option" badge.

**The concrete risk:** the demo's Hisense 43" FHD LED TV at Game (Mall@Reds,
R3 499) was phone-verified on **2026-06-09**, so the tagged demo degrades
around **2026-06-16** unless a human re-verifies it.

This helper refreshes the freshness/audit fields for the **two founder-demo
verified products only** — after a real human re-check. It is deliberately
not a production freshness system.

## The rule

> **Only run `--apply` after a real phone/website/store verification.
> Do not use this to fake freshness.**

The verification itself is a human act (call Game, check the price). The
script only records that it happened.

## Commands

Safe preview (read-only, runs with the anon key):

```bash
node scripts/retail/reverify-demo-prices.mjs
```

Apply, after a REAL re-verification (requires service-role key in env, e.g.
Cloud Shell):

```bash
node scripts/retail/reverify-demo-prices.mjs --apply \
  --verified-by "Richard phone recheck 2026-06-12"
```

`--verified-by` is mandatory for writes and should say **who, how, when**.

## What it may touch

| Allowed to update | Must never change |
|---|---|
| `price_verified_at` (→ now) | `name`, `price`, `shop_id`, `mall_id` |
| `verified_by` (→ your string) | `data_quality_status`, `data_source` |
| | review/publish state of any observation |

## Built-in refusals

- Dry-run by default; `--apply` without `--verified-by` fails.
- Targets only: Hisense 43" by **explicit product id** (with mall/shop/price
  R3 499/quality guards) and Woolworths Greek Yoghurt 500g by strict
  mall+name match. Hard cap of 2 rows; ambiguous matches refused.
- Rows that are not already `manually_verified` are refused — this tool can
  never upgrade a demo/needs_review row to verified.
- If the live price differs from R3 499, it refuses: a price change means the
  fact changed, and the correct path is re-staging through the observation
  pipeline (CSV → review → publish), not a freshness touch.

## Rollback / inspection

- Before: the dry run prints current `price_verified_at` / `verified_by` —
  copy them if you want a manual record.
- After: re-run the dry run to see the new values; the demo card should show
  "Verified option" and `npm run demo:smoke -- --live` should pass the
  trust-label check.
- To revert, set the previous `price_verified_at`/`verified_by` back via SQL
  in the Supabase dashboard (the script intentionally has no un-verify mode).

## Limits

This is founder-demo upkeep, not freshness management. Production-scale
freshness (expiry sweeps on `valid_to`, re-verification queues, multi-mall
coverage) is roadmap item 22E in
[retail-data-readiness-audit.md](./retail-data-readiness-audit.md).
