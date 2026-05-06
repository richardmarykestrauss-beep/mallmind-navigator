import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, ShoppingBag, Store, MapPin, Bell, Shield,
  TrendingUp, Search, AlertCircle, RefreshCw, Loader2,
  Zap, Bot, Route as RouteIcon, Tag, Package, CheckCircle2,
  Activity, BarChart2, Clock,
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const SUPABASE_URL  = "https://qspsouemjtcdcfnivpnt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_46teArH5kq3ndUUBHwLsjw_NnFRGCsI";

const CHART_COLORS = ["#00d4ff", "#00ff88", "#a855f7", "#f59e0b", "#ef4444", "#ec4899"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminStats {
  overview: {
    totalUsers: number;
    totalProducts: number;
    totalShops: number;
    totalMalls: number;
    activePriceAlerts: number;
    pushSubscriptions: number;
    staleProducts: number;
    inStockPct: number;
    verifiedPct: number;
  };
  topQueries: { query: string; count: number; zero_pct: number }[];
  zeroResultQueries: { query: string; count: number }[];
  mallTraffic: { mall_name: string; count: number }[];
  levelDistribution: { level: number; name: string; count: number }[];
  subscriptionDistribution: { status: string; count: number }[];
  priceSubmissions: { date: string; count: number }[];
  eventBreakdown: { event_type: string; count: number }[];
  recentEvents: { event_type: string; mall_name: string | null; metadata: Record<string, unknown> | null; created_at: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, color = "text-primary", alert = false,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: string; alert?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-2xl border bg-surface/70 backdrop-blur p-4",
      alert ? "border-destructive/40 bg-destructive/5" : "border-border"
    )}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className={cn("h-4 w-4", alert ? "text-destructive" : color)} />
      </div>
      <p className={cn("font-display text-2xl font-bold", alert ? "text-destructive" : "")}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display font-bold text-sm uppercase tracking-wider text-muted-foreground px-1 mb-3 mt-6 flex items-center gap-2">
      {children}
    </h2>
  );
}

const EVENT_LABELS: Record<string, string> = {
  route_built: "Route Built",
  route_completed: "Route Completed",
  ai_conversation: "AI Chat",
  ai_route_triggered: "AI→Route",
  budget_mode_used: "Budget Mode",
  price_alert_set: "Alert Set",
  price_alert_removed: "Alert Removed",
  parking_saved: "Parking Saved",
  shopping_list_created: "List Created",
  shopping_list_to_ai: "List→AI",
  deals_viewed: "Deals Viewed",
  navigate_there_clicked: "Navigate Clicked",
  session_start: "Session Start",
};

// Custom tooltip for Recharts
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-muted-foreground mb-1">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="font-bold" style={{ color: p.name === "count" ? "#00d4ff" : "#00ff88" }}>
          {p.value}
        </p>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "search" | "products" | "behaviour";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await (await import("@/lib/supabaseClient")).supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-stats`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
        },
      });

      if (res.status === 403) throw new Error("Admin access required");
      if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);

      const data = await res.json();
      setStats(data);
      setLastRefresh(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth"); return; }
    if (profile && !profile.is_admin) { navigate("/"); return; }
    if (profile?.is_admin) fetchStats();
  }, [authLoading, user, profile, navigate, fetchStats]);

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview",  label: "Overview",  icon: BarChart2 },
    { key: "search",    label: "Search",    icon: Search },
    { key: "products",  label: "Products",  icon: Package },
    { key: "behaviour", label: "Events",    icon: Activity },
  ];

  if (authLoading || (loading && !stats)) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading admin data…</p>
        </div>
      </MobileShell>
    );
  }

  if (error) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="font-bold">{error}</p>
          <button onClick={fetchStats} className="text-sm text-primary underline">Try again</button>
        </div>
      </MobileShell>
    );
  }

  const o = stats!.overview;

  return (
    <MobileShell>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/50">
        <div>
          <p className="font-display font-bold text-base">Admin Dashboard</p>
          {lastRefresh && (
            <p className="text-[10px] text-muted-foreground">
              Updated {lastRefresh.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border/50 px-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-all border-b-2 -mb-px",
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && stats && (
          <>
            <SectionTitle><Users className="h-3.5 w-3.5" /> Platform</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Total Users"    value={o.totalUsers.toLocaleString()}    icon={Users}       color="text-primary" />
              <StatCard label="Products"       value={o.totalProducts.toLocaleString()} icon={ShoppingBag} color="text-secondary" />
              <StatCard label="Shops"          value={o.totalShops.toLocaleString()}    icon={Store}       color="text-primary" />
              <StatCard label="Malls"          value={o.totalMalls.toLocaleString()}    icon={MapPin}      color="text-secondary" />
              <StatCard label="Price Alerts"   value={o.activePriceAlerts.toLocaleString()} icon={Bell}   color="text-primary" />
              <StatCard label="Push Subs"      value={o.pushSubscriptions.toLocaleString()} icon={Shield} color="text-secondary" />
            </div>

            <SectionTitle><Package className="h-3.5 w-3.5" /> Product Health</SectionTitle>
            <div className="grid grid-cols-3 gap-2.5">
              <StatCard label="In Stock"    value={`${o.inStockPct}%`}  icon={CheckCircle2} color="text-secondary" />
              <StatCard label="Verified"    value={`${o.verifiedPct}%`} icon={Shield}       color="text-primary" />
              <StatCard label="Stale (7d+)" value={o.staleProducts}     icon={Clock}        alert={o.staleProducts > 50} />
            </div>

            <SectionTitle><TrendingUp className="h-3.5 w-3.5" /> Price Submissions (30d)</SectionTitle>
            {stats.priceSubmissions.length > 0 ? (
              <div className="rounded-2xl border border-border bg-surface/50 p-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.priceSubmissions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="count" stroke="#00ff88" fill="url(#subGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No submissions yet — data appears here once users submit prices.</p>
            )}

            <SectionTitle><Users className="h-3.5 w-3.5" /> Level Distribution</SectionTitle>
            <div className="rounded-2xl border border-border bg-surface/50 p-3 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.levelDistribution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {stats.levelDistribution.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <SectionTitle><Tag className="h-3.5 w-3.5" /> Subscriptions</SectionTitle>
            {stats.subscriptionDistribution.length > 0 ? (
              <div className="rounded-2xl border border-border bg-surface/50 p-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.subscriptionDistribution} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={60} label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {stats.subscriptionDistribution.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No subscription data yet.</p>
            )}
          </>
        )}

        {/* ── SEARCH TAB ── */}
        {tab === "search" && stats && (
          <>
            <SectionTitle><MapPin className="h-3.5 w-3.5" /> Mall Traffic (30d)</SectionTitle>
            {stats.mallTraffic.length > 0 ? (
              <div className="rounded-2xl border border-border bg-surface/50 p-3 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.mallTraffic} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis dataKey="mall_name" type="category" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} width={90} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" fill="#00d4ff" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No search events yet — starts populating as users search.</p>
            )}

            <SectionTitle><TrendingUp className="h-3.5 w-3.5" /> Top Queries (30d)</SectionTitle>
            {stats.topQueries.length > 0 ? (
              <div className="space-y-1.5">
                {stats.topQueries.map((q, i) => (
                  <div key={q.query} className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-3 py-2.5">
                    <span className="text-[10px] font-bold text-muted-foreground w-4 text-right">{i + 1}</span>
                    <p className="flex-1 text-xs font-medium truncate">{q.query}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-primary font-bold">{q.count}×</span>
                      {q.zero_pct > 0 && (
                        <span className="text-[9px] text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">
                          {q.zero_pct}% no results
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No queries logged yet.</p>
            )}

            <SectionTitle><AlertCircle className="h-3.5 w-3.5 text-destructive" /> Zero-Result Queries</SectionTitle>
            <p className="text-[10px] text-muted-foreground mb-2 px-1">Products users want that you don't have yet — your scraper gap list.</p>
            {stats.zeroResultQueries.length > 0 ? (
              <div className="space-y-1.5">
                {stats.zeroResultQueries.map((q, i) => (
                  <div key={q.query} className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-muted-foreground w-4 text-right">{i + 1}</span>
                      <p className="text-xs font-medium">{q.query}</p>
                    </div>
                    <span className="text-[10px] text-destructive font-bold">{q.count}×</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">🎉 No zero-result queries! Every search found something.</p>
            )}
          </>
        )}

        {/* ── PRODUCTS TAB ── */}
        {tab === "products" && stats && (
          <>
            <SectionTitle><Package className="h-3.5 w-3.5" /> Inventory Summary</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Total Products"  value={o.totalProducts.toLocaleString()}   icon={ShoppingBag} color="text-primary" />
              <StatCard label="Total Shops"     value={o.totalShops.toLocaleString()}      icon={Store}       color="text-secondary" />
              <StatCard label="In Stock"        value={`${o.inStockPct}%`}                icon={CheckCircle2} color="text-secondary" />
              <StatCard label="Verified"        value={`${o.verifiedPct}%`}               icon={Shield}      color="text-primary" />
              <StatCard
                label="Stale Prices (7d+)"
                value={o.staleProducts.toLocaleString()}
                icon={Clock}
                alert={o.staleProducts > 50}
                sub={o.staleProducts > 50 ? "Run scraper!" : "Looking healthy"}
              />
              <StatCard label="Active Alerts"   value={o.activePriceAlerts.toLocaleString()} icon={Bell}     color="text-primary" />
            </div>

            <SectionTitle><Zap className="h-3.5 w-3.5" /> Price Submissions (30d)</SectionTitle>
            {stats.priceSubmissions.length > 0 ? (
              <div className="rounded-2xl border border-border bg-surface/50 p-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.priceSubmissions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="subGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="count" stroke="#a855f7" fill="url(#subGrad2)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No submissions yet.</p>
            )}

            <SectionTitle><Users className="h-3.5 w-3.5" /> User Level Distribution</SectionTitle>
            <div className="space-y-2">
              {stats.levelDistribution.map((l) => {
                const total = stats.levelDistribution.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? Math.round((l.count / total) * 100) : 0;
                return (
                  <div key={l.level} className="rounded-xl border border-border bg-surface/60 px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium">Lv {l.level} · {l.name}</span>
                      <span className="text-xs text-muted-foreground">{l.count} users ({pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── BEHAVIOUR / EVENTS TAB ── */}
        {tab === "behaviour" && stats && (
          <>
            <SectionTitle><Activity className="h-3.5 w-3.5" /> Event Breakdown (30d)</SectionTitle>
            {stats.eventBreakdown.length > 0 ? (
              <>
                <div className="rounded-2xl border border-border bg-surface/50 p-3 h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.eventBreakdown.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        dataKey="event_type"
                        type="category"
                        tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                        width={90}
                        tickFormatter={(v) => EVENT_LABELS[v] ?? v}
                      />
                      <Tooltip formatter={(v) => [v, "events"]} />
                      <Bar dataKey="count" fill="#00d4ff" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 space-y-1.5">
                  {stats.eventBreakdown.map((e, i) => (
                    <div key={e.event_type} className="flex items-center justify-between rounded-xl border border-border bg-surface/60 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-xs">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                      </div>
                      <span className="text-xs font-bold text-primary">{e.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No events yet — starts populating as users interact with the app.</p>
            )}

            <SectionTitle><Bot className="h-3.5 w-3.5" /> AI + Routes</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "AI Chats",      key: "ai_conversation",    icon: Bot,       color: "text-primary" },
                { label: "AI→Routes",     key: "ai_route_triggered", icon: RouteIcon, color: "text-secondary" },
                { label: "Budget Mode",   key: "budget_mode_used",   icon: Zap,       color: "text-primary" },
                { label: "Routes Done",   key: "route_completed",    icon: CheckCircle2, color: "text-secondary" },
              ].map(({ label, key, icon: Icon, color }) => {
                const val = stats.eventBreakdown.find((e) => e.event_type === key)?.count ?? 0;
                return <StatCard key={key} label={label} value={val.toLocaleString()} icon={Icon} color={color} />;
              })}
            </div>

            <SectionTitle><Clock className="h-3.5 w-3.5" /> Recent Events</SectionTitle>
            {stats.recentEvents.length > 0 ? (
              <div className="space-y-1.5 mb-4">
                {stats.recentEvents.map((e, i) => (
                  <div key={i} className="rounded-xl border border-border bg-surface/60 px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(e.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {e.mall_name && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />{e.mall_name}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No recent events.</p>
            )}
          </>
        )}
      </div>
    </MobileShell>
  );
};

export default AdminDashboard;
