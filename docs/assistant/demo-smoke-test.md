# MallMind Founder Demo — Assistant Smoke Test

Repeatable verification for the exact founder demo journey on `/assistant`.
Sprint 20E. Companion script: `scripts/assistant/demo-smoke-check.mjs`
(`npm run demo:smoke`). Baseline snapshot:
[founder-demo-baseline.md](./founder-demo-baseline.md).

The CLI script verifies environment + backend response shape. The visual
steps below must be checked in a real browser — the CLI cannot see rendering.

---

## 0. Pre-flight (CLI)

```bash
npm run demo:smoke          # env checks + prints this journey
npm run demo:smoke -- --live  # additionally calls the live /assistant endpoint
```

Expected: all PASS (the `--live` call needs the dev backend up and Vertex
quota available — see failure modes).

## 1. The demo journey (browser)

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Open the app with `VITE_GOOGLE_BACKEND_URL` set at build time | No amber "Demo backend not connected" warning on `/assistant` |
| 2 | Open `/assistant` | Page renders: "Hey, I'm MallMind AI", trust helper copy ("I check trusted mall product data first…") |
| 3 | If no mall is selected | "Choose a Mall First" button + demo tip naming **Mall@Reds (Centurion)** |
| 4 | Select **Mall@Reds** (via the button → mall list) | Returns to `/assistant`, header shows Mall@Reds |
| 5 | Tap the featured chip **"I need a TV under R4000"** (full-width, glowing) | Thinking state, then answer |
| 6 | Shopping Answer Card appears **first**, visually dominant | Header chip "BEST PICK" + trust badge **"Verified option"** (emerald) |
| 7 | Best pick contents | **Hisense 43" FHD LED TV** · **Game** · **R3 499** · reason line ("Verified option · Fits your budget · On special") |
| 8 | Backup option sub-card | **Samsung 32" HD Smart TV · Game — R2 999** with badge "Example/demo data" + amber warning "Backup option is not confirmed yet." |
| 9 | Gemini free-text | Demoted to small grey text below the card (never a big bubble above it) |
| 10 | Product list below card | "LIVE MALL PRICES" — Hisense card with "Verified price" seal, then LG/Samsung sample-data cards |
| 11 | Route handoff hint (when the card action is "Compare options", i.e. no navigate action) | Small line: *Want to go there? Tap **Take me to Game** below, or ask "Take me to Game."* |
| 12 | Tap **Take me to Game** (or type "Take me to Game") | Route panel: "1 stop · ~1 min walk", numbered steps (Main Entrance → walk toward Game → arrived), **Start Navigation** button |
| 13 | Scan all visible text | NO internal tokens anywhere (see list below) |

## 1b. Route preview honesty (Sprints 21A–21C)

Assistant → Navigate handoff:

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Ask **"Take me to Game"** in `/assistant` | Route panel header reads **"Route ready"** with summary "1 stop · ~1 min walk" beside it (21A) |
| 2 | Panel body | "AI-assisted prototype route" badge + helper line: *"Preview route ready. Start Navigation opens the indoor route view with these steps on the mall map."* (21A) |
| 3 | Tap **Start Navigation** | The **Navigate screen opens** (`/navigate`) — this works for anonymous sessions too (21B bugfix; previously the button silently did nothing without a route_id) |
| 4 | Navigate screen badge | **"Prototype route preview"** (fallback/stop-list mode) or "AI-Assisted Route" (real backend route) — never "Prototype Tracking" |
| 5 | Map overlay chip | Says **"Preview"** — NOT "GPS" (21B) |
| 6 | Below the map | *"Follow these steps on the mall map. Live indoor positioning is not active in this demo."* (21B) |
| 7 | Route content | Steps/stops list, map preview canvas, stats bar (minutes/metres/done) all still render |
| 8 | Scan the screen | NO fake GPS, tracking, blue-dot, or live-positioning claims anywhere |

Deals → Navigate path (21C):

| # | Step | Expected result |
|---|------|-----------------|
| 1 | Open `/deals` with Mall@Reds selected | Deal cards render (e.g. Hisense TV / JBL earbuds at Game) with **"Navigate There"** buttons |
| 2 | Tap **"Navigate There"** on a Game deal | Opens `/navigate` with the Game stop loaded (21C fixed the broken `opening_hours` shop lookup that silently dumped this to search) |
| 3 | Navigate screen | Same honesty copy as above ("Preview" chip, positioning disclaimer); stop shows Game · Unit Shop G01 |

## 2. Internal tokens that must never be visible

`manual_fact_entry`, `csv_manual`, `needs_review`, `manually_verified`,
`live_feed`, `data_quality_status`, `retail_observation`, `manual_seed`,
`pending`, `approved`, `published`, raw `data_source` pipe-strings
(`retail_observation|source:csv|…`).

Shopper-safe labels only: "Verified option", "Verified price",
"Price may need confirmation", "Example/demo data", "Live retailer feed",
"Not confirmed yet", "Sample data · price may vary".

## 3. Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Card never appears; answers come but no "Best pick" block; amber env warning shows | `VITE_GOOGLE_BACKEND_URL` missing at build time → app silently uses the legacy Supabase edge path which has no `shopping_answer` | Set the env var and rebuild. The 20C guardrail panel makes this loud. |
| "No products found" / assistant asks to select a mall | No mall selected, or wrong mall — only **Mall@Reds** has the verified demo data | Select Mall@Reds (demo tip on the empty state points there) |
| Product queries fail with a generic error; "Something went wrong" | Vertex AI quota exhausted (HTTP 429 behind a 500) on the dev project | Wait and retry. Note: plain **"Take me to Game"** still works during quota exhaustion — it uses the deterministic store-route path, no Gemini. |
| Card appears but `routeAvailable` is false / card shows "Compare options" | Backend only marks `routeAvailable` when a route was actually built in that response — this is honest, not a bug | Use the "Take me to Game" button below the product list, or ask for the route — the handoff hint points there |

## 4. What the CLI script cannot verify

- Visual dominance/order of the card vs the Gemini text
- The featured chip, demo tip, env-guardrail panel rendering
- The route panel UI and Start Navigation behaviour
- The Navigate screen honesty copy and the Deals → Navigate There path
- Anything requiring a click

Those are browser sections 1 and 1b above.
