# Mall@Reds — Source Conflicts & Resolution Rules

**Access date:** 2026-07-24. All claims below link to sources opened and inspected (not snippets).

## Conflict-resolution rules (applied)

Evidence tiers (highest first): **1** official Mall@Reds directory/floor plan · **2** official retailer branch locator · **3** official mall social/newsletter · **4** Google Places · **5** reputable public directory · **6** historical/cached · **7** unverified mentions.

- **Official mall source beats third-party.** A current official directory listing outranks any aggregator.
- **A current official retailer locator may beat an old mall PDF** for *branch existence* (a chain can open/close between mall-directory updates).
- **Store number requires direct evidence.** Only the official directory's stated shop number is accepted. Aggregator shop numbers are corroborating, not authoritative.
- **Floor assignment stays UNKNOWN unless proven.** The official directory shows **no floors**, so every tenant's `floor` is `null`. Nothing is inferred.
- **Trading hours carry a source + timestamp.** Only **mall-level** hours are published; per-store hours are `null`.
- **Temporary closures are not silently made permanent.** `branch_status` is `listed_current` (present in the current official directory), which is explicitly *not* a live "open now" claim and cannot reflect a same-day temporary closure.

## Conflicts found

### 1. "Game" — older marketing vs current directory  (**material**)
- **Third-party/marketing text** (e.g. the Anaprop/search overview) lists **Game** among the centre's anchors.
- **The current official directory** (`https://www.mallatreds.co.za/shops/`) does **not** list Game, and **no current retailer locator** confirmed a Game branch at Mall@Reds in this pass.
- **Resolution:** Tier-1 current directory wins. **Game is treated as unverified / possibly a former tenant and is EXCLUDED** from the verified register. This corrects the earlier Sprint-2F assumption (from unmerged demo CSVs) that Game is a current Mall@Reds anchor. Re-confirm via game.co.za's own locator or the mall before any use.

### 2. ~~Directory capture is incomplete — 113 captured vs ~140 claimed~~ → RESOLVED in Sprint 2G: directory is COMPLETE at 113  (**completeness**)
- **2F framing:** the automated fetch returned **113 rows** and this was labelled a subset of a supposed **~140**.
- **2G re-verification (2026-07-24):** a **deterministic live-DOM capture** (counting rendered row elements, not a small-model summary) of the official directory returns **exactly 113** rows and no more. This was confirmed at **both** official directory URLs — the canonical `https://www.mallatreds.co.za/shops-v2/` (the site's own primary-nav "Store Directory" target) and `https://www.mallatreds.co.za/shops/` — which render the **byte-identical** 113-row list (same first row Absa #96, same last row Woolworths #111). There is **no pagination, no "load more", and no lazy-loaded content**; the A–Z index and category list are client-side filters over the same rows.
- **Origin of "~140":** re-inspection found the "~140" figure on **no** official Mall@Reds page — not the homepage, not `/about/` (which states GLA 56 000 m² and management but **no** store count), and not the directory. It was an **unverified assumption** carried into 2F.
- **Resolution:** the "~140" claim is **retired**. The register is the **COMPLETE current official directory (113 tenants)**, not a subset. Diff of the 2G capture against the 2F register: **0 new, 0 missing, 0 store-number mismatches, 0 phone mismatches.** If management later confirms a higher number, that would be a *new* finding to reconcile — but nothing public supports it today.

### 3. Incredible Connection — third-party only  (**existence, medium confidence**)
- **Third-party directories** (yep.co.za, netpages, sayellow) list **Incredible Connection (Mall@Reds), Shop 61**. The retailer's own locator page returned **HTTP 403** (anti-bot) and was **not bypassed**.
- This pass's official-directory capture did not include Shop 61 / Incredible Connection (likely part of the ~27 uncaptured rows).
- **Resolution:** recorded as **excluded-pending** (medium confidence), not mixed into the official-verified set, until the official directory or the retailer's own locator confirms it.
- **2G re-confirmation (2026-07-24):** the complete official directory (now proven complete at 113) contains **no Shop 61 and no Incredible Connection listing**. Its absence is therefore a genuine "not in the current official directory" — not a capture gap. Stays **excluded-pending** until a tier-1/2 source confirms it.

### 4. Aggregator phone numbers = mall main line  (**data quality**)
- Several third-party listings show the store phone as **012 656 8957** — which is the **mall management (Anaprop) main line**, not the store's direct number.
- **Resolution:** treat aggregator phone numbers as **low-confidence**; the register's per-store phones come from the **official directory**, which lists store-specific numbers.

### 5. Coordinates unverified  (**data quality**)
- The official site publishes **no GPS coordinates**. The repository's demo value (`-25.8537, 28.1878`) is **unverified**.
- **Resolution:** all per-store `latitude`/`longitude` = `null`; a mall-level coordinate should be taken from Google Places (tier 4) in a follow-up, stored with that source. Nothing inferred now.

### 6. Shared store numbers within the official directory  (**identity**)
- Some shop numbers appear on two listings (e.g. **88** = Dis-Chem *and* Sunrise Home; **80A** = Clothing Junction *and* Homeware & Tech).
- **Resolution:** the verbatim `store_number` is preserved on each; a numeric suffix is appended to `canonical_store_id` only to keep IDs unique (6 such cases). No store number is invented or altered.
