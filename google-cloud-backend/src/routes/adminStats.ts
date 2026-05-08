import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

/**
 * GET /admin-stats
 * Returns aggregated platform metrics from the Supabase database.
 *
 * In production this route must be protected by an auth middleware
 * that verifies the caller has is_admin = true in their profile.
 *
 * DEV_ONLY: Auth check is not enforced until Firebase Auth / Identity
 * Platform is integrated (Phase 7 of migration plan).
 */
router.get("/", async (_req: Request, res: Response): Promise<void> => {
  const supabase = getSupabaseClient();

  try {
    const [
      { count: mallCount },
      { count: shopCount },
      { count: productCount },
      { count: userCount },
      { count: activeSessionCount },
      { count: routeCount },
      { data: recentSearches },
      { data: recentEvents },
    ] = await Promise.all([
      supabase.from("malls").select("*", { count: "exact", head: true }),
      supabase.from("shops").select("*", { count: "exact", head: true }),
      supabase.from("products").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase
        .from("shopping_sessions")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("shopping_routes")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("search_events")
        .select("query, mall_id, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("app_events")
        .select("event_name, user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    res.json({
      counts: {
        malls:           mallCount ?? 0,
        shops:           shopCount ?? 0,
        products:        productCount ?? 0,
        users:           userCount ?? 0,
        active_sessions: activeSessionCount ?? 0,
        active_routes:   routeCount ?? 0,
      },
      recent_searches: recentSearches ?? [],
      recent_events:   recentEvents ?? [],
      generated_at: new Date().toISOString(),
      // DEV_ONLY: remove this flag and add auth middleware before exposing publicly
      _note: "DEV_ONLY: auth enforcement pending Firebase Auth integration (Phase 7)",
    });
  } catch (err) {
    console.error("[admin-stats]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
