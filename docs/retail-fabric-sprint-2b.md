# Retail Intelligence Fabric — Sprint 2B

**Hardened Recommendation Spine.** Makes the governed, evidence-backed path the
real product spine: the normal shopper recommendation flow now depends only on
approved, publication-eligible, evidence-backed offers. Demo / staged / unreviewed
/ unpublished / stale / unavailable / conflicted / evidence-less offers can no
longer leak into normal mode.

> **Reality label:** _Prototype — local persisted data_. No live scraping, no
> external service, no production writes, no remote migrations, no deploy. Existing
> trust/freshness protections are preserved (nothing weakened).

> **Branch note:** stacked on `feat/retail-fabric-sprint-2a` (PR #27). The whole
> stack (#25 → #26 → #27 → this) is unmerged; `claude-premium-nav-test` has no
> `src/lib/fabric/`. Verified with `git merge-base` before branching.

## Canonical recommendation source

`src/lib/fabric/recommendationSpine.ts` is the ONE shopper-facing retrieval path:

```
getShopperEligibleOffers(ingestion, fabric, query, now, mode) → { offers, diagnostics }
```

NORMAL-mode gates (every one required): review approved · publication eligible ·
**published/active** · evidence present · source policy not blocked · no unresolved
conflict · availability ≠ unavailable · not expired · not stale beyond policy ·
product identity resolved · mall/store scope compatible · branch claims only with
branch evidence. It returns internal exclusion diagnostics (for tests + admin
observability) but never leaks internal tokens to shoppers.

## Before / after data flow

- **Before:** the assistant preview called `buildTvUnderBudgetAnswer` → `rankOffers`,
  whose only gate was `published + approved + not-unavailable`. Curated demo,
  evidence-less and conflicted seed offers could appear.
- **After:** normal mode calls `buildShopperAnswer` → `getShopperEligibleOffers`
  (full governance) → `rankEligible` → shopper-safe contract. The legacy builder is
  untouched and is now the explicit **curated_demo** mode.

## Weak fallback paths found + handling

| Path | Before | Handling |
| --- | --- | --- |
| `buildTvUnderBudgetAnswer` / `rankOffers` (assistant preview) | published+approved only | Left intact for tests; normal UI path switched to the governed spine; it is now the labelled `curated_demo` mode. |
| Seed curated offers (mostly evidence-less) | recommendable | Excluded in normal mode (missing_evidence); available only in `curated_demo`. |
| Conflicted / unavailable / expired seed offers | recommendable if published | Excluded by the publication gate in normal mode. |
| Real Supabase `AssistantPage` backend | separate production path | **Out of scope** — the browser-local fabric can't feed a Supabase backend without external services/production writes (forbidden). Documented as a Sprint 2C boundary. |

## Ranking changes

Ranking runs over the **already-eligible** set, so it can never promote an
ineligible offer. Intents: **budget** (mall relevance → trust → freshness → branch →
price), **cheapest** (cheapest eligible, trust breaks ties), **verified_only**
(only `verified_live`; if none, an honest no-result — never widens).

## Assistant response contract

`ShopperOption` carries product, retailer, store, price + original price, trust
label **text**, observed date, freshness statement, source type (humanized),
geographic scope + scope statement, availability statement, branch-stock flag,
expiry, an evidence-backed explanation, and a route action only when a store exists
at the mall. Forbidden claims ("in stock now", "live price", "available at this
branch", "verified" for manual/staged) never appear, and **no internal enum/status
token appears in shopper-facing text**.

## Gemini / tool path

`toGeminiCandidate` / `buildGeminiCandidates` expose only safe fields (title,
retailer, store, price, trust/freshness summary, availability limitation, scope,
route id) — no drafts, blockers, legal notes, reviewer notes, or raw evidence. The
model may explain/compare eligible candidates; it cannot override publication
policy. On failure, the deterministic fallback uses **the same eligible set**.

## Feature modes

- **normal** — governed eligible offers only (default).
- **curated_demo** — explicitly labelled "Curated demonstration data"; cannot
  silently activate in normal mode.
- **admin_preview** — shows ineligible offers with blockers for debugging; never
  publishes or leaks into shopper mode.

## Observability

`EligibilityDiagnostics` (total considered, eligible, and per-category exclusions).
Surfaced admin-only in the Assistant preview and a compact **Recommendation Spine**
section in the Data Command Center. Never shown to shoppers.

## Data compatibility

No destructive migration. Offers lacking governance fields are treated as
**ineligible** in normal mode (never silently grandfathered as approved); demo/admin
preview can still show them. Backward-compatible optional types.

## Tests

`src/lib/fabric/recommendationSpine.test.ts` (17) + extended DCC render test:
eligible baseline; staged/needs_review/rejected/unpublished/evidence-less/expired/
stale/unavailable/conflict/blocked-source/mall-mismatch/branch-mismatch exclusion;
online-only labelling; presence≠branch-stock; verified-only never widens; cheapest
picks cheapest eligible; cheaper-ineligible can't outrank; normal≠demo; curated_demo
labelled; Gemini sanitization; failure fallback uses the same set; no internal
tokens in shopper text; route action only with a valid store; diagnostics accuracy;
no mutation of evidence/review records.

## Gates

`npm test` **146 pass** · `npm run build` · `npm run verify:all` **9/9** ·
`typecheck` adds **zero** new errors (11 pre-existing in unrelated files).

## Browser QA

Verified in the app (zero console errors): (1) TV under R4000 normal → 13
considered, 1 eligible, honest diagnostics, no false branch claim; (2) verified-only
→ honest no-result ("nothing shown rather than widening"); (3) cheapest → cheapest
eligible; (6) admin preview → excluded offers with blockers (e.g. `offer_game_hisense43:
conflict`). DCC Recommendation Spine section renders.

## Not built (by design)

No live extraction. No external service. No production writes. The real Supabase
`AssistantPage` backend is untouched — wiring governance into it needs the fabric
persisted server-side (Sprint 2C), which would be external/production work.

## Recommended Sprint 2C

- Persist the fabric governance (policies, evidence, decisions, drafts, published
  offers) to Supabase so the real backend `ai-assistant` function can call
  `getShopperEligibleOffers` server-side and the shopper `AssistantPage` becomes
  governed end-to-end.
- Retire `buildTvUnderBudgetAnswer` once the curated-demo route is fully separated.
- Feed `buildGeminiCandidates` into the backend tool-calling payload; add
  eligibility diagnostics to backend analytics.
