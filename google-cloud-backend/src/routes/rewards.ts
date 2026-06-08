import { Router } from "express";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for rewards route");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const router = Router();

const XP_REWARDS = {
  PRICE_SUBMIT: 50,
  ROUTE_COMPLETE: 30,
  SESSION_START: 20,
  FIRST_SEARCH: 10,
} as const;

const AwardXpSchema = z.object({
  user_id: z.string().uuid(),
  reason: z.enum(["PRICE_SUBMIT", "ROUTE_COMPLETE", "SESSION_START", "FIRST_SEARCH"]),
});

function xpForLevel(level: number): number {
  switch (level) {
    case 1: return 0;
    case 2: return 100;
    case 3: return 300;
    case 4: return 700;
    case 5: return 1500;
    case 6: return 3000;
    default: return 0;
  }
}

function calcLevel(xp: number): number {
  let level = 1;
  for (let l = 6; l >= 2; l--) {
    if (xp >= xpForLevel(l)) {
      level = l;
      break;
    }
  }
  return level;
}

async function unlockXpAchievements(userId: string, newXp: number): Promise<string[]> {
  const [{ data: allAchs, error: allErr }, { data: existing, error: existingErr }] = await Promise.all([
    supabase
      .from("achievements")
      .select("id, name, condition_value")
      .eq("condition_type", "xp"),
    supabase
      .from("user_achievements")
      .select("achievement_id")
      .eq("user_id", userId),
  ]);

  if (allErr) throw new Error(allErr.message);
  if (existingErr) throw new Error(existingErr.message);
  if (!allAchs?.length) return [];

  const earnedIds = new Set((existing ?? []).map((r: any) => r.achievement_id));

  const newlyUnlocked = (allAchs as Array<{ id: string; name: string; condition_value: number }>).filter(
    (a) => newXp >= Number(a.condition_value ?? 0) && !earnedIds.has(a.id)
  );

  if (!newlyUnlocked.length) return [];

  const { error: insertErr } = await supabase
    .from("user_achievements")
    .insert(
      newlyUnlocked.map((a) => ({
        user_id: userId,
        achievement_id: a.id,
        unlocked_at: new Date().toISOString(),
      }))
    );

  if (insertErr) throw new Error(insertErr.message);

  return newlyUnlocked.map((a) => a.name);
}

/**
 * POST /rewards/award-xp
 *
 * Backend-controlled XP award path.
 *
 * SECURITY:
 * - Uses service role server-side.
 * - Frontend must not update profiles.xp directly.
 * - Frontend must not insert user_achievements directly.
 *
 * NOTE:
 * This route currently trusts user_id from the caller because the app's auth middleware
 * is not yet globally enforced. Sprint 19B.2B/19B.3 should add JWT verification and
 * derive user_id from the Authorization header instead of accepting it from body.
 */
router.post("/award-xp", async (req, res) => {
  try {
    const parsed = AwardXpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { user_id, reason } = parsed.data;
    const xpGained = XP_REWARDS[reason];

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, xp, level")
      .eq("id", user_id)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const currentXp = Number((profile as any).xp ?? 0);
    const currentLevel = Number((profile as any).level ?? 1);
    const newXp = currentXp + xpGained;
    const newLevel = calcLevel(newXp);
    const leveledUp = newLevel > currentLevel;

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ xp: newXp, level: newLevel })
      .eq("id", user_id);

    if (updateErr) {
      return res.status(500).json({ error: "Failed to update XP" });
    }

    let newAchievements: string[] = [];
    try {
      newAchievements = await unlockXpAchievements(user_id, newXp);
    } catch (achievementErr) {
      console.warn("[rewards/award-xp] achievement unlock failed:", achievementErr);
      newAchievements = [];
    }

    void supabase.from("analytics_events").insert({
      user_id,
      event_type: "xp_awarded",
      metadata: {
        reason,
        xp_gained: xpGained,
        new_xp: newXp,
        new_level: newLevel,
        leveled_up: leveledUp,
        new_achievements: newAchievements,
      },
    });

    return res.json({
      ok: true,
      reason,
      xpGained,
      newXp,
      newLevel,
      leveledUp,
      newAchievements,
    });
  } catch (err) {
    console.error("[rewards/award-xp]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
