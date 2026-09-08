# Mall Data Compiler — Admin Guide

Sprint 9A · MallMind Navigator

---

## What This Is

The Mall Data Compiler is an admin-only workflow for systematically collecting, reviewing, and staging mall/shop/product data from publicly available sources — before it is applied to the live database.

It has two layers:

| Layer | Table | Purpose |
|-------|-------|---------|
| **Research Source** | `mall_research_sources` | Tracks where a batch of data came from (a website, a flyer, a manual survey) |
| **Finding** | `mall_source_findings` | One discrete data point extracted from a source (a shop name, a product price, opening hours) |

> **Important:** This sprint only collects and reviews findings. No automatic writes to `shops`, `products`, or `mall_nodes` happen yet. Applying approved findings to the live database is a future sprint.

---

## Allowed Sources

Always prefer sources that are:
- Publicly accessible without a login
- Official or semi-official (mall websites, retailer websites, published directories)
- Not behind a paywall

### ✅ Allowed source types

| Type | Examples |
|------|---------|
| `official_website` | `sandtoncity.com`, `gatewayworld.co.za` |
| `retail_directory` | Mall tenant directories, Gumtree business listings |
| `public_flyer` | Woolworths weekly ad (public PDF), Clicks catalogue |
| `manual_survey` | Admin physically visited the mall and noted shop locations |
| `press_release` | New store opening announcement on a press wire |
| `social_media` | Public Instagram/Facebook post from a verified brand account |
| `other` | Anything that doesn't fit the above |

### ❌ Do NOT store from these sources

- **Google Maps / Google Places** — Terms of Service prohibit scraping or storing Google data in your own database
- **Apple Maps** — Same restriction
- **Foursquare / Yelp** — API data has its own ToS; do not extract and store without a valid API agreement
- Anything gated behind authentication that you do not own
- Screen-scraped data from competitor apps

If a source is questionable, add a note to the research source record and flag the findings with lower confidence for manual review.

---

## Workflow

### Step 1: Add a Research Source

1. Open Admin Dashboard → **Mall Data Compiler** section
2. Click **Add Research Source**
3. Fill in:
   - **Mall** — which mall this batch of data relates to
   - **Label** — human-readable name, e.g. `"Sandton City official website – May 2026"`
   - **Source type** — pick the closest match from the dropdown
   - **URL** — the exact URL you visited (optional but strongly recommended)
   - **Notes** — any caveats, e.g. `"Directory page only shows anchor stores"`
4. Click **Save Source**

The source becomes the parent record for all findings you log from it.

### Step 2: Log Findings

1. Switch to the **Findings** tab
2. Click **Log New Finding**
3. Fill in:
   - **Source** — select the research source this finding came from
   - **Finding type** — what kind of entity (shop, product, shop hours, etc.)
   - **Data (JSON)** — structured data for this finding (see examples below)
   - **Raw snippet** — paste the original text, if useful for audit
   - **Confidence** — 0–100; use 90+ for firsthand/official sources, 60–80 for secondhand
4. Click **Log Finding** — it lands in the Pending queue

### Step 3: Review Findings

Findings must be reviewed before they can be applied. The review options are:

| Action | Meaning |
|--------|---------|
| **Approve** | Data looks correct and trustworthy — ready to apply |
| **Need Info** | Needs verification before approval (e.g. conflicting floor number) |
| **Reject** | Data is incorrect, duplicate, or from a disallowed source |

---

## Finding Data JSON Examples

### Shop finding
```json
{
  "name": "Game",
  "floor": "G",
  "unit": "G14",
  "category": "Electronics",
  "phone": "011 883 4000"
}
```

### Product finding
```json
{
  "name": "Samsung 65\" QLED TV",
  "brand": "Samsung",
  "price": 12999,
  "is_on_special": false,
  "shop_name": "Game"
}
```

### Shop hours finding
```json
{
  "shop_name": "Woolworths Food",
  "floor": "UG",
  "opens": "08:00",
  "closes": "21:00",
  "days": "Mon–Sun"
}
```

### Mall hours finding
```json
{
  "opens": "09:00",
  "closes": "21:00",
  "days": "Mon–Sat",
  "sunday_opens": "10:00",
  "sunday_closes": "19:00"
}
```

### Floor layout finding
```json
{
  "floor": "G",
  "description": "Ground floor — food court, supermarkets, pharmacy anchor",
  "anchor_shops": ["Woolworths Food", "Checkers", "Dis-Chem"]
}
```

### Promotion finding
```json
{
  "shop_name": "Clicks",
  "promotion_text": "3 for 2 on all vitamins",
  "valid_from": "2026-05-01",
  "valid_to": "2026-05-31",
  "source_page": "https://www.clicks.co.za/promotions"
}
```

---

## API Reference

All endpoints require an admin bearer token (`Authorization: Bearer <supabase_access_token>`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/mall-data/sources` | List sources (filter: `mall_id`, `active`) |
| `POST` | `/admin/mall-data/sources` | Create a new source |
| `GET` | `/admin/mall-data/findings` | List findings (filter: `source_id`, `mall_id`, `status`, `finding_type`) |
| `POST` | `/admin/mall-data/findings` | Log a new finding |
| `POST` | `/admin/mall-data/findings/:id/review` | Review a finding (approve / reject / needs_more_info) |

### POST /admin/mall-data/sources body
```json
{
  "mall_id":     "uuid",
  "label":       "Sandton City website – May 2026",
  "source_type": "official_website",
  "source_url":  "https://www.sandtoncity.com/stores",
  "notes":       "Only shows stores currently trading"
}
```

### POST /admin/mall-data/findings body
```json
{
  "source_id":    "uuid",
  "mall_id":      "uuid",
  "finding_type": "shop",
  "data":         { "name": "Game", "floor": "G", "unit": "G14" },
  "raw_snippet":  "Game — Ground Floor — Unit G14",
  "confidence":   90
}
```

### POST /admin/mall-data/findings/:id/review body
```json
{
  "action":     "approve",
  "admin_note": "Confirmed via store visit 2026-05-12",
  "confidence": 95
}
```

---

## Future: Applying Findings to the Live Database

Once findings are approved, a future sprint will add:

1. A **"Apply to DB"** button per approved finding
2. Backend logic that creates/updates `shops` or `products` rows from `finding.data`
3. An audit log entry linking the new/updated row to its source finding

This is intentionally deferred to keep Sprint 9A focused on safe data collection only.

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| No sources visible | Confirm mall filter is set to "All malls" |
| "Source not found" error on finding creation | Source may have been deleted or mall_id mismatch |
| 403 on any endpoint | Session token expired — sign out and back in |
| JSON parse error in finding form | Validate JSON with jsonlint.com before pasting |
| Finding shows wrong mall | Source's mall_id and the finding's mall_id must match |
