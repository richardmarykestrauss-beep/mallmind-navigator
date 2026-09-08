-- ── Sprint 8F: Price Correction Reports ──────────────────────────────────────
-- Operational workflow table for user-submitted price corrections.
-- Users report; admins review; only admin approval can change product prices.
-- Separate from analytics_events because these are actionable items, not signals.

-- ── updated_at trigger function (idempotent) ──────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists price_correction_reports (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null    default now(),
  updated_at  timestamptz not null    default now(),

  -- Attribution (optional — no login required to submit)
  user_id     uuid null,
  mall_id     uuid null,

  -- What product and shop the correction targets
  product_id  uuid not null references products(id),
  shop_id     uuid null     references shops(id),

  -- Price data
  current_price   numeric null,    -- price shown to user at submission time
  reported_price  numeric null,    -- what user says the actual price is

  -- User context
  user_note   text  null,    -- max 500 chars enforced in backend
  source_type text  null,    -- in_store_seen | retailer_website | catalogue | user_memory | other

  -- Workflow status
  status         text not null default 'pending',
  -- Allowed: pending | needs_verification | approved | rejected

  -- Admin fields (null until reviewed)
  admin_note      text        null,
  reviewed_by     uuid        null,   -- admin user_id
  reviewed_at     timestamptz null,
  confidence_score int        null,   -- 0-100 admin confidence in the correction

  -- Extra context
  metadata    jsonb not null default '{}'::jsonb
);

-- ── updated_at trigger ────────────────────────────────────────────────────────
drop trigger if exists set_price_correction_reports_updated_at on price_correction_reports;
create trigger set_price_correction_reports_updated_at
  before update on price_correction_reports
  for each row execute function set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists pcr_created_at_idx
  on price_correction_reports (created_at desc);

create index if not exists pcr_status_idx
  on price_correction_reports (status);

create index if not exists pcr_product_id_idx
  on price_correction_reports (product_id);

create index if not exists pcr_shop_id_idx
  on price_correction_reports (shop_id)
  where shop_id is not null;

create index if not exists pcr_mall_id_idx
  on price_correction_reports (mall_id)
  where mall_id is not null;

create index if not exists pcr_reviewed_by_idx
  on price_correction_reports (reviewed_by)
  where reviewed_by is not null;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Inserts via backend service role only (bypasses RLS).
-- No public read or write. Admins may read via select policy.

alter table price_correction_reports enable row level security;

create policy "admins_can_read_price_correction_reports"
  on price_correction_reports
  for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );
