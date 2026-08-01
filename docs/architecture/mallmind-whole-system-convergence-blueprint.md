# MallMind — Whole-System Architecture & Pilot Convergence Blueprint

Status: **Governing architecture and execution document.**
Inputs reconciled: the repository-grounded [Wired-vs-Present Integration Audit](wired-vs-present-audit.md)
(current-state authority), the agreed progressive-architecture doctrine (execution doctrine), and the
national MallMind vision (long-term horizon only — **not** an immediate build list).
Doctrine in one line: **Pilot narrow, architect broad. Converge what exists, prove one complete journey,
then scale on measurable triggers.**

---

## 1. MallMind product vision (complete, long-term)

MallMind is an AI-assisted indoor shopping and navigation platform. A shopper enters a mall and asks
naturally — *"shampoo for dry hair under R100, a birthday present for a ten-year-old, and somewhere
affordable to eat"* — and MallMind understands intent; finds suitable products and shops; compares
current prices and promotions; shows evidence, freshness, and availability scope; distinguishes national
online pricing from branch-specific pricing/stock; builds an efficient shopping mission; guides the
shopper through the mall; adapts when things change; and does so through a premium, fast, trustworthy
mobile experience.

Long-term surface: product/price discovery · branch-level availability where evidence exists ·
promotions and price-history intelligence · shopping lists and multi-stop missions · indoor route
preview · assisted/live indoor positioning · voice and visual navigation · AI shopping assistance ·
mall discovery and amenities · accessibility-aware routes · retailer and mall partnerships · shopper
alerts and personalisation · analytics for malls and retailers · national and eventually international
expansion.

**The vision is not shrinking. The execution is narrowing to prove it.**

## 2. Whole-bowl operating doctrine

MallMind is always evaluated as a complete system — retail truth, freshness, branch availability,
source rights, data quality, indoor maps, routing, positioning, UX, mobile performance, latency,
concurrency, database scale, queues/workers, AI orchestration, search/caching, observability, security,
backups, cost, partnerships, and operational maintainability — never one migration or component in
isolation.

Two non-negotiable rules:
- **AI must never originate factual prices, stock, product identity, rights decisions, or route facts.**
  Shopper-facing claims require evidence and freshness. AI parses messy input into structured candidates
  that deterministic pipelines validate before publication.
- **Humans cannot review millions of normal updates.** Normal high-confidence data automates; only
  anomalies, source changes, rights problems, and uncertain matches route to human review.

## 3. Current repository capabilities (what already exists)

MallMind is **broadly built and thinly integrated** — not a thin prototype. Already present:

- **Retail truth pipeline** — source registration → snapshot → staging → evidence-backed verification →
  approved-only publication → freshness decay (migrations 026/027/036/039; `retailObservationPublisher.ts`,
  `priceTrust.ts`, `dataTrustPolicy.ts`).
- **Feed ingestion** — retailer-neutral CSV + JSON contracts, dedupe/replay identity, governed branch
  mapping, pending-review staging bridge (`src/lib/retail/feed/*`, migration 039).
- **Indoor map + routing** — floorplan model, indoor canvas renderer, route-walk preview; server-side
  Dijkstra over `mall_nodes`/`mall_edges` (`src/components/navigation/*`, `routingService.ts`,
  `buildRoute.ts`, `indoorMapModel.ts`).
- **Map factory** — floorplan → node/edge graph extraction with QA stages (migrations 017–023,
  `services/mapFactory`, `src/components/map-factory/*`).
- **Search** — trigram GIN indexes (migration 025).
- **AI assistant** — deterministic intent handlers + Gemini orchestration + safe degradation
  (`services/assistant`, `geminiService.ts`, `recommendProducts.ts`).
- **Entity resolution** — duplicate-detection bot (`services/dataBots/duplicateDetectionBot.ts`).
- **Admin / review** — verify-product, retail-observations admin, evidence review, map-factory and
  mall-intelligence tabs.
- **Frontend PWA** — Assistant, Search, Navigate, Malls, Deals, ShoppingList, Rewards, Parking, Profile.

## 4. Wired-versus-present state (summary; authority is the audit)

| Area | State |
|------|-------|
| Shopper query (Assistant + Search) | **WIRED** end-to-end; reads `products`; deterministic-first + Gemini fallback + safe degradation |
| Navigation routing | **WIRED** (Dijkstra over real `mall_nodes`/`mall_edges`) on **SYNTHETIC/PROTOTYPE** graph data |
| CSV admin import | **WIRED** — the one live canonical ingestion funnel (→ `retail_price_observations` pending) |
| Durable intake worker | **WIRED BUT DEAD-ENDS** at `retail_intake_job_drafts` |
| `RetailerFeedContractV1` (`*.mjs`) | **PRESENT-ONLY** island (no DB sink) |
| `stage_retail_feed_observation` (039) | **PRESENT-ONLY** — zero runtime callers |
| `products` writes | **DIVERGENT / BYPASS** — sanctioned RPC + several legacy direct writers |
| `price_scope` on shopper read | **NOT WIRED** |
| `Deals.tsx` | **DIVERGENT / BYPASS** — reads `best_deals` view raw, no trust labelling |
| Positioning | **SIMULATED** (time-interpolated; no BLE/PDR/QR/GPS), honestly labelled |

## 5. Canonical domain map

Bounded domains (a **modular monolith** for the pilot — modules, not services):

1. **Retail Product Intelligence** — canonical products, identity, category normalisation.
2. **Price & Promotion Intelligence** — observations, current offers, price history, promotions.
3. **Branch & Availability** — retailer branches, stock scope, branch mapping.
4. **Source Governance & Provenance** — sources, rights/commercial-use, snapshots, evidence.
5. **Ingestion** — adapters, feed contract, staging funnel, durable intake, anomaly gating.
6. **Verification & Publication** — review queue, the publication gate, projection into `products`.
7. **Mall & Spatial** — malls, shops, `mall_nodes`/`mall_edges`, floorplans, map factory.
8. **Routing & Navigation** — graph routing, multi-stop ordering, route rendering, preview walk.
9. **AI Assistant** — intent parsing (deterministic + Gemini), mission assembly, degradation.
10. **Shopper Profile & Missions** — sessions, shopping lists, personalisation (later).
11. **Notifications** — alerts, price-drop notices (later).
12. **Operations & Analytics** — admin review, data-quality dashboards, ops metrics.

**Contracts between domains are explicit and one-directional at the trust boundary:** Ingestion produces
*candidates*; Verification & Publication is the *only* domain that writes shopper-visible price/trust
state; Shopper-facing domains *read* the published projection and never the staging tables.

## 6. Canonical retail truth model

```
retail_data_sources        — who/what a source is; legal_status, rights_review_state, commercial_use
   └─ retail_source_snapshots  — raw evidence captured at ingest (audit trail)
retail_source_listings     — retailer-specific product identity (per-source SKU/GTIN)
retail_price_observations  — APPEND-ONLY commercial evidence; review_status pending→approved→published
   └─ (published)          → publish_verified_observation → products (shopper-facing projection)
retail_external_location_mappings — governed external-branch → internal shop/mall identity (039)
```

Append-only evidence (`retail_price_observations`) is the historical source of truth; `products` is the
current shopper-facing projection. Nothing shopper-facing reads observations directly.

## 7. Exact intended relationship: products ↔ listings ↔ observations ↔ published

```
retailer feed / CSV / submission
      │  (Ingestion domain)
      ▼
retail_source_listings         = retailer-specific evidence identity (one per source SKU)
      │
      ▼
retail_price_observations      = append-only commercial observation (price/stock at a time, a scope)
      │  review_status: pending → (human/auto review) → approved
      ▼
publish_verified_observation() = the ONLY sanctioned writer of the projection
      │  sets observation.review_status='published', published_product_id, published_at
      ▼
products                       = current shopper-facing projection (one row per shopper-visible offer)
```

**There must be exactly one editable price/trust truth.** Today there is not (audit §1–§2). The target
state: `products` is a **projection**, writable in its protected fields **only** by
`publish_verified_observation`; a `published_observation_id` back-reference links each product to its
originating observation for reconciliation. See §10 for the field-level integrity design.

## 8. Canonical ingestion funnel

One funnel, all sources converge on it:

```
Source adapter (CSV / JSON feed / durable intake / submission / manual)
      → RetailerFeedContractV1 canonical candidate
      → staging bridge  stage_retail_feed_observation()   (governed branch mapping applied here)
      → retail_price_observations (review_status = pending)
      → exception-based human review  (anomalies / rights / mapping / collisions only)
      → publish_verified_observation()
      → products (projection)
```

Convergence obligations (from audit §3): the durable-worker drafts (`retail_intake_job_drafts`) and the
`RetailerFeedContractV1` output must both terminate in `retail_price_observations` **through the
already-built `stage_retail_feed_observation`**. Legacy/divergent writers (the raw-insert CLI, the
parallel JS publisher, the scrapers) must be routed through this funnel, marked legacy, or retired — we
cannot maintain three definitions of a valid observation.

## 9. Shopper-query flow

```
Shopper NL query
  → deterministic intent classify (regex; no LLM)
  → deterministic bypass for clear product/budget/cheapest/nav intents  (answered from products)
  → Gemini only for ambiguous / conversational / mission intents  (tools return candidate sets)
  → trust + freshness + scope annotation (priceTrust)          ← price_scope MUST be included
  → ranked shopper cards (evidence + freshness + scope shown honestly)
  → optional: build multi-stop route over the mall graph
Failure at any AI step → deterministic recovery, else safe degraded message (never invented facts)
```

Search baseline: **`pg_trgm` + structured filters** (mall/shop scope, price bound, category). The LLM
receives only a small candidate set — never raw rows, never SQL over millions of records.

## 10. Trust, provenance, freshness, and price-scope rules — with the projection-integrity field taxonomy

**Rule:** unverified writers must not be able to change shopper-visible trusted price data, **while
legitimate catalogue-metadata maintenance remains possible.** Do **not** blanket-lock `products`.

Classify `products` columns into four groups and protect them differently:

| Class | Example fields | Who may write | Enforcement intent |
|-------|----------------|---------------|--------------------|
| **Protected commercial projection** | `price`, `original_price`, `is_on_special`, `price_valid_until`, `price_condition`, `price_scope`, `verified`, `price_verification_method`, `verified_by`, `price_verified_at` | **Only** `publish_verified_observation` (service_role, SECURITY DEFINER) | Column-level protection: a `BEFORE UPDATE` trigger rejects changes to these columns unless the write originates from the publication RPC (e.g. a session GUC/flag the RPC sets), so no scraper/CLI/admin path can mutate trusted price/trust state |
| **Editable descriptive / catalogue metadata** | `name`, `brand`, `category`, `description`, image/asset refs, `pack_size` | Admin/catalogue maintenance via a normal, RLS-guarded path | Remains freely maintainable; never affects price trust |
| **Derived trust fields** | `trust_state`, `trust_label`, `is_price_expired` | **Computed at read time** (`priceTrust.ts`), not hand-written | Never stored-and-edited; always derived from protected fields + freshness window |
| **Linked provenance** | `published_observation_id` (to add), `shop_id`, `data_source`, `published_at` | Set by the publication pipeline | Immutable reconciliation linkage product ↔ observation |

Freshness: a published price decays past its source-aware validity window (default ~7 days); expired
prices degrade trust and drop from primary discovery. Price-scope: **national-online vs branch-specific
must be selected, carried, and shown to the shopper** (today it is not — audit §5). Provenance: every
shopper-visible price traces to an approved observation and its evidence snapshot.

## 11. Indoor map, routing, and positioning boundaries

- **Routing (keep):** custom Dijkstra over `mall_nodes`/`mall_edges` DB rows. Correct for the pilot; do
  **not** adopt PostGIS/pgRouting (see triggers §14).
- **Multi-stop:** nearest-neighbour + 2-opt over the graph for a handful of stops; brute-force is fine at
  pilot cardinality. No external solver.
- **Map data (the real gap):** graph geometry and floor images are currently **synthetic/prototype**
  (audit §7). The pilot needs **one real surveyed graph + floorplan for Mall@Reds** — this is a *data*
  task, not a code task.
- **Positioning boundary:** pilot ships **route preview + simulated walk + manual/QR check-ins**, always
  honestly labelled. BLE/PDR/Wi-Fi-RTT/VPS are future-scale only. Never present simulated position as live.

## 12. Pilot modular-monolith architecture

```
React/Vite PWA
      │
ONE modular Cloud Run backend (Node/Express) — clean module boundaries, NOT microservices
      │
Supabase/PostgreSQL (single primary)
  ├─ retail truth (sources, listings, observations)
  ├─ current-state projection (products)
  ├─ append-only history (observations; partition later)
  ├─ pg_trgm search + structured filters
  ├─ mall graph (mall_nodes / mall_edges)
  └─ verification / publication boundary (SECURITY DEFINER RPCs, RLS)
Object storage (GCS africa-south1): source-evidence snapshots + floorplan assets
Async ingestion worker (existing durable worker) → canonical funnel
Gemini: intent & ambiguity only — never factual truth
Observability: structured logs, health endpoints, verify:all as the authoritative gate
```

Deliberately **excluded from the pilot** (future-scale only): dedicated search engine, Redis, BigQuery,
Pub/Sub domain-event mesh, read replicas, pgRouting, PostGIS, pgvector, BLE/PDR hardware, service
decomposition, large multi-agent systems, national-scale partitioning everywhere.

## 13. Progressive scaling architecture

| Capability | Pilot (1–5 malls) | Regional (20–100) | National (100s–1000s) |
|-----------|-------------------|--------------------|------------------------|
| Compute | one modular Cloud Run service | split ingestion workers from API | domain service separation where ownership/scale demands |
| Database | single Postgres primary | connection pooler hardening; begin history partitioning | partitioned history, read replicas, regional failover |
| Search | `pg_trgm` + filters | evaluate dedicated search **if measured** | search cluster(s), partitioned by mall |
| History | append-only in Postgres | export cold history to object storage | analytics warehouse (e.g. BigQuery) |
| Events | in-process calls | introduce a queue/Pub/Sub for ingestion fan-out | event-driven domain mesh |
| Cache | none / HTTP | Redis for hot reads/rate-limit | distributed cache |
| Positioning | preview + QR | BLE in high-traffic malls | sensor fusion / VPS where justified |
| Semantic search | none (structured only) | evaluate `pgvector` in-Postgres | dedicated vector store if needed |

Gemini's national blueprint is the **horizon map** for this table — adopted piece-by-piece on triggers,
never wholesale.

## 14. Measurable triggers for specialist infrastructure

Adopt a tool only when a metric crosses a threshold under **realistic load testing**, not on theory:

- **Dedicated search** ← p95 product-search latency exceeds target under realistic QPS **and** query
  profiling shows `pg_trgm`/filters are the bottleneck (not missing indexes).
- **`pgvector` (semantic search)** ← measured demand for vague/gift queries that structured filters cannot
  serve; evaluate **in the same Postgres** first.
- **History partitioning / warehouse export** ← observation history growth makes hot-table queries or
  storage cost cross budget thresholds.
- **Connection pooler hardening / read replicas** ← autoscaling workers+API exhaust DB connections
  (pooler saturation observed).
- **PostGIS / specialist spatial tooling** ← mall graphs grow beyond what the node/edge model + Dijkstra
  serve within routing latency targets.
- **Queue / Pub/Sub mesh** ← ingestion fan-out or backpressure exceeds in-process handling.
- **BLE / advanced positioning** ← a mall partnership funds anchors **and** preview+QR is proven
  insufficient for the target UX.

## 15. Clean staging strategy

Stand up a **new, clean Supabase staging project built from migrations 000–039**, proven green by the
existing disposable-DB verification, as the integration-proof and pilot environment. It is **staging, not
production**. Migration lock: no manual schema edits in the console; all migrations in Git, applied via
CLI/CI. **This document does not create or mutate that project** — it sets the direction; creation is a
separate, controlled sprint.

## 16. Frozen legacy hosted-project strategy

The existing hosted project `qspsouemjtcdcfnivpnt` is **FROZEN / SUSPECT**:

- Do **not** push, repair, reset, migrate, wipe, or delete it.
- Do **not** treat it as a source of truth.
- History is inconsistent (through 032 with anomalies); it is Free-tier with **no managed backups/PITR**;
  its data value is **unknown** (target-linked audit + manual backup were blocked at the credential
  boundary — see the 2M-A / 2M-B operator runbooks).
- It stays frozen until an operator (not the agent) completes a target-linked read-only audit **and** a
  verified manual logical backup. Only then is reconcile-vs-decommission decided — **with evidence**.

We do not gamble with it to make progress; the clean staging project (§15) unblocks development without
touching it.

## 17. The one-mall whole-bowl proof (the true next milestone)

One mall, one permissioned source, one real offer, one verified publication, one shopper-visible result,
one usable route — proven end-to-end and captured as repeatable evidence:

```
1.  Clean staging created from migrations 000–039
2.  Mall@Reds tenant + a real surveyed floorplan/graph loaded
3.  One approved / explicitly authorised retailer source registered
4.  A small real feed enters through the canonical adapter
5.  Data stages automatically (pending)
6.  Normal rows pass deterministic validation
7.  Exceptions appear in the review interface (exception-based)
8.  One offer is verified and published (publish_verified_observation)
9.  The shopper asks for that product
10. MallMind retrieves it quickly
11. The UI shows price scope, freshness and evidence honestly
12. MallMind generates a route to the relevant store
13. The route renders cleanly on the real mall floorplan
14. The full process is captured as repeatable evidence
```

Every pilot decision must preserve future qualities: multi-mall identifiers, multi-retailer source
contracts, append-only evidence, current-state projections, freshness expiry, queue-ready ingestion,
replaceable search, modular boundaries, mall-specific graph data, source rights, deterministic
publication, observability, and horizontal-scaling headroom.

## 18. The next three sprints

**Sprint 3A — Canonical Truth & Ingestion Convergence.** Wire the one funnel: route the durable-worker
drafts and/or the `RetailerFeedContractV1` output into `retail_price_observations` via the already-built
`stage_retail_feed_observation`; classify every legacy/divergent writer as routed / legacy / retired.
Documentation + local disposable verification only until a clean staging project exists.

**Sprint 3B — Projection Integrity & Trust Closure.** Implement the field-level projection integrity of
§10: protect commercial/price/trust columns to the publication RPC only (trigger-based), keep descriptive
metadata editable, add `published_observation_id`, wire `price_scope` into the shopper read, and bring
`Deals.tsx` through the trust pipeline. Quarantine the direct scraper/JS writers.

**Sprint 3C — One-Mall Whole-Bowl Proof.** Execute §17 on the clean staging project with one real source
and one real Mall@Reds graph/floorplan; capture repeatable end-to-end evidence.

## 19. Acceptance gates per sprint

**3A gates:** exactly one ingestion funnel terminates in `retail_price_observations`; `stage_retail_feed_observation`
has at least one wired runtime caller; every writer of observations is inventoried as routed/legacy/retired;
disposable-DB verification green; no production contact.

**3B gates:** a bypass write to a protected `products` field is rejected in a disposable-DB test; a
descriptive-metadata edit still succeeds; `published_observation_id` populated by the publication path;
`price_scope` present in shopper responses and rendered; `Deals.tsx` shows trust labelling; scrapers/JS
direct writers disabled or quarantined; verification green; no production contact.

**3C gates:** the 14-step whole-bowl sequence (§17) completes on clean staging with one real source and
one real mall graph; the shopper sees an honest scope/freshness/evidence label; a route renders on the
real floorplan; evidence captured and repeatable; legacy hosted project untouched.

## 20. Preserve / Consolidate / Defer / Retire

| Verdict | Items |
|---------|-------|
| **Preserve** | truth/verification/publication boundary; `publish_verified_observation` RPC; deterministic assistant handlers + safe degradation; RetailerFeedContractV1 (now wire it); custom node/edge Dijkstra routing; React/Vite PWA; `pg_trgm` search baseline; RLS + SECURITY DEFINER pattern |
| **Consolidate** | ingestion paths → one funnel via `stage_retail_feed_observation`; `products` writers → publication-RPC-only for protected fields; durable-worker drafts → observations; `Deals.tsx` → trust pipeline |
| **Defer** | `pgvector`/semantic search; dedicated search engine; Redis; BigQuery; Pub/Sub mesh; read replicas; PostGIS; BLE/PDR/VPS positioning; most additional AI agents; national partitioning |
| **Retire** | legacy direct-write scrapers (`scripts/scraper/*`, `supabase/functions/scrape-prices`); the parallel JS publisher (`publish-staged-observations.mjs`) and raw-insert CLI once the funnel is wired |

## 21. Explicit unresolved decisions

1. **Durable-worker drafts vs. feed contract as the primary adapter into the funnel** — which becomes the
   canonical entry, and does the other feed into it or retire?
2. **Protected-field enforcement mechanism** — trigger with a publication-session flag vs. column-level
   privileges vs. splitting protected fields into a separate table. (Blueprint recommends the trigger
   approach; final choice pending an ADR.)
3. **Legacy scraper disposition** — hard retire vs. re-route through the funnel as just another adapter.
4. **`Deals` semantics** — should `best_deals` become a trust-aware view/projection, or should `Deals.tsx`
   call the same backend path as Search?
5. **Real Mall@Reds graph/floorplan source** — surveyed manually, from mall management CAD, or from a
   verified map-factory pass with human topology sign-off?
6. **Clean-staging creation timing** — which sprint physically creates it (a separate controlled task).
7. **Price-scope UX** — exact shopper labelling for national-online vs branch-specific.

## 22. Architecture decision records that should follow

- **ADR — Modular monolith for the pilot** (services deferred to measured need).
- **ADR — Canonical ingestion funnel** via `stage_retail_feed_observation`; legacy writer disposition.
- **ADR — `products` projection integrity** (four-class field taxonomy; protected-field enforcement).
- **ADR — Search baseline `pg_trgm` + filters**; `pgvector`/dedicated search as trigger-gated futures.
- **ADR — Custom node/edge routing retained**; PostGIS/pgRouting trigger-gated.
- **ADR — Frozen legacy hosted project** `qspsouemjtcdcfnivpnt`; clean staging from 000–039.
- **ADR — AI boundary**: never originates prices/stock/rights/route facts; exception-based human review.

---

## Required architectural decisions (recorded)

- Keep a **modular monolith** for the pilot.
- Preserve the existing **custom node/edge routing** model.
- Keep **`pg_trgm` + structured filters** as the pilot-search baseline.
- Treat **`pgvector` and PostGIS as optional future evaluations**, not requirements.
- Keep **AI away from originating prices, stock, rights decisions, and route facts**.
- Make **human review exception-based**.
- Leave **`qspsouemjtcdcfnivpnt` frozen**; do not wipe, repair, push to, or delete it.
- Use a **new clean staging project from migrations 000–039** for future integration proof.
- Do **not** create that hosted project in this documentation task.
- Do **not** connect or deploy anything in this task.

*This blueprint governs direction only. Sprint 3A implementation has not begun.*
