/**
 * admin-stats — Supabase Edge Function
 *
 * Returns all admin dashboard metrics in a single call.
 * Uses service_role key so it bypasses RLS and can aggregate freely.
 * Protected: caller must send a valid JWT belonging to a profile
 * where is_admin = true.
 *
 * Deploy: supabase functions deploy admin-stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function query(sql: string) {
  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/exec_sql`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ sql }),
    }
  );
  if (!res.ok) return null;
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Verify admin — check JWT then confirm is_admin on profile
  const auth = req.headers.get("Authorization");
  if (!auth) return new Response("Unauthorized", { status: 401, headers: CORS });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  if (authErr || !user) return new Response("Unauthorized", { status: 401, headers: CORS });

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profileRow?.is_admin) {
    return new Response("Forbidden — admin only", { status: 403, headers: CORS });
  }

  // ── Run all aggregations in parallel ──────────────────────────────────────

  const [
    usersTotal,
    productsTotal,
    shopsTotal,
    mallsTotal,
    priceAlertsTotal,
    pushSubsTotal,
    userGrowth,
    searchVolume,
    topQueries,
    zeroResultQueries,
    mallTraffic,
    levelDist,
    subDist,
    priceSubmissions,
    eventBreakdown,
    recentEvents,
    staleProducts,
    inStockStats,
    verifiedStats,
  ] = await Promise.all([
    // Overview counts
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("shops").select("id", { count: "exact", head: true }),
    supabase.from("malls").select("id", { count: "exact", head: true }),
    supabase.from("price_alerts").select("id", { count: "exact", head: true }),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }),

    // User growth — new signups per day (last 30 days)
    supabase.rpc("admin_user_growth").catch(() => ({ data: null })),

    // Search volume per day (last 30 days)
    supabase.rpc("admin_search_volume").catch(() => ({ data: null })),

    // Top search queries (last 30 days)
    supabase
      .from("search_events")
      .select("query, result_count")
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .limit(500),

    // Zero result queries
    supabase
      .from("search_events")
      .select("query")
      .eq("result_count", 0)
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .limit(500),

    // Mall traffic (search events grouped by mall)
    supabase
      .from("search_events")
      .select("mall_name")
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .not("mall_name", "is", null)
      .limit(2000),

    // Level distribution
    supabase
      .from("profiles")
      .select("level")
      .limit(5000),

    // Subscription distribution
    supabase
      .from("profiles")
      .select("subscription_status")
      .limit(5000),

    // Price submissions per day
    supabase
      .from("price_submissions")
      .select("created_at")
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .limit(2000),

    // App event type breakdown
    supabase
      .from("app_events")
      .select("event_type")
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .limit(5000),

    // Recent app events
    supabase
      .from("app_events")
      .select("event_type, mall_name, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(20),

    // Stale products (not updated in 7+ days)
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .lt("updated_at", new Date(Date.now() - 7 * 86400_000).toISOString()),

    // In-stock ratio
    supabase.from("products").select("in_stock").limit(10000),

    // Verified ratio
    supabase.from("products").select("verified").limit(10000),
  ]);

  // ── Aggregate client-side (no stored procs needed) ────────────────────────

  // Top queries
  const queryCounts: Record<string, { count: number; zeros: number }> = {};
  for (const row of (topQueries.data ?? [])) {
    const q = (row.query as string).toLowerCase().trim();
    if (!queryCounts[q]) queryCounts[q] = { count: 0, zeros: 0 };
    queryCounts[q].count++;
    if ((row.result_count as number) === 0) queryCounts[q].zeros++;
  }
  const topQueriesAgg = Object.entries(queryCounts)
    .map(([query, v]) => ({ query, count: v.count, zero_pct: Math.round((v.zeros / v.count) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Zero result queries
  const zeroCounts: Record<string, number> = {};
  for (const row of (zeroResultQueries.data ?? [])) {
    const q = (row.query as string).toLowerCase().trim();
    zeroCounts[q] = (zeroCounts[q] ?? 0) + 1;
  }
  const zeroQueriesAgg = Object.entries(zeroCounts)
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Mall traffic
  const mallCounts: Record<string, number> = {};
  for (const row of (mallTraffic.data ?? [])) {
    const m = row.mall_name as string;
    mallCounts[m] = (mallCounts[m] ?? 0) + 1;
  }
  const mallTrafficAgg = Object.entries(mallCounts)
    .map(([mall_name, count]) => ({ mall_name, count }))
    .sort((a, b) => b.count - a.count);

  // Level distribution
  const levelCounts: Record<number, number> = {};
  for (const row of (levelDist.data ?? [])) {
    const l = (row.level as number) ?? 1;
    levelCounts[l] = (levelCounts[l] ?? 0) + 1;
  }
  const levelDistAgg = [1, 2, 3, 4, 5, 6].map((level) => ({
    level,
    name: ["Newcomer", "Scout", "Bargain Hunter", "Smart Shopper", "Mall Pro", "Legend"][level - 1],
    count: levelCounts[level] ?? 0,
  }));

  // Subscription distribution
  const subCounts: Record<string, number> = {};
  for (const row of (subDist.data ?? [])) {
    const s = (row.subscription_status as string) ?? "free";
    subCounts[s] = (subCounts[s] ?? 0) + 1;
  }
  const subDistAgg = Object.entries(subCounts).map(([status, count]) => ({ status, count }));

  // Price submissions by day
  const subByDay: Record<string, number> = {};
  for (const row of (priceSubmissions.data ?? [])) {
    const d = (row.created_at as string).slice(0, 10);
    subByDay[d] = (subByDay[d] ?? 0) + 1;
  }
  const priceSubsAgg = Object.entries(subByDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // App event breakdown
  const evtCounts: Record<string, number> = {};
  for (const row of (eventBreakdown.data ?? [])) {
    const e = row.event_type as string;
    evtCounts[e] = (evtCounts[e] ?? 0) + 1;
  }
  const evtBreakdownAgg = Object.entries(evtCounts)
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count);

  // In-stock ratio
  const allProducts = inStockStats.data ?? [];
  const inStockCount = allProducts.filter((p) => p.in_stock).length;
  const verifiedCount = (verifiedStats.data ?? []).filter((p) => p.verified).length;

  const result = {
    overview: {
      totalUsers: usersTotal.count ?? 0,
      totalProducts: productsTotal.count ?? 0,
      totalShops: shopsTotal.count ?? 0,
      totalMalls: mallsTotal.count ?? 0,
      activePriceAlerts: priceAlertsTotal.count ?? 0,
      pushSubscriptions: pushSubsTotal.count ?? 0,
      staleProducts: staleProducts.count ?? 0,
      inStockPct: allProducts.length ? Math.round((inStockCount / allProducts.length) * 100) : 0,
      verifiedPct: allProducts.length ? Math.round((verifiedCount / allProducts.length) * 100) : 0,
    },
    topQueries: topQueriesAgg,
    zeroResultQueries: zeroQueriesAgg,
    mallTraffic: mallTrafficAgg,
    levelDistribution: levelDistAgg,
    subscriptionDistribution: subDistAgg,
    priceSubmissions: priceSubsAgg,
    eventBreakdown: evtBreakdownAgg,
    recentEvents: recentEvents.data ?? [],
  };

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
