# MallMind — Admin Data Review Workflow

**Last updated:** 2026-05-15 (Sprint 12B)

This document describes how admins review, classify, and approve staged data findings in MallMind's research pipeline. No bot or automated process ever writes to live tables — all live-data changes require an explicit admin action that is not yet implemented (planned Sprint 15).

---

## Overview

```
Source (URL / scraper / manual) 
        │
        ▼
Source Ingestion Agent  ─────────────────────────────────────────────────────────────────┐
  • Fetches page text                                                                      │
  • Checks blocklist (Google Maps, Yelp, Apple Maps, TripAdvisor, Waze, social crawlers)  │
  • Creates pending MallResearchBatchItems                                                 │
        │                                                                                 │
        ▼                                                                                 │
5-Bot Pipeline (per item, optional)                                                       │
  1. Source Research Bot     — validates source URL legitimacy                            │
  2. Finding Extractor Bot   — extracts name / price / floor / unit / category            │
  3. Data Guardian Bot       — scores trust level, raises policy flags                    │
  4. Duplicate Detection Bot — checks for existing matching records in DB                 │
  5. Admin Review Assistant  — synthesises a recommended action (advisory only)           │
        │                                                                                 │
        ▼                                                                                 ◄─
Admin Review (manual)
  • Admin reads: Finding Summary, Source Evidence, Risk Flags, Bot Recommendation
  • Admin chooses: Accept / Reject / Flag / Mark Reviewed
  • Result: item.status updated — item stays staged
        │
        ▼
Apply-to-live  [NOT YET IMPLEMENTED — planned Sprint 15]
  • Separate admin workflow
  • Only accepted items are candidates
  • Requires second confirmation before writing to products / shops / mall_nodes
```

---

## Step-by-Step Review Process

### 1. Find items to review

Go to **Admin Dashboard → Research Batches** tab.

- Batches with status `open` or `in_progress` contain pending items.
- The **Data Expansion** tab shows a summary count of pending review items and a direct link.

### 2. Open a batch

Click a batch row to open **BatchDetailView**. You'll see:

- Batch stats (total / pending / accepted / rejected)
- Source Ingestion Agent panel (for adding more items via URL)
- Item list (each item is a `BatchItemRow`)

### 3. Review each item — Evidence Panel sections

Each `BatchItemRow` expands to show a structured evidence panel:

| Section | What it shows | Action |
|---------|--------------|--------|
| **Finding Summary** | Extracted entity name, price, category, floor/unit, confidence score | Read — verify extraction is correct |
| **Source Evidence** | Source URL, source name, sequence number, raw text, added timestamp | Read — confirm source is legitimate |
| **Risk Flags** | Computed warnings: no URL, low confidence, duplicate risk, missing fields | Address flags before accepting |
| **Admin Recommendation** | Top suggested action from Admin Review bot | Advisory only — your judgment takes precedence |
| **Bot Analysis** | Full outputs from all 5 bots + pipeline status | Expand for deeper investigation |
| **Pipeline Actions** | Run individual bots or full pipeline | Use to populate Bot Analysis section |
| **Admin Decision** | Accept / Reject / Flag / Mark Reviewed + notes | Your actual decision |

### 4. Understanding Risk Flags

| Flag | Meaning | Recommended action |
|------|---------|--------------------|
| No source URL | Finding has no verifiable origin | Flag for manual verification or reject |
| Low confidence (< 60%) | Extractor uncertain about this finding | Run Extract bot again, or manually verify |
| Duplicate risk | Likely matches an existing record | Check Duplicate Detection bot output, reject if true duplicate |
| No entity identified | Extraction found no name/product/shop | Raw text may be too ambiguous — reject or add more context |
| No price extracted | Product finding with no price | Run Extract bot, or manually add price data |
| Missing location data | Shop finding with no floor/unit | Acceptable if other details are strong; note in admin notes |
| Not extracted yet | No bot has run yet | Run Find Extractor (or Full Pipeline) before reviewing |

### 5. Making your decision

| Action | When to use | Effect |
|--------|------------|--------|
| **Accept** | Finding is accurate, source is legitimate, ready for apply workflow | `status = accepted` |
| **Reject** | Finding is wrong, duplicate, or source is untrustworthy | `status = rejected` |
| **Flag** | Needs follow-up but can't be resolved now | `status = flagged` |
| **Mark Reviewed** | You've seen it but aren't making a final call yet | `status = reviewed` |

> **Important:** Accepting an item does NOT publish it to live data. It confirms the staged finding is reviewed and ready for the future Apply workflow.

### 6. Running bots

Each item has a **Pipeline Actions** section with individual bot buttons:

| Bot button | Runs | Useful for |
|------------|------|-----------|
| Source Research | Source Research Bot | Verifying a URL isn't on the blocklist |
| Find Extractor | Finding Extractor Bot | Populating the Finding Summary section |
| Data Guardian | Data Guardian Bot | Checking trust/policy score |
| Duplicate Check | Duplicate Detection Bot | Confirming no existing match |
| Admin Review | Admin Review Assistant | Getting a synthesised recommendation |
| Run Full Pipeline | All 5 bots in sequence | Starting fresh on a new item |

Bot outputs are saved in `bot_hints_used` and displayed in the **Bot Analysis** section. They persist across page reloads.

---

## Safety Rules

1. **No bot ever auto-writes live data.** Bot outputs are stored in `bot_hints_used` only.
2. **No admin review action writes live data.** Accept/Reject/Flag updates `status` in the staging table only.
3. **Apply-to-live is a separate workflow** (not yet built). When it ships, it will require explicit second confirmation and will only process `accepted` items.
4. **Blocked sources are permanent.** Google Maps, Yelp, Apple Maps, TripAdvisor, Waze, and social media crawlers are on the blocklist and cannot be ingested under any circumstances.
5. **Source type matters.** Strong sources (official website, mall directory, manual survey) carry higher trust weight than weak sources (social media, unknown).

---

## Source Quality Reference

| Source type | Strength | When to use |
|-------------|----------|-------------|
| `official_website` | Strong | Retailer's own website |
| `retail_directory` | Strong | Official mall tenant directory |
| `manual_survey` | Strong | Admin personally verified |
| `public_flyer` | Medium | Scanned/public promotional material |
| `press_release` | Medium | Official company announcements |
| `social_media` | Weak | Use only as supplementary evidence, never primary |
| `other` / `unknown` | Weak | Flag for manual verification before accepting |

---

## Ingestion Run History

The **Source Ingestion Agent** panel in each batch shows the result of the most recent ingestion run:

- Source URL and whether it was allowed by the blocklist policy
- Whether the page was successfully fetched
- Character count of extracted text
- Number of candidates detected
- Number of items created vs skipped
- Pipeline run count (if `run_pipeline` was enabled)
- Any warnings from the ingestion process

Historical run results are not persisted across page reloads in the current implementation. Results are shown immediately after each ingest.

---

## Tab Navigation Reference

| Admin Tab | Purpose | Direct link from Data Expansion |
|-----------|---------|--------------------------------|
| Research Batches | Manage batches, review items via BatchItemRow | ✅ "Open Research Batches" button |
| Mall Data | Review MallDataFindings (older finding type) | ✅ "Open Mall Data Findings" button |
| Data Expansion | Overview, launch readiness, source campaigns | — (you are here) |
| Bot Suite | Standalone bot runners for ad-hoc research | Navigate manually |

---

## Glossary

| Term | Meaning |
|------|---------|
| **Staged item** | A `MallResearchBatchItem` with any status — it exists in the research tables only, not in live product/shop tables |
| **Live data** | Records in `products`, `shops`, `mall_nodes`, `malls` — what the shopper app reads |
| **Batch** | A `MallResearchBatch` grouping related staged items (e.g. "Sandton City Q2 2026 expansion") |
| **bot_hints_used** | JSON field on each item storing all bot outputs |
| **extracted_data** | JSON field on each item storing the Finding Extractor's structured output |
| **Apply workflow** | Future Sprint 15 feature that publishes accepted staged items to live tables |
| **Trust score** | Data Guardian bot's 0–1 assessment of source legitimacy and data quality |
| **Confidence** | Finding Extractor's 0–1 certainty about the extracted values |
