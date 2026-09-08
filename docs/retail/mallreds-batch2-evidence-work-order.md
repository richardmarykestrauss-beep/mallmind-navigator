# Mall@Reds Batch 2 — Evidence Capture Work Order

| | |
|---|---|
| **Sprint** | 22F — Evidence Capture Work Order |
| **Baseline commit** | `a949d661f49417a17429945872c1350c71e83b0d` |
| **Pack** | [mallreds-batch2-source-pack.md](./mallreds-batch2-source-pack.md) · CSV `scripts/retail/mallreds_batch2_source_pack.csv` |
| **Note templates** | [mallreds_batch2_evidence_notes_template.md](../../scripts/retail/mallreds_batch2_evidence_notes_template.md) |

## 1. Purpose

This is the **human evidence-capture step** between the Batch 2 plan (22E)
and any staging. Nothing in the CSV may be applied, and no row may claim
Verified, until the work in this document is done. The operator collects
real evidence (calls, snapshots, photos), then updates the CSV per §8 —
without ever creating a fake verified row.

## 2. Operator rules

1. Do not promise prices to users — MallMind states verified facts, it does
   not negotiate or guarantee.
2. **Nothing is marked Verified until its evidence exists.** No exceptions.
3. Do not apply the placeholder CSV. Ever.
4. Capture date **and time** for every piece of evidence.
5. Capture the source and contact details (store number called, URL, who
   answered — first name/role is enough).
6. Capture stock status honestly — "they weren't sure" is `needs_more_info`,
   not `in_stock=true`.
7. If a store refuses to confirm price/stock → mark the row **hold /
   needs_more_info** (template §7.4). Do not guess.
8. If the real price differs from the placeholder → update the CSV to the
   **real** price before any staging. The placeholder is disposable.
9. If a product is not stocked → set `in_stock=false`, or hold/remove the
   row. Never publish stock that doesn't exist.
10. If the store offers a substitute ("we don't have the DMO381, we have the
    DMO382") → that is a **new row** created later through review. Do not
    silently rename or re-spec the existing row.

## 3. Phone call scripts

Best window: weekday 09:30–11:30. One call per shop covers all 5 products.

### 3.1 Game (Shop G01) — 5 electronics/appliance products

> "Hi, good morning. My name is [NAME]. I'm doing a price check for a local
> shopping app that lists verified in-store prices for Mall@Reds — it sends
> customers to your store. Could I quickly confirm the shelf price and
> availability of five products? It takes about two minutes."

For each product, ask exactly:
1. "Is the **[product name/model]** stocked at your Mall@Reds branch?"
2. "What is the current shelf price?"
3. "Is that a special or the normal price?"
4. "If it's a special — until when is it valid?"
5. (Close) "Thanks — may I note your first name as the person who confirmed?"

Evidence note to paste into `source_note` (replacing the placeholder):
```
PHONE VERIFIED | called Game Mall@Reds [number] | [YYYY-MM-DD HH:MM] |
confirmed by [first name/role] | price R[x] [normal|special until YYYY-MM-DD] |
in stock: [yes/no] | caller: [operator name]
```

**Refusal/uncertainty handling:** if they can't or won't confirm a product,
say thank you, note `REFUSED/UNSURE [date]` for that row, and mark it hold
(§7.4). Never coax a guess out of staff and record it as fact.

### 3.2 Checkers (Shop G05) — 5 grocery staples

Same opening and questions. Groceries move fast; explicitly ask: "Is that
today's shelf price?" If the staffer quotes a promo price, capture the
promo end date or treat as normal-price-unknown → hold.

### 3.3 Clicks (Shop G15) — 5 health & beauty products

Same script. Note for Clicks: card/member prices differ from shelf prices —
ask explicitly for the **non-member shelf price**. If only a member price is
given, record both in the note and keep the row at needs_more_info for the
reviewer to frame.

## 4. Product checklist by shop

Legend — Confirm: price (P), stock (S), special? (Sp), valid_to if special
(V), confirmer/evidence (E). Final action is one of:
**verify** (evidence captured, CSV upgraded) / **update** (real price
differs — correct CSV, then verify) / **hold** (needs_more_info) /
**remove** (not stocked, drop row).

### Game — phone (one call)
| Product | Placeholder | Confirm | Action |
|---|---|---|---|
| Samsung Galaxy A16 LTE 128GB | R3299 | P S Sp V E | verify / update / hold / remove |
| Defy 20L Manual Microwave DMO381 | R1299 | P S Sp V E | " |
| Russell Hobbs 1.7L Cordless Kettle | R399 | P S Sp V E | " |
| JBL Go 4 Portable Speaker | R899 | P S Sp V E | " |
| Sunbeam 2-Slice Toaster | R329 | P S Sp V E | " |

### Checkers — phone (one call)
| Product | Placeholder | Confirm | Action |
|---|---|---|---|
| Jacobs Krönung Instant Coffee 200g | R129.99 | P S Sp V E | verify / update / hold / remove |
| Nescafé Ricoffy 750g | R159.99 | P S Sp V E | " |
| Huletts White Sugar 2.5kg | R74.99 | P S Sp V E | " |
| Sunlight Dishwashing Liquid 750ml | R42.99 | P S Sp V E | " |
| Fatti's & Moni's Macaroni 500g | R26.99 | P S Sp V E | " |

### Woolworths — website snapshot (+ phone if doubt)
| Product | Placeholder | Confirm | Action |
|---|---|---|---|
| Ayrshire Full Cream Milk 2L | R46.99 | P S Sp V E + URL | verify / update / hold / remove |
| Free Range Large Eggs 6s | R39.99 | P S Sp V E + URL | " |
| Soft White Bread 700g | R23.99 | P S Sp V E + URL | " |
| Chicken Breast Fillets 600g | R94.99 | P S Sp V E + URL | " |
| Still Water 1.5L | R16.99 | P S Sp V E + URL | " |

### Clicks — phone (one call)
| Product | Placeholder | Confirm | Action |
|---|---|---|---|
| Panado Tablets 24s | R32.99 | P S Sp V E (non-member price) | verify / update / hold / remove |
| Colgate Total Toothpaste 100ml | R39.99 | P S Sp V E (non-member) | " |
| Dove Original Roll-On 50ml | R29.99 | P S Sp V E (non-member) | " |
| Clicks Vitamin C 500mg 100s | R89.99 | P S Sp V E (non-member) | " |
| Johnson's Baby Wipes 80s | R34.99 | P S Sp V E (non-member) | " |

### PEP — store visit / shelf photos (one visit)
| Product | Placeholder | Confirm | Action |
|---|---|---|---|
| Men's Crew Neck T-Shirt | R49.99 | P S E (photo) | verify / update / hold / remove |
| Ladies' Basic Leggings | R79.99 | P S E (photo) | " |
| Kids' School Socks 3-Pack | R39.99 | P S E (photo) | " |
| Men's Canvas Sneakers | R159.99 | P S E (photo) | " |
| Bath Towel 70×130cm | R99.99 | P S E (photo) | " |

## 5. Woolworths website snapshot checklist (per row)

1. Find the exact product page on woolworths.co.za; record the **full URL**.
2. Capture a screenshot (or save the HTML) showing product name + price +
   date visible (include the system clock or note the timestamp).
3. Record date/time of the check.
4. Record the **online-vs-store caveat**: online price is not automatically
   the Mall@Reds shelf price. If the price is borderline for the demo or the
   item is promo-flagged online, phone the Mall@Reds store (Shop G10) to
   confirm — then it becomes a phone-verified row instead.
5. Decide: website evidence sufficient (staple, stable) → verify with method
   `website`; doubt → phone confirm or hold.
6. Note format: §7.2.

## 6. PEP shelf-photo checklist (single visit, Shop G20)

- Photo must show **the product and its price label legibly in one frame**.
- One photo per product; retakes beat blur.
- Record date/time and location (PEP Mall@Reds, Shop G20).
- Filename format: `pep-mallreds-[product-slug]-YYYYMMDD.jpg`
  (e.g. `pep-mallreds-mens-crewneck-tshirt-20260615.jpg`).
- Keep originals (EXIF intact) in the private evidence folder; photos are
  evidence, never shopper-visible content.
- Product not on shelf / no price label → no photo, mark the row hold or
  `in_stock=false` per what staff confirm. Do not photograph a similar item
  as a stand-in (see rule 2.10).

## 7. Evidence note templates

(Also in `scripts/retail/mallreds_batch2_evidence_notes_template.md` for
copy-paste.)

**7.1 Phone note**
```
PHONE VERIFIED | called [shop] Mall@Reds [number] | [YYYY-MM-DD HH:MM] |
confirmed by [first name/role] | price R[x] [normal|special until YYYY-MM-DD] |
in stock: [yes/no] | caller: [operator name]
```

**7.2 Website note**
```
WEBSITE CHECKED | [full URL] | snapshot [filename/hash] | [YYYY-MM-DD HH:MM] |
online price R[x] [normal|special until YYYY-MM-DD] |
online-vs-store caveat: [confirmed by phone YYYY-MM-DD | not store-confirmed] |
checker: [operator name]
```

**7.3 Shelf photo note**
```
SHELF PHOTO | [filename] | PEP Mall@Reds Shop G20 | [YYYY-MM-DD HH:MM] |
label price R[x] | in stock: yes (on shelf) | photographer: [operator name]
```

**7.4 Hold / needs_more_info note**
```
HOLD - NEEDS MORE INFO | [shop] | [YYYY-MM-DD] | reason: [refused | unsure |
not stocked | member-price only | promo end date unknown] | next step: [x]
```

## 8. CSV update procedure (after evidence, before staging)

Per row, in `scripts/retail/mallreds_batch2_source_pack.csv` (or a copied
`..._verified.csv` to keep the plan file pristine — reviewer's choice):

1. Remove the `BATCH2 PLACEHOLDER - DO NOT APPLY...` prefix **only when that
   row's evidence exists**.
2. Replace `price` (and `original_price`) with the confirmed figures.
3. Set `trust_state` → `verified` **only for evidence-backed rows**.
4. Set `verification_method` → `phone` / `website` / `store_visit` to match
   the actual evidence.
5. Replace the placeholder `source_note` with the real note (§7 templates).
6. Set `valid_to` only when a special has a stated end date; non-special
   rows keep the generic horizon.
7. Rows without evidence **stay** `manual_fact_entry` + `csv_manual` with
   their placeholder or HOLD note — they stage safely as needs_review and
   can never publish as Verified (enforced by the trust mapper).
8. `in_stock` reflects what was actually confirmed.

## 9. Quality gate before staging (all boxes, before any import dry-run)

- [ ] No `[placeholder]` bracket remains on any row marked `verified`
- [ ] No fake verified row — every `verified` row has a real §7 note
- [ ] No unknown shop — all rows use the 5 confirmed shop ids
- [ ] No price without a capture date in its note
- [ ] No `in_stock=true` without confirmation
- [ ] No special without `valid_to` where a date was provided
- [ ] Unresolved rows remain low-trust (`csv_manual`) / HOLD — not deleted
      silently, not promoted
- [ ] Evidence artefacts (photos/screenshots) saved to the private evidence
      folder with filenames matching the notes

## 10. Staging handoff (next sprint, after this work order is executed)

1. Updated evidence-backed CSV ready (per §8).
2. `node scripts/retail/import-csv-staging.mjs --file <csv>` — **dry run
   only** in that sprint; review the plan output.
3. Only after plan review (and explicit approval): `--apply` in Cloud Shell,
   then admin review queue, then approved-only publisher — each step gated
   as designed.

## 11. ⏰ Hisense founder demo re-verification (DEADLINE ~2026-06-16)

The founder demo's "Verified option" (Hisense 43" FHD LED TV at Game,
phone-verified 2026-06-09) expires around **2026-06-16** under the 7-day
trust window. **While making the Game call in §3.1, also re-confirm the
Hisense at R3 499** — one call covers both jobs. Then, and only then:

```bash
node scripts/retail/reverify-demo-prices.mjs --apply \
  --verified-by "Richard phone recheck YYYY-MM-DD"
```

**Do not run `--apply` without a real verification.** If the Hisense price
has changed from R3 499, the helper will refuse by design — the correct path
is then re-staging through the observation pipeline, not a freshness touch.
See [demo-price-reverification.md](./demo-price-reverification.md).
