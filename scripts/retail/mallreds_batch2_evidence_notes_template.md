# Batch 2 Evidence Note Templates (copy-paste)

Companion to `docs/retail/mallreds-batch2-evidence-work-order.md` (§7).
Paste the completed note into the row's `source_note`, replacing the
`BATCH2 PLACEHOLDER...` text — only once the evidence actually exists.

## Phone (Game / Checkers / Clicks)

```
PHONE VERIFIED | called [shop] Mall@Reds [number] | [YYYY-MM-DD HH:MM] | confirmed by [first name/role] | price R[x] [normal|special until YYYY-MM-DD] | in stock: [yes/no] | caller: [operator name]
```

## Website (Woolworths)

```
WEBSITE CHECKED | [full URL] | snapshot [filename/hash] | [YYYY-MM-DD HH:MM] | online price R[x] [normal|special until YYYY-MM-DD] | online-vs-store caveat: [confirmed by phone YYYY-MM-DD | not store-confirmed] | checker: [operator name]
```

## Shelf photo (PEP)

```
SHELF PHOTO | [filename] | PEP Mall@Reds Shop G20 | [YYYY-MM-DD HH:MM] | label price R[x] | in stock: yes (on shelf) | photographer: [operator name]
```

## Hold / needs_more_info

```
HOLD - NEEDS MORE INFO | [shop] | [YYYY-MM-DD] | reason: [refused | unsure | not stocked | member-price only | promo end date unknown] | next step: [x]
```

Rules reminder: no Verified without evidence · real price replaces
placeholder · refusals become HOLD, never guesses · substitutes are new
rows, never silent renames.
