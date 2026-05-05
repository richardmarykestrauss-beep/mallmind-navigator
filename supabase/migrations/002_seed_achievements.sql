-- ================================================================
-- Migration 002 — Seed achievements table
--
-- Run this in Supabase → SQL Editor
-- Safe to re-run (ON CONFLICT DO NOTHING)
-- ================================================================

-- Seed the 6 badge definitions
INSERT INTO achievements (id, name, description, icon, xp_required)
VALUES
  ('first-find',  'First Find',  'Start your MallMind journey',    'Star',     0),
  ('deal-hunter', 'Deal Hunter', 'Reach 100 XP',                   'Target', 100),
  ('streak-x7',   'Streak x7',   'Reach 300 XP',                   'Flame',  300),
  ('vip-saver',   'VIP Saver',   'Reach 1,000 XP',                 'Crown',  1000),
  ('mall-master', 'Mall Master', 'Reach 3,000 XP',                 'Award',  3000),
  ('legend',      'Legend',      'Top 1% of SA shoppers (6k XP)',  'Sparkles', 6000)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on user_achievements (if not already enabled)
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- Users can only read/insert their own achievements
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_achievements' AND policyname = 'user_achievements_own'
  ) THEN
    CREATE POLICY user_achievements_own ON user_achievements
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS user_achievements_user_id_idx ON user_achievements (user_id);
