# MallMind Data Trust Policy Engine

Sprint 9G · MallMind Navigator

---

## Purpose

The Data Trust Policy Engine is the central, deterministic rulebook for classifying whether any mall data point is **real, trusted, verified, stale, disputed, risky, or rejected**.

All five Data Intelligence Bots and the Data Guardian call this engine to produce a consistent, audit-safe trust classification. The engine is a pure function — no external API calls, no database reads, no writes.

**File:** `google-cloud-backend/src/services/dataTrustPolicy.ts`

---

## Core Guarantee

```
must_not_update_live_data: true   →  data MUST NOT be used to update live shops/products/mall_nodes
must_not_update_live_data: false  →  trust is sufficient for admin to consider, but
                                     an EXPLICIT ADMIN APPLY ACTION is still required
```

---

## Trust States (12)

The policy engine classifies every data point into one of twelve trust states.

| State | Meaning | `must_not_update` |
|-------|---------|:-----------------:|
| `raw` | Just arrived — no checks run yet | ✅ true |
| `reported` | User submitted — no supporting evidence | ✅ true |
| `evidence_submitted` | Has photo, receipt, or attached evidence | ✅ true |
| `source_matched` | Source URL/name validated as credible | ✅ true |
| `community_supported` | 3+ independent matching reports agree | ✅ true |
| `admin_verified` | Admin reviewed and approved | ❌ false |
| `physically_verified` | Physical on-site verification performed | ❌ false |
| `retailer_verified` | Retailer directly confirmed | ❌ false |
| `mall_verified` | Mall management confirmed | ❌ false |
| `stale` | Data has exceeded its freshness window | ✅ true |
| `disputed` | Conflicting reports — blocked until resolved | ✅ true |
| `rejected` | Explicitly rejected — do not use | ✅ true |

---

## Trust Level Ladder (8 levels)

The policy engine also maps to the existing 8-level trust ladder (compatible with Data Guardian and Live Data Apply Planner):

| Level | Rank | Applied by |
|-------|------|-----------|
| `demo` | 0 | Raw/rejected data |
| `user_submitted` | 1 | Reported, stale, disputed |
| `evidence_submitted` | 2 | Has photo/receipt |
| `source_matched` | 3 | Credible source or community supported |
| `admin_verified` | 4 | Admin review gate |
| `physically_verified` | 5 | On-site verification |
| `retailer_verified` | 6 | Retailer confirmation |
| `mall_verified` | 7 | Mall management confirmation |

---

## Freshness Rules

| Finding type | Stale after |
|-------------|------------|
| `price` | 7 days |
| `product` | 7 days |
| `promotion` | Promotion expiry date |
| `shop` | 90 days without confirmation |
| `trading_hours` | 90 days without confirmation |
| `floor_layout` | 90 days without confirmation |
| `route_hint` | 90 days without confirmation |
| `other` | 90 days |

When data crosses its freshness threshold, `trust_state` is set to `stale` regardless of the underlying trust signals. `must_not_update_live_data` is always `true` for stale data.

---

## Conflict / Dispute Rules

| Condition | `conflict_risk` | Result |
|-----------|:-----------:|--------|
| `has_conflicting_reports` + `pending_dispute_count ≥ 3` | `high` | `trust_state: disputed` |
| `has_conflicting_reports` + `pending_dispute_count ≥ 1` | `medium` | `trust_state: disputed` |
| `has_conflicting_reports` only | `low` | `trust_state: disputed` |
| `pending_dispute_count ≥ 3` | `high` | `trust_state: disputed` |
| `pending_dispute_count ≥ 1` | `medium` | `trust_state: disputed` |
| None | `none` | No impact |

**Disputed data** is always hard-blocked: `must_not_update_live_data: true`.  
`blocked_actions` includes `create_live_record`, `apply_to_live_data`, `run_apply_planner`.  
The dispute must be resolved (all conflicting reports cleared) before the data can be re-evaluated.

---

## Restricted Sources

The following source patterns are immediately classified as `source_quality: restricted` and the data is set to `trust_state: rejected`:

- `google.com/maps`
- `maps.google`
- `google places` / `place_id`
- `googleapis.com/maps`
- `maps.apple.com`
- `foursquare.com`
- `yelp.com`

This is a hard block — no submission from these sources may proceed to live data.

---

## Evidence Strength Classification

| Strength | Evidence present |
|----------|-----------------|
| `verified` | `has_mall_confirmation` or `has_retailer_confirmation` |
| `strong` | `has_physical_verification` or `has_official_source` or `has_receipt` |
| `moderate` | `has_photo` |
| `weak` | Some `evidence_types[]` but no strong/verified evidence |
| `none` | No evidence at all |

---

## Source Quality Classification

| Quality | Source signals |
|---------|---------------|
| `restricted` | Google Maps, Apple Maps, Yelp, Foursquare |
| `official` | `official_mall_website`, `official_retailer_website`, `government_or_regulatory` |
| `high` | `official_website`, `press_release` source type |
| `medium` | `retail_directory`, `public_flyer`, `news_media`, `.co.za` / `.gov.za` URL |
| `low` | Social media (verified or unverified), `user_generated` |
| `unknown` | No source provided |

---

## Safe Badge Wording

The policy engine is the **only approved source** of user-visible trust labels.

| Trust state | Safe badge |
|-------------|-----------|
| `raw` | Unverified · awaiting review |
| `reported` | Reported by shopper · not yet verified |
| `evidence_submitted` | Evidence submitted · under review |
| `source_matched` | Source checked · awaiting admin approval |
| `community_supported` | Community supported · multiple reports agree |
| `admin_verified` | Verified by MallMind |
| `physically_verified` | Physically verified on-site |
| `retailer_verified` | Retailer confirmed |
| `mall_verified` | Officially verified by mall management |
| `stale` | Data may be outdated · last verified X days ago |
| `disputed` | Data disputed · conflicting reports under review |
| `rejected` | Submission rejected |

**Forbidden wording** (never use in user-visible output):
- "guaranteed" — never allowed
- "in stock" / "definitely available" — never without live feed confirmation
- "accurate" — never for user_submitted data
- "live price" — never without live_feed data quality status

---

## `TrustPolicyResult` Fields

| Field | Type | Description |
|-------|------|-------------|
| `trust_state` | `TrustState` | 12-state classification |
| `trust_level` | `PolicyTrustLevel` | 8-level ladder (compatible with Data Guardian) |
| `confidence_score` | `number` | 0–100 |
| `evidence_strength` | `EvidenceStrength` | none · weak · moderate · strong · verified |
| `source_quality` | `SourceQuality` | unknown · restricted · low · medium · high · official |
| `freshness_state` | `FreshnessState` | fresh · aging · stale · unknown |
| `conflict_risk` | `ConflictRisk` | none · low · medium · high |
| `manual_review_priority` | `ManualReviewPriority` | none · low · medium · high · urgent |
| `safe_badge` | `string` | User-safe badge text (only approved source) |
| `allowed_next_actions` | `string[]` | Actions permitted in this state |
| `blocked_actions` | `string[]` | Actions blocked in this state |
| `reasoning_summary` | `string` | Plain-language reasoning for admin display |
| `missing_evidence` | `string[]` | What evidence would elevate trust |
| `must_not_update_live_data` | `boolean` | True for all states below `admin_verified` |

---

## Exported Functions

All seven functions are pure — no side effects, no external calls.

### `evaluateDataTrust(input: TrustPolicyInput): TrustPolicyResult`

Main entry point. Runs all sub-classifiers and produces a complete `TrustPolicyResult`.

### `classifySourceTrust(source_type?, source_classification?, source_url?): SourceQuality`

Classifies a data source as restricted / official / high / medium / low / unknown.

### `classifyEvidenceStrength(...): EvidenceStrength`

Classifies evidence as none / weak / moderate / strong / verified based on flags.

### `classifyFreshness(finding_type, observed_at?, verified_at?, promotion_expires_at?): FreshnessState`

Applies per-finding-type freshness thresholds. Promotions use their expiry date.

### `classifyConflictRisk(has_conflicting_reports, pending_dispute_count): ConflictRisk`

Returns none / low / medium / high based on dispute signals.

### `getSafeBadgeForTrustState(trust_state, options?): string`

Returns the approved user-visible badge for a trust state. Supports injecting stale age in days.

### `getManualReviewPriority(trust_state, conflict_risk, freshness_state, confidence_score): ManualReviewPriority`

Computes how urgently an admin should review this data.

---

## Integration Points

### Data Guardian (`dataGuardianService.ts`)

Calls `evaluateDataTrust()` at the end of `reviewMallDataSubmission()` and attaches the result as `policy_result` on `DataGuardianResult`.

### Admin Review Assistant Bot (`adminReviewAssistantBot.ts`)

Accepts optional `policy_result` in its input. Uses:
- `policy_result.trust_state === "disputed"` → critical block action
- `policy_result.trust_state === "stale"` → high priority re-verify action
- `policy_result.manual_review_priority === "urgent"` → urgent review action
- `policy_result.blocked_actions` → reasoning on why live apply is blocked

### Live Data Apply Planner Bot (`liveDataApplyPlannerBot.ts`)

Adds a **policy trust_state gate** before the existing trust_level gate.  
The following states hard-block plan generation regardless of trust_level:
`stale`, `disputed`, `rejected`, `raw`, `reported`, `evidence_submitted`, `source_matched`, `community_supported`

### Research Batch Pipeline (`mallResearchBatches.ts`)

After the Data Guardian step, saves `policy_result` to `bot_hints_used` separately (key: `"policy_result"`) so the UI can display the Truth Status block without re-running the guardian.

---

## UI — Truth Status Block

The Admin Dashboard → Research Batches tab shows a **Truth Status** panel for each batch item once a Data Guardian run has produced a `policy_result`.

The panel shows:
- Trust state badge (colour-coded)
- Confidence score
- Conflict risk (shown in red if non-zero)
- Freshness state (coloured by freshness)
- Manual review priority
- Safe badge text
- Evidence / source / freshness / conflict / must_not_update grid
- Reasoning summary
- Missing evidence hints (what would elevate trust)
- Blocked and allowed actions

---

## Allowed / Blocked Actions Reference

| Trust state | Allowed | Blocked |
|-------------|---------|---------|
| `rejected` / restricted | `reject` | everything else |
| `disputed` | `flag_for_human_review`, `reject`, `mark_as_disputed` | `create_finding`, `add_to_batch`, `run_apply_planner`, `create_live_record`, `apply_to_live_data` |
| `stale` | `flag_for_human_review`, `mark_as_stale`, `request_more_evidence` | `run_apply_planner`, `create_live_record`, `apply_to_live_data` |
| `raw` | `flag_for_human_review`, `request_more_evidence` | `create_finding`, `add_to_batch`, `run_apply_planner`, `create_live_record`, `apply_to_live_data` |
| `reported` → `source_matched` | `create_finding`, `add_to_batch`, `request_more_evidence`, `flag_for_human_review` | `run_apply_planner`, `create_live_record`, `apply_to_live_data` |
| `admin_verified` and above | all actions | none |

---

## Why a Central Policy Engine

Previously, trust rules were scattered across:
- `dataGuardianService.ts` (base trust + confidence)
- `sourceResearchBot.ts` (source restriction)
- `liveDataApplyPlannerBot.ts` (trust gate)
- `adminReviewAssistantBot.ts` (risk synthesis)

This meant:
- Freshness rules existed nowhere
- Conflict/dispute state existed nowhere
- The 12 trust states existed nowhere
- Different bots could produce inconsistent trust assessments

The central `dataTrustPolicy.ts` engine provides a single source of truth for all trust decisions. All bots call the same functions. The same input always produces the same output.

---

## Roadmap

- **Sprint 10:** `trust_state` and `policy_result` stored on `mall_research_batch_items` as a real column (not just JSONB) to enable filtering/sorting by trust state
- **Sprint 11:** Admin "Dispute Resolution" workflow — surfaces all disputed items for a mall in one view
- **Sprint 12:** Automatic staleness scan — daily cron job marks items with expired freshness windows
