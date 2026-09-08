# MallMind Source Ingestion Policy

Sprint 9H · MallMind Navigator

---

## Purpose

The Source Ingestion Agent allows MallMind admins to fetch a single allowed public webpage, extract readable text, and automatically create candidate research batch items for admin review.

This document defines which sources are allowed, which are blocked, and what the agent may and may not do.

---

## Core Principle

> The ingestion agent may **collect and stage** candidate findings.
> It may **not verify, apply, or approve** live data by itself.

Every item created by the ingestion agent:
- Has status `pending` — always
- Must be reviewed, accepted, or rejected by a human admin
- Is subject to all existing bot pipeline checks (Source Research Bot, Data Guardian, etc.)
- Will never automatically update `shops`, `products`, or `mall_nodes`

---

## Hard-Blocked Sources

The following source URLs/names are **always blocked** — no fetch is attempted:

| Pattern | Reason |
|---------|--------|
| `google.com/maps` | Google Maps — ToS prohibits data extraction |
| `maps.google` | Google Maps — ToS prohibits data extraction |
| `google places` / `place_id` | Google Places API — ToS prohibits storing places data |
| `googleapis.com/maps` | Google Maps API — ToS prohibits redistribution |
| `maps.apple.com` | Apple Maps — ToS prohibits data extraction |
| `yelp.com` | Yelp — requires valid API agreement |
| `foursquare.com` | Foursquare — requires valid API agreement |
| `tripadvisor.com` | TripAdvisor — ToS prohibits scraping |
| `waze.com` | Waze (Google subsidiary) — ToS prohibits extraction |
| `mapquest.com` | MapQuest — ToS prohibits data extraction |

These are enforced at two layers:
1. **Hard-block regex check** in `sourceIngestionService.ts` (before any fetch)
2. **Source Research Bot** (before any fetch, as a secondary check)

If either layer flags a restricted source, ingestion stops immediately and no items are created.

---

## Allowed Source Types

| Source type | Trust ceiling | Notes |
|-------------|--------------|-------|
| `official_website` / `official_mall_source` | `admin_verified` | Mall's own website — safest |
| `official_retailer_source` | `admin_verified` | Retailer's own website |
| `public_reference_source` | `source_matched` | Press release, news article |
| `retailer_website` | `admin_verified` | Same as official_retailer_source |
| `public_flyer` | `evidence_submitted` | Scanned flyer / PDF extract |
| `press_release` | `source_matched` | Official press release |
| `unknown` | `user_submitted` | Allowed with warnings — use with caution |

If the source type is `unknown`, the ingestion agent proceeds but:
- Attaches a warning to the summary
- Creates items with `user_submitted` trust ceiling
- No auto-approval is possible

---

## What the Agent Does

1. **Pre-flight hard-block check** — URL is checked against blocked patterns
2. **Source Research Bot** — classifies the source and checks for policy violations
3. **Fetch** — single GET request to the source URL (15-second timeout, max 1.5 MB)
4. **HTML extraction** — strips scripts, styles, nav, footer; preserves line structure
5. **Candidate chunking** — splits text into lines, filters junk, keeps lines with mall signals
6. **Finding Extractor Bot** — runs on each candidate chunk
7. **Batch item creation** — creates `mall_research_batch_items` with `status: pending`
8. **Optional pipeline** — if `run_pipeline: true`, runs the full 5-bot pipeline on each item

---

## What the Agent Does NOT Do

- ❌ Does not write to `shops`, `products`, or `mall_nodes`
- ❌ Does not auto-approve findings
- ❌ Does not change item status (stays `pending`)
- ❌ Does not follow links recursively
- ❌ Does not download binary files (PDFs, images)
- ❌ Does not use a browser or JavaScript rendering
- ❌ Does not call external AI APIs
- ❌ Does not respect `robots.txt` beyond the hard-block list (admin assumes responsibility for allowed sources)
- ❌ Does not deduplicate across batches (only within the same batch)

---

## Request Limits

| Parameter | Default | Maximum |
|-----------|---------|---------|
| `max_items` | 50 | 150 |
| Fetch timeout | 15 seconds | — |
| Max response size | 1.5 MB | — |
| Accepted content types | `text/html`, `text/plain`, `application/xhtml+xml` | — |

---

## User-Agent

The agent identifies itself honestly to the server:

```
MallMindResearchBot/0.1 (admin-requested; contact: support@mallmind.co.za)
```

---

## Candidate Detection Rules

Lines from the extracted text are kept as candidates if they contain:

**Explicit signals:**
- `shop`, `store`, `outlet`, `branch`, `unit`, `floor`, `level`
- `Ground Floor`, `First Floor`, `Trading Hours`
- `opens`, `closes`, time patterns (`08:00`, `9am`)
- Price patterns (`R\d`, e.g. `R12,999`)
- Unit codes (`G12`, `L2-34`)
- `promotion`, `special`, `discount`, `sale`
- `category`, `directory`, `tenant`

**Known SA retailer names:**
Game, Clicks, Woolworths, Checkers, Pick n Pay, Dis-Chem, Mr Price, Pep, Ackermans, Truworths, Foschini, Edgars, HiFi Corp, Incredible Connection, Sportscene, Cotton On, Starbucks, KFC, McDonald's, Nando's, and more.

**Navigation junk is filtered out:**
Home, Contact, Privacy Policy, Terms, Facebook, Instagram, Login, Subscribe, Cart, etc.

---

## Deduplication

Within a single ingestion run:
- Candidate lines are normalised (lowercase, trimmed, collapsed whitespace)
- Duplicate normalised lines are skipped

Against existing batch items:
- All existing `raw_text` values in the batch are loaded and normalised before ingestion starts
- Candidates that match an existing item's normalised text are skipped

---

## Safe Workflow for a New Mall

1. Create a research batch: "Mall@Reds — June 2026 survey"
2. Open the batch → Source Ingestion Agent panel
3. Enter `https://mallatreds.co.za/stores` as the source URL
4. Set source type to `official_website`, max items to 50
5. Check "Run bot pipeline" for automated analysis
6. Click **Ingest Source**
7. Review the summary:
   - Was the source allowed?
   - How many candidates were found?
   - How many items were created?
   - Were there any warnings?
8. Open each created item — review bot outputs (Trust Status, Source Research, Data Guardian)
9. Accept items that are accurate and have sufficient trust
10. Reject items that are wrong, duplicate, or low-quality
11. For accepted items with `admin_verified` trust: use Live Data Apply Planner to generate a patch plan
12. Apply the patch plan via an explicit admin action (Sprint 10)

---

## Admin Responsibility

By using the Source Ingestion Agent, the admin confirms that:

1. The source URL is a publicly accessible page they are permitted to read
2. They are not attempting to extract data from a restricted service
3. They will review all created items before accepting any findings
4. They understand that created items are staging data only — no live data update occurs

---

## Audit Trail

Every ingestion attempt is recorded in `admin_audit_log` with:
- `batch_id`
- `source_url`
- `allowed_to_ingest`
- `created_item_count`
- `skipped_item_count`
- `pipeline_run_count`

Individual bot runs triggered during pipeline execution are also logged separately.
