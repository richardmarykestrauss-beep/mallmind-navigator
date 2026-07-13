# Data Ingestion — RC1 + Data Command Center

RC1 is a refined **superset** of [Data Ingestion Sprint 1](./data-ingestion-sprint-1.md).
It keeps the same architecture decision — _Prototype — local persisted data_ over
_Curated demonstration data_, no remote schema, no backend routes, no live
scraping — and adds the RC1 taxonomy, a third **safe** ingestion path (a source
registry), conflict/stale detection, and a control-plane **Data Command Center**.

> **Reality label:** everything here runs on locally-persisted curated
> demonstration data. Nothing fetches, scrapes, crawls, or auto-approves. No
> recommendation is presented as live-verified unless it carries live-verified
> evidence.

## Three safe ingestion paths (RC1)

1. **Manual single-offer entry** — admin form, always **staged**, never auto-published.
2. **Manual CSV import / staging** — parse → preview → stage rows for review.
3. **Public source snapshot registry** — register a source (name, URL, type,
   retailer/mall, status, legal/risk note, owner notes). **Registry only — RC1
   performs no automated fetching.**

There is deliberately **no automated scraper execution**.

## Taxonomy (RC1 exact values)

- **Trust labels:** `verified_live`, `recently_observed`, `catalogue_special`,
  `manual_admin`, `partner_feed`, `user_submitted`, `stale`, `unavailable`,
  `conflict_detected`.
- **Review statuses:** `staged`, `needs_review`, `approved`, `rejected`, `archived`.
- **Availability status (coarse):** `known_available`, `unknown`, `inferred`,
  `unavailable` — derived from the richer `availabilityScope`; never
  `known_available` without supporting evidence.
- **Source-registry status:** `candidate`, `approved`, `blocked`, `needs_review`,
  `deprecated`.
- **Ingestion-run type:** `manual_csv`, `manual_entry`, `source_snapshot`,
  `future_agent_research` (reserved — not executed in RC1).

## CSV columns (exact minimum)

`retailer, mall, store, product_title, brand, category, price, original_price,
source_url, source_type, observed_at, expires_at, trust_label,
availability_status`

Rows **stage first** (never auto-approved). Unknown retailers reject; unknown
products create a new product with a warning; unknown malls warn.

## New modules

| File | Purpose |
| --- | --- |
| `src/lib/ingestion/availability.ts` | `deriveAvailabilityStatus` — maps detailed scope → coarse RC1 status. |
| `src/lib/ingestion/conflicts.ts` | `detectConflicts` (same product + same source category, material price spread), `detectStaleOffers`, `offerHasConflict`, `sourceCategory`. |
| `src/lib/ingestion/store.ts` | `addSource`, `decideSourceStatus` (source registry); `commitOfferCsv` new-product support. |
| `src/components/ingestion/ingestionMeta.ts` | Shared source-type / source-status / run-type / run-status display metadata. |

Conflict rule: offers are grouped by `(productId, sourceCategory)`; a group with a
spread ≥ R50 **and** ≥ 3% is flagged (≥ 15% → `error`). Different categories
(e.g. `partner_feed` vs `retailer_page`) are **not** treated as conflicts.

## Admin surfaces

- **`/admin/data-ingestion`** — Overview, **Sources** (Add source snapshot +
  registry), CSV import, Manual offer, Review queue (staged/needs_review/
  approved/rejected/archived), Assistant preview, Evidence panel.
- **`/admin/data-command-center`** — read-and-decide control plane with the seven
  required sections: **Source Registry, Staged Offers, Approved Offers,
  Conflict/Stale Alerts, Ingestion Runs, Review Queue, Decision Notes.** Each
  source shows name, URL, type, retailer/mall, status, legal/risk note, last
  checked, owner notes. Each run shows run type, status, rows found, rows
  approved, conflicts detected, created_at, and an evidence link/source URL.

The Command Center is designed so future **Paperclip / Perplexity / Claude**
research outputs can later be pasted or imported as source snapshots + staged
offers into these same sections — no schema change required.

## Assistant integration

Approved (or demo-mode) offers only. Each answer shows product, retailer/store/
mall, price, source + trust label, observed/freshness, and availability
confidence, with a stale warning where applicable. **No "in stock now" claim
unless `availability_status` is `known_available` and the source supports it.**

## Tests

`src/lib/ingestion/ingestion.test.ts` — **27 deterministic tests**, covering:
trust-label validation, stale detection, CSV normalization (RC1 columns),
staged-vs-approved filtering, conflict detection (Game R3999 vs Checkers R4499,
same source category), recommendation output carrying source/freshness/trust, and
source-snapshot registration preserving URL + timestamp.

## Gates

`npm test` (66 pass) · `npm run build` · `npm run verify:all` (9/9 pass).
`npm run typecheck` has 11 **pre-existing** errors in unrelated files
(`analytics.ts`, `AssistantPage.tsx`, `SearchPage.tsx`, `AdminDashboard.tsx`,
`MallIntelligenceTab.tsx`); RC1 adds **zero** new type errors and `verify:all`
does not run `typecheck`.

## Not built yet (by design)

No automated scraping/crawling; no bypass of robots.txt, login walls, rate limits,
or anti-bot systems; no paid third-party APIs; no Paperclip dependency; no live
"verified" stock without evidence; no deployment; no remote schema/migration
changes.
