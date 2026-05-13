import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import MobileShell from "@/components/MobileShell";
import AdminGuard from "./AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Store,
  ShoppingBag,
  Package,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Activity,
  WifiOff,
  KeyRound,
  User,
  Server,
  BarChart3,
  MessageSquare,
  Route as RouteIcon,
  Eye,
  Clock,
  Search,
  TrendingUp,
} from "lucide-react";
import {
  verifyProductPrice,
  checkBackendHealth,
  getAdminStats,
  isGoogleBackendConfigured,
  type PriceVerificationMethod,
  type HealthCheckResult,
  type AnalyticsSummary,
} from "@/lib/googleBackendClient";

// ── Constants ─────────────────────────────────────────────────────────────────

const VERIFICATION_METHODS: { value: PriceVerificationMethod; label: string }[] = [
  { value: "website",               label: "Website" },
  { value: "phone",                 label: "Phone Call" },
  { value: "store_visit",           label: "Store Visit" },
  { value: "flyer",                 label: "Flyer" },
  { value: "receipt",               label: "Receipt" },
  { value: "retailer_confirmation", label: "Retailer Confirmation" },
  { value: "scraper",               label: "Scraper" },
  { value: "retailer_api",          label: "Retailer API" },
  { value: "user_submission",       label: "User Submission" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Counts {
  malls: number;
  shops: number;
  products: {
    total: number;
    demo: number;
    manually_verified: number;
    live_feed: number;
    stale: number;
    user_submitted: number;
    needs_review: number;
  };
}

interface ShopRef {
  name: string;
  floor: string | null;
  unit_number: string | null;
}

interface ProductWithShop {
  id: string;
  name: string;
  brand: string | null;
  price: number;
  is_on_special: boolean;
  data_quality_status: string;
  price_verified_at: string | null;
  price_verification_method: string | null;
  data_source: string | null;
  verified_by: string | null;
  shop_id: string;
  shops: ShopRef | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatZar(price: number): string {
  return `R${price.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function formatVerifiedAt(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

/** Returns Tailwind bg + text classes for a quality status badge. */
function qualityBadgeClasses(status: string): string {
  switch (status) {
    case "live_feed":         return "bg-green-100 text-green-800";
    case "manually_verified": return "bg-emerald-100 text-emerald-800";
    case "demo":              return "bg-yellow-100 text-yellow-800";
    case "needs_review":      return "bg-orange-100 text-orange-800";
    case "stale":             return "bg-red-100 text-red-800";
    case "user_submitted":    return "bg-blue-100 text-blue-800";
    default:                  return "bg-muted text-muted-foreground";
  }
}

function qualityBadgeLabel(status: string): string {
  switch (status) {
    case "live_feed":         return "Live Feed";
    case "manually_verified": return "Verified";
    case "demo":              return "Demo";
    case "needs_review":      return "Needs Review";
    case "stale":             return "Stale";
    case "user_submitted":    return "User Submitted";
    default:                  return status;
  }
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchCounts(): Promise<Counts> {
  const [mallsRes, shopsRes, productsRes] = await Promise.all([
    supabase.from("malls").select("id", { count: "exact", head: true }),
    supabase.from("shops").select("id", { count: "exact", head: true }),
    supabase.from("products").select("data_quality_status"),
  ]);

  const products = (productsRes.data ?? []) as { data_quality_status: string }[];

  const byStatus = (status: string) =>
    products.filter((p) => (p.data_quality_status ?? "demo") === status).length;

  return {
    malls: mallsRes.count ?? 0,
    shops: shopsRes.count ?? 0,
    products: {
      total:             products.length,
      demo:              byStatus("demo"),
      manually_verified: byStatus("manually_verified"),
      live_feed:         byStatus("live_feed"),
      stale:             byStatus("stale"),
      user_submitted:    byStatus("user_submitted"),
      needs_review:      byStatus("needs_review"),
    },
  };
}

async function fetchProductsForVerification(): Promise<ProductWithShop[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, brand, price, is_on_special, data_quality_status, " +
      "price_verified_at, price_verification_method, data_source, verified_by, shop_id, " +
      "shops ( name, floor, unit_number )"
    )
    .order("price_verified_at", { ascending: true })
    .limit(30);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProductWithShop[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

interface QualityRowProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

function QualityRow({ label, count, total, color }: QualityRowProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
      <span className="flex-1 text-sm">{label}</span>
      <span className="text-sm font-medium">{count}</span>
      <span className="w-8 text-right text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ── ProductVerifyCard ─────────────────────────────────────────────────────────

interface ProductVerifyCardProps {
  product: ProductWithShop;
  defaultVerifiedBy: string;
  onVerified: () => void;
}

function ProductVerifyCard({ product, defaultVerifiedBy, onVerified }: ProductVerifyCardProps) {
  const { session } = useAuth();

  const [method, setMethod]       = useState<PriceVerificationMethod>("website");
  const [dataSource, setDataSource] = useState(product.data_source ?? "");
  const [verifiedBy, setVerifiedBy] = useState(defaultVerifiedBy);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  const shop = product.shops;
  const isVerified = product.data_quality_status === "manually_verified" ||
                     product.data_quality_status === "live_feed";

  async function handleVerify() {
    if (!session?.access_token) {
      setError("No active session. Please sign in again.");
      return;
    }
    if (!dataSource.trim()) {
      setError("Data source is required.");
      return;
    }
    if (!verifiedBy.trim()) {
      setError("Verified by is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await verifyProductPrice(
        {
          product_id:                  product.id,
          price_verification_method:   method,
          data_source:                 dataSource.trim(),
          verified_by:                 verifiedBy.trim(),
        },
        session.access_token
      );
      setSuccess(true);
      // Refresh the list after a brief moment so the admin sees the success state first
      setTimeout(onVerified, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className={`overflow-hidden transition-colors ${
      isVerified ? "border-emerald-200 bg-emerald-50/30" : ""
    }`}>
      {/* ── Product header ── */}
      <CardContent className="pt-4 pb-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{product.name}</p>
            {product.brand && (
              <p className="text-xs text-muted-foreground">{product.brand}</p>
            )}
            {shop && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {shop.name}
                {shop.floor ? ` · Floor ${shop.floor}` : ""}
                {shop.unit_number ? ` · ${shop.unit_number}` : ""}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-bold">{formatZar(product.price)}</p>
            {product.is_on_special && (
              <span className="text-xs text-green-600 font-medium">On Special</span>
            )}
          </div>
        </div>

        {/* ── Quality metadata ── */}
        <div className="mt-3 rounded-md bg-muted/50 p-2.5 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0">Status</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${qualityBadgeClasses(product.data_quality_status)}`}>
              {qualityBadgeLabel(product.data_quality_status)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0">Verified</span>
            <span className="text-foreground">{formatVerifiedAt(product.price_verified_at)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0">Method</span>
            <span className="text-foreground">{product.price_verification_method ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0">Source</span>
            <span className="text-foreground truncate">{product.data_source ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0">By</span>
            <span className="text-foreground truncate">{product.verified_by ?? "—"}</span>
          </div>
        </div>
      </CardContent>

      {/* ── Verification form ── */}
      <CardContent className="pt-3 pb-4 space-y-2">
        {success ? (
          <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Price verified — refreshing…</span>
          </div>
        ) : (
          <>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PriceVerificationMethod)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Verification method" />
              </SelectTrigger>
              <SelectContent>
                {VERIFICATION_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value)}
              placeholder="Data source, e.g. Game website, in-store shelf"
              className="h-9 text-sm"
            />

            <Input
              value={verifiedBy}
              onChange={(e) => setVerifiedBy(e.target.value)}
              placeholder="Your name or email"
              className="h-9 text-sm"
            />

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={handleVerify}
              disabled={loading}
              size="sm"
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  Verify Price
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── SystemDiagnostics ─────────────────────────────────────────────────────────

function SystemDiagnostics() {
  const { session } = useAuth();

  const backendUrl = (import.meta.env.VITE_GOOGLE_BACKEND_URL as string | undefined) ?? "";
  const hasSession = !!session;
  const hasToken   = !!session?.access_token;
  const userEmail  = session?.user?.email ?? null;

  type HealthState = "idle" | "checking" | "ok" | "error";
  const [healthState, setHealthState] = useState<HealthState>("idle");
  const [healthResult, setHealthResult] = useState<HealthCheckResult | null>(null);

  async function runHealthCheck() {
    setHealthState("checking");
    setHealthResult(null);
    const result = await checkBackendHealth();
    setHealthResult(result);
    setHealthState(result.ok ? "ok" : "error");
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Activity className="h-4 w-4" />
          System Diagnostics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {/* Backend URL */}
        <div className="flex items-start gap-2 text-xs">
          <Server className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground w-24 shrink-0">Backend URL</span>
          {backendUrl ? (
            <span className="font-mono text-foreground break-all">{backendUrl}</span>
          ) : (
            <span className="text-destructive font-medium">Not set — VITE_GOOGLE_BACKEND_URL missing</span>
          )}
        </div>

        {/* Supabase session */}
        <div className="flex items-center gap-2 text-xs">
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground w-24 shrink-0">Session</span>
          {hasSession ? (
            <span className="text-emerald-600 font-medium">
              Active{userEmail ? ` · ${userEmail}` : ""}
            </span>
          ) : (
            <span className="text-destructive font-medium">No session — sign in required</span>
          )}
        </div>

        {/* Access token presence */}
        <div className="flex items-center gap-2 text-xs">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground w-24 shrink-0">Access token</span>
          {hasToken ? (
            <span className="text-emerald-600 font-medium">Present</span>
          ) : (
            <span className="text-destructive font-medium">Missing</span>
          )}
        </div>

        {/* Health check button + result */}
        <div className="pt-1 space-y-2">
          <Button
            size="sm"
            variant="outline"
            onClick={runHealthCheck}
            disabled={healthState === "checking"}
            className="h-8 text-xs"
          >
            {healthState === "checking" ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <Activity className="mr-1.5 h-3 w-3" />
                Test Backend Connection
              </>
            )}
          </Button>

          {healthState === "ok" && healthResult && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{healthResult.message}</span>
            </div>
          )}

          {healthState === "error" && healthResult && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              <WifiOff className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {healthResult.status ? `HTTP ${healthResult.status}` : "Connection failed"}
                </p>
                <p className="mt-0.5 text-destructive/80">{healthResult.message}</p>
                <p className="mt-1 text-destructive/60">
                  Try: restart Vite, hard-refresh (Ctrl+Shift+R), check .env.local
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Helpers for FounderAnalytics ──────────────────────────────────────────────

function formatEventType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

function metaSummary(metadata: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (metadata.product_name)  parts.push(String(metadata.product_name));
  if (metadata.shop_name)     parts.push(String(metadata.shop_name));
  if (metadata.price != null) parts.push(`R${metadata.price}`);
  if (metadata.route_summary) parts.push(String(metadata.route_summary));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function eventTypeColor(type: string): string {
  if (type.includes("route"))     return "bg-primary/15 text-primary";
  if (type.includes("assistant")) return "bg-secondary/15 text-secondary";
  if (type.includes("product"))   return "bg-emerald-100 text-emerald-700";
  return "bg-muted text-muted-foreground";
}

// ── FounderAnalytics component ────────────────────────────────────────────────

function FounderAnalytics({ data }: { data: AnalyticsSummary }) {
  const isEmpty = data.total_events === 0;

  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5 text-center">
        <BarChart3 className="mx-auto mb-2 h-6 w-6 text-primary/40" />
        <p className="text-sm font-medium text-muted-foreground">No analytics data yet.</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Use the Assistant to generate events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Total Events"
          value={data.total_events}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Last 24 h"
          value={data.events_last_24h}
        />
        <StatCard
          icon={<MessageSquare className="h-4 w-4" />}
          label="AI Searches"
          value={data.assistant_queries}
          sub="assistant queries"
        />
        <StatCard
          icon={<RouteIcon className="h-4 w-4" />}
          label="Route Requests"
          value={data.route_requests}
        />
        <StatCard
          icon={<Eye className="h-4 w-4" />}
          label="Product Views"
          value={data.product_views}
          sub="best pick impressions"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Event Types"
          value={data.unique_event_types.length}
          sub="distinct tracked actions"
        />
      </div>

      {/* ── Top searches ── */}
      {data.top_searches.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Search className="h-4 w-4" />
              Top Searches
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-1.5">
              {data.top_searches.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{s.query_text}</span>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    ×{s.count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Top products ── */}
      {data.top_products.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Package className="h-4 w-4" />
              Top Products Viewed
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-2">
              {data.top_products.map((p, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.product_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.shop_name}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      ×{p.count}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${qualityBadgeClasses(p.data_quality_status)}`}>
                      {qualityBadgeLabel(p.data_quality_status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Top shops ── */}
      {data.top_shops.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Store className="h-4 w-4" />
              Top Shops Mentioned
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-1.5">
              {data.top_shops.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{s.shop_name}</span>
                  <span className="shrink-0 rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-semibold text-secondary">
                    ×{s.count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Recent events ── */}
      {data.recent_events.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Activity className="h-4 w-4" />
              Recent Events
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-2">
              {data.recent_events.map((e) => {
                const summary = metaSummary(e.metadata);
                return (
                  <div key={e.id} className="flex items-start gap-2.5 text-xs">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${eventTypeColor(e.event_type)}`}>
                      {formatEventType(e.event_type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      {e.query_text && (
                        <p className="truncate text-foreground font-medium">"{e.query_text}"</p>
                      )}
                      {summary && !e.query_text && (
                        <p className="truncate text-muted-foreground">{summary}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-muted-foreground/60">
                      {formatRelativeTime(e.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AdminDashboardContent() {
  const { session, profile } = useAuth();

  const [counts, setCounts]                 = useState<Counts | null>(null);
  const [countsError, setCountsError]       = useState<string | null>(null);
  const [countsLoading, setCountsLoading]   = useState(true);

  const [products, setProducts]             = useState<ProductWithShop[]>([]);
  const [productsError, setProductsError]   = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [refreshKey, setRefreshKey]         = useState(0);

  // Founder analytics state
  const [analytics, setAnalytics]           = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  // Default "verified by" name: prefer full_name, fall back to email
  const defaultVerifiedBy =
    profile?.full_name ?? session?.user?.email ?? "";

  useEffect(() => {
    fetchCounts()
      .then(setCounts)
      .catch((e) => setCountsError(String(e)))
      .finally(() => setCountsLoading(false));
  }, []);

  useEffect(() => {
    setProductsLoading(true);
    setProductsError(null);
    fetchProductsForVerification()
      .then(setProducts)
      .catch((e) => setProductsError(String(e)))
      .finally(() => setProductsLoading(false));
  }, [refreshKey]);

  // Fetch founder analytics from backend (only if backend is configured)
  useEffect(() => {
    if (!isGoogleBackendConfigured()) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    getAdminStats()
      .then((resp) => setAnalytics(resp.analytics))
      .catch((e) => setAnalyticsError(String(e)))
      .finally(() => setAnalyticsLoading(false));
  }, []);

  return (
    <MobileShell hideNav>
      <div className="flex min-h-screen flex-col bg-background">
        {/* ── Header ── */}
        <header className="border-b bg-card px-4 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Read-only · MallMind Data Engine</p>
        </header>

        <main className="flex-1 space-y-6 p-4">
          {/* ── System diagnostics ── */}
          <SystemDiagnostics />

          {/* ── Overview loading / error ── */}
          {countsLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {countsError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              Failed to load data: {countsError}
            </div>
          )}

          {counts && (
            <>
              {/* ── Stat cards ── */}
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Overview
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={<Store className="h-4 w-4" />}
                    label="Malls"
                    value={counts.malls}
                  />
                  <StatCard
                    icon={<ShoppingBag className="h-4 w-4" />}
                    label="Shops"
                    value={counts.shops}
                  />
                  <StatCard
                    icon={<Package className="h-4 w-4" />}
                    label="Products"
                    value={counts.products.total}
                    sub="across all shops"
                  />
                  <StatCard
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Verified"
                    value={counts.products.manually_verified + counts.products.live_feed}
                    sub="manually verified or live feed"
                  />
                </div>
              </section>

              {/* ── Data quality breakdown ── */}
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Product Data Quality
                </h2>
                <Card>
                  <CardContent className="space-y-3 pt-4">
                    {counts.products.live_feed > 0 && (
                      <QualityRow label="live_feed" count={counts.products.live_feed} total={counts.products.total} color="bg-green-500" />
                    )}
                    {counts.products.manually_verified > 0 && (
                      <QualityRow label="manually_verified" count={counts.products.manually_verified} total={counts.products.total} color="bg-emerald-400" />
                    )}
                    <QualityRow label="demo" count={counts.products.demo} total={counts.products.total} color="bg-yellow-400" />
                    {counts.products.needs_review > 0 && (
                      <QualityRow label="needs_review" count={counts.products.needs_review} total={counts.products.total} color="bg-orange-400" />
                    )}
                    {counts.products.stale > 0 && (
                      <QualityRow label="stale" count={counts.products.stale} total={counts.products.total} color="bg-red-400" />
                    )}
                    {counts.products.user_submitted > 0 && (
                      <QualityRow label="user_submitted" count={counts.products.user_submitted} total={counts.products.total} color="bg-blue-400" />
                    )}
                    <div className="border-t pt-2">
                      <div className="flex items-center justify-between text-sm font-medium">
                        <span>Total products</span>
                        <span>{counts.products.total}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* ── Next steps hint ── */}
              <section className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">To promote products to VERIFIED_DATA:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>Run migration <code>007_price_verified_at.sql</code> in Supabase</li>
                  <li>Run migration <code>008_data_quality_fields.sql</code> in Supabase</li>
                  <li>Use the <strong>Verify Price</strong> form below for each product</li>
                </ol>
              </section>
            </>
          )}

          {/* ── Founder Analytics ── */}
          {isGoogleBackendConfigured() && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <BarChart3 className="h-4 w-4" />
                  Founder Analytics
                </h2>
                <button
                  onClick={() => {
                    setAnalyticsLoading(true);
                    setAnalyticsError(null);
                    getAdminStats()
                      .then((resp) => setAnalytics(resp.analytics))
                      .catch((e) => setAnalyticsError(String(e)))
                      .finally(() => setAnalyticsLoading(false));
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Refresh analytics"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>

              {analyticsLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {analyticsError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  Failed to load analytics: {analyticsError}
                </div>
              )}

              {!analyticsLoading && !analyticsError && analytics && (
                <FounderAnalytics data={analytics} />
              )}
            </section>
          )}

          {/* ── Recent Products (verification queue) ── */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Price Verification Queue
              </h2>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Refresh product list"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>

            {productsLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {productsError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Failed to load products: {productsError}
              </div>
            )}

            {!productsLoading && !productsError && products.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No products found.
              </p>
            )}

            {!productsLoading && products.length > 0 && (
              <div className="space-y-3">
                {products.map((product) => (
                  <ProductVerifyCard
                    key={product.id}
                    product={product}
                    defaultVerifiedBy={defaultVerifiedBy}
                    onVerified={() => setRefreshKey((k) => k + 1)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </MobileShell>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <AdminDashboardContent />
    </AdminGuard>
  );
}
