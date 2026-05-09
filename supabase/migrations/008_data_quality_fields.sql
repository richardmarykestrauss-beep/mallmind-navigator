-- ── Migration 008 — Full data quality model for products ────────────────────
--
-- Adds four more fields alongside the price_verified_at from migration 007.
-- Together they answer: how trustworthy is this price, who said so, and how
-- did it get here?
--
-- data_quality_status values and their meaning:
--
--   demo               – manually seeded for dev/testing; not independently
--                        confirmed; safe for tech testing only
--   manually_verified  – price confirmed by a human against a real source
--                        (phone call, website, flyer, receipt, store visit,
--                        or direct retailer confirmation); safe for demo/pilot
--   live_feed          – price injected automatically from a retailer API,
--                        scraper, or official data feed; safe for production
--   stale              – was live_feed or manually_verified but has not been
--                        refreshed within the acceptable window; treat as
--                        untrustworthy until re-verified
--   user_submitted     – price submitted by a user via the crowdsourced
--                        price submission feature; unverified but community-
--                        sourced; needs_review after first submission
--   needs_review       – flagged for manual review (e.g. 3+ user submissions
--                        disagree with the stored price, or scraper returned
--                        an outlier value)
--
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS data_quality_status text
    NOT NULL
    DEFAULT 'demo'
    CHECK (data_quality_status IN (
      'demo',
      'manually_verified',
      'live_feed',
      'stale',
      'user_submitted',
      'needs_review'
    )),

  ADD COLUMN IF NOT EXISTS price_verification_method text
    CHECK (price_verification_method IN (
      'phone',
      'website',
      'flyer',
      'receipt',
      'store_visit',
      'retailer_confirmation',
      'scraper',
      'retailer_api',
      'user_submission'
    )),

  ADD COLUMN IF NOT EXISTS data_source text,

  ADD COLUMN IF NOT EXISTS verified_by text;

-- ── Column comments ───────────────────────────────────────────────────────────

COMMENT ON COLUMN products.data_quality_status IS
  'Overall trustworthiness of this price. Allowed values: '
  'demo | manually_verified | live_feed | stale | user_submitted | needs_review. '
  'Dev Agent classifies endpoints as DEMO_DATA, VERIFIED_DATA, or REAL based on this.';

COMMENT ON COLUMN products.price_verification_method IS
  'How the price was confirmed. Only meaningful when data_quality_status is '
  'manually_verified or live_feed. '
  'Allowed: phone | website | flyer | receipt | store_visit | '
  'retailer_confirmation | scraper | retailer_api | user_submission.';

COMMENT ON COLUMN products.data_source IS
  'Free-text origin label, e.g. "manual_seed", "takealot_scraper", '
  '"game_retailer_api", "user_submission_20260509". '
  'Helps trace where a price came from without a full audit table.';

COMMENT ON COLUMN products.verified_by IS
  'Optional identifier of who last verified this price, e.g. an email address, '
  'staff ID, or automated service name. Not a foreign key — lightweight audit trail.';

-- ── Seed: label existing seed data honestly ───────────────────────────────────
-- All existing products were entered as development seeds.
-- Mark them explicitly so reporting tools see 'demo' and not NULL.
-- Do NOT change this to 'manually_verified' unless you have physically
-- checked the price against a real store.

UPDATE products
SET    data_source = 'manual_seed'
WHERE  data_source IS NULL;
