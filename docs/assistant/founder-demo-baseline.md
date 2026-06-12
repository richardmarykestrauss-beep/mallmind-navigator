# MallMind Founder Demo Baseline — Mall@Reds

| | |
|---|---|
| **Baseline commit** | `1e05d89738c65f503186acfe79cff0e579a2d0ee` |
| **Date** | 2026-06-12 |
| **Branch** | `claude-premium-nav-test` |
| **Recommended tag** (not yet created) | `founder-demo-mall-at-reds-2026-06-12` |

## Demo promise

> **Right product. Right shop. Trusted price. Shortest route.**

This snapshot marks the first stable, repeatable founder demo after Sprints
20A–21D: the Assistant shopping answer flow, the route handoff, the Navigate
screen honesty copy, and the Deals route path all work end-to-end at
Mall@Reds and are protected by the smoke checklist.

## Stable demo journey

1. Open `/assistant`.
2. Select **Mall@Reds** (the empty-state demo tip points there).
3. Ask **"I need a TV under R4000"** (one-tap featured chip).
4. The **Shopping Answer Card appears first**, above the AI free-text.
5. Best pick: **Hisense 43" FHD LED TV · Game · R3 499 · "Verified option"**.
6. Backup option visible, honestly labelled **"Example/demo data"**.
7. Ask or tap **"Take me to Game"**.
8. The **"Route ready"** panel appears (1 stop · ~1 min walk, steps, helper line).
9. Tap **Start Navigation** → `/navigate` opens (works for anonymous sessions).
10. Navigate screen shows the **prototype route preview honesty copy**
    ("Prototype route preview", "Preview" chip, "Live indoor positioning is
    not active in this demo").
11. Open `/deals`.
12. Tap **"Navigate There"** on a Game deal → `/navigate` opens with the Game
    stop loaded and the same honesty copy.

## What is real now

- Demo backend wired through `VITE_GOOGLE_BACKEND_URL` (with a loud in-app
  guardrail when it is missing).
- Supabase holds the real Mall@Reds demo records (shops, products, published
  verified prices from the controlled retail pipeline).
- Route preview, steps, stops, map schematic and stats render from real data.
- The answer card separates **verified / demo / backup** status with
  shopper-safe labels only — internal pipeline statuses never reach the UI.
- `npm run demo:smoke` (and `-- --live`) protects the flow from regression.

## What is still prototype / manual

- **Live indoor positioning is not active** — no blue-dot GPS claim is made
  anywhere, by design.
- Not all malls/products are live; Mall@Reds is the seeded demo mall.
- The backup option may be demo/example data rather than a verified price.
- Retail data expansion is still needed (more real, evidence-backed sources).
- Product freshness/availability needs stronger ingestion + verification
  systems before production claims can be made.

## Known demo risks

- **Vertex/Gemini quota (429)** can break live AI product answers; plain
  "Take me to Game" survives quota exhaustion via the deterministic route path.
- The route/Navigate/Deals checks are **browser-only and manual** (sections 1
  and 1b of the smoke checklist); the CLI cannot see rendering.
- A Browserslist "data is old" build warning is non-blocking noise.
- `app_events` 401 analytics noise may appear in browser logs — unrelated to
  the demo route flow.

## Pre-demo ritual

```bash
npm run demo:smoke              # env + printed checklist
npm run demo:smoke -- --live    # adds a live backend probe (uses Gemini quota)
```

Then walk the browser checklist — sections **1** and **1b** of
[demo-smoke-test.md](./demo-smoke-test.md) — and manually test both
**Assistant → Navigate** and **Deals → Navigate** paths.

**Weekly:** re-verify the demo's verified prices (7-day trust expiry) — see
[demo-price-reverification.md](../retail/demo-price-reverification.md).

## Next build lane

**Retail data expansion / Mall Intelligence ingestion.** The demo and route
polish are now stable enough to pause unless bugs appear; the highest-value
next work is widening trusted retail data (more sources, more verified
products, more malls) through the existing approval-gated pipeline.
Readiness audit: [retail-data-readiness-audit.md](../retail/retail-data-readiness-audit.md).
