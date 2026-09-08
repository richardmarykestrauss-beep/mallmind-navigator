# MallMind Data Scripts

> ## ⚠️ QUARANTINED — legacy code, do not run against live Supabase
>
> **This directory predates the 19C retail trust pipeline** (Sprint 22C
> quarantine). Everything below this banner describes the OLD workflow and is
> kept only as raw material for a future rebuild.
>
> - **Do not run these scrapers against production/dev Supabase with a
>   service-role key.** They write directly to `products`/`shops`, bypassing
>   `retail_data_sources` → `retail_source_snapshots` →
>   `retail_import_batches` → `retail_price_observations` → admin review →
>   the approved-only publisher.
> - The scheduled GitHub Actions (`scrape-prices.yml`, `scrape-malls.yml`)
>   were de-scheduled and gated in Sprint 22C. Do not re-add `schedule:`
>   triggers.
> - If the `SUPABASE_SERVICE_KEY` repository secret is still configured in
>   GitHub, a human must inspect/remove it (Settings → Secrets).
> - **Any future scraper rebuild must output observation rows** (snapshots +
>   import batches + `retail_price_observations`), never direct product
>   writes. See `docs/retail/retail-data-readiness-audit.md`.

---

Two ways to get data into MallMind — run once manually, then automate.

---

## Step 1 — Seed the database (do this first)

1. Open **Supabase Dashboard → SQL Editor**
2. Click **New Query**
3. Open `supabase/seed.sql` from this repo and paste the entire file
4. Click **Run**

This creates ~64 shops across 8 SA malls and ~200 products with real SA prices. Safe to re-run.

---

## Step 2 — Run the scraper locally (keep prices fresh)

### Setup
```bash
cd scripts/scraper
npm install
cp .env.example .env
```

Open `.env` and fill in:
```
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here
```

Get your service role key from: **Supabase → Project Settings → API → service_role** (keep this secret — never commit it).

### Run scrapers
```bash
# All scrapers (recommended)
npm run all

# Takealot only (live SA prices)
npm run takealot

# PriceCheck only (discovers new products)
npm run pricecheck
```

---

## Step 3 — Automate with Supabase Edge Functions

Deploy the daily scraper that runs at 3am SA time automatically:

### Prerequisites
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### Deploy
```bash
supabase functions deploy scrape-prices
```

### Set environment variable
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Schedule (in Supabase Dashboard)
1. Go to **Edge Functions → scrape-prices**
2. Click **Schedules → Add Schedule**
3. Cron expression: `0 1 * * *` (1am UTC = 3am SAST, runs every night)

### Test it manually
```bash
supabase functions invoke scrape-prices --no-verify-jwt
```

---

## What the scrapers pull

| Source | What it gets | Frequency |
|---|---|---|
| Takealot API | Live prices for 10 key products across SA | Nightly |
| PriceCheck.co.za | New product listings + price comparisons | Nightly |

Takealot prices are used as a baseline — in-store prices are set at a 2–6% premium above the online price, which is realistic for SA retail.

---

## Adding more products

To add a new product to the Takealot scraper, edit `scripts/scraper/takealot.ts` and add to `SEARCH_TARGETS`:

```typescript
{ query: "samsung galaxy watch 6",  shopNames: ["Samsung Experience Store", "Game"] },
```

The scraper will find the live Takealot price and update all matching products in those stores.
