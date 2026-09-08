# Retail Intelligence Fabric — Sprint 1

**Source Adapter SDK + Evidence Vault**, built ON TOP of the existing ingestion
system (source registry, snapshots, trust labels, conflict/stale detection, review
queue, Data Command Center) — not a parallel system.

> **Reality label:** _Prototype — local persisted data_. No live web extraction,
> no network requests, no external/paid services, no production writes, no remote
> migrations, no deploy. Adapters run against **deterministic local fixtures** only.

## Architecture

```
src/lib/fabric/
  types.ts        Common typed contract (adapter I/O, policy, evidence, identity, events, runs)
  hash.ts         Deterministic content hashing (FNV-1a, sha256:-style marker)
  normalize.ts    Identity normalization (trim / lower / quotes+inches / model punct / whitespace)
  lifecycle.ts    Deterministic lifecycle state machine + illegal-transition rejection
  policy.ts       Source policy engine (no policy / blocked / mode / tier enforcement)
  events.ts       Typed internal event model + per-run collector
  evidence.ts     Evidence vault: create/revise (immutable), provenance links, confidence, trust suggestion
  identity.ts     Product-identity match hierarchy → ranked merge candidates (no auto-merge)
  registry.ts     Adapter registry (dup rejection, enable/disable, capabilities)
  runner.ts       Orchestrates a run through the lifecycle → evidence + events (never publishes)
  store.ts        Local prototype persistence + deterministic seed + registry bootstrap
  adapters/       ManualSnapshot, JsonLdFixture, CatalogueFixture, SitemapFixture
  fixtures/       jsonld / catalogue / sitemap deterministic fixtures
src/components/ingestion/fabricSections.tsx   DCC operational views + provenance drawer
```

## Lifecycle

```
DISCOVERED → CAPTURED → EXTRACTED → NORMALIZED → VALIDATED → CONFLICT_CHECKED
          → REVIEWED → APPROVED → PUBLISHED → STALE / WITHDRAWN
   (any state → FAILED; nothing skips REVIEWED on the way to APPROVED/PUBLISHED)
```

The runner walks an adapter to **CONFLICT_CHECKED** at most and marks the run
`needs_review`. **No adapter can publish an offer directly** — approval/publish
only ever happens in the existing human review queue.

## Adapter contract

`SourceAdapter { adapterId, sourceId, mode, version, discover, capture, extract, validate }`
with typed `SourceCandidate → CaptureResult → ExtractionCandidate → ValidationResult`.
Modes: `partner_api | merchant_feed | json_ld | sitemap | catalogue | newsletter |
browser_observation | manual`. All Sprint-1 adapters are pure + deterministic and
perform **no network I/O**.

## Source policy model

Every source must have a `SourceAccessPolicy` before any adapter runs. Execution is
denied — with a visible reason surfaced in the Data Command Center — when:
- **no policy exists** (`no_policy`),
- the source is **`blocked`** (`source_blocked`),
- the mode is **not in `allowedModes`** (`mode_not_allowed`),
- the **automation tier forbids** the mode (`tier_forbids_mode`) — e.g. `manual_only`
  permits only `manual`/`catalogue`.

There is **no silent fallback to automation**.

## Evidence vault model

`EvidenceRecord` carries source/owner/adapter/version, lifecycle state, captured +
observed timestamps, content type + deterministic hash, typed **references** (raw /
screenshot / document — never inline binaries), page number + bounding box, extracted
text, structured payload, extractor id/version, **six-dimension field confidence**,
reviewer status/notes, and a **revision chain** (`revision` / `revisionOf` /
`supersededBy`). Corrections create a new revision; the original is never overwritten.

**Provenance links** connect evidence to product offers, source snapshots, ingestion
runs, conflict alerts, and review decisions — one offer may have many evidence records
(seed links `offer_game_hisense43` to a JSON-LD record **and** a manual confirmation).

## Field-level confidence

`identityConfidence, priceConfidence, availabilityConfidence, locationConfidence,
freshnessConfidence, sourceAuthority` — internal adjudication only. `suggestTrustLabel`
recommends an existing user-facing trust label (conflict → `conflict_detected`; partner
feed + recent + branch → `verified_live`/`partner_feed`; catalogue + validity →
`catalogue_special`; public page → `recently_observed`) but **never auto-applies or
auto-publishes**.

## Demo adapters (deterministic, no network)

- **ManualSnapshotAdapter** — human-supplied URL/text/metadata; always requires review.
- **JsonLdFixtureAdapter** — parses Schema.org Product/Offer JSON-LD fixtures.
- **CatalogueFixtureAdapter** — parses catalogue blocks with page + bounding-box metadata (no OCR).
- **SitemapFixtureAdapter** — parses a local XML sitemap into candidate URLs.

## Product identity

`matchIdentity` returns ranked `MergeCandidate`s by tier — exact GTIN → exact
manufacturer model → exact retailer SKU → brand+model → normalized title → human
review — each with confidence + explanation. **No automatic fuzzy merge**; soft
matches never auto-link.

## Data Command Center

Four new operational views appended to the existing command center (section nav
extended): **Adapter Registry**, **Source Policies**, **Evidence Vault**, **Adapter
Runs**, plus a **Provenance detail drawer** (source URL, captured time, extracted
fields + confidence bars, evidence text, page/bbox, adapter/extractor versions, review
notes, linked offers). Adapter **Run** and **Enable/Disable** buttons are wired — no
dead buttons. Everything is labelled "Prototype fixture" / "No live source request is
performed".

## Security & governance

No credentials in adapter definitions; no dynamic code execution / remote code loading;
no direct publishing from adapter output; policy `blocked`/`manual_only` enforced;
deterministic evidence hashing; sanitized error messages; fixtures contain no personal
or sensitive data.

## Tests

`src/lib/fabric/fabric.test.ts` (29) + `src/pages/admin/DataCommandCenter.test.tsx` (1):
registration, duplicate/disabled rejection, missing-policy/disallowed-mode/blocked-source/
manual-only enforcement, manual+JSON-LD+catalogue+sitemap extraction, stable hashing,
evidence immutability, multi-evidence provenance, confidence validation, trust-label
suggestion, conflict linkage, exact GTIN/model matching, no-auto-fuzzy-merge, lifecycle
transitions (valid + rejected), event generation, **no-auto-publish**, and DCC section
rendering.

## Gates

`npm test` **107 pass** · `npm run build` · `npm run verify:all` **9/9** · `typecheck`
adds **zero** new errors (11 pre-existing in unrelated files).

## Not built (by design)

No live web extraction. No external/paid service integration (Firecrawl/Apify/Stagehand/
Document AI/Pub-Sub/Eventarc are design targets only). No production data written. No
remote migrations. No deploy.

## Recommended Sprint 2

- Wire approved evidence into offer creation through the existing review queue (still
  human-gated), attaching provenance links automatically.
- A real content-addressed evidence store (Cloud Storage refs) behind the same typed API.
- First authorized connector behind a policy gate (partner API or merchant feed) using
  the same contract, plus a scheduled-run surface.
- Map the event model onto Pub/Sub + a Cloud Run worker for capture/extraction.
