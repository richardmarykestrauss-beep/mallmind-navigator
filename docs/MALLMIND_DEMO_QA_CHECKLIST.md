# MallMind Demo & QA Checklist

> **Sprint 8H checkpoint — branch `google-cloud-migration-plan` · commit `200ac49`**
>
> Run this checklist top-to-bottom before every demo or release.
> Tick each box. If any step fails, stop and fix before continuing.

---

## Quick Reference: Stable IDs

| Resource | Value |
|---|---|
| **Mall** | Mall@Reds |
| `mall_id` | `f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c` |
| **Shop** | Game (Mall@Reds) |
| `shop_id` | `a1b2c3d4-0001-4000-8000-100000000001` |
| **Product** | Hisense 43" FHD LED TV |
| `product_id` | `b1b2c3d4-0001-4000-8000-200000000001` |
| **Backend** | `https://mallmind-backend-dev-1017902775578.africa-south1.run.app` |
| **Frontend (local)** | `http://localhost:8080` |
| **Admin page** | `http://localhost:8080/admin` |
| **Assistant page** | `http://localhost:8080/assistant` |

---

## 1. Environment Restart Checklist

Run this before every test session to guarantee a clean, current state.

```bash
# 1. Set the correct gcloud project
gcloud config set project mallmind

# 2. Pull latest code
git checkout google-cloud-migration-plan
git pull origin google-cloud-migration-plan

# 3. Install deps (skip if package.json unchanged)
npm install
cd google-cloud-backend && npm install && cd ..

# 4. Build frontend
npm run build

# 5. Build backend
cd google-cloud-backend && npm run build && cd ..
```

```bash
# 6. Start Vite dev server (leave running in a terminal)
npm run dev
# → App should open at http://localhost:8080

# 7. Open Admin dashboard
# → http://localhost:8080/admin

# 8. Open Assistant
# → http://localhost:8080/assistant

# 9. Hard-refresh both tabs (clears Vite cache)
# Mac:  Cmd + Shift + R
# Win:  Ctrl + Shift + R
```

- [ ] `git pull` succeeded — no merge conflicts
- [ ] `npm run build` exited 0 errors
- [ ] `cd google-cloud-backend && npm run build` exited 0 errors
- [ ] Vite dev server started on `:8080`
- [ ] `/admin` page loads without white screen
- [ ] `/assistant` page loads without white screen

---

## 2. Backend Health Checklist

### 2a. Cloud Run health endpoint

```bash
curl -s https://mallmind-backend-dev-1017902775578.africa-south1.run.app/health
```

**Expected response:**
```json
{ "status": "ok", "uptime": <seconds> }
```

- [ ] HTTP 200 received
- [ ] `"status": "ok"` in body
- [ ] Response time < 3 s

### 2b. Admin Diagnostics panel

1. Open `http://localhost:8080/admin`
2. Sign in as admin user
3. Scroll to **System Diagnostics** card

- [ ] Backend URL is shown (not "Not set")
- [ ] Session shows **Active** with your email
- [ ] Access token shows **Present**
- [ ] Click **Test Backend Connection** → shows "Connected — backend is healthy"

### 2c. CORS check (if testing from a custom domain)

```bash
curl -s -I \
  -H "Origin: https://your-frontend-domain.com" \
  https://mallmind-backend-dev-1017902775578.africa-south1.run.app/health
```

**Expected:** `access-control-allow-origin` header is present in response.

- [ ] CORS header present, or not applicable (localhost dev)

---

## 3. Assistant MVP Journey Checklist

### 3a. Mall selection

1. Open `/assistant`
2. Tap **Choose a Mall First** or navigate to `/malls`
3. Select **Mall@Reds**

- [ ] Mall selector works
- [ ] Header shows "Active session · Mall@Reds" or just "Mall@Reds"

### 3b. Best TV query

Type (or paste) the following message into the assistant:

> **"What is the best TV under R5000?"**

**Expected — product cards:**

| Check | Expected |
|---|---|
| First result | Hisense 43" FHD LED TV |
| Best pick strip | ⭐ "Best pick" label visible |
| Trust badge | 🟢 "Verified price" (green, shield icon) |
| Price | R3,499 or current DB value |
| Shop | Game |
| Floor | Ground floor (G or L1) |
| `trust_state` (dev tools) | `"verified"` |

- [ ] Hisense appears **first** in results
- [ ] "Best pick" strip is visible
- [ ] Green "Verified price" badge visible (not amber/red)
- [ ] Price shows without "around" prefix
- [ ] Shop name is "Game"
- [ ] Floor and unit number shown
- [ ] "Take me to Game" button visible

**Expected — assistant message text:**

- [ ] Says "verified at R..." or "confirmed R..." — NOT "around R..." or "sample data"
- [ ] No "cannot build route" text
- [ ] No "session not active" text
- [ ] Message is concise (not a wall of text)

---

## 4. Route Checklist

### 4a. Inline route trigger

Click the **"Take me to Game"** button shown below the Hisense card.

- [ ] Loading state shows "Building route…"
- [ ] Route card appears (blue border / route icon)
- [ ] Route summary line shows (e.g. "1 stop · ~3 min walk")
- [ ] At least 2 route steps shown with numbered circles
- [ ] "Start Navigation" button visible
- [ ] No "cannot build route" message anywhere
- [ ] No "session is not active" message

### 4b. Voice route trigger (optional — requires HTTPS)

If testing on HTTPS, say:
> **"Take me to Game for the Hisense TV"**

- [ ] Same route card appears
- [ ] Route summary correct
- [ ] Assistant says "Route to Game is ready"

### 4c. Navigation screen

Click **Start Navigation**.

- [ ] Navigates to `/navigate`
- [ ] At least one stop listed (Game)
- [ ] Floor information visible
- [ ] "Done — Next Stop" button visible

---

## 5. Feedback Checklist

After the TV query (step 3b), complete each feedback action and verify Founder Analytics counts increase.

> Note: Refresh Founder Analytics in `/admin` after each batch of feedback.

### 5a. Recommendation feedback

Under the product cards, find "Was this helpful?"

- [ ] Click **Useful** → shows "✓ Thanks for the feedback"
- [ ] `recommendation_feedback` event count increases in Founder Analytics

### 5b. Price accuracy feedback

Under each product card, find "Was this price correct?"

- [ ] Click **Yes** → shows "✓ Thanks for the feedback"
- [ ] `price_accuracy_feedback` event count increases in Founder Analytics

### 5c. Route feedback

After triggering a route (step 4a), find "Did you find the store?"

- [ ] Click **Yes** → shows "✓ Thanks for the feedback"
- [ ] `route_feedback` event count increases in Founder Analytics

### 5d. Purchase signal

Find "Did you buy it?"

- [ ] Click **Bought it** → shows "✓ Thanks for the feedback"
- [ ] `purchase_signal` event increases in Founder Analytics
- [ ] Check **Not today** on a second session → separate count

---

## 6. Price Correction Checklist

### 6a. Submit a price correction report

1. Under any Hisense card, find the **"Price wrong?"** link (below the price accuracy FeedbackStrip)
2. Click it — the amber inline form should expand

- [ ] Form appears with "Report incorrect price" heading
- [ ] Shows current price reference (e.g. "Currently showing: R3,499")
- [ ] Enter a reported price (e.g. `3299`)
- [ ] Select source ("Retailer website")
- [ ] Optional: add a note
- [ ] Click **Submit report**

**Expected:**
- [ ] Form closes and shows "✓ Price report submitted — thanks!"
- [ ] Product price **has NOT changed** (still R3,499)
- [ ] Open `/admin` → **Price Correction Reports** → Pending tab shows the new report
- [ ] Trust badge on Hisense changes to 🔴 **"Recently disputed"** on next assistant query
- [ ] "Recently disputed by a shopper — confirm before buying." warning shown

### 6b. Reject the report

1. In `/admin` → Price Correction Reports → Pending tab
2. Find the report you just submitted
3. Click **Reject**
4. Add an optional admin note
5. Click **Reject Report**

**Expected:**
- [ ] Report moves from Pending → Reviewed tab
- [ ] Report status shows "Rejected"
- [ ] Ask the TV question again in Assistant
- [ ] Disputed badge **disappears**
- [ ] Green "Verified price" badge **returns** (if no other pending reports)
- [ ] Assistant resumes saying "verified at R..."

### 6c. Approve report (price update test)

> **⚠️ Only run this test when you intend to update the DB price.**

1. Submit a new correction report (step 6a) with a deliberate test price (e.g. `3199`)
2. In `/admin` → Pending → Click **Approve**
3. Fill in: Approved price = `3199`, Verification method = "Store Visit", Data source = "Demo test"
4. Click **Approve & Update Price**

**Expected:**
- [ ] Product price in DB updates to R3,199
- [ ] `data_quality_status` = `manually_verified`
- [ ] `price_verified_at` = today's date
- [ ] Check Supabase `admin_audit_log` — row created with `action = "price_correction_approved"`
- [ ] Hisense shows new price R3,199 on next assistant query
- [ ] Green "Verified price" badge with today's date

> **Cleanup:** After approval test, manually reset the product price in Supabase to the original value if needed.

---

## 7. Founder Analytics Checklist

Open `/admin` → scroll to **Founder Analytics** section. Click **Refresh**.

| Metric | Check |
|---|---|
| Total Events | > 0 (increases with every action) |
| Last 24h | > 0 after a test session |
| AI Searches | Increases after each assistant query |
| Route Requests | Increases after each "Take me to" click |
| Product Views | Increases after each recommendation |
| Event Types | ≥ 8 distinct tracked actions |
| Top Searches | Shows "What is the best TV under R5000?" or similar |
| Top Products | Shows Hisense with view count |
| Top Shops | Shows Game |
| Recommendation feedback | Shows useful / not-useful counts |
| Price accuracy | Shows correct / flagged counts |
| Route success | Shows found / not-found counts |
| Purchase signals | Shows bought / not-today counts |
| Recent events | Shows latest events with timestamps |

- [ ] All counts above match what you performed during the test session
- [ ] No "Failed to load analytics" error

---

## 8. Known Stable IDs

Hardcoded reference for curl commands and DB lookups.

```
Mall:    Mall@Reds
mall_id: f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c

Shop:    Game (Mall@Reds Ground Floor)
shop_id: a1b2c3d4-0001-4000-8000-100000000001

Product: Hisense 43" FHD LED TV
product_id: b1b2c3d4-0001-4000-8000-200000000001

Backend base URL:
  https://mallmind-backend-dev-1017902775578.africa-south1.run.app

Frontend (local dev):
  http://localhost:8080

Admin page:
  http://localhost:8080/admin

Assistant page:
  http://localhost:8080/assistant

Navigate page:
  http://localhost:8080/navigate
```

---

## 9. Copy-Paste Test Commands

Replace `BACKEND` with the base URL from section 8.

```bash
BACKEND="https://mallmind-backend-dev-1017902775578.africa-south1.run.app"
MALL_ID="f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c"
PRODUCT_ID="b1b2c3d4-0001-4000-8000-200000000001"
SHOP_ID="a1b2c3d4-0001-4000-8000-100000000001"
```

### 9a. Health check

```bash
curl -s "$BACKEND/health" | jq .
```

**Expected:** `{ "status": "ok" }`

---

### 9b. Best TV query (assistant)

```bash
curl -s -X POST "$BACKEND/assistant" \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [{\"role\": \"user\", \"content\": \"What is the best TV under R5000?\"}],
    \"mall_id\": \"$MALL_ID\",
    \"mall_name\": \"Mall@Reds\"
  }" | jq '{message: .message, top_product: .products[0].name, trust: .products[0].trust_state, price: .products[0].price}'
```

**Expected:**
```json
{
  "message": "...(mentions verified)...",
  "top_product": "Hisense 43\" FHD LED TV",
  "trust": "verified",
  "price": 3499
}
```

---

### 9c. Route to Game (assistant)

```bash
curl -s -X POST "$BACKEND/assistant" \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [
      {\"role\": \"user\", \"content\": \"What is the best TV under R5000?\"},
      {\"role\": \"assistant\", \"content\": \"Best pick: Hisense 43 FHD at Game for a verified R3499.\"},
      {\"role\": \"user\", \"content\": \"Take me to Game\"}
    ],
    \"mall_id\": \"$MALL_ID\",
    \"mall_name\": \"Mall@Reds\"
  }" | jq '{message: .message, build_route: .build_route, shop_ids: .route_shop_ids, steps: (.route_steps | length)}'
```

**Expected:**
```json
{
  "message": "Route to Game is ready...",
  "build_route": true,
  "shop_ids": ["a1b2c3d4-0001-4000-8000-100000000001"],
  "steps": 2
}
```

---

### 9d. Analytics event test

```bash
curl -s -X POST "$BACKEND/analytics/event" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_type\": \"assistant_query_submitted\",
    \"mall_id\": \"$MALL_ID\",
    \"query_text\": \"curl test — delete me\",
    \"metadata\": {\"source\": \"curl_test\"}
  }" | jq .
```

**Expected:** `{ "ok": true }`

---

### 9e. Price correction report test

```bash
curl -s -X POST "$BACKEND/price-corrections/report" \
  -H "Content-Type: application/json" \
  -d "{
    \"product_id\": \"$PRODUCT_ID\",
    \"shop_id\": \"$SHOP_ID\",
    \"mall_id\": \"$MALL_ID\",
    \"current_price\": 3499,
    \"reported_price\": 3299,
    \"user_note\": \"Saw lower price on shelf — curl test\",
    \"source_type\": \"in_store_seen\"
  }" | jq .
```

**Expected:** `{ "ok": true, "report_id": "<uuid>" }`

> **Cleanup:** After this test, open `/admin` → Pending → Reject the curl test report so it doesn't affect trust state.

---

### 9f. Recommend products (direct endpoint)

```bash
curl -s -X POST "$BACKEND/recommend-products" \
  -H "Content-Type: application/json" \
  -d "{
    \"mall_id\": \"$MALL_ID\",
    \"query\": \"TV\",
    \"budget\": 5000
  }" | jq '{total: .total_found, top: .recommendations[0].name, trust: .recommendations[0].trust_state}'
```

**Expected:**
```json
{
  "total": 1,
  "top": "Hisense 43\" FHD LED TV",
  "trust": "verified"
}
```

---

## 10. Demo Script (Founder Pitch — ~5 minutes)

Use this script for investor or retailer demos. Keep it conversational.

---

### Opening (30 seconds)

> "MallMind is an AI shopping concierge for South African malls.
> Today I'll show you the complete shopper journey — search, verify, route, and convert —
> running live on our backend in Google Cloud."

---

### Step 1 — Select the mall (15 seconds)

Open the app. Select **Mall@Reds**.

> "The user opens MallMind and selects their mall.
> This could be auto-detected via GPS — we have geofencing ready."

---

### Step 2 — Ask the AI (30 seconds)

Type: **"What is the best TV under R5000?"**

> "They ask the AI assistant for a TV under R5000.
> Our Gemini-powered backend searches the mall's live stock,
> scores products by price, discount, and data quality,
> and returns a ranked recommendation — instantly."

Point to the Hisense card.

> "The Hisense is the best pick — it's **manually verified**.
> You can see the green badge: 'Verified price'.
> We know the exact price and exactly where it sits in the mall."

---

### Step 3 — Route to the store (30 seconds)

Click **"Take me to Game"**.

> "The user taps 'Take me to Game'.
> MallMind builds a step-by-step indoor route using our
> navigation graph — no GPS required inside the mall."

Point to the route card with steps.

> "They see exactly which floor, which entrance, which unit number.
> One tap and they're navigating."

---

### Step 4 — Feedback + trust (30 seconds)

Click **Useful**, **Yes** (price correct), **Found the store**.

> "After the interaction, we capture lightweight behavioural feedback —
> whether the recommendation was useful, whether the price was correct,
> whether they found the store.
> This feeds straight into our Founder Analytics dashboard."

Switch to `/admin` → Founder Analytics.

> "Here in real-time: assistant queries, route requests, product views,
> and purchase signals. This is the data retailers will pay for."

---

### Step 5 — Price integrity (45 seconds)

Tap **"Price wrong?"** → submit a correction.

> "If a shopper sees a different price on the shelf, they can flag it.
> This creates a pending dispute — the product immediately shows
> a 'Recently disputed' badge. But — and this is important —
> the price in our database does not change."

Switch to `/admin` → Price Correction Reports.

> "The report lands here in the admin queue.
> A human reviewer approves or rejects it.
> Only admin approval updates the price —
> with full audit logging and verification metadata.
> Crowdsourced accuracy, admin-controlled integrity."

---

### Closing (30 seconds)

> "That's the full MallMind loop:
> - Find the best verified product in seconds
> - Route to the store without GPS
> - Capture purchase intent for retailers
> - Maintain price accuracy with human oversight
>
> We're live at Mall@Reds with 8 malls, 58 shops, and real product data.
> The next step is signing 2–3 anchor retailers on a free trial
> to start the data flywheel.
>
> Any questions?"

---

## Appendix: Common Failure Modes

| Symptom | Likely cause | Fix |
|---|---|---|
| White screen on `/admin` or `/assistant` | Vite build not run | `npm run build && npm run dev` |
| "VITE_GOOGLE_BACKEND_URL is not configured" | `.env` or `.env.local` missing | Add `VITE_GOOGLE_BACKEND_URL=<URL>` to `.env.local` |
| "Connected — backend is healthy" fails | Cloud Run cold start | Wait 15 s, retry |
| Products return `trust_state = "sample"` | Product not manually verified in DB | Run admin verify on the product |
| "No products found" from assistant | Mall ID mismatch or no products seeded | Verify `mall_id` in DB matches selection |
| Route card doesn't appear | No shop graph for this mall — fallback mode | Expected; fallback steps still shown |
| Founder Analytics shows 0 | Backend not configured or `VITE_GOOGLE_BACKEND_URL` wrong | Check diagnostics, verify env var |
| "Recently disputed" badge stuck | Old report not rejected/approved | Go to admin queue, review pending reports |

---

*Last updated: Sprint 8H — 2026-05-13*
*Branch: google-cloud-migration-plan*
*Maintainer: update the "Last updated" line and commit ID after each sprint.*
