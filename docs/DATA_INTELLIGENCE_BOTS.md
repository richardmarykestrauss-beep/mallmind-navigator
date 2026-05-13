# MallMind Data Intelligence Bot Suite

Sprint 9C / 9G / 9H · MallMind Navigator

---

## Purpose

The Data Intelligence Bot Suite is a collection of five specialist, deterministic bots that assist admins in evaluating and preparing raw data submissions before they are considered for live database updates.

**All bots are:**
- 100% deterministic — no external AI calls, no automatic live data updates
- Rule-based and regex-based — consistent results for the same input
- Audit-logged — every bot run is recorded in `admin_audit_log`

**Core guarantee on every bot output:**
```
must_not_update_live_data: true  →  bot output must not be used to update live shops/products/routes
must_not_update_live_data: false →  admin may proceed to next step — explicit apply action still required
```

---

## Data Flow

```
Raw text / source / submission
  → Data Guardian (trust scoring)
  → Source Research Bot (source safety)
  → Finding Extractor Bot (field extraction)
  → Duplicate Detection Bot (DB lookup)
  → Admin Review Assistant Bot (synthesised action list)
  → Live Data Apply Planner Bot (field-level patch plan)
  → ADMIN EXPLICIT APPLY ACTION (not automatic)
  → Audit log
```

No step in this pipeline writes to `shops`, `products`, `mall_nodes`, or any live data table.

---

## Bot 1 — Source Research Bot

**Endpoint:** `POST /admin/data-bots/source-research`

Classifies a source URL or name/description and determines whether it is:
- Safe to use as a data source
- Restricted by policy (Google Maps, Apple Maps, Foursquare, Yelp)
- SA-relevant (recognised mall or retailer domain)

### Google Maps / Places rule

**HARD BLOCK** — the bot immediately returns `blocked_by_policy` for any of:
- `google.com/maps`
- `maps.google`
- `google places` / `place_id`
- `googleapis.com/maps`
- `maps.apple.com`
- `foursquare.com`
- `yelp.com`

Google's Terms of Service explicitly forbid storing or redistributing their places data in a competing database. Violation risks legal action and platform bans.

### Source categories

| Category | Trust ceiling |
|----------|--------------|
| `official_mall_website` | source_matched → admin_verified |
| `official_retailer_website` | source_matched → admin_verified |
| `retail_directory` | source_matched |
| `press_release` | source_matched |
| `news_media` | source_matched |
| `public_flyer` | evidence_submitted |
| `social_media_verified` | evidence_submitted |
| `social_media_unverified` | user_submitted |
| `user_generated` | user_submitted |
| `government_or_regulatory` | source_matched |
| `unknown` | user_submitted |

### Request

```json
{
  "source_url":         "https://sandtoncity.com/stores",
  "source_name":        "Sandton City official",
  "source_description": "Tenant directory",
  "submitted_by_type":  "admin"
}
```

### Response (example)

```json
{
  "bot_name":                 "SourceResearchBot",
  "processed_at":             "2026-05-13T10:00:00.000Z",
  "risk_level":               "low",
  "recommendation":           "proceed",
  "live_data_action_safety":  "safe_to_plan",
  "must_not_update_live_data": false,
  "reasoning":                ["Official source detected (official_mall_website). High baseline trust.", "Trust ceiling: source_matched → admin_verified."],
  "source_category":          "official_mall_website",
  "is_restricted":            false,
  "trust_ceiling":            "source_matched → admin_verified",
  "sa_relevance_signals":     ["Recognised South African mall domain", ".co.za TLD detected — likely South African site"],
  "quality_flags":            []
}
```

---

## Bot 2 — Finding Extractor Bot

**Endpoint:** `POST /admin/data-bots/extract-finding`

Applies deterministic regex patterns to free-form text to extract:
- Prices (`R999`, `R 1,299.99`)
- Unit codes (`G12`, `L2-34`)
- Floor labels (`Ground Floor`, `Level 1`)
- Trading hours (`08:00`, `9am – 9pm`)
- Shop names (`at Game`, `Pick n Pay store`)
- Promotion signals (`sale`, `special`, `20% off`)

No AI — all extractions are rule-based.

### Request

```json
{
  "raw_text": "Game store at Sandton City Ground Floor unit G12 is selling the Samsung 65\" TV for R12,999 on special until end of May.",
  "hint_finding_type": "price"
}
```

### Response fields

| Field | Description |
|-------|-------------|
| `extracted_findings` | Array of finding objects, each with `finding_type` and `fields` array |
| `total_signals_found` | How many field values were extracted |
| `finding_types_detected` | Which finding types were identified |
| `extraction_summary` | Human-readable summary |

---

## Bot 3 — Duplicate Detection Bot

**Endpoint:** `POST /admin/data-bots/detect-duplicates`

Reads `shops` and `products` from Supabase (no writes) and checks for name matches using normalised word-overlap scoring.

**Match strength:**
| Score | Strength |
|-------|---------|
| ≥ 95% | `exact` |
| ≥ 75% | `high` |
| ≥ 50% | `medium` |
| ≥ 25% | `low` |
| < 25% | `none` (excluded) |

**Floor + unit bonuses:** Same floor adds +5%, same unit_number adds +10%.

### Dedup recommendations

| Recommendation | Meaning |
|----------------|---------|
| `create_new` | No significant match — safe to create a new record |
| `link_to_existing` | Strong match found — admin should verify and link |
| `needs_human_review` | Multiple weak matches — admin must decide |

### Request

```json
{
  "finding_type": "shop",
  "name":         "Game",
  "mall_id":      "uuid-of-mall"
}
```

---

## Bot 4 — Admin Review Assistant Bot

**Endpoint:** `POST /admin/data-bots/review-assistant`

Accepts JSON outputs from any combination of the other bots and synthesises them into a prioritised action list for the admin.

**Pure function** — accepts pre-run results as input. Does not call other bots internally.

### Priority order

| Priority | Example actions |
|----------|-----------------|
| `critical` | Reject — restricted source detected |
| `high` | Exact duplicate found · Confidence below 40% |
| `medium` | Source quality flags · Review candidates |
| `low` | Ready for live apply plan |

### Input

```json
{
  "guardian_result":  { ... DataGuardianResult ... },
  "source_result":    { ... SourceResearchResult ... },
  "duplicate_result": { ... DuplicateDetectionResult ... },
  "extractor_result": { ... FindingExtractorResult ... }
}
```

All four fields are optional — pass whichever results you have.

### Response fields

| Field | Description |
|-------|-------------|
| `recommended_actions` | Prioritised list of `{ priority, action_label, description }` |
| `summary_for_admin` | One-sentence summary |
| `safe_to_proceed` | `true` if no blockers and risk is not critical |
| `blocker_reasons` | Array of hard-block messages |
| `confidence_score` | From Data Guardian if provided |
| `trust_level` | From Data Guardian if provided |

---

## Bot 5 — Live Data Apply Planner Bot

**Endpoint:** `POST /admin/data-bots/plan-apply`

Proposes a field-level patch plan for applying a finding to a live data record.

**NEVER writes to the database.** The plan is a proposal — an admin must take an explicit apply action.

### Minimum trust level gate

Trust level must be `admin_verified` (rank 4/7) or higher. Lower trust levels are hard-blocked.

| Trust level | Can generate plan? |
|-------------|-------------------|
| `demo` | ❌ Blocked |
| `user_submitted` | ❌ Blocked |
| `evidence_submitted` | ❌ Blocked |
| `source_matched` | ❌ Blocked |
| `admin_verified` | ✅ Yes |
| `physically_verified` | ✅ Yes |
| `retailer_verified` | ✅ Yes |
| `mall_verified` | ✅ Yes |

### Allowed fields per table

**`shops`:** `name, floor, unit_number, category, opening_time, closing_time, phone, email, website`

**`products`:** `name, brand, price, is_on_special, original_price, special_price, category, description`

**`mall_nodes`:** `name, floor, type, x, y`

All other fields in `structured_data` are silently skipped and reported in `fields_skipped`.

### Request

```json
{
  "finding_type":    "shop",
  "trust_level":     "admin_verified",
  "confidence_score": 85,
  "structured_data": { "name": "Game", "floor": "G", "unit_number": "G12" },
  "target_record_id": "uuid-of-existing-shop"
}
```

### Response fields

| Field | Description |
|-------|-------------|
| `target_table` | `shops`, `products`, `mall_nodes`, or `none` |
| `proposed_patches` | Array of `{ field, proposed_value, confidence, notes }` |
| `fields_skipped` | Fields excluded from the plan |
| `plan_blocked` | `true` if trust level or data is insufficient |
| `block_reason` | Why the plan was blocked |
| `plan_summary` | Human-readable summary of the patch |

---

## API Reference

All endpoints:
- Require admin bearer token (`Authorization: Bearer <token>`)
- Fire-and-forget `admin_audit_log` entry on every call
- Return `BotOutputBase` fields on every response

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/data-bots/source-research`  | POST | Source classification + policy check |
| `/admin/data-bots/extract-finding`  | POST | Regex field extraction from raw text |
| `/admin/data-bots/detect-duplicates` | POST | Supabase duplicate search |
| `/admin/data-bots/review-assistant` | POST | Synthesise bot results into action list |
| `/admin/data-bots/plan-apply`       | POST | Field-level patch plan (no DB writes) |

---

## Shared Output Fields (`BotOutputBase`)

Every bot response includes:

```json
{
  "bot_name":                  "SourceResearchBot",
  "processed_at":              "2026-05-13T10:00:00.000Z",
  "risk_level":                "low | medium | high | critical",
  "recommendation":            "proceed | proceed_with_caution | needs_admin_review | reject | escalate",
  "live_data_action_safety":   "safe_to_plan | requires_review | do_not_apply | blocked_by_policy",
  "reasoning":                 ["..."],
  "must_not_update_live_data": true
}
```

---

## Why No Automatic Updates

MallMind is a navigation and shopping assistant. Incorrect data directly harms shoppers:

1. **Wrong shop locations** → shoppers routed to wrong floor
2. **False prices** → misleads price-comparison decisions
3. **Stale promotions** → shoppers expect discounts that have expired
4. **Duplicate records** → split reviews and reviews across two "same" stores

The bot suite surfaces these risks deterministically. A human admin is always the final decision-maker.

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `blocked_by_policy` on source | Source URL/name matches a restricted pattern (Google Maps, etc.) — use mall's own official website |
| `plan_blocked: true` on apply planner | Trust level is below `admin_verified` — run the Data Guardian first and ensure the trust level is upgraded |
| No fields in `proposed_patches` | All `structured_data` fields were excluded — check `fields_skipped` and rename fields to match the allowed set |
| Duplicate detection returns no candidates | Check the name spelling — normalisation strips punctuation, so "Pick 'n Pay" → "pick n pay" |
| Admin Review Assistant returns no actions | No input results provided — pass at least one bot result as input |

---

---

## Research Batch Integration (Sprint 9F)

All five bots can now run directly from Research Batch items via one-click buttons in the Admin Dashboard → Research Batches tab.

### New endpoints (Sprint 9F)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/mall-research/items/:id/run-source-research`  | Run Source Research Bot on item |
| POST | `/admin/mall-research/items/:id/run-finding-extractor` | Run Finding Extractor Bot on item |
| POST | `/admin/mall-research/items/:id/run-data-guardian`    | Run Data Guardian on item |
| POST | `/admin/mall-research/items/:id/run-duplicate-check`  | Run Duplicate Detection on item |
| POST | `/admin/mall-research/items/:id/run-admin-review`     | Run Admin Review Assistant on item |
| POST | `/admin/mall-research/items/:id/run-full-pipeline`    | Run all 5 bots in sequence |

Bot outputs are saved to `mall_research_batch_items.bot_hints_used` JSONB — never to `shops`, `products`, or `mall_nodes`.
Item status is never changed automatically by a bot run.

### Standalone Bot Suite tab

The Bot Suite tab remains fully functional and useful for:
- **Testing bots with freeform input** — paste any raw text or URL without creating a batch item
- **One-off source validation** — check a source URL before starting a research session
- **Debugging bot behaviour** — run individual bots with controlled inputs and inspect the full JSON response
- **Live Data Apply Planner** — generate a patch plan from any structured data, not just batch items

The Research Batch integration is the **production workflow** (input derived from real batch items, outputs saved back). The Bot Suite tab is the **sandbox** (freeform input, no persistence).

---

---

## Data Trust Policy Engine (Sprint 9G)

A central deterministic policy engine (`dataTrustPolicy.ts`) now underpins all five bots.

### What it adds

- **12 trust states:** `raw → reported → evidence_submitted → source_matched → community_supported → admin_verified → physically_verified → retailer_verified → mall_verified → stale → disputed → rejected`
- **Freshness rules:** prices stale after 7 days; promotions at expiry; shop/layout after 90 days
- **Conflict/dispute gate:** any conflicting reports → `trust_state: disputed` → `must_not_update_live_data: true`
- **Restricted source gate:** Google Maps, Yelp, etc. → `trust_state: rejected`
- **Safe badge wording** — the only approved source for user-visible trust labels
- **Allowed / blocked actions** per trust state

### Integration

| Bot | How it uses the engine |
|-----|----------------------|
| Data Guardian | Calls `evaluateDataTrust()` — attaches `policy_result` to its output |
| Admin Review Assistant | Accepts optional `policy_result` — uses `trust_state`, `conflict_risk`, `manual_review_priority` for additional actions |
| Live Data Apply Planner | New policy trust_state gate — blocks `stale`, `disputed`, `rejected`, `raw`, `reported`, `evidence_submitted`, `source_matched`, `community_supported` regardless of trust_level |
| Research Batch pipeline | Saves `policy_result` to `bot_hints_used` after Data Guardian runs |

### UI — Truth Status block

Each Research Batch item shows a **Truth Status** panel (collapsed by default) once the Data Guardian has run. It shows trust state, confidence, conflict risk, freshness, safe badge, blocked/allowed actions, and what evidence would elevate trust.

See [DATA_TRUST_POLICY.md](DATA_TRUST_POLICY.md) for the full specification.

---

---

## Source Ingestion Agent (Sprint 9H)

The **Source Ingestion Agent** (`sourceIngestionService.ts`) feeds candidate findings into the Research Batch workflow from official/public source pages.

**It is not a scraper or crawler.** It is a single-page, admin-requested fetch that:
- Applies the same source safety rules as the Source Research Bot
- Hard-blocks Google Maps, Apple Maps, Yelp, Foursquare, TripAdvisor, Waze, MapQuest
- Fetches one page per request (no recursive link following)
- Extracts plain text using deterministic HTML stripping (no browser, no AI)
- Runs the Finding Extractor Bot on each candidate chunk
- Creates `mall_research_batch_items` with `status: pending`
- Optionally runs the full 5-bot pipeline on each created item

**API endpoint:** `POST /admin/mall-research/batches/:id/ingest-source`

**Safe source types:** official mall websites, official retailer websites, press releases, public directories, public flyers.

**Always blocked:** any source matching the Source Research Bot restriction patterns.

See [SOURCE_INGESTION_POLICY.md](SOURCE_INGESTION_POLICY.md) for the full allowed/blocked source list and safe workflow.

---

## Roadmap

- **Sprint 10:** Apply Planner → admin confirm → actual `UPDATE` call (first live data write from batch item)
- **Sprint 11:** Batch processing — run full pipeline against all pending items in a batch queue
- **Sprint 12:** Mall Data Compiler findings → Research Batch bridge — import compiler findings as batch items
