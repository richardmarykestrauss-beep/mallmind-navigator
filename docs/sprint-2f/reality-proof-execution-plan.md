# Mall@Reds Reality-Proof — Execution Plan

**Status: PLAN + RESEARCH TARGETS ONLY.** No cloud resource created, no deploy, no scraping, no
ingestion, no schema migration, no frontend connection, no production access. Nothing was
executed against any external retailer or Google Cloud.

This plan sequences the move from *infrastructure* to *one real mall*, across two parallel
workstreams. It is deliberately concrete and reuses what already exists — it introduces **no new
framework**.

---

## The four things MallMind must prove (and where each is addressed)

| # | Claim to prove | Addressed by |
|---|---|---|
| 1 | The durable engine works on real dev cloud infrastructure | **Workstream A** — [worker dev deployment plan](../environments/mallmind-intake-worker-dev-deployment-plan.md) |
| 2 | We can rapidly obtain substantial real Mall@Reds product data | **Workstream B** — [live research targets](mallreds-live-research-targets.json) + [acquisition lanes](retailer-acquisition-lane-matrix.json) |
| 3 | We can identify the fastest credible navigation path | **Workstream B** — [navigation tech matrix](navigation-technology-research-matrix.json) |
| 4 | The shopper can eventually search real products and route to real stores | Convergence of 1–3 (see sequencing) |

Grounding audit (repository truth): `docs/sprint-2f/mallreds-*-audit*` / `mallreds-gap-register.json`.

---

## Workstream A — durable worker dev proof (READY, at STOP GATE)

Full inspection, resource plan, IAM matrix, secret matrix, and the exact 21-step command plan are
in the [deployment plan](../environments/mallmind-intake-worker-dev-deployment-plan.md). Summary:

- **Reuses merged Sprint 2E** verbatim (worker, GCS adapter, Postgres gateway, fixture uploader,
  crash hook, fixture-only guard, service-to-service auth). Nothing rewritten.
- **Proves:** 1,000-record fixture → private dev GCS → private Cloud Run worker (`africa-south1`)
  → `mallmind-dev` Postgres → lease claim → bounded chunk commits → durable checkpoints →
  `INTAKE_DEV_CRASH_AFTER_CHUNK` interruption → lease expiry → replacement worker resumes →
  exact reconciliation → **zero** duplicate evidence/drafts/quarantine → **zero** publication.
- **Fail-closed:** every command sets an explicit dev target; production ref never appears;
  fixture-only mode stays on; least-privilege IAM; no SA JSON keys; private (`--no-allow-unauthenticated`).
- **Also measures** the real `africa-south1 → Stockholm` Cloud Run→Supabase latency (the open item
  from the KEEP-Stockholm region decision) via `duration_ms` per `intake.chunk_committed`.
- **STOP GATE (A6):** nothing runs until Richard supplies the dev GCP `PROJECT_ID`, the
  `mallmind-backend-dev` SA email, a dev source UUID, and the two dev secret values (piped in-session).

## Workstream B — Mall@Reds reality readiness (RESEARCH TARGETS READY)

Four machine-readable artifacts, all "no scraping yet", all external facts flagged
`requires_live_verification`:

- [`mallreds-live-research-targets.json`](mallreds-live-research-targets.json) — 5 priority
  retailers (Game, Woolworths, PEP, Clicks + one unidentified grocery anchor), scored, with the
  live queries needed. No tenants invented.
- [`retailer-acquisition-lane-matrix.json`](retailer-acquisition-lane-matrix.json) — 19 acquisition
  lanes × applicability, each with proof/sample/fields/legal-review/integration/failure.
- [`mallreds-map-source-targets.json`](mallreds-map-source-targets.json) — directory + map/floor-plan
  targets with copyright guidance (extract facts, don't copy artwork).
- [`navigation-technology-research-matrix.json`](navigation-technology-research-matrix.json) — 20
  positioning/nav technologies scored for web-PWA fit, hardware, mall cooperation, SA feasibility.

---

## Recommended sequencing (fastest credible path)

1. **Run Workstream A** (after the A6 gate) — proves the durable engine on real dev infra. Independent
   of retailer data; unblocks confidence in the ingestion path and yields the latency number.
2. **Identify the real tenants** — official Mall@Reds directory + Google Places
   ([map-source-targets](mallreds-map-source-targets.json)). This resolves the unknown grocery anchor
   and every retailer identity gap. **Live research; legal-light (facts only).**
3. **Flagship product proof** — the "43-inch TV under R5000 at Mall@Reds": capture ONE real, verified,
   in-budget TV at the real electronics store via `manual_controlled_uploads` (first-party evidence),
   enriched with a manufacturer image/spec. Publish through the existing evidence→review→publish path.
   This is the smallest end-to-end shopper-truth proof.
4. **Scale product coverage** — for Game + Woolworths, evaluate `product_sitemap_jsonld` /
   `public_search_endpoint` **after legal review**; enrich identity with GTIN databases. Per-branch
   availability stays on the `manual_controlled_uploads` lane (the only honest branch-stock source).
5. **Navigation proof** — QR-anchor scan-to-locate on one Mall@Reds floor, re-origining the existing
   Dijkstra route from a real node (fixes the inert `current_anchor_node_id`; replaces manual "Done"
   taps). Cheapest web-first path with zero mall hardware; validate before considering SDKs.
6. **Converge (claim 4)** — with real tenants (2), a real evidence-backed offer (3), and real routing
   (5), a shopper can search a real product and route to the real store on one floor of one mall.

## Hard boundaries (unchanged)

No new frameworks · no dashboard redesign · no Pub/Sub or Eventarc · no autonomous AI operator ·
no production access · **no scraping/ingestion in this package** · no schema migrations yet ·
no frontend connected to dev · governed publication only (nothing bypasses human review).

## Blockers requiring live internet research

- The **real Mall@Reds tenant list** (official directory) — blocks retailer identity, incl. the
  unidentified grocery anchor.
- Whether each retailer exposes a **lawful structured product source** (API/sitemap/JSON-LD/feed) —
  every acquisition lane is `requires_live_verification`.
- Official/lawful **floor-plan and store-number** sources for real routing.
- **Navigation vendor** capabilities/pricing/SA-support and PWA sensor/Wi-Fi restrictions — the entire
  nav matrix is unverified until live-checked.
- Legal/ToS/robots review before ANY live retailer traffic.

## Explicitly NOT done in this package

No cloud resource created or changed · no deploy · no fixture upload · no DB job · no scraping or
retailer data acquired · no production system touched · no migrations · no frontend↔dev connection.
