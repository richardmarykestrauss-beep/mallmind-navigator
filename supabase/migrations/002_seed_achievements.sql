-- ================================================================
-- Migration 002 — Seed achievements table
--
-- Run this in Supabase → SQL Editor
-- Safe to re-run (ON CONFLICT (name) DO NOTHING)
-- ================================================================

-- Add unique constraint on name so the ON CONFLICT clause works (safe re-run)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'achievements_name_unique'
  ) THEN
    ALTER TABLE achievements ADD CONSTRAINT achievements_name_unique UNIQUE (name);
  END IF;
END $$;

-- Seed the 6 XP-milestone badges
-- condition_type = 'xp'  → unlock when profile.xp >= condition_value
-- xp_reward = 0          → these are milestone badges, not reward-granting ones
INSERT INTO achievements (name, description, icon, xp_reward, condition_type, condition_value)
VALUES
  ('First Find',  'Start your MallMind journey',   'Star',     0, 'xp', 0),
  ('Deal Hunter', 'Reach 100 XP',                  'Target',   0, 'xp', 100),
  ('Streak x7',   'Reach 300 XP',                  'Flame',    0, 'xp', 300),
  ('VIP Saver',   'Reach 1,000 XP',                'Crown',    0, 'xp', 1000),
  ('Mall Master', 'Reach 3,000 XP',                'Award',    0, 'xp', 3000),
  ('Legend',      'Top 1% of SA shoppers',         'Sparkles', 0, 'xp', 6000)
ON CONFLICT (name) DO NOTHING;

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
