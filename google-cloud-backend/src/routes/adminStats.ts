import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// ── Analytics row type (matches analytics_events columns) ─────────────────────
interface AnalyticsRow {
  id: string;
  created_at: string;
  event_type: string;
  query_text: string | null;
  product_id: string | null;
  shop_id: string | null;
  metadata: Record<string, unknown> | null;
}

// ── Analytics summary builder ─────────────────────────────────────────────────

async function fetchAnalyticsSummary(supabase: ReturnType<typeof getSupabaseClient>) {
  const EMPTY = {
    total_events: 0,
    events_last_24h: 0,
    assistant_queries: 0,
    route_requests: 0,
    route_responses: 0,
    product_views: 0,
    unique_event_types: [] as string[],
    top_searches: [] as Array<{ query_text: string; count: number }>,
    top_products: [] as Array<{
      product_id: string;
      product_name: string;
      shop_name: string;
      data_quality_status: string;
      count: number;
    }>,
    top_shops: [] as Array<{ shop_id: string; shop_name: string; count: number }>,
    feedback_summary: {
      recommendation_useful:     0,
      recommendation_not_useful: 0,
      price_correct:             0,
      price_incorrect:           0,
      routes_found:              0,
      routes_not_found:          0,
      bought:                    0,
      not_today:                 0,
    },
    recent_events: [] as Array<{
      id: string;
      created_at: string;
      event_type: string;
      query_text: string | null;
      product_id: string | null;
      shop_id: string | null;
      metadata: Record<string, unknown>;
    }>,
  };

  try {
    // Fetch the latest 1 000 events + a total count in one round-trip each.
    // 1 000 rows is ample for early-stage aggregation without hitting limits.
    const [{ count: totalCount, error: cntErr }, { data: rows, error: rowErr }] =
      await Promise.all([
        supabase
          .from("analytics_events")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("analytics_events")
          .select("id, created_at, event_type, query_text, product_id, shop_id, metadata")
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

    if (cntErr) console.warn("[admin-stats/analytics] count error:", cntErr.message);
    if (rowErr) console.warn("[admin-stats/analytics] rows error:", rowErr.message);

    const events: AnalyticsRow[] = (rows ?? []) as AnalyticsRow[];
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ── Scalar counters ───────────────────────────────────────────────────────
    const events_last_24h = events.filter((e) => e.created_at >= cutoff24h).length;
    const assistant_queries  = events.filter((e) => e.event_type === "assistant_query_submitted").length;
    const route_requests     = events.filter((e) => e.event_type === "route_requested").length;
    const route_responses    = events.filter((e) => e.event_type === "route_response_received").length;
    const product_views      = events.filter((e) => e.event_type === "product_recommendation_viewed").length;
    const unique_event_types = [...new Set(events.map((e) => e.event_type))];

    // ── Top searches — deduplicate query_text from assistant queries ──────────
    const searchCounts: Record<string, number> = {};
    for (const e of events) {
      if (e.event_type === "assistant_query_submitted" && e.query_text) {
        const key = e.query_text.trim().toLowerCase();
        searchCounts[key] = (searchCounts[key] ?? 0) + 1;
      }
    }
    const top_searches = Object.entries(searchCounts)
      .map(([query_text, count]) => ({ query_text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ── Top products — from product_recommendation_viewed metadata ────────────
    const productCounts: Record<string, {
      product_id: string;
      product_name: string;
      shop_name: string;
      data_quality_status: string;
      count: number;
    }> = {};
    for (const e of events) {
      if (e.event_type === "product_recommendation_viewed" && e.product_id) {
        const meta = (e.metadata ?? {}) as Record<string, unknown>;
        if (!productCounts[e.product_id]) {
          productCounts[e.product_id] = {
            product_id: e.product_id,
            product_name: String(meta.product_name ?? "Unknown"),
            shop_name:    String(meta.shop_name    ?? "Unknown"),
            data_quality_status: String(meta.data_quality_status ?? "demo"),
            count: 0,
          };
        }
        productCounts[e.product_id].count++;
      }
    }
    const top_products = Object.values(productCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ── Top shops — any event that references a shop_id ───────────────────────
    const shopCounts: Record<string, { shop_id: string; shop_name: string; count: number }> = {};
    for (const e of events) {
      if (e.shop_id) {
        const meta = (e.metadata ?? {}) as Record<string, unknown>;
        if (!shopCounts[e.shop_id]) {
          shopCounts[e.shop_id] = {
            shop_id: e.shop_id,
            shop_name: String(meta.shop_name ?? "Unknown"),
            count: 0,
          };
        }
        shopCounts[e.shop_id].count++;
      }
    }
    const top_shops = Object.values(shopCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ── Feedback summary ─────────────────────────────────────────────────────
    const feedbackVal = (type: string, value: string) =>
      events.filter(
        (e) => e.event_type === type && (e.metadata as Record<string, unknown>)?.value === value
      ).length;

    const feedback_summary = {
      recommendation_useful:     feedbackVal("recommendation_feedback",  "useful"),
      recommendation_not_useful: feedbackVal("recommendation_feedback",  "not_useful"),
      price_correct:             feedbackVal("price_accuracy_feedback",  "correct"),
      price_incorrect:           feedbackVal("price_accuracy_feedback",  "incorrect"),
      routes_found:              feedbackVal("route_feedback",           "found_store"),
      routes_not_found:          feedbackVal("route_feedback",           "did_not_find_store"),
      bought:                    feedbackVal("purchase_signal",          "bought"),
      not_today:                 feedbackVal("purchase_signal",          "not_today"),
    };

    // ── Recent events — latest 20, structured for display ────────────────────
    const recent_events = events.slice(0, 20).map((e) => ({
      id:          e.id,
      created_at:  e.created_at,
      event_type:  e.event_type,
      query_text:  e.query_text ?? null,
      product_id:  e.product_id ?? null,
      shop_id:     e.shop_id ?? null,
      metadata:    (e.metadata ?? {}) as Record<string, unknown>,
    }));

    return {
      total_events: totalCount ?? events.length,
      events_last_24h,
      assistant_queries,
      route_requests,
      route_responses,
      product_views,
      unique_event_types,
      top_searches,
      top_products,
      top_shops,
      recent_events,
      feedback_summary,
    };
  } catch (err) {
    // Analytics errors must never crash admin-stats — return empty gracefully
    console.error("[admin-stats/analytics] unexpected error:", err);
    return EMPTY;
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /admin-stats
 * Returns aggregated platform metrics + founder analytics from analytics_events.
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
    // Run existing platform stats and analytics in parallel
    const [
      [
        { count: mallCount },
        { count: shopCount },
        { count: productCount },
        { count: userCount },
        { count: activeSessionCount },
        { count: routeCount },
        { data: recentSearches },
        { data: recentEvents },
      ],
      analytics,
    ] = await Promise.all([
      Promise.all([
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
      ]),
      fetchAnalyticsSummary(supabase),
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
      analytics,
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
