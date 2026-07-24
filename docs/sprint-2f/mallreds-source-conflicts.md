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

### 2. Directory capture is incomplete — 113 captured vs ~140 claimed  (**completeness**)
- The automated fetch of the official directory returned **113 rows**; the page's own claimed total is **~140**.
- **Resolution:** the register is a **verified subset**, clearly labelled. Missing tenants are *not present* here — they are **not invented**. A complete re-capture of the official directory is a follow-up task.

### 3. Incredible Connection — third-party only  (**existence, medium confidence**)
- **Third-party directories** (yep.co.za, netpages, sayellow) list **Incredible Connection (Mall@Reds), Shop 61**. The retailer's own locator page returned **HTTP 403** (anti-bot) and was **not bypassed**.
- This pass's official-directory capture did not include Shop 61 / Incredible Connection (likely part of the ~27 uncaptured rows).
- **Resolution:** recorded as **excluded-pending** (medium confidence), not mixed into the official-verified set, until the official directory or the retailer's own locator confirms it.

### 4. Aggregator phone numbers = mall main line  (**data quality**)
- Several third-party listings show the store phone as **012 656 8957** — which is the **mall management (Anaprop) main line**, not the store's direct number.
- **Resolution:** treat aggregator phone numbers as **low-confidence**; the register's per-store phones come from the **official directory**, which lists store-specific numbers.

### 5. Coordinates unverified  (**data quality**)
- The official site publishes **no GPS coordinates**. The repository's demo value (`-25.8537, 28.1878`) is **unverified**.
- **Resolution:** all per-store `latitude`/`longitude` = `null`; a mall-level coordinate should be taken from Google Places (tier 4) in a follow-up, stored with that source. Nothing inferred now.

### 6. Shared store numbers within the official directory  (**identity**)
- Some shop numbers appear on two listings (e.g. **88** = Dis-Chem *and* Sunrise Home; **80A** = Clothing Junction *and* Homeware & Tech).
- **Resolution:** the verbatim `store_number` is preserved on each; a numeric suffix is appended to `canonical_store_id` only to keep IDs unique (6 such cases). No store number is invented or altered.
