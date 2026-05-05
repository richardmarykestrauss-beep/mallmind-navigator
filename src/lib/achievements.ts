/**
 * Achievement check + award logic.
 * Called after every XP award — detects newly unlocked badges and
 * writes them to the user_achievements table.
 */

import { supabase } from "./supabaseClient";

// Must stay in sync with BADGES in Rewards.tsx
export const ACHIEVEMENT_DEFS = [
  { id: "first-find",  name: "First Find",  xpRequired: 0    },
  { id: "deal-hunter", name: "Deal Hunter", xpRequired: 100  },
  { id: "streak-x7",   name: "Streak x7",   xpRequired: 300  },
  { id: "vip-saver",   name: "VIP Saver",   xpRequired: 1000 },
  { id: "mall-master", name: "Mall Master", xpRequired: 3000 },
  { id: "legend",      name: "Legend",      xpRequired: 6000 },
] as const;

export type AchievementId = typeof ACHIEVEMENT_DEFS[number]["id"];

export interface UserAchievement {
  achievement_id: string;
  earned_at: string;
}

/** Load all achievements a user has already earned */
export async function getUserAchievements(userId: string): Promise<UserAchievement[]> {
  const { data } = await supabase
    .from("user_achievements")
    .select("achievement_id, earned_at")
    .eq("user_id", userId);
  return (data ?? []) as UserAchievement[];
}

/**
 * Compare current XP against definitions, insert any newly earned badges.
 * Returns the display names of badges just unlocked (empty array = nothing new).
 */
export async function checkAchievements(userId: string, newXp: number): Promise<string[]> {
  try {
    const existing = await getUserAchievements(userId);
    const earnedIds = new Set(existing.map((r) => r.achievement_id));

    const newlyUnlocked = ACHIEVEMENT_DEFS.filter(
      (a) => newXp >= a.xpRequired && !earnedIds.has(a.id)
    );

    if (!newlyUnlocked.length) return [];

    await supabase.from("user_achievements").insert(
      newlyUnlocked.map((a) => ({
        user_id: userId,
        achievement_id: a.id,
        earned_at: new Date().toISOString(),
      }))
    );

    return newlyUnlocked.map((a) => a.name);
  } catch {
    // Non-critical — silently ignore DB errors so XP flow never breaks
    return [];
  }
}
