/**
 * XP award utility.
 * Adds XP to a user's profile, recalculates their level, and persists to Supabase.
 */

import { supabase } from "@/lib/supabaseClient";
import { xpForLevel } from "@/lib/levels";

export const XP_REWARDS = {
  PRICE_SUBMIT: 50,
  ROUTE_COMPLETE: 30,
  SESSION_START: 20,
  FIRST_SEARCH: 10,
} as const;

export interface XPResult {
  newXp: number;
  newLevel: number;
  leveledUp: boolean;
  xpGained: number;
}

function calcLevel(xp: number): number {
  let level = 1;
  for (let l = 6; l >= 2; l--) {
    if (xp >= xpForLevel(l)) { level = l; break; }
  }
  return level;
}

export async function awardXP(userId: string, amount: number, currentXp: number, currentLevel: number): Promise<XPResult> {
  const newXp = currentXp + amount;
  const newLevel = calcLevel(newXp);
  const leveledUp = newLevel > currentLevel;

  await supabase
    .from("profiles")
    .update({ xp: newXp, level: newLevel })
    .eq("id", userId);

  return { newXp, newLevel, leveledUp, xpGained: amount };
}
