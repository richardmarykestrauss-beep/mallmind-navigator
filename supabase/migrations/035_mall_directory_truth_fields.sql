-- Sprint 2G — Mall directory truth fields (additive; honest-unknown correction).
--
-- Purpose:
--   Let a real mall store directory (first real case: Mall@Reds, 113 tenants
--   captured from the official directory) be represented on `public.shops`
--   WITHOUT inventing data. Today `shops` forces three values that a directory
--   often does not publish:
--     • floor         text  DEFAULT 'G'      → invents a Ground-floor claim
--     • category      text  NOT NULL         → forces a made-up category
--     • opening_time  time  DEFAULT '09:00'  → invents trading hours
--     • closing_time  time  DEFAULT '21:00'  → invents trading hours
--   and it has nowhere to record per-store provenance (source URL, how the row
--   was verified, confidence, when it was observed/last-verified). A raw insert
--   would therefore strip exactly the evidence that makes the dataset trustworthy
--   and stamp a false floor/hours.
--
-- What this migration does (all additive / relaxing — never destructive):
--   1. DROP the dangerous DEFAULT 'G' on shops.floor so an omitted floor is NULL
--      ("unknown"), not a fabricated Ground floor. Existing floor values are left
--      exactly as-is (this migration never rewrites data to NULL).
--   2. DROP NOT NULL on shops.category so "category unknown" is representable
--      (the frontend Shop type is already `category: string | null`). Existing
--      category values are untouched.
--   3. DROP the DEFAULT on opening_time / closing_time so omitted hours are NULL
--      ("unknown"), not a fabricated 09:00–21:00. Existing values are untouched.
--   4. ADD nullable provenance + verification + directory columns so a branch row
--      can carry its own evidence: store_number, zone, branch_status,
--      verification_status, confidence_score, observed_at, last_verified_at,
--      primary_source_url, source_owner, contradiction_notes,
--      normalized_retailer_name. (phone/website already exist — migration 001.)
--
-- Normalized-retailer decision: DEFERRED (no `retailers`/chain table now). The
--   repo has no chain entity, the app never cross-references a chain across malls,
--   and no products are being acquired this sprint — a normalized entity would be
--   a broad redesign this sprint explicitly excludes. A lightweight
--   `normalized_retailer_name` slug column is added instead, so future
--   normalization is possible without reworking existing rows. See
--   docs/sprint-2g/mallreds-schema-fit-report-2g.md.
--
-- Safety: additive/relaxing only; no data rewrite; no seed rows; RLS unchanged
--   (the existing "Anyone can view shops" SELECT policy still applies to the new
--   columns); no new GRANTs. NOT auto-applied by this sprint — see the Sprint 2G
--   stop gate and the rollback file
--   supabase/rollback/035_mall_directory_truth_fields_rollback.sql.

-- ── 1–3. Remove invented-value defaults / NOT NULL (data preserved) ───────────
-- These change ONLY the column defaults / nullability. Existing rows keep their
-- current floor / category / opening_time / closing_time values verbatim.
alter table public.shops alter column floor        drop default;
alter table public.shops alter column category     drop not null;
alter table public.shops alter column opening_time drop default;
alter table public.shops alter column closing_time drop default;

-- ── 4. Additive directory / provenance / verification columns (all nullable) ──
alter table public.shops
  add column if not exists store_number            text,
  add column if not exists zone                    text,
  add column if not exists branch_status           text,
  add column if not exists verification_status     text,
  add column if not exists confidence_score        numeric(3,2),
  add column if not exists observed_at             timestamptz,
  add column if not exists last_verified_at        timestamptz,
  add column if not exists primary_source_url      text,
  add column if not exists source_owner            text,
  add column if not exists contradiction_notes     text,
  add column if not exists normalized_retailer_name text;

-- ── Check constraints (idempotent; describe honest vocabularies) ──────────────
-- branch_status: what we can HONESTLY say about the branch. 'listed_current'
-- means "present in the current official directory" — deliberately NOT a live
-- "open right now" claim. 'unknown' is the honest default.
do $$ begin
  alter table public.shops
    add constraint shops_branch_status_check
    check (branch_status is null or branch_status in
      ('operating','temporarily_closed','former','listed_current','unknown'));
exception when duplicate_object then null; end $$;

-- verification_status: HOW the row was established. 'official_directory' = the
-- mall's own directory; weaker tiers are explicit, never implied.
do $$ begin
  alter table public.shops
    add constraint shops_verification_status_check
    check (verification_status is null or verification_status in
      ('official_directory','retailer_locator','third_party','user_submitted','unverified'));
exception when duplicate_object then null; end $$;

-- confidence_score: 0..1. NULL = not scored (never silently 0).
do $$ begin
  alter table public.shops
    add constraint shops_confidence_score_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1));
exception when duplicate_object then null; end $$;

-- ── Index (one, justified) ────────────────────────────────────────────────────
-- Directory import reconciliation and admin lookups query a store by its number
-- within a mall. Not unique: a real directory can share a shop number across two
-- listings (e.g. Mall@Reds #88 = Dis-Chem + Sunrise Home, #80A = two units).
create index if not exists shops_mall_store_number_idx
  on public.shops (mall_id, store_number);

-- ── Column-level evidence semantics ───────────────────────────────────────────
comment on column public.shops.floor is
  'Floor label. NULL = UNKNOWN (not yet verified) — never assume Ground. No DEFAULT: an omitted floor stays NULL rather than being fabricated as ''G''.';
comment on column public.shops.category is
  'Store category. Nullable: NULL = category not yet captured/verified (do not invent). Existing rows are unchanged.';
comment on column public.shops.opening_time is
  'Opening time. NULL = hours unknown/not verified. No DEFAULT: an omitted time stays NULL rather than fabricated 09:00.';
comment on column public.shops.closing_time is
  'Closing time. NULL = hours unknown/not verified. No DEFAULT: an omitted time stays NULL rather than fabricated 21:00.';
comment on column public.shops.store_number is
  'Official directory shop number as printed by the source (text: may be ''50'', ''31C'', ''R65'', ''Kiosk 6'', ''14-16''). Directly evidenced — never invented. May be shared across two listings.';
comment on column public.shops.zone is
  'Optional mall zone/wing. NULL = unknown (the official directory publishes none).';
comment on column public.shops.branch_status is
  'What we can honestly say about this branch: operating | temporarily_closed | former | listed_current (present in current official directory, NOT a live open claim) | unknown. Default meaning when NULL: unknown.';
comment on column public.shops.verification_status is
  'How this row was established: official_directory | retailer_locator | third_party | user_submitted | unverified. NULL = unverified.';
comment on column public.shops.confidence_score is
  'Provenance confidence 0..1 (e.g. 0.90 for an official-directory listing). NULL = not scored.';
comment on column public.shops.observed_at is
  'When the source evidence for this row was observed (read from the source).';
comment on column public.shops.last_verified_at is
  'When this row was last re-checked against its source.';
comment on column public.shops.primary_source_url is
  'Canonical source URL that evidences this row (e.g. the official mall directory).';
comment on column public.shops.source_owner is
  'Owner/publisher of the primary source (e.g. ''Mall@Reds / Anaprop Property Management (official)'').';
comment on column public.shops.contradiction_notes is
  'Free-text note of any source conflict affecting this row (e.g. aggregator phone = mall main line, shared store number). NULL = none recorded.';
comment on column public.shops.normalized_retailer_name is
  'Lightweight retailer/chain canonicalization slug (e.g. ''pick-n-pay''). NOT a foreign key — a normalized retailers table is deferred. NULL = not normalized.';
