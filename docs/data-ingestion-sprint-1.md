# Data Ingestion — Sprint 1

The trustworthy ingestion foundation for the MallMind AI shopping assistant:
canonical products, retailer offers, physical store mappings, source evidence,
freshness, trust + availability labels, and honest availability status.

> **Reality label:** _Prototype — local persisted data_ over _Curated
> demonstration data_. This sprint deliberately ships **no live scraping, no
> autonomous crawling, no fake live integrations**, and **no remote schema
> changes**.

## Why local-persisted (architecture decision)

The repo already contains a retail-ingestion subsystem (`supabase/migrations/026`
retail data, `027` evidence-backed verification, `029–032` retail CSV-intake RPC,
plus admin UI + backend routes). Introducing a **new 10-table remote schema +
backend routes + a live-Gemini path** would (a) duplicate that subsystem — a
parallel architecture the Sovereign Systems Build Doctrine forbids — and (b) be
**unverifiable here**: `verify:db` needs Docker to rebuild migrations locally
(unavailable), applying to remote is out of bounds, and the backend needs absent
service-role keys and is CORS-blocked from localhost.

Per the doctrine's "implement the safest minimal compatible version rather than
introducing a parallel architecture", Sprint 1 implements the full **data model +
all logic + admin UI + assistant recommendation** as a self-contained,
honestly-labelled **frontend prototype with local persistence**. It touches no
migrations and no backend, so navigation and the existing retail subsystem stay
untouched, and everything is verified by `npm test` + `npm run build` +
`verify:all`. The TypeScript shapes mirror the target relational model 1:1 so a
future migration can adopt them directly.

## Data model

`src/lib/ingestion/model.ts` defines: `Mall`, `Retailer`, `Store`, `Product`,
`ProductOffer`, `StoreOfferObservation`, `SourceSnapshot`, `IngestionRun`,
`ReviewQueueItem`, and a `SourcePolicy` gate — with the exact fields required by
the sprint. The whole dataset (`IngestionDatabase`) is persisted to
`localStorage` under `mallmind.ingestion.v1` (`src/lib/ingestion/store.ts`).

Facts are kept **separate**: a product existing on a retailer's website, a
retailer having a store at a mall, and branch stock being confirmed are three
independent facts and never collapsed into one another.

## CSV templates

Downloadable from the admin UI and stored in `docs/ingestion-templates/`.

- **products.csv** — `canonicalName, brand, modelNumber, category,
  descriptionSummary, gtin, manufacturerSku`
- **stores.csv** — `retailerSlug, mallSlug, tradingName, shopNumber, floorLabel,
  telephone, storeUrl, verificationStatus`
- **offers.csv** — `productModelNumber, retailerSlug, sellerName, channel,
  currency, currentPrice, previousPrice, promotionLabel, sourceUrl, sourceType,
  sourceObservedAt, validUntil, availabilityScope, priceTrustLabel`

Import flow: accept → parse → validate per row → preview (accepted / warning /
rejected) → approve valid rows → create an `IngestionRun` → queue warnings for
review → show the result. Rejected rows are never committed.

## Trust labels (price)

`verified_live` → **Verified live** · `recently_observed` → **Recently
observed** · `catalogue_special` → **Catalogue special** · `manual_admin` →
**Manual admin** · `user_submitted` → **User submitted** · `stale` → **Stale —
needs verification** · `unavailable` → **Unavailable**.

Ranking priority (best → worst): verified_live, recently_observed,
catalogue_special, manual_admin, user_submitted, stale, unavailable.

## Availability labels

`branch_stock_confirmed` → **Branch stock confirmed** · `collection_available` →
**Collection available** · `online_stock_only` → **Online stock only** ·
`retailer_range_observed` → **Retailer range observed** ·
`store_presence_confirmed` → **Store presence confirmed** · `availability_unknown`
→ **Availability unknown** · `inferred_not_confirmed` → **Inferred — not
confirmed** · `out_of_stock` → **Out of stock** · `no_longer_listed` → **No
longer listed**.

**Branch-stock rule (enforced):** `branch_stock_confirmed` is only valid when a
`StoreOfferObservation` with branch-specific evidence (phone / in-store / staff
confirmation, in/low stock) exists for that offer. Website presence + a store at
the mall are **never** sufficient — validation raises
`branch_stock_without_evidence`.

## Freshness rules

`src/lib/ingestion/freshness.ts` computes an **effective** freshness state and
label on read, **without overwriting** the stored `priceTrustLabel`:

- `verified_live`: expires per provider rule, else after **6h** → stale.
- `recently_observed` (electronics): stale after **24h** (aging in the last
  quarter of the window).
- `catalogue_special`: valid until `validUntil`; past it → **expired** → stale.
- `manual_admin`: warning (aging) after **7 days**.
- `user_submitted`: **unpublished** until reviewed.
- `unavailable`: terminal.

## Review workflow

Statuses: `pending`, `approved`, `rejected`, `needs_correction`. Manual and CSV
entries are always created **pending** and are **never auto-published**.
Approving publishes; rejecting/needs-correction keeps it unpublished. Every
review decision persists (`reviewedAt`, `reviewedBy`, `decisionNotes`).

## Evidence model

Every published offer is traceable to a source URL, observed timestamp, source
type, ingestion run / manual entry, review decision, trust label and evidence
metadata. `SourceSnapshot` stores an `evidenceExcerpt`, `contentHash`,
`evidenceMetadata`, `parserVersion` and `ingestionRunId`. The admin **View
evidence** panel shows these fields. **No fake screenshots or raw-page captures
are stored** — excerpts are curated demonstration text.

## Recommendation ranking

`src/lib/ingestion/ranking.ts` — deterministic: within budget → published &
approved → not unavailable → category match → physical retailer present at the
mall (primary vs. online-comparison split) → trust quality → freshness →
confirmed branch stock → current price. Stale offers never outrank fresh
comparable offers merely because they are cheaper. The explanation is generated
from the ranking factors.

## Assistant integration

`src/lib/ingestion/recommend.ts` builds the transparent answer for “I need a TV
under R4000 at Mall@Reds”, generated entirely from the model (never hardcoded):
in-mall recommendations + a separate online-comparison list, each with price
trust, freshness, store-at-mall and branch-stock status, source, and a "why". It
is surfaced live in the admin **Assistant preview** tab. Wiring this layer into
the deployed Gemini backend assistant is a documented backend follow-up (needs
the remote schema + keys).

## Legal / source-policy gate

`SourcePolicy` (placeholder, functional) tracks per retailer: `termsReviewed`,
`robotsReviewed`, `automationApproved`, `ingestionFrequency`, `permittedFields`,
`imageUsagePermission`, `legalReviewStatus`. Seeded as `not_reviewed` / manual /
no automation — a gate future live-source adapters must pass before any
automation.

## Limitations

- Prototype persistence is browser-local (`localStorage`); not multi-user, not
  remote, not durable across devices. Clearly labelled as such.
- No live scraping / private-API access / stock feeds — by design.
- Store↔mall links and offers are **curated demonstration data**, not verified.
- The assistant answer runs client-side from the local model, not through the
  deployed Gemini backend (that requires the remote schema + keys).

## Future work

- Promote the model to a Supabase migration + backend routes (reconciled with the
  existing `retail_*` tables, not parallel to them).
- Live-source **adapters** behind the `SourcePolicy` gate (terms/robots/automation
  approved) with evidence capture.
- Wire the recommendation layer into the deployed assistant.
- Branch-stock confirmation via kiosk / staff app / partner feeds.
