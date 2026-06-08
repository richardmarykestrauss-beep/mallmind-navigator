/**
 * XP award utility.
 *
 * Sprint 19B.2B:
 * XP is now awarded through the Cloud Run backend instead of direct browser writes.
 *
 * SECURITY:
 * - Frontend must not update profiles.xp / profiles.level directly.
 * - Frontend must not insert user_achievements directly.
 * - Backend uses service role and centralizes reward logic.
 *
 * TODO 19B.3:
 * Backend should derive user_id from Authorization JWT instead of trusting request body.
 */

import { isGoogleBackendConfigured } from "@/lib/googleBackendClient";

const GOOGLE_BACKEND_URL = ((import.meta.env.VITE_GOOGLE_BACKEND_URL as string | undefined) ?? "").replace(/\/+$/, "");

export const XP_REWARDS = {
  PRICE_SUBMIT:    50,
  ROUTE_COMPLETE:  30,
  SESSION_START:   20,
  FIRST_SEARCH:    10,
} as const;

export type XPReason = keyof typeof XP_REWARDS;

export interface XPResult {
  newXp: number;
  newLevel: number;
  leveledUp: boolean;
  xpGained: number;
  newAchievements: string[];
}

interface BackendAwardXpResponse {
  ok: boolean;
  reason: XPReason;
  xpGained: number;
  newXp: number;
  newLevel: number;
  leveledUp: boolean;
  newAchievements: string[];
}

function reasonFromAmount(amount: number): XPReason {
  const match = Object.entries(XP_REWARDS).find(([, value]) => value === amount);

  if (!match) {
    throw new Error(`Unknown XP reward amount: ${amount}`);
  }

  return match[0] as XPReason;
}

/**
 * Award XP through the backend.
 *
 * currentXp/currentLevel are kept in the signature for backwards compatibility
 * with existing callers, but are no longer trusted for writes.
 */
export async function awardXP(
  userId: string,
  amount: number,
  _currentXp: number,
  _currentLevel: number
): Promise<XPResult> {
  if (!isGoogleBackendConfigured() || !GOOGLE_BACKEND_URL) {
    throw new Error("XP awards require the Google Cloud backend to be configured");
  }

  const reason = reasonFromAmount(amount);

  const response = await fetch(`${GOOGLE_BACKEND_URL}/rewards/award-xp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      reason,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`XP award failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as BackendAwardXpResponse;

  return {
    newXp: data.newXp,
    newLevel: data.newLevel,
    leveledUp: data.leveledUp,
    xpGained: data.xpGained,
    newAchievements: data.newAchievements ?? [],
  };
}
