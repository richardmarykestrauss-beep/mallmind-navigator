# Retail Intelligence Fabric — Sprint 2A

**Human-Gated Evidence-to-Offer Review Bridge.** Turns reviewed extraction
candidates into normalized drafts → auditable review decisions → staged/approved
`ProductOffer`s → a separate publication gate → an assistant-safe retrieval path.

> **Reality label:** _Prototype — local persisted data_. No live extraction, no
> external/paid service, no production writes, no remote migrations, no deploy.
> Everything runs on the deterministic fixture adapters from Sprint 1.

> **Branch note:** builds on `feat/retail-fabric-sprint-1` (PR #26). As of this
> writing neither #25 nor #26 is merged into `claude-premium-nav-test`, so this is
> stacked on the fabric branch and should merge after them.

## Architecture (`src/lib/fabric/`)

```
draft.ts         normalizeToDraft — ExtractionCandidate → OfferDraft (deterministic, idempotent)
review.ts        ReviewDecision model — append-only, guarded approvals, explicit field patches
publication.ts   evaluatePublication — separate eligibility gate (blockers never become warnings)
offerBridge.ts   createOfferFromDecision / applyPublication — the ONE controlled offer path
assistantSafe.ts publication-gated retrieval + limitation-carrying assistant output
bridgeStore.ts   submitDecision — orchestrates decision → offer → publication across both stores
```

## Normalization flow

`ExtractionCandidate → normalizeToDraft(ext, ctx) → OfferDraft(needs_review)`.
Validates required price/title, rejects invalid/impossible prices + unsupported
currencies, records warnings, maps identifiers, and **never invents fields** or
infers mall/branch scope from a national page (public pages → `online_only`,
catalogue → `national`, manual → `unknown`; never `mall`/`branch`). The draft is
**idempotent**: same candidate + normalizer version → same `draftHash` and id.

## Review decision model

`ReviewDecision` is append-only (`previousDecisionId` + `decisionVersion`).
Corrections are explicit `FieldPatch[]`, never silent edits — the draft and
evidence are unchanged. Approval is guarded (`approvalBlockers`):
- requires evidence, price, title, observedAt and source;
- **branch** availability requires branch-scoped evidence (`locationConfidence ≥ 0.5`);
- **verified_live** requires an authorized policy + high source-authority evidence;
- **unresolved conflicts** block approval until explicitly resolved (a
  `conflictState → resolved` patch).

## Publication policy

`evaluatePublication → { eligible, blockers, warnings }`. Blockers: not approved,
missing evidence, blocked source policy, expired, stale-beyond-policy, unresolved
conflict, `conflict_detected` trust, unavailable, missing source reference, unmet
verified_live. Warnings: availability unknown, online-only, branch not confirmed,
manual-admin data, low confidence, upcoming expiry. **A blocker is never silently
downgraded to a warning.** Approval, publication eligibility, and actual
publication are three separate states — offers are created **unpublished**.

## Provenance path

Every derived offer retains `evidenceIds`, `reviewDecisionId`, `draftId`,
`sourceId`, and adapter/extractor/normalizer versions. `createOfferFromDecision`
emits provenance links (`product_offer → evidence`, `review_decision → evidence`).
One offer can carry multiple evidence records.

## Assistant safety path

The assistant may only retrieve offers that are **approved AND publication
eligible** (`filterAssistantEligible`) — which already excludes stale, unavailable,
conflict-blocked, evidence-less, and blocked-source offers. Each assistant view
carries trust label, observed date, a source/freshness statement, geographic
scope, an availability limitation, and expiry — never claiming live price / branch
stock / store availability unless approved fields + evidence support it. (The
existing curated `buildTvUnderBudgetAnswer` is left unchanged; the hardened path is
additive and is what the Publication Readiness view uses.)

## Data Command Center

Two new sections + a drawer: **Extraction Review Queue** (draft, source, adapter,
price, evidence count, confidence, warnings, conflict, action), **Review Drawer**
(side-by-side **Evidence Comparison** with conflict highlighting; approve / reject /
request-changes / archive; final trust label, availability, geographic scope,
explicit price correction, conflict resolution, reasoning; live approval-blocker
display), and **Publication Readiness** (eligible/blocked, blockers, warnings,
linked offer, evidence lineage). No dead buttons; actions update both prototype
stores deterministically.

## Tests

`src/lib/fabric/bridge.test.ts` (22) + DCC render test: candidate→draft
normalization, stable draft hash, invalid price / unsupported currency rejection,
no field invention, evidence-required approval, append-only decisions + correction
patch lineage, conflict blocks approval + publication, expired catalogue blocked,
unavailable blocked, unknown-availability warning, branch-requires-branch-evidence,
verified_live policy requirements, idempotent approval, multi-evidence offer,
rejection creates no offer, adapter-cannot-publish, assistant excludes non-eligible,
assistant output carries limitations, and the full JSON-LD → evidence → draft →
review → publish → assistant fixture workflow.

## Gates

`npm test` **129 pass** · `npm run build` · `npm run verify:all` **9/9** ·
`typecheck` adds **zero** new errors (11 pre-existing in unrelated files).

## Not built (by design)

No live extraction. No external/paid service. No production writes. No remote
migrations. No deploy. Assistant wiring into the main recommendation path is left
additive (Sprint 2B).

## Recommended Sprint 2B

- Make the hardened retrieval the sole assistant path (retire the legacy filter),
  and thread it into `rankOffers`/`recommend`.
- Draft creation from any adapter run (queue drafts directly from `AdapterRun`
  evidence), plus batch review.
- Conflict resolution workflow (choose the winning evidence, record the rationale).
- Persist decisions/drafts to the real evidence store once it exists; map
  `offer.published` transitions onto the event model → Pub/Sub.
