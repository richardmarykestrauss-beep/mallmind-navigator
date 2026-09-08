# MallMind Retail Source Registry v1

| | |
|---|---|
| **Sprint** | 22D — Retail Brain Source Strategy & Source Registry Design |
| **Baseline commit** | `e12de46741807e25fdf265d2bc6f09a2ea5e4c14` |
| **Status** | PROPOSAL ONLY — nothing in this document is applied to the database |
| **Companion** | [source-registry-seed-proposal.csv](./source-registry-seed-proposal.csv) (proposal-only) |

## 1. Purpose

MallMind's trust moat is accurate, evidence-backed, fresh retail data. Every
fact a shopper sees must be traceable through one unbroken chain:

> **source → snapshot/evidence → extraction → observation → review →
> publish → shopper-safe label**

A *source* is the first link. If observations are staged under vague or
unregistered sources ("misc manual CSV"), that provenance debt is permanent —
rows keep their source forever. Registering sources **before** adding product
volume means every Batch 2+ row cites a named source with a known legal
status, trust baseline, evidence standard and freshness window. Volume
without source identity creates long-term trust debt; this document prevents
that.

The registry maps onto the existing `retail_data_sources` table (migration
026): `source_type`, `base_trust`, `legal_status`, `attribution_required`,
`is_active`, `license_note`. No schema change is required for v1 (one small
optional addition is proposed in §5 for snapshot types).

## 2. Initial source classes

Legend: *Verified?* = can observations from this class ever publish as a
Verified price. *Review?* = admin review required before publish (currently:
always, for everything).

### 2.1 Phone verification
- **Purpose:** human calls the store and confirms price/stock. Current gold standard.
- **source_type:** `manual` · **legal_status:** `manual_fact_entry`
- **base_trust:** 0.90 · **Evidence:** call note (who called, number, time, what was confirmed)
- **Freshness:** 7 days · **Verified?:** YES · **Review?:** yes
- **Labels:** "Verified option" / "Verified price"; after window "Price may have changed"
- **Hard rules:** verifier identity recorded in `verified_by`; no verification claim without an actual call.

### 2.2 Store visit / shelf photo
- **Purpose:** operator photographs the shelf label in-store.
- **source_type:** `manual` · **legal_status:** `manual_fact_entry`
- **base_trust:** 0.90 · **Evidence:** photo (hashed snapshot, type `image`), date, store
- **Freshness:** 7 days · **Verified?:** YES · **Review?:** yes
- **Labels:** "Verified option"
- **Hard rules:** photo must show product + price legibly; EXIF/date retained privately.

### 2.3 Receipt / till slip
- **Purpose:** proof a price was actually paid on a date.
- **source_type:** `manual` · **legal_status:** `manual_fact_entry`
- **base_trust:** 0.95 · **Evidence:** receipt image (hashed); **card numbers / loyalty IDs redacted before storage**
- **Freshness:** 7 days as current price; permanent as historical evidence
- **Verified?:** YES · **Review?:** yes · **Labels:** "Verified option"
- **Hard rules:** PII redaction is mandatory; a receipt proves the past, not next week.

### 2.4 Retailer website check (human)
- **Purpose:** human checks the retailer's own public product page.
- **source_type:** `manual` · **legal_status:** `manual_fact_entry`
- **base_trust:** 0.75 · **Evidence:** URL + screenshot/HTML snapshot (hashed) + check date
- **Freshness:** 1–7 days · **Verified?:** YES (method `website`) — with the caveat that online price ≠ guaranteed in-store price; prefer phone for the demo's flagship rows
- **Review?:** yes · **Labels:** "Verified option" or "Price may need confirmation" per reviewer judgement
- **Hard rules:** record the exact URL; online-only prices must not claim in-store validity without a second signal.

### 2.5 Retailer flyer / PDF
- **Purpose:** retailer-published catalogues with printed validity windows.
- **source_type:** `flyer` · **legal_status:** `manual_fact_entry` (distributed marketing material, factual extraction)
- **base_trust:** 0.80 · **Evidence:** the PDF/image itself (hashed snapshot, type `pdf`/`image`), page reference
- **Freshness:** printed `valid_to`; cap 14 days if undated
- **Verified?:** YES (`flyer_extracted` → manually_verified per existing trust mapper) · **Review?:** yes
- **Labels:** "Verified option" during validity; special must drop at `valid_to`
- **Hard rules:** extract facts only; never republish the creative; national flyer ≠ proof of a specific mall's shelf price unless the flyer says so or it is confirmed.

### 2.6 Retailer email / newsletter (Dis-Chem specials pattern)
- **Purpose:** recurring permissioned specials data. Full standard in §5.
- **source_type:** `flyer` class for v1 (newsletter = digital flyer); a dedicated `newsletter` type may be proposed later
- **legal_status:** `manual_fact_entry` (human-forwarded) / upgrade path to `partner_licensed` if the retailer agrees
- **base_trust:** 0.80 · **Evidence:** PII-stripped original email (hashed)
- **Freshness:** stated validity window; cap 14 days if undated
- **Verified?:** YES for the *promo fact*; mall-level shelf claim needs confirmation (§5)
- **Review?:** yes · **Labels:** "Verified option" during validity
- **Hard rules:** §5 in full — PII stripping, no creative republication, no mailbox crawling.

### 2.7 User-submitted photo
- **Purpose:** crowd-sourced price sightings.
- **source_type:** `user_submission` · **legal_status:** `user_supplied`
- **base_trust:** 0.40 · **Evidence:** photo (hashed) + location + time
- **Freshness:** 3–7 days · **Verified?:** **NO, never alone** — may corroborate; can upgrade a fact only via operator re-verification
- **Review?:** yes · **Labels:** "Price may need confirmation"
- **Hard rules:** single user submission can never publish as Verified; conflicting submissions trigger review, not replacement.

### 2.8 Manual admin entry (no external evidence)
- **Purpose:** bootstrap/bridge entries typed by an admin.
- **source_type:** `manual` · **legal_status:** `manual_fact_entry`
- **base_trust:** 0.50 · **Evidence:** none beyond the entry itself
- **Freshness:** n/a — publishes as `needs_review` tier
- **Verified?:** **NO** (existing hardened rule: `manual_fact_entry` + `csv_manual` → needs_review, never Verified)
- **Review?:** yes · **Labels:** "Price may need confirmation"
- **Hard rules:** this class exists to be replaced by evidence-backed classes; never widen it.

### 2.9 Partner / retailer submission
- **Purpose:** the endgame — retailers submit their own facts via portal/agreement.
- **source_type:** `retailer_submission` / `partner_feed` · **legal_status:** `retailer_supplied` / `partner_licensed`
- **base_trust:** 0.90 · **Evidence:** authenticated submission record
- **Freshness:** submitter-controlled with heartbeat; stale feed degrades
- **Verified?:** YES; long-term candidate for direct publish **after** a sustained accuracy track record and an explicit policy change — review-gated until then
- **Review?:** yes (v1) · **Labels:** "Verified option" / future "Live retailer feed"
- **Hard rules:** contract before connection; attribution per agreement.

### 2.10 Affiliate / product feed
- **Purpose:** licensed structured feeds (e.g. affiliate programmes).
- **source_type:** `affiliate_feed` · **legal_status:** `licensed_feed` once an actual licence exists; until then `needs_legal_review`
- **base_trust:** 0.70 · **Evidence:** feed payload snapshot (hashed)
- **Freshness:** daily heartbeat · **Verified?:** online price only — never an in-store claim without mall-level confirmation
- **Review?:** yes · **Labels:** at most "Price may need confirmation" for in-store context
- **Hard rules:** feed terms read and recorded in `license_note` before activation.

### 2.11 Public catalogue aggregator
- **Purpose:** lead generation only (third parties aggregating others' flyers).
- **source_type:** `partner_feed` (if contracted) else unregistered · **legal_status:** `reference_only` / `needs_legal_review`
- **base_trust:** 0.40 · **Evidence:** weak (second-hand)
- **Freshness:** n/a for publishing · **Verified?:** **NO** — leads only; go to the underlying retailer flyer
- **Review?:** yes · **Labels:** none (must not reach shoppers)
- **Hard rules:** inactive until legal review; never cite an aggregator as evidence.

### 2.12 Google Business / Profile / store directory
- **Purpose:** shop existence, location, trading hours — **never prices**.
- **source_type:** n/a for retail prices; lives in the Mall Intelligence lane (`mall_sources`, GeoDirectory enrichment)
- **legal_status:** licensed API use only · **base_trust:** 0.70 for hours/location
- **Freshness:** weekly-monthly · **Verified?:** n/a (not price data) · **Review?:** yes (staged store locations)
- **Hard rules:** Places API under its licence; no scraping of Google surfaces.

### 2.13 Mall website / directory
- **Purpose:** tenant lists, units, floors — feeds shops, not prices.
- **source_type:** Mall Intelligence lane · **legal_status:** public directory info; `manual_fact_entry` for human-checked entries
- **base_trust:** 0.65 · **Evidence:** page snapshot + date
- **Freshness:** monthly · **Verified?:** n/a (not price data) · **Review?:** yes (staged)
- **Hard rules:** directory says a store exists, not what it charges.

### 2.14 Legacy scraper output — QUARANTINED
- **Purpose:** none, going forward. Historical code kept as raw material (Sprint 22C).
- **source_type:** would be `csv`-class if ever re-staged · **legal_status:** `needs_legal_review`
- **base_trust:** 0.30 · **is_active:** **false**
- **Verified?:** **NO** · **Review?:** n/a — must not feed the pipeline at all
- **Hard rules:** scrapers never write to products (enforced by 22C quarantine); any rebuilt scraper outputs observations under a *new*, legally-reviewed source registration, never this one.

## 3. Initial named source registry proposal

All rows are proposals; nothing is inserted by this sprint.

| source_name | source_type | legal_status | base_trust | attribution_required | active | Allowed use | Forbidden use | Notes |
|---|---|---|---|---|---|---|---|---|
| MallMind Phone Verification — Mall@Reds | manual | manual_fact_entry | 0.90 | no | yes | Verify price/stock per product per call; demo re-verification | claiming verification without a real call | Current gold standard; verifier named in `verified_by` |
| MallMind Store Visit Evidence | manual | manual_fact_entry | 0.90 | no | yes | shelf-photo-backed observations | illegible/undated photos as evidence | snapshot type `image` |
| MallMind Receipt Evidence | manual | manual_fact_entry | 0.95 | no | yes | price-paid proof | storing unredacted card/loyalty data | redact before storage |
| Retailer Website Public Page Evidence | manual | manual_fact_entry | 0.75 | no | yes | human checks of retailer's own public pages, URL + snapshot | automated crawling under this source; in-store claims from online-only prices | method `website` |
| Retailer Flyer / PDF Evidence | flyer | manual_fact_entry | 0.80 | no | yes | extraction from retailer-published catalogues | republishing creative; mall-level claims from national flyers without confirmation | validity window from the artefact |
| Dis-Chem Newsletter Evidence | flyer | manual_fact_entry | 0.80 | no | yes | §5 standard: forwarded/owned-inbox specials emails | mailbox crawling; storing recipient PII; auto-publish | upgrade path to partner_licensed |
| MallMind User Submissions | user_submission | user_supplied | 0.40 | no | yes | corroborating signals, leads | publishing as Verified alone | ties into price_correction_reports |
| MallMind Manual Admin Entry | manual | manual_fact_entry | 0.50 | no | yes | bootstrap rows that will be evidence-upgraded | ever becoming Verified without an evidence method | existing hardened rule |
| Mall@Reds Official Directory | csv (mall-intel lane) | manual_fact_entry | 0.65 | no | yes | shop existence/floor/unit staging | price claims | directory ≠ prices |
| Mall of Africa Official Directory | csv (mall-intel lane) | manual_fact_entry | 0.65 | no | **no (until 22H/23A)** | future second-mall shop staging | activation before identity hardening | proposed inactive |
| Sandton City Official Directory | csv (mall-intel lane) | manual_fact_entry | 0.65 | no | **no** | future flagship staging | activation before partner posture decided | proposed inactive |
| Affiliate Feed — Unlicensed Placeholder | affiliate_feed | **needs_legal_review** | 0.70 | yes | **no** | nothing until a licence exists | any publishing | placeholder documenting the rule |
| Public Catalogue Aggregators | partner_feed | **reference_only** | 0.40 | yes | **no** | leads → go verify at the underlying retailer | citing as evidence; publishing | legal review before any use |
| Legacy Scraper Output — Quarantined | csv | **needs_legal_review** | 0.30 | no | **no** | none | feeding the pipeline; any writes | 22C quarantine; rebuilt scrapers get NEW registrations |

## 4. Proposed seed CSV

See [source-registry-seed-proposal.csv](./source-registry-seed-proposal.csv).
**Proposal-only: do not apply.** Risky/unready sources are marked
`is_active=false` and/or `needs_legal_review`/`reference_only`. Applying the
registry (a later, explicitly-approved sprint) would go through a
dry-run-first script in the existing pattern, never a raw SQL paste.

## 5. Email / newsletter evidence standard (Dis-Chem pattern)

1. **Intake:** a human forwards the retailer's specials email to a dedicated
   MallMind inbox, or (phase 2) a MallMind-owned inbox is subscribed
   directly. **Never** crawl a personal mailbox; only explicitly forwarded
   items or the MallMind-controlled inbox are in scope.
2. **Evidence preservation:** the original email is stored privately as a
   snapshot. Hash the raw source; then produce and store the **PII-stripped**
   version (hash recorded for both, only the stripped copy retained):
   - strip recipient address(es) and forwarder identity headers
     (`Delivered-To`, `Received` chains, `X-Forwarded-For`);
   - strip unsubscribe links/tokens (they embed subscriber identifiers);
   - strip loyalty/customer numbers anywhere in the body;
   - keep sender domain (provenance), subject, date, body content.
3. **Snapshot typing:** v1 uses existing snapshot types (`feed` or `image`
   of the rendered email). **Proposed (not applied) migration for later
   approval:** extend the `retail_source_snapshots.snapshot_type` CHECK to
   add `'email'`:
   ```sql
   -- PROPOSAL ONLY — do not run in this sprint
   alter table public.retail_source_snapshots
     drop constraint retail_source_snapshots_snapshot_type_check;
   alter table public.retail_source_snapshots
     add constraint retail_source_snapshots_snapshot_type_check
     check (snapshot_type in
       ('csv','manual_note','pdf','image','feed','retailer_upload','user_photo','email'));
   ```
4. **Extraction:** product name, price, special price, and the **stated
   validity window** are extracted (human or AI, with extraction confidence
   recorded). The retailer's own `valid_to` is gold — it drives special
   expiry.
5. **Staging:** extracted rows become `retail_price_observations` under the
   registered newsletter source — never direct product writes, never
   auto-publish. Admin review is mandatory.
6. **Honesty rule:** a national Dis-Chem special proves the *chain promo*,
   not a specific mall's shelf price. Either the mall-level claim is
   confirmed (phone/photo at the branch) or the observation is staged
   against the chain context with the reviewer deciding the safe framing.
7. **Copyright:** extract facts; never republish the email's creative,
   images, or layout. Evidence snapshots are private (026 comment: "Do not
   expose publicly").

## 6. Legal and compliance rules

- No bypassing technical protections; no CAPTCHA/login scraping; no
  aggressive crawling. If a site resists automation, stop.
- robots.txt and terms of service must be checked **per target** and the
  outcome recorded in the source's `license_note`.
- `legal_status = needs_legal_review` **blocks publish** (see §7).
- `reference_only` sources may create internal leads/verification tasks but
  never Verified shopper claims.
- PII minimization: store the minimum needed for evidence; redact recipient
  identifiers, card/loyalty numbers; evidence snapshots are never
  shopper-visible.
- No user mailbox crawling — only explicitly forwarded emails or the
  MallMind-controlled, directly-subscribed inbox.
- "Publicly visible" is not a licence. When in doubt: prefer the human or
  partner path; it exists for every source class above.

## 7. Publisher hardening proposal (spec only — DO NOT IMPLEMENT THIS SPRINT)

The approved-only publisher (`scripts/retail/publish-staged-observations.mjs`)
and the admin publish preview should additionally **refuse** any observation
whose joined `retail_data_sources` row has:

- `legal_status = 'needs_legal_review'`, or
- `legal_status = 'prohibited'` *(note: not currently in the 026 CHECK list —
  adding it would itself be a proposed migration)*, or
- `is_active = false`

…unless explicitly overridden by a future **admin-only, audited** override
process (logged to `admin_audit_log` with the admin identity and reason).
The natural implementation home is the shared Retail Intelligence Core
(`retailPublishPlanner` gaining a source-eligibility check), so script and
preview stay in lockstep — with harness coverage. Spec only; no code changed
in 22D.

## 8. Freshness windows

| Source class | Verified-tier window | After expiry |
|---|---|---|
| Phone verification | 7 days | "Price may have changed" + re-verification task |
| Store visit / shelf photo | 7 days | same |
| Receipt | 7 days as current price; permanent as historical evidence | history only |
| Retailer website check | 1–7 days (reviewer sets per source confidence) | degrade |
| Newsletter / flyer | stated `valid_to`; cap 14 days if undated; special flag must drop at `valid_to` | degrade + special removed |
| Retailer API / partner feed | heartbeat-based (hours–24h); stale feed degrades automatically | degrade |
| User photo | 3–7 days, never Verified alone | fades |
| Demo data | never fresh — always "Example/demo data" | n/a |

Re-verification loops: 22B manual helper (exists) → read-only expiry report
(roadmap) → much later, flag-only scheduled sweeps. No scheduled jobs yet.

## 9. Mall choice implication

- **Mall@Reds Batch 2 comes after this registry** so that every new row
  cites a registered source with a real legal status and evidence standard —
  no provenance debt. Batch 2 also measures the true operator cost per
  verified product, the key input for scaling decisions.
- **Mall of Africa is the second-mall pilot**, entered only after source
  discipline (this doc) and multi-mall identity hardening (chain-aware shop
  references, brand/model-aware product matching). Its retailer overlap
  (multiple Games/Clicks/Woolworths) is precisely what breaks name-fragment
  matching today.
- **Sandton City is the flagship, later** — approached with partner-grade
  sources and a working multi-mall brain, because first impressions with
  premium landlords/retailers are spent once.

## 10. Immediate next sprint recommendation

**Sprint 22E — Mall@Reds Catalogue Batch 2 Source Pack.**

Scope expectation:
- Choose 20–30 products across 3–5 Mall@Reds shops (mix of electronics,
  grocery, pharmacy if available).
- Every row cites a **registered source from this document** (phone
  verification primary; flyer/website/photo where artefacts exist) with the
  evidence artefact captured (call note, photo, PDF, URL snapshot).
- Build the CSV + evidence pack; stage via the existing
  `import-csv-staging.mjs` (dry-run first, `--apply` gated); review in the
  admin queue; publish via the approved-only publisher.
- Measure and record operator minutes per verified product.
- **No raw scraping. No direct product writes. No new code expected.**
  Everything flows observation staging → review → publish.
