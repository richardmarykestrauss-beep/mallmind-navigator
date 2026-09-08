-- ── Sprint 8C: Analytics Events Table ────────────────────────────────────────
-- First-party event store written via backend service role.
-- Separate from app_events (anon-key, frontend-direct).
-- No PII stored — metadata must never contain audio, GPS, health,
-- payment data, or personal identity fields.

create table if not exists analytics_events (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null    default now(),

  -- Who / where
  user_id     uuid        null,   -- Supabase auth user id (optional)
  session_id  uuid        null,   -- shopping session id (optional)
  mall_id     uuid        null,   -- mall context (optional)

  -- What happened
  event_type    text not null,
  event_source  text not null default 'frontend',
  query_text    text null,

  -- Entity references (all optional)
  product_id  uuid null,
  shop_id     uuid null,
  route_id    uuid null,

  -- Arbitrary non-PII data
  metadata    jsonb not null default '{}'::jsonb
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists analytics_events_created_at_idx
  on analytics_events (created_at desc);

create index if not exists analytics_events_mall_id_idx
  on analytics_events (mall_id)
  where mall_id is not null;

create index if not exists analytics_events_user_id_idx
  on analytics_events (user_id)
  where user_id is not null;

create index if not exists analytics_events_session_id_idx
  on analytics_events (session_id)
  where session_id is not null;

create index if not exists analytics_events_event_type_idx
  on analytics_events (event_type);

create index if not exists analytics_events_product_id_idx
  on analytics_events (product_id)
  where product_id is not null;

create index if not exists analytics_events_shop_id_idx
  on analytics_events (shop_id)
  where shop_id is not null;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Inserts happen exclusively via the backend service role (which bypasses RLS).
-- No public read or write access.

alter table analytics_events enable row level security;

-- Service role bypasses RLS automatically — no explicit policy needed for inserts.
-- Admins can read all events; regular users cannot read any events directly.
create policy "admins_can_read_analytics_events"
  on analytics_events
  for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );
