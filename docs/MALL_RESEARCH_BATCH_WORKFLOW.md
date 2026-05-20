# MallMind Mall Research Batch Workflow

Sprint 9E/9F/9G/9H · MallMind Navigator

---

## Purpose

The Mall Research Batch Workflow is a controlled admin workspace for collecting, organising, and reviewing raw data findings for a specific mall — across multiple sessions — before any data is considered for live database application.

**Core guarantee:**
- **Nothing in this workflow writes to `shops`, `products`, or `mall_nodes`.**
- All writes are limited to `mall_research_batches` and `mall_research_batch_items` (staging tables only).
- An admin must take a separate, explicit apply action (via the Live Data Apply Planner Bot) to move data to live tables.

---

## Concepts

### Batch
A **batch** is a named collection of findings for one research session targeting a single mall. Examples:
- "Sandton City — May 2026 phone survey"
- "Mall of Africa — floor layout update Q2 2026"
- "Gateway — new store openings June 2026"

### Batch Item (Finding)
A **batch item** is a single raw data point collected during the research session — a text observation, a source URL, an extracted detail, or a combination. Items have a **finding type** that categorises what was observed.

### Status flow
```
Batch:   open → in_progress → complete
                            ↘ archived
```
```
Item:    pending → reviewed → accepted
                           ↘ rejected
                           ↘ flagged
```

---

## Data Flow

```
Admin opens/creates a batch for a mall
  → Admin adds findings (raw text + source URL) as batch items
  → Admin runs Data Intelligence Bots on each item:
      Source Research Bot   → validates source URL safety
      Finding Extractor Bot → extracts prices, unit codes, hours
      Duplicate Detection Bot → checks for existing DB matches
      Data Guardian         → assigns trust level + confidence
      Admin Review Assistant Bot → synthesises all bot outputs
  → Admin reviews each item (accept / reject / flag)
  → [optional] Admin runs Live Data Apply Planner Bot → gets field-level patch plan
  → Admin marks batch complete
  → SEPARATE EXPLICIT APPLY ACTION required to write to live tables
  → Audit log records every step
```

---

## Database Schema

### `mall_research_batches`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | auto-generated |
| `mall_id` | UUID FK → malls | nullable |
| `title` | TEXT NOT NULL | human-readable name for the batch |
| `description` | TEXT | optional detail |
| `status` | TEXT | `open` · `in_progress` · `complete` · `archived` |
| `notes` | TEXT | free-form admin notes |
| `item_count` | INTEGER | denormalised — incremented on item add |
| `reviewed_count` | INTEGER | denormalised — incremented on first review of an item |
| `created_by` | UUID FK → auth.users | admin who created the batch |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-managed by trigger |

### `mall_research_batch_items`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | auto-generated |
| `batch_id` | UUID FK → mall_research_batches | cascades on delete |
| `sequence_number` | INTEGER | optional ordering hint |
| `finding_type` | TEXT | `shop` · `product` · `trading_hours` · `floor_layout` · `promotion` · `other` |
| `raw_text` | TEXT | free-form observation text |
| `source_url` | TEXT | URL of the data source |
| `source_name` | TEXT | human-readable source name |
| `status` | TEXT | `pending` · `reviewed` · `accepted` · `rejected` · `flagged` |
| `admin_notes` | TEXT | review notes from admin |
| `bot_hints_used` | JSONB | JSON snapshot of bot outputs used as reference |
| `extracted_data` | JSONB | structured data extracted during review — staging only |
| `reviewed_by` | UUID FK → auth.users | admin who reviewed the item |
| `reviewed_at` | TIMESTAMPTZ | timestamp of first review action |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-managed by trigger |

**RLS:** Both tables require `profiles.is_admin = true`. The backend service role bypasses RLS.

---

## API Reference

All endpoints require `Authorization: Bearer <admin-token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`   | `/admin/mall-research/batches` | List all batches (newest first). Supports `?mall_id=` and `?status=` filters. |
| `POST`  | `/admin/mall-research/batches` | Create a new batch. Body: `{ title, mall_id?, description?, notes? }` |
| `GET`   | `/admin/mall-research/batches/:id` | Fetch a batch with all its items. |
| `POST`  | `/admin/mall-research/batches/:id/items` | Add a finding item to a batch. Body: `{ finding_type?, raw_text?, source_url?, source_name?, sequence_number? }` |
| `PATCH` | `/admin/mall-research/batches/:id/items/:itemId` | Update item status, notes, extracted_data, or bot_hints_used. Body: `{ status?, admin_notes?, extracted_data?, bot_hints_used? }` |
| `PATCH` | `/admin/mall-research/batches/:id/status` | Update batch status. Body: `{ status }` |

### Example: Create a batch
```json
POST /admin/mall-research/batches
{
  "mall_id":     "uuid-of-sandton-city",
  "title":       "Sandton City — May 2026 phone survey",
  "description": "Verify new store openings on Level 2"
}
```

### Example: Add a finding item
```json
POST /admin/mall-research/batches/{id}/items
{
  "finding_type": "shop",
  "raw_text":     "New H&M store on Level 2, unit L2-44. Opening 1 June.",
  "source_url":   "https://sandtoncity.com/stores/hm",
  "source_name":  "Sandton City official website"
}
```

### Example: Review an item
```json
PATCH /admin/mall-research/batches/{id}/items/{itemId}
{
  "status":       "accepted",
  "admin_notes":  "Confirmed via official website. Trust level admin_verified.",
  "extracted_data": {
    "name":   "H&M",
    "floor":  "L2",
    "unit":   "L2-44"
  }
}
```

---

## Bot Integration

The Research Batch Workflow is designed to be used alongside the Data Intelligence Bot Suite (Sprint 9C). The recommended order for each batch item:

### Step 1 — Source Research Bot
```
POST /admin/data-bots/source-research
{ "source_url": "<item.source_url>", "source_name": "<item.source_name>" }
```
→ Validates source isn't Google Maps / Yelp. Returns `source_category` and `trust_ceiling`.

### Step 2 — Finding Extractor Bot
```
POST /admin/data-bots/extract-finding
{ "raw_text": "<item.raw_text>", "hint_finding_type": "<item.finding_type>" }
```
→ Extracts prices, unit codes, floor labels, hours from raw text.

### Step 3 — Duplicate Detection Bot
```
POST /admin/data-bots/detect-duplicates
{ "finding_type": "shop", "name": "<extracted shop name>", "mall_id": "<batch.mall_id>" }
```
→ Returns match candidates from existing `shops` / `products` rows.

### Step 4 — Data Guardian
```
POST /admin/data-guardian/review
{ "raw_text": "<item.raw_text>", "source_url": "<item.source_url>", ... }
```
→ Assigns `trust_level` and `confidence_score`.

### Step 5 — Admin Review Assistant Bot (optional)
```
POST /admin/data-bots/review-assistant
{ "guardian_result": {...}, "source_result": {...}, "duplicate_result": {...}, "extractor_result": {...} }
```
→ Synthesises all results into a prioritised action list.

### Step 6 — Live Data Apply Planner Bot (when trust level ≥ admin_verified)
```
POST /admin/data-bots/plan-apply
{ "finding_type": "shop", "trust_level": "admin_verified", "confidence_score": 85, "structured_data": {...} }
```
→ Returns a field-level patch plan — **NEVER writes to live tables.**

---

## Frontend: Research Batches Tab

The admin UI exposes the workflow as the **Research Batches** tab in the Admin Dashboard (8th tab, requires backend).

### Batch list view
- Lists all batches, newest first
- Filter by status
- One-click to open a batch

### Batch detail view
- Shows all items with status badges
- Expandable item rows: raw text, source URL, bot hint shortcuts, action buttons
- Quick actions per item: Accept · Reject · Flag · Mark Reviewed
- Admin notes textarea per item
- Add Finding form: finding type + raw text + source URL
- Batch status transitions: open → in_progress → complete / archived
- Progress stats: total items · pending · accepted · rejected

### Bot hints in the UI
Each batch item shows a hint strip pointing to the 4 bots to run:
> Source Research · Find & Extract · Check Duplicates · Data Guardian
> All bots are in the **Bot Suite** tab.

---

## Why No Automatic Updates

The batch workflow is a research and review tool — not an import pipeline. The same reasons that motivate the Bot Suite's `must_not_update_live_data` guarantee apply here:

1. Raw text may contain errors, guesses, or outdated information.
2. Sources may be unreliable, unverified, or policy-restricted.
3. Exact duplicate matching is probabilistic — human confirmation is required.
4. Trust level must meet a minimum gate (`admin_verified`) before a patch plan can be generated.

The admin is always the final decision-maker.

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `Cannot add items to an archived batch` | Change batch status to `open` or `in_progress` first |
| Item stays `pending` after review | Only the first transition from `pending` to a reviewed state records `reviewed_by` and `reviewed_at` |
| `item_count` seems stale | The count is updated fire-and-forget — refresh the batch detail to get the accurate item list count |
| Batch not visible in list | Check the status filter — it may be filtering to a specific status |

---

---

## One-Click Bot Pipeline (Sprint 9F)

Each batch item now has direct bot action buttons — no need to copy-paste text between Research Batches and the Bot Suite tab.

### What each button does

| Button | Bot | What it uses from the item |
|--------|-----|---------------------------|
| **Source** | Source Research Bot | `source_url`, `source_name`, `raw_text` (as description) |
| **Extract** | Finding Extractor Bot | `raw_text`, `finding_type` as hint |
| **Guardian** | Data Guardian | `raw_text`, `source_url`, `finding_type`, `batch.mall_id`, `extracted_data`, source_research result |
| **Duplicate** | Duplicate Detection Bot | Shop/product name from extractor output or `extracted_data`, `batch.mall_id` |
| **Review** | Admin Review Assistant | All previously run bot outputs in `bot_hints_used` |
| **Run Full Pipeline** | All 5 bots in sequence | Everything above, step by step |

### Why outputs are saved to `bot_hints_used`

`bot_hints_used` is a JSONB staging field on each batch item. It is the only field that bot pipeline writes touch — no `shops`, `products`, or `mall_nodes` are touched. Storing outputs here lets the admin:
- Re-open a batch item days later and see prior bot analysis
- Run individual bots in any order
- Pass all outputs to Admin Review Assistant for a synthesised recommendation
- Keep a full audit trail of bot reasoning

### Storage format

```json
{
  "source_research":     { ... SourceResearchResult ... },
  "finding_extractor":   { ... FindingExtractorResult ... },
  "data_guardian":       { ... DataGuardianResult ... },
  "policy_result":       { ... TrustPolicyResult ... },
  "duplicate_detection": { ... DuplicateDetectionResult ... },
  "admin_review":        { ... AdminReviewAssistantResult ... },
  "pipeline": {
    "last_run_at": "2026-05-13T10:00:00.000Z",
    "steps_completed": ["source_research", "finding_extractor", "data_guardian", "policy_result", "duplicate_detection", "admin_review"],
    "warnings": []
  }
}
```

`policy_result` is saved separately after the Data Guardian runs so the Truth Status block in the UI can render without inspecting the full guardian output. It contains the 12-state `trust_state`, `evidence_strength`, `source_quality`, `freshness_state`, `conflict_risk`, `manual_review_priority`, `safe_badge`, `allowed_next_actions`, `blocked_actions`, and `must_not_update_live_data`.

### Why live data is not updated automatically

1. Bot outputs are advisory — deterministic rules applied to unverified text.
2. Trust level must be `admin_verified` (rank 4/7) or higher before even a patch *plan* can be generated.
3. Even a patch plan requires a separate, explicit admin apply action to write to `shops`/`products`.
4. Item status is never changed by a bot run — the admin clicks Accept/Reject/Flag manually.

### Suggested workflow for a new mall (e.g. Mall@Reds)

1. Create a batch: "Mall@Reds — June 2026 survey"
2. For each shop/price finding, add a batch item with raw text + source URL
3. For each item, click **Run Full Pipeline**
4. Check the "Bot Outputs" panel:
   - **Source Research**: is the source trusted? Is it blocked by policy?
   - **Finding Extractor**: did it extract the right shop name, floor, unit?
   - **Data Guardian**: what trust level and confidence score did it assign?
   - **Duplicate Detection**: is there already a Game / Woolworths entry for this mall?
   - **Admin Recommendation**: what's the synthesised action?
5. Read the "Bot suggestion" banner for the top recommended action
6. Make your decision — click Accept, Reject, or Flag
7. When a batch item is accepted with sufficient trust, use the Bot Suite → Live Data Apply Planner to generate a patch plan
8. Apply patch manually via direct DB access or a future Apply workflow

### Example — Mall@Reds Game item

**Raw text:**
> Game is listed as Shop G01 on Ground Floor. Category Electronics.

**Expected bot outputs after pipeline:**
- Source Research: `source_category: unknown`, `risk_level: medium` (no source URL)
- Finding Extractor: extracts `shop_name: Game`, `floor: Ground Floor`, `unit_code: G01`
- Data Guardian: `trust_level: user_submitted` (no official source), `confidence_score: ~30`
- Duplicate Detection: finds existing Game shop if `mall_id` is set, returns `link_to_existing` recommendation
- Admin Review: `overall_risk: medium`, suggests "Needs admin cross-check — duplicate candidate found"

**Admin decision:** Review the duplicate candidate. If it's the same Game shop, reject this item (already exists). If it's a new location, accept and run Apply Planner.

### How to interpret bot recommendations

| Recommendation | Meaning |
|----------------|---------|
| `proceed` | Source is trusted — safe to continue |
| `proceed_with_caution` | Semi-official source — cross-check recommended |
| `needs_admin_review` | Low-trust or ambiguous — human must decide |
| `reject` | Policy block or no data — do not use |
| `create_new` | No duplicate found — safe to create a new record |
| `link_to_existing` | Match found — verify and link to existing record |
| `approve_for_admin_review` | Guardian says trust is sufficient for admin to decide |

### What to do after Admin Review Assistant recommends an action

The Admin Review Assistant shows a **suggestion banner** in the item row. It is advisory only.

- If it says "Accept" → verify the extracted data looks correct, then click **Accept**
- If it says "Reject" or "BLOCKED" → click **Reject** and add a note
- If it says "needs_more_info" → click **Flag** and note what's missing
- Never click Accept just because the bot said so — always read the raw text and extractor output

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `Cannot add items to an archived batch` | Change batch status to `open` or `in_progress` first |
| Item stays `pending` after review | Only the first transition from `pending` to a reviewed state records `reviewed_by` and `reviewed_at` |
| `item_count` seems stale | The count is updated fire-and-forget — refresh the batch detail to get the accurate item list count |
| Batch not visible in list | Check the status filter — it may be filtering to a specific status |
| Bot action buttons unresponsive | Ensure the backend URL is configured (`VITE_GOOGLE_BACKEND_URL`) and you are logged in as admin |
| Pipeline halted at source_research | Source URL matched a restricted pattern (Google Maps etc.) — use mall's official website |
| Finding Extractor extracts nothing | Raw text may be too short or contain no structured signals — add more detail |
| Duplicate bot returns no candidates | Check that `batch.mall_id` is set and the item's shop name is spelled correctly |
| Admin Review returns no actions | Run at least one other bot first — Admin Review synthesises prior bot outputs |

---

---

## Source Ingestion Agent (Sprint 9H)

The **Source Ingestion Agent** panel appears inside each open research batch. It allows an admin to provide a single official/public source URL and have MallMind automatically:

1. Check the source against the Source Research Bot policy
2. Fetch the public page (if allowed)
3. Extract readable plain text from the HTML
4. Split into candidate findings (shop names, floors, units, hours, promotions)
5. Run the Finding Extractor Bot on each candidate
6. Create pending batch items for each useful candidate
7. Optionally run the full bot pipeline on each created item

### What is safe to ingest

- Official mall websites (e.g. `mallatreds.co.za`, `sandtoncity.com`)
- Official retailer websites (`woolworths.co.za`, `game.co.za`)
- Press releases and public directories
- Any page you are permitted to read as a member of the public

### What is blocked

- Google Maps / Google Places / Google Maps API
- Apple Maps
- Yelp / Foursquare / TripAdvisor / Waze / MapQuest
- Any source the Source Research Bot classifies as `restricted`

### Suggested workflow for a new mall (e.g. Mall@Reds)

1. Create a batch: "Mall@Reds — June 2026 survey"
2. Open the batch → **Source Ingestion Agent** panel
3. Enter `https://mallatreds.co.za/stores`
4. Source name: "Mall@Reds official website", source type: "Official website"
5. Max items: 50 · Check "Run bot pipeline" for automated analysis
6. Click **Ingest Source**
7. Review the summary — candidates found, items created, any warnings
8. Open each item in the **Findings** list:
   - Check the **Truth Status** panel (Trust state, confidence, freshness)
   - Check the **Data Guardian** and **Admin Recommendation** outputs
9. Accept items that are accurate; reject items that are wrong or duplicate
10. For accepted items with `admin_verified` trust: use Bot Suite → Live Data Apply Planner

### Important guarantees

- All created items have `status: pending` — always
- No live data is updated automatically
- Admin must explicitly accept and apply each finding
- The agent does not follow links or download images/PDFs
- The agent does not use AI — all extraction is deterministic regex

See [SOURCE_INGESTION_POLICY.md](SOURCE_INGESTION_POLICY.md) for the full policy document.

---

## Roadmap

- **Sprint 10:** "Apply to live data" button on accepted items with `trust_level >= admin_verified` — calls Live Data Apply Planner then admin confirm → actual `UPDATE`
- **Sprint 11:** Bulk import — paste a list of raw text observations → auto-creates one item per line
- **Sprint 13:** Mall comparison batches — compare findings across multiple batches for the same mall over time
