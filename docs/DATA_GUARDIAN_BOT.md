# MallMind Data Guardian Bot

Sprint 9B · MallMind Navigator

---

## Purpose

The Data Guardian Bot is MallMind's verification gatekeeper.

It reviews raw data submissions, public-source findings, photo/receipt references, and admin notes. It classifies trust level, recommends safe badge wording, detects missing evidence, and ensures unverified data never goes straight into live shops, products, or routes.

**Core principle:** Raw data is not live data.

```
Submission / Source / Evidence
  → Data Guardian review
  → structured finding recommendation
  → admin review
  → future apply-to-live action
  → audit log
```

The service is 100% deterministic. No external AI calls. No database reads. Pure function.

---

## Trust Ladder

Levels are ordered from lowest (0) to highest (7):

| # | Level | Description | Max Confidence |
|---|-------|-------------|---------------|
| 0 | `demo` | No submission context — treated as sample data | 10% |
| 1 | `user_submitted` | Shopper text only, no supporting evidence | 40% |
| 2 | `evidence_submitted` | Photo, receipt, or flyer attached | 60% |
| 3 | `source_matched` | Official/semi-official public source | 75% |
| 4 | `admin_verified` | Admin submitted or reviewed with source | 90% |
| 5 | `physically_verified` | In-person on-site confirmation | 90% |
| 6 | `retailer_verified` | Retailer directly confirmed | 98% |
| 7 | `mall_verified` | Mall management confirmed | 98% |

### `must_not_update_live_data`

| Trust level | must_not_update_live_data | Notes |
|-------------|--------------------------|-------|
| `demo` | ✅ true | Never update live data |
| `user_submitted` | ✅ true | Create finding only |
| `evidence_submitted` | ✅ true | Create finding only |
| `source_matched` | ✅ true | Approve for admin review, not live yet |
| `admin_verified` | ❌ false | Admin apply action required |
| `physically_verified` | ❌ false | Admin apply action required |
| `retailer_verified` | ❌ false | Admin apply action required |
| `mall_verified` | ❌ false | Admin apply action required |

> Even when `must_not_update_live_data` is `false`, an **explicit admin apply action** is required. No automatic updates occur in any sprint.

---

## Source Rules

### ✅ Allowed sources

| Type | Examples | Trust ceiling |
|------|---------|--------------|
| `official_website` | `sandtoncity.com`, `game.co.za` | source_matched → admin_verified |
| `retail_directory` | Mall tenant list, Gumtree business listings | source_matched |
| `public_flyer` | Woolworths weekly ad (public PDF), Clicks catalogue | evidence_submitted |
| `manual_survey` | Admin physically visited the mall | admin_verified |
| `press_release` | New store opening on a press wire | source_matched |
| `social_media` | Verified brand's public Instagram/Facebook | evidence_submitted |
| `other` | Anything not fitting the above | case-by-case |

### ❌ Disallowed sources — Google Maps / Places rule

**Never scrape, cache, or store data from:**

- Google Maps
- Google Places API
- Google Street View
- Apple Maps
- Foursquare (without valid API agreement)
- Yelp (without valid API agreement)
- Any platform whose Terms of Service prohibit data extraction

Google's ToS explicitly forbids storing or redistributing their places data in a competing database. Violation risks legal action and platform bans.

**Safe alternative:** Use the mall's own official website or contact mall management directly.

---

## Proof Packs

### New shop proof pack (minimum for `source_matched`)

- [ ] Shop name
- [ ] Mall name or mall ID
- [ ] Floor number
- [ ] Unit number or nearby landmark
- [ ] Category (electronics, clothing, food, etc.)
- [ ] Storefront photo **or** official mall website listing
- [ ] Date observed / date effective

For `admin_verified` or higher, also:
- [ ] Admin review of above evidence
- [ ] Source URL or reference document

### Product price proof pack (minimum for `evidence_submitted`)

- [ ] Product name
- [ ] Brand (if applicable)
- [ ] Shop/store name
- [ ] Mall name or mall ID
- [ ] Price (exact)
- [ ] Shelf photo, receipt, retailer website, or admin verification
- [ ] Date observed
- [ ] Promotion flag (yes/no)
- [ ] Promotion expiry date (if promotion = yes)

For `admin_verified` or higher, also:
- [ ] Admin confirmation of price from a verifiable source

---

## Confidence Scoring Table

Confidence score caps are applied in order:

| Condition | Cap |
|-----------|-----|
| No evidence + submitted by user | ≤ 40% |
| Evidence present but no official/admin/retailer/mall verification | ≤ 60% |
| Source matched but not admin reviewed | ≤ 75% |
| Admin or physical verification only | ≤ 90% |
| Retailer or mall verified | ≤ 98% |

Base scores by signal:

| Signal | Trust level | Base confidence |
|--------|------------|-----------------|
| Mall management confirmation | mall_verified | 98% |
| Retailer direct confirmation | retailer_verified | 95% |
| Physical on-site verification | physically_verified | 90% |
| Admin + official source | admin_verified | 85% |
| Admin only | admin_verified | 82% |
| Retailer submitted (no explicit confirmation) | source_matched | 75% |
| Official website (official_website) | source_matched | 72% |
| Semi-official source (retail_directory, etc.) | source_matched | 65% |
| Receipt evidence | evidence_submitted | 60% |
| Photo evidence | evidence_submitted | 50% |
| Public flyer | evidence_submitted | 48% |
| Social media photo | evidence_submitted | 45% |
| User text only | user_submitted | 25% |
| System generated | user_submitted | 20% |
| No context | demo | 10% |

---

## Recommended Actions

| Action | When |
|--------|------|
| `reject` | No content or evidence submitted |
| `needs_more_info` | Critical missing evidence |
| `create_finding` | Enough to warrant a pending finding — user/evidence level |
| `approve_for_admin_review` | Source matched or admin reviewed — ready for admin decision |
| `apply_to_existing_record` | Retailer/mall verified + no missing evidence |

---

## Safe Badge Wording

The `safe_badge` field contains the only user-visible trust label. It comes from a fixed mapping — never generated dynamically.

| Trust level | Safe badge |
|------------|-----------|
| `demo` | `Sample data · price may vary` |
| `user_submitted` | `Reported by shopper · awaiting verification` |
| `evidence_submitted` | `Evidence submitted · under review` |
| `source_matched` | `Source matched · awaiting admin approval` |
| `admin_verified` | `Verified by MallMind` |
| `physically_verified` | `Physically verified` |
| `retailer_verified` | `Retailer verified` |
| `mall_verified` | `Mall verified` |

### Forbidden wording (must never appear in user-visible text below the required trust level)

| Word/phrase | Minimum trust level to use |
|-------------|---------------------------|
| "verified" | `admin_verified` and above |
| "confirmed" | `retailer_verified` / `mall_verified` only |
| "guaranteed" | **Never** |
| "in stock" | **Never** without a `live_feed` data quality status |
| "definitely available" | **Never** |
| "official" | `mall_verified` only |
| "accurate" | **Never** for `user_submitted` |
| "live price" | **Never** without `live_feed` data quality status |

---

## Output JSON Example

```json
{
  "recommended_action": "create_finding",
  "finding_type": "shop",
  "trust_level": "user_submitted",
  "confidence_score": 25,
  "safe_badge": "Reported by shopper · awaiting verification",
  "reasoning_summary": "Trust level: user submitted (confidence: 25%). User text submission only — no supporting evidence. Missing evidence (5): Shop name; Mall name or mall ID; Floor number; Unit number or nearby landmark; Storefront photo or official source URL.",
  "missing_evidence": [
    "Shop name",
    "Mall name or mall ID",
    "Floor number",
    "Unit number or nearby landmark",
    "Storefront photo or official source URL",
    "Date observed"
  ],
  "structured_data": {},
  "admin_note": "Auto-scored by Data Guardian: user_submitted at 25% confidence. Created as a pending finding. Requires admin review before any live data update. REMINDER: Live database update requires an explicit admin apply action — never automatic.",
  "must_not_update_live_data": true
}
```

---

## Why It Must Not Update Live Data Automatically

MallMind is a navigation and shopping assistant. Incorrect shop locations, wrong prices, and bad route hints directly harm user trust.

Automatic updates from unverified submissions would:

1. **Corrupt shop locations** — a user misremembering a floor could route shoppers to the wrong level
2. **Introduce false prices** — a malicious or mistaken price submission could mislead shoppers
3. **Break routes** — incorrect floor/unit data feeds into the route-building graph

The Data Guardian prevents this by enforcing a human-in-the-loop review at every level below `admin_verified`. Even at `retailer_verified` and `mall_verified`, an explicit admin apply action is the final gate.

This is a deliberate product decision, not a technical limitation. Future sprints will add the admin apply UI — but the gating will remain.

---

## API Reference

### POST /admin/data-guardian/review

Requires admin bearer token.

**Request body** (all fields optional except none strictly required — bot handles missing fields gracefully):

```json
{
  "mall_id": "uuid (optional)",
  "source_type": "official_website | retail_directory | public_flyer | manual_survey | press_release | social_media | other",
  "finding_type": "shop | product | price | trading_hours | floor_layout | route_hint | promotion | other",
  "submitted_by_type": "user | admin | retailer | mall | system",
  "raw_text": "Free-text description of the submission",
  "source_url": "https://source-url.co.za/stores",
  "structured_data": { "name": "Game", "floor": "G", "price": 12999 },
  "observed_at": "2026-05-13",
  "has_photo": false,
  "has_receipt": false,
  "has_official_source": true,
  "has_retailer_confirmation": false,
  "has_mall_confirmation": false,
  "has_physical_verification": false
}
```

**Response:** `DataGuardianResult` (see Output JSON Example above)

**Side effects:** Fire-and-forget `admin_audit_log` entry only. No writes to live tables.

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| High confidence but still `must_not_update_live_data: true` | Check trust level — must be `admin_verified` or above to unlock live update path |
| `needs_more_info` even with evidence | Check `missing_evidence` array — specific fields are missing from `structured_data` |
| `reject` returned | No `raw_text` and no `structured_data` fields provided |
| All confidence capped at 40% | `submitted_by_type: user` with no evidence flags checked |
| Route hint showing low trust | Route hints require official source, physical verification, or admin — user hints always stay low |
