-- ================================================================
-- Migration 001 — Add geo + Google Places columns
--
-- Run this in Supabase → SQL Editor
-- Safe to re-run (uses IF NOT EXISTS / DO $$ pattern)
-- ================================================================


-- ── MALLS table additions ─────────────────────────────────────────────────
-- Add GPS coordinates so we can sort malls by distance and enable geofencing

ALTER TABLE malls
  ADD COLUMN IF NOT EXISTS lat              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS address          TEXT,
  ADD COLUMN IF NOT EXISTS phone            TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS google_place_id  TEXT,
  ADD COLUMN IF NOT EXISTS rating           NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS province         TEXT;


-- ── SHOPS table additions ─────────────────────────────────────────────────
-- Add per-store GPS (for indoor positioning), Google Place ID, contact info

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS lat              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS phone            TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS google_place_id  TEXT;


-- ── Seed GPS coordinates for the 8 existing malls ────────────────────────
-- These are accurate GPS centre-points for each mall

UPDATE malls SET
  lat = -26.1074, lng = 28.0564,
  province = 'Gauteng',
  address = 'Sandton City, 163 5th Street, Sandton, 2196'
WHERE name ILIKE '%sandton city%';

UPDATE malls SET
  lat = -25.9968, lng = 28.1097,
  province = 'Gauteng',
  address = 'Mall of Africa, Lone Creek Crescent, Waterfall City, Midrand'
WHERE name ILIKE '%mall of africa%';

UPDATE malls SET
  lat = -25.7821, lng = 28.2762,
  province = 'Gauteng',
  address = 'Menlyn Park Shopping Centre, Atterbury Rd & Lois Ave, Menlyn, Pretoria'
WHERE name ILIKE '%menlyn%';

UPDATE malls SET
  lat = -26.1824, lng = 28.1057,
  province = 'Gauteng',
  address = 'Eastgate Shopping Centre, 43 Bradford Rd, Bedfordview'
WHERE name ILIKE '%eastgate%';

UPDATE malls SET
  lat = -26.1354, lng = 27.9724,
  province = 'Gauteng',
  address = 'Cresta Shopping Centre, Beyers Naude Drive, Cresta, Johannesburg'
WHERE name ILIKE '%cresta%';

UPDATE malls SET
  lat = -29.7266, lng = 31.0777,
  province = 'KwaZulu-Natal',
  address = 'Gateway Theatre of Shopping, 1 Palm Blvd, Umhlanga Ridge, Umhlanga'
WHERE name ILIKE '%gateway%';

UPDATE malls SET
  lat = -33.8943, lng = 18.5120,
  province = 'Western Cape',
  address = 'Canal Walk Shopping Centre, Century Blvd, Century City, Cape Town'
WHERE name ILIKE '%canal walk%';

UPDATE malls SET
  lat = -33.9022, lng = 18.4197,
  province = 'Western Cape',
  address = 'V&A Waterfront, Dock Rd, Victoria & Alfred Waterfront, Cape Town'
WHERE name ILIKE '%waterfront%' OR name ILIKE '%v&a%' OR name ILIKE '%v & a%';


-- ── Index for geospatial queries ──────────────────────────────────────────
-- Speeds up "find nearest mall" queries dramatically

CREATE INDEX IF NOT EXISTS malls_lat_lng_idx ON malls (lat, lng);
CREATE INDEX IF NOT EXISTS shops_google_place_id_idx ON shops (google_place_id);
CREATE INDEX IF NOT EXISTS malls_google_place_id_idx ON malls (google_place_id);
