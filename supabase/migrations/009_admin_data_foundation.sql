-- MallMind Admin Data Manager database foundation
-- Safe/idempotent: creates admin support tables and soft-delete columns.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

ALTER TABLE malls
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES profiles(id),
  mall_id uuid REFERENCES malls(id),
  shop_id uuid REFERENCES shops(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  total_rows integer,
  imported_rows integer,
  skipped_rows integer,
  error_summary text,
  source_file text,
  data_source text
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  admin_id uuid REFERENCES profiles(id),
  action text NOT NULL,
  table_name text,
  row_id uuid,
  old_values jsonb,
  new_values jsonb
);

COMMENT ON COLUMN profiles.is_admin IS
  'True = this user can access the admin data manager. Set manually by a superuser — never exposed to signup flow.';

COMMENT ON COLUMN malls.deleted_at IS
  'Soft-delete marker. NULL means active. Never hard-delete mall records during admin operations.';

COMMENT ON COLUMN shops.deleted_at IS
  'Soft-delete marker. NULL means active. Never hard-delete shop records during admin operations.';

COMMENT ON COLUMN products.deleted_at IS
  'Soft-delete marker. NULL means active. Never hard-delete product records during admin operations.';
