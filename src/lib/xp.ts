/**
 * XP award utility.
 * Adds XP to a user's profile, recalculates their level, persists to Supabase,
 * and checks for newly unlocked achievements.
 */

import { supabase } from "@/lib/supabaseClient";
import { xpForLevel } from "@/lib/levels";
import { checkAchievements } from "@/lib/achievements";

export const XP_REWARDS = {
  PRICE_SUBMIT:    50,
  ROUTE_COMPLETE:  30,
  SESSION_START:   20,
  FIRST_SEARCH:    10,
} as const;

export interface XPResult {
  newXp: number;
  newLevel: number;
  leveledUp: boolean;
  xpGained: number;
  newAchievements: string[]; // display names of badges just unlocked
}

function calcLevel(xp: number): number {
  let level = 1;
  for (let l = 6; l >= 2; l--) {
    if (xp >= xpForLevel(l)) { level = l; break; }
  }
  return level;
}

export async function awardXP(
  userId: string,
  amount: number,
  currentXp: number,
  currentLevel: number
): Promise<XPResult> {
  const newXp    = currentXp + amount;
  const newLevel = calcLevel(newXp);
  const leveledUp = newLevel > currentLevel;

  await supabase
    .from("profiles")
    .update({ xp: newXp, level: newLevel })
    .eq("id", userId);

  // Check for newly earned badges (non-blocking — won't throw)
  const newAchievements = await checkAchievements(userId, newXp);

  return { newXp, newLevel, leveledUp, xpGained: amount, newAchievements };
}
