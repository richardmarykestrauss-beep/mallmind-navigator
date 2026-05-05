/**
 * Achievement check + award logic.
 *
 * Real DB schema:
 *   achievements:       id (uuid), name, description, icon, xp_reward, condition_type, condition_value
 *   user_achievements:  id (uuid), user_id (uuid), achievement_id (uuid), unlocked_at (timestamptz)
 */

import { supabase } from "./supabaseClient";

export interface UserAchievement {
  name: string;        // from achievements.name via manual join
  unlocked_at: string; // ISO timestamp
}

interface AchievementRow {
  id: string;
  name: string;
  condition_value: number;
}

interface UserAchievementRow {
  achievement_id: string;
  unlocked_at: string;
}

/**
 * Load all achievements a user has already earned,
 * returned as { name, unlocked_at } for easy display.
 */
export async function getUserAchievements(userId: string): Promise<UserAchievement[]> {
  const [{ data: userAchs }, { data: allAchs }] = await Promise.all([
    supabase
      .from("user_achievements")
      .select("achievement_id, unlocked_at")
      .eq("user_id", userId),
    supabase
      .from("achievements")
      .select("id, name"),
  ]);

  if (!userAchs?.length) return [];

  const achNameMap: Record<string, string> = Object.fromEntries(
    (allAchs ?? []).map((a: { id: string; name: string }) => [a.id, a.name])
  );

  return (userAchs as UserAchievementRow[]).map((ua) => ({
    name: achNameMap[ua.achievement_id] ?? "",
    unlocked_at: ua.unlocked_at,
  })).filter((ua) => ua.name !== "");
}

/**
 * Compare current XP against XP-milestone definitions,
 * insert any newly earned badges into user_achievements.
 * Returns display names of badges just unlocked ([] = nothing new).
 */
export async function checkAchievements(userId: string, newXp: number): Promise<string[]> {
  try {
    const [{ data: allAchs }, { data: existing }] = await Promise.all([
      supabase
        .from("achievements")
        .select("id, name, condition_value")
        .eq("condition_type", "xp"),
      supabase
        .from("user_achievements")
        .select("achievement_id")
        .eq("user_id", userId),
    ]);

    if (!allAchs?.length) return [];

    const earnedIds = new Set(
      (existing ?? []).map((r: { achievement_id: string }) => r.achievement_id)
    );

    const newlyUnlocked = (allAchs as AchievementRow[]).filter(
      (a) => newXp >= a.condition_value && !earnedIds.has(a.id)
    );

    if (!newlyUnlocked.length) return [];

    await supabase.from("user_achievements").insert(
      newlyUnlocked.map((a) => ({
        user_id: userId,
        achievement_id: a.id,
        unlocked_at: new Date().toISOString(),
      }))
    );

    return newlyUnlocked.map((a) => a.name);
  } catch {
    // Non-critical — silently ignore so XP flow never breaks
    return [];
  }
}
