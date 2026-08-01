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

**Repository-fact caveat (semantics of `products`).** As built, `products` is a *mixed* model: it is
shop-scoped (`shop_id`, `mall_id`) — i.e. a **current-offer projection** — but it also embeds catalogue
identity fields (`name`, `brand`, `category`, `model`) rather than referencing a separate
`canonical_products` table (which does not exist in the schema). It has **no `is_active` column** (only
`in_stock` and `verified`). Therefore Sprint 3B must first **confirm whether `products` is canonical
product identity, a current-offer projection, or a mixed legacy model** before deciding where
revocation/expiry/supersession fields belong (see §10.2). Do **not** assume `is_active` exists or add it
as a locked design.

## 8. Canonical ingestion funnel

One funnel, all sources converge on it. **Role clarity:** `RetailerFeedContractV1` is the **canonical
validation contract**; the **durable intake worker is the asynchronous transport / orchestration
mechanism** (not a competing validator); `retail_intake_job_drafts` is a **durable intermediate record,
not a competing source of retail truth**.

```
approved source                         (rights approved + evidenced in the source registry)
  → durable intake job                  (asynchronous transport / orchestration)
  → RetailerFeedContractV1 validation   (the canonical validation contract)
  → governed candidate / draft          (retail_intake_job_drafts = durable intermediate record)
  → stage_retail_feed_observation()     (governed branch mapping applied here)
  → retail_price_observations (pending)
  → review / verification               (exception-based: anomalies / rights / mapping / collisions)
  → publish_verified_observation()
  → shopper-facing projection (products)
```

Convergence obligations (from audit §3): the durable-worker drafts (`retail_intake_job_drafts`) and the
`RetailerFeedContractV1` output must both terminate in `retail_price_observations` **through the
already-built `stage_retail_feed_observation`**. Legacy/divergent writers (the raw-insert CLI, the
parallel JS publisher, the scrapers) must be routed through this funnel, marked legacy, or retired — we
cannot maintain three definitions of a valid observation.

**Rights are inherited, never self-assigned.** An adapter (including any preserved scraper parsing logic)
**may not originate, upgrade, or approve** a rights or commercial-use status. Source rights are approved
and evidenced in the **source registry**; adapters reference an **approved source identity**; candidates
**inherit** that source identity; the **publication policy checks the approved rights state**; unknown or
unapproved rights remain **quarantined**. AI and scraper code never set `source_rights_status` (e.g. they
must not assign `public_fair_use` — see Red-Team Disposition, rejected item).

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

**Deals rule (uniform trust policy).** `Deals` must use the **same trust-aware backend policy as Search and
Assistant** (trust, freshness, verification, and price-scope). A dedicated `/deals` endpoint is acceptable
**only if it reuses the same service-level policy** rather than duplicating it; the current `Deals.tsx`
direct-`best_deals`-view read (audit §6) must not remain a trust bypass.

## 10. Trust, provenance, freshness, and price-scope rules — with the projection-integrity field taxonomy

**Rule:** unverified writers must not be able to change shopper-visible trusted price data, **while
legitimate catalogue-metadata maintenance remains possible.** Do **not** blanket-lock `products`.

Classify `products` columns into four groups and protect them differently:

| Class | Example fields | Who may write | Enforcement intent |
|-------|----------------|---------------|--------------------|
| **Protected commercial projection** | `price`, `original_price`, `is_on_special`, `price_valid_until`, `price_condition`, `price_scope`, `verified`, `price_verification_method`, `verified_by`, `price_verified_at` | **Only** `publish_verified_observation` (a narrowly-owned SECURITY DEFINER RPC) | Enforcement mechanism is **deferred to an ADR before Sprint 3B** — see §10.1. **Session/GUC flags are rejected** as the mechanism (unsafe/unpredictable under pooled connections). No scraper/CLI/admin/ordinary-client path may mutate these fields. |
| **Editable descriptive / catalogue metadata** | `name`, `brand`, `category`, `description`, image/asset refs, `pack_size` | Admin/catalogue maintenance via a normal, RLS-guarded path | Remains freely maintainable; never affects price trust |
| **Derived trust fields** | `trust_state`, `trust_label`, `is_price_expired` | **Computed at read time** (`priceTrust.ts`), not hand-written | Never stored-and-edited; always derived from protected fields + freshness window |
| **Linked provenance** | `published_observation_id` (to add), `shop_id`, `data_source`, `published_at` | Set by the publication pipeline | Immutable reconciliation linkage product ↔ observation |

Freshness: a published price decays past its source-aware validity window (default ~7 days); expired
prices degrade trust and drop from primary discovery. Provenance: every shopper-visible price traces to an
approved observation and its evidence snapshot.

### 10.1 Protected-field enforcement (ADR required before Sprint 3B — GUC rejected)

The enforcement mechanism is **not yet selected** and must be decided by an ADR **before** Sprint 3B
implementation. **Session/GUC flags are explicitly rejected** because they are unsafe/unpredictable under
pooled database connections. The ADR must compare at least: (a) **column-level privileges + a narrowly
owned SECURITY DEFINER publication RPC**; (b) a **protected commercial-projection table separated from
editable catalogue metadata**; (c) **database-trigger enforcement that does not depend on pooled session
state**; and (d) any repository-grounded alternative. The selected design must ensure **all** of:

- ordinary clients cannot change protected commercial fields;
- **service-role application code cannot bypass the publication boundary merely because it holds a
  powerful key**;
- existing elevated scripts are removed or constrained;
- legitimate descriptive-metadata editing remains possible;
- table **owners** and **SECURITY DEFINER** functions are explicitly considered (ownership can bypass
  column privileges — this must be verified against actual Supabase roles/ownership);
- every trusted commercial change remains **attributable to an originating observation and an audit event**.

**Preferred baseline (subject to the ADR and to actual Supabase role/ownership verification):** column
privileges + a narrowly-owned SECURITY DEFINER publication RPC.

### 10.2 Eviction / revocation / supersession capabilities (required; field placement deferred)

The projection must support, as required capabilities (mechanism/placement decided in 3B, not prescribed
here): a **publication back-reference to the originating observation**; **revocation**;
**expiry / deactivation**; **source correction**; **removal from active shopper results**; and
**auditable rollback or supersession**. Because `products` today has **no `is_active`** and is a mixed
offer/identity model (§7), the ADR must decide whether these expiry/revocation fields live on `products`
or in a **separate current-offer projection** — the blueprint requires the *capability*, not a specific
column. Do **not** blindly add `is_active` to `products`.

### 10.3 price_scope taxonomy, and the four independent signals

**price_scope must be selected, returned, and displayed in shopper-facing results before Sprint 3B exits**
(today it is neither selected nor shown — audit §5).

*Repository fact:* the enforced schema enum (`rpo_price_scope_check` in migration 036, mirrored on
`products` in 038) is **`online_national`, `online_regional`, `branch_specific`, `catalogue_national`,
`unknown`**. Note the repo uses **`online_national`** (not `national_online`), has **no `mall_level`**, and
already includes `online_regional` and `catalogue_national`. The pilot **display** baseline maps the three
substantiated-for-display values to shopper labels:

| price_scope (schema value) | Shopper label | Pilot display status |
|---|---|---|
| `branch_specific` | "In-store price at [Branch Name]" | display |
| `online_national` | "National online price — in-store price may vary" | display |
| `unknown` | "Price scope not confirmed" | display |
| `online_regional` | (regional online) | present in schema; **requires explicit source semantics before shopper display** — treat as `unknown` for display until approved |
| `catalogue_national` | (catalogue/national) | present in schema; **requires explicit source semantics before shopper display** — treat as `unknown` for display until approved |

`mall_level`, `regional` (in-store), and `national_in_store` are **not** in the schema and are **future
candidates requiring explicit source semantics + schema approval** — do not introduce them without a real
source that can substantiate the meaning.

**Four independent signals must never be conflated** — verification, scope, stock, and freshness are
distinct: a *verified* **national-online** price must **never** be presented as *verified branch
availability*. Price verification attests the price was observed from an approved source; price scope
states *what the price applies to*; stock availability is a separate claim; freshness is the age of the
observation. The shopper card must render them independently.

## 11. Indoor map, routing, and positioning boundaries

- **Routing (keep):** custom Dijkstra over `mall_nodes`/`mall_edges` DB rows. Correct for the pilot; do
  **not** adopt PostGIS/pgRouting (see triggers §14).
- **Multi-stop:** nearest-neighbour + 2-opt over the graph for a handful of stops; brute-force is fine at
  pilot cardinality. No external solver.
- **Map data (the real gap):** graph geometry and floor images are currently **synthetic/prototype**
  (audit §7). The pilot needs **one real surveyed graph + floorplan for Mall@Reds** — this is a *data*
  task, not a code task. **Real navigation evidence for Mall@Reds requires all of:** (1) a **legally
  usable source floorplan**; (2) **topology verification**; (3) **store-entrance verification**;
  (4) **vertical-transition verification** where applicable (escalators/lifts/stairs); (5)
  **coordinate-to-meter calibration**; (6) a **physical ground-truth route walk**. Synthetic map-factory
  geometry may seed the graph but does **not** satisfy this evidence bar.
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
CLI/CI. **This documentation task does not create or mutate that project** — it sets the direction.

**Creation happens during Sprint 3A**, in this controlled sequence (each step gated on the prior):

1. Complete **local disposable** migration and funnel verification.
2. Provision the clean staging project.
3. Apply migrations **000–039** through the approved controlled process.
4. Verify **schema, grants, RLS, and RPCs**.
5. Execute the Sprint 3A integration tests.
6. **Treat successful staging proof as a Sprint 3A exit gate.**

Throughout, the legacy `qspsouemjtcdcfnivpnt` project **remains frozen and untouched** (§16).

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

**Sprint 3A — Canonical Truth & Ingestion Convergence.** Wire the one funnel (§8): route the durable-worker
drafts and/or the `RetailerFeedContractV1` output into `retail_price_observations` via the already-built
`stage_retail_feed_observation`; classify every legacy/divergent writer as routed / legacy / retired.
Preserve scraper *parsing* logic only as **governed adapters that emit `RetailerFeedContractV1` candidates
into the pending-observation funnel** — never as direct writers and never self-assigning rights.
*Before 3A exit:* (1) **disable or quarantine direct commercial writers**; (2) establish the canonical
**validation → transport → staging** path locally **and** on clean staging; (3) ensure **no scraper
self-assigns rights**; (4) create the clean staging project per §15 and treat its proof as an exit gate.

**Sprint 3B — Projection Integrity & Trust Closure.** *Before 3B exit:* (1) **select and implement the
projection-protection ADR** of §10.1 (GUC rejected); (2) add the **provenance back-reference**
(`published_observation_id`); (3) add **revocation / expiry / supersession** behaviour per §10.2 (field
placement decided by ADR after confirming `products` semantics); (4) bring **`Deals` through the trust
policy** (§9 Deals rule); (5) **surface `price_scope`** per §10.3; (6) **prove that an unverified write cannot
preserve a verified trust presentation.** Keep descriptive metadata editable; quarantine the direct
scraper/JS writers.

**Sprint 3C — One-Mall Whole-Bowl Proof.** Execute §17 on the clean staging project with one real source
and one real Mall@Reds graph/floorplan. *Before 3C exit:* complete the **real floorplan/graph evidence and
route QA** (§11 evidence bar) and **prove one real source-to-shopper-to-route journey**, captured as
repeatable evidence.

## 19. Acceptance gates per sprint

**3A gates:** exactly one ingestion funnel terminates in `retail_price_observations`; `stage_retail_feed_observation`
has at least one wired runtime caller; every writer of observations is inventoried as routed/legacy/retired;
**direct commercial writers disabled or quarantined**; **no scraper self-assigns rights**; the
**validation → transport → staging** path proven locally **and on the newly-provisioned clean staging
project** (staging schema/grants/RLS/RPC verified — §15); disposable-DB verification green; **legacy
`qspsouemjtcdcfnivpnt` untouched**.

**3B gates:** the **projection-protection ADR is selected and implemented** (GUC not used); a bypass write
to a protected `products` field is **rejected** in a disposable-DB test **while a descriptive-metadata edit
still succeeds**; **service-role app code cannot bypass the publication boundary**; `published_observation_id`
populated by the publication path; **revocation/expiry/supersession capability** demonstrated; `price_scope`
present in shopper responses and rendered per §10.3; **`Deals` served through the same trust/freshness/
verification/scope policy** as Search/Assistant; **proof that an unverified write cannot preserve a verified
trust presentation**; verification green; legacy project untouched.

**3C gates:** the 14-step whole-bowl sequence (§17) completes on clean staging with one real source and
one real mall graph; the Mall@Reds navigation **evidence bar (§11) is met** (legally usable floorplan,
topology, entrance, vertical-transition, calibration, ground-truth route walk); the shopper sees honest,
independent verification/scope/stock/freshness labels; a route renders on the real floorplan; evidence
captured and repeatable; legacy hosted project untouched.

## 20. Preserve / Consolidate / Defer / Retire

| Verdict | Items |
|---------|-------|
| **Preserve** | truth/verification/publication boundary; `publish_verified_observation` RPC; deterministic assistant handlers + safe degradation; RetailerFeedContractV1 (now wire it); custom node/edge Dijkstra routing; React/Vite PWA; `pg_trgm` search baseline; RLS + SECURITY DEFINER pattern |
| **Consolidate** | ingestion paths → one funnel via `stage_retail_feed_observation`; `products` writers → publication-RPC-only for protected fields; durable-worker drafts → observations; `Deals.tsx` → trust pipeline |
| **Defer** | `pgvector`/semantic search; dedicated search engine; Redis; BigQuery; Pub/Sub mesh; read replicas; PostGIS; BLE/PDR/VPS positioning; most additional AI agents; national partitioning |
| **Retire** | **direct-write** behaviour of the scrapers (`scripts/scraper/*`, `supabase/functions/scrape-prices`) and the parallel JS publisher (`publish-staged-observations.mjs`) + raw-insert CLI — **disabled/quarantined before Sprint 3A exit**. Scraper *parsing* logic may be **preserved only as governed adapters** that emit `RetailerFeedContractV1` candidates into the funnel (never direct writers, never self-assigning rights). |

## 21. Explicit unresolved decisions

1. **Durable-worker drafts vs. feed contract roles** — settled in principle (§8: contract = validation,
   worker = transport, drafts = durable intermediate); the open item is the exact adapter that first emits
   into the funnel and the disposition of the other.
2. **Protected-field enforcement mechanism** — **deferred to an ADR before Sprint 3B** (§10.1).
   **Session/GUC flags are rejected.** Preferred baseline: column privileges + narrowly-owned SECURITY
   DEFINER RPC, subject to the ADR and to actual Supabase role/ownership verification.
3. **`products` semantics** — canonical identity vs current-offer projection vs mixed legacy model
   (repository fact: currently mixed, shop-scoped, no `is_active` — §7). Must be confirmed in 3B before
   choosing where revocation/expiry/supersession fields live (§10.2).
4. **Legacy scraper disposition** — retire outright vs. re-route parsing as a governed adapter emitting
   candidates (never a direct writer, never self-assigning rights).
5. **`Deals` semantics** — a trust-aware view/projection, or `Deals` calling the same backend policy as
   Search (§9 Deals rule); a `/deals` endpoint only if it reuses the same policy.
6. **Real Mall@Reds graph/floorplan source** — manual survey, mall-management CAD, or a map-factory pass
   with human topology sign-off — and how the §11 evidence bar is met.
7. **price_scope display for `online_regional` / `catalogue_national`** — the exact source semantics
   required before either is shown to shoppers (until then, display as `unknown` — §10.3).
8. **Price-scope UX** — exact shopper labelling wording per §10.3.

## 22. Architecture decision records that should follow

- **ADR — Modular monolith for the pilot** (services deferred to measured need).
- **ADR — Canonical ingestion funnel** via `stage_retail_feed_observation` (contract = validation, worker =
  transport, drafts = durable intermediate); legacy writer disposition.
- **ADR — `products` projection-protection mechanism** *(required before Sprint 3B)* — compares (a) column
  privileges + narrowly-owned SECURITY DEFINER RPC, (b) separated protected-projection table, (c) trigger
  enforcement independent of pooled session state, (d) any repository-grounded alternative; **GUC/session
  flags rejected**; must satisfy the §10.1 guarantees (owners + SECURITY DEFINER considered; service-role
  code cannot bypass; changes attributable to an observation + audit event).
- **ADR — `products` semantics + eviction/revocation field placement** (identity vs offer projection vs
  mixed; where back-reference/revocation/expiry/supersession live — §10.2).
- **ADR — Rights inheritance** — rights approved/evidenced in the source registry; adapters inherit, never
  originate/upgrade/approve; unapproved → quarantined (rejects auto `public_fair_use`).
- **ADR — price_scope taxonomy** — pilot display baseline (`branch_specific` / `online_national` /
  `unknown`); `online_regional` / `catalogue_national` need source semantics; verification/scope/stock/
  freshness kept independent (§10.3).
- **ADR — Search baseline `pg_trgm` + filters**; `pgvector`/dedicated search as trigger-gated futures.
- **ADR — Custom node/edge routing retained**; PostGIS/pgRouting trigger-gated; Mall@Reds evidence bar (§11).
- **ADR — Frozen legacy hosted project** `qspsouemjtcdcfnivpnt`; clean staging from 000–039 provisioned in 3A.
- **ADR — AI boundary**: never originates prices/stock/rights/route facts; exception-based human review.

## 23. Red-Team Review Disposition

Gemini's independent red-team review returned **APPROVE WITH CHANGES**. Disposition:

**Accepted (incorporated as-is):**
- RetailerFeedContractV1 = canonical validation contract; durable intake worker = async transport;
  `retail_intake_job_drafts` = durable intermediate record, not a competing truth (§8).
- Direct scraper / parallel-publisher writes to shopper-facing commercial fields **disabled before Sprint
  3A exit**; scraper parsing preserved only as governed adapters emitting candidates (§8, §18, §20).
- Required capabilities: publication back-reference, revocation, expiry/deactivation, source correction,
  removal from active results, auditable rollback/supersession (§10.2).
- `Deals` uses the same trust-aware backend policy as Search/Assistant; `/deals` only if it reuses it (§9).
- `price_scope` selected, returned, and displayed before Sprint 3B exit (§10.3, §18, §19).
- Real Mall@Reds navigation evidence bar: legal floorplan, topology, entrances, vertical transitions,
  calibration, ground-truth route walk (§11, §19).
- Clean staging project created **during Sprint 3A** in the specified sequence; staging proof is a 3A exit
  gate; legacy project stays frozen (§15, §16).

**Accepted with modification:**
- *Protected-field enforcement* — **GUC/session flags rejected** (unsafe under pooled connections). The
  mechanism is **deferred to an ADR before Sprint 3B**, comparing column privileges + narrowly-owned
  SECURITY DEFINER RPC / separated protected table / pooled-state-independent trigger / repository
  alternative, with the §10.1 guarantees (owners + definers considered; service-role cannot bypass;
  attributability). **Preferred baseline: column privileges + SECURITY DEFINER RPC**, subject to the ADR
  and real Supabase role/ownership verification.
- *Eviction/deactivation* — capability **required**, but **`is_active` is not prescribed**; 3B first
  confirms `products` semantics (repository fact: mixed model, no `is_active`), then an ADR decides field
  placement (§7, §10.2).
- *price_scope taxonomy* — adopts the review's shopper labels but **anchored to the repository's actual
  enum** (`online_national`, `online_regional`, `branch_specific`, `catalogue_national`, `unknown`). The
  repo uses `online_national` (not `national_online`) and has no `mall_level`; `online_regional` /
  `catalogue_national` require source semantics before display; `mall_level` / `regional` / `national_in_store`
  are future candidates needing schema approval (§10.3).

**Rejected:**
- *Automatic `source_rights_status = public_fair_use` assignment by adapters/scrapers.* An adapter must
  **never self-authorise legal or commercial use.** Rights are approved and evidenced in the source
  registry; adapters inherit an approved source identity; publication checks the approved rights state;
  unknown/unapproved rights remain quarantined; AI/scraper code may not originate, upgrade, or approve
  rights (§8).

**Deferred to ADRs (before the sprint that needs them):** projection-protection mechanism; `products`
semantics + revocation-field placement; rights inheritance; price_scope taxonomy (§22).

**Sprint deadlines recorded:** before 3A exit — disable/quarantine direct commercial writers, establish the
validation/transport/staging path locally **and** on clean staging, ensure no scraper self-assigns rights.
Before 3B exit — select+implement the projection-protection ADR, add provenance back-reference, add
revocation/expiry/supersession, bring `Deals` through the trust policy, surface `price_scope`, prove
unverified writes cannot preserve a verified trust presentation. Before 3C exit — complete the real
floorplan/graph evidence + route QA and prove one real source-to-shopper-to-route journey (§18, §19).

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
