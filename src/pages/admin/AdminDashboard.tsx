import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
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
  Inbox,
  Database,
  Globe,
  Plus,
  ExternalLink,
  X,
  Bot,
  ShieldAlert,
  ListChecks,
  Cpu,
  Copy,
  Layers,
  Pencil,
  ClipboardList,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Tag,
  FileText,
  Link,
  CheckCircle,
  XCircle,
  Flag,
  RotateCcw,
  Zap,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  verifyProductPrice,
  checkBackendHealth,
  getAdminStats,
  getAdminPriceCorrections,
  reviewPriceCorrection,
  getMallDataSources,
  createMallDataSource,
  getMallDataFindings,
  createMallDataFinding,
  reviewMallDataFinding,
  reviewDataSubmission,
  runSourceResearch,
  runFindingExtractor,
  runDuplicateDetection,
  runAdminReviewAssistant,
  runLiveDataApplyPlanner,
  getMallResearchBatches,
  createMallResearchBatch,
  getMallResearchBatch,
  createMallResearchBatchItem,
  reviewMallResearchBatchItem,
  updateMallResearchBatchStatus,
  runResearchItemSourceResearch,
  runResearchItemFindingExtractor,
  runResearchItemDataGuardian,
  runResearchItemDuplicateCheck,
  runResearchItemAdminReview,
  runResearchItemFullPipeline,
  isGoogleBackendConfigured,
  type PriceVerificationMethod,
  type HealthCheckResult,
  type AnalyticsSummary,
  type PriceCorrectionReport,
  type MallDataSource,
  type MallDataFinding,
  type MallDataSourceType,
  type MallDataFindingType,
  type MallDataFindingStatus,
  type DataGuardianInput,
  type DataGuardianResult,
  type DataGuardianTrustLevel,
  type DataGuardianRecommendedAction,
  type SourceResearchResult,
  type FindingExtractorResult,
  type DuplicateDetectionResult,
  type AdminReviewAssistantResult,
  type LiveDataApplyPlannerResult,
  type MallResearchBatch,
  type MallResearchBatchWithItems,
  type MallResearchBatchItem,
  type MallResearchBatchStatus,
  type MallResearchItemStatus,
  type MallResearchFindingType,
  type PipelineBotResult,
} from "@/lib/googleBackendClient";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_TYPES: { value: MallDataSourceType; label: string }[] = [
  { value: "official_website",  label: "Official Website" },
  { value: "retail_directory",  label: "Retail Directory" },
  { value: "public_flyer",      label: "Public Flyer / Catalogue" },
  { value: "manual_survey",     label: "Manual Survey" },
  { value: "press_release",     label: "Press Release" },
  { value: "social_media",      label: "Social Media" },
  { value: "other",             label: "Other" },
];

const FINDING_TYPES: { value: MallDataFindingType; label: string }[] = [
  { value: "shop",         label: "Shop" },
  { value: "product",      label: "Product" },
  { value: "mall_hours",   label: "Mall Hours" },
  { value: "shop_hours",   label: "Shop Hours" },
  { value: "floor_layout", label: "Floor Layout" },
  { value: "promotion",    label: "Promotion" },
  { value: "other",        label: "Other" },
];

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

      {/* ── Feedback summary ── */}
      {(data.feedback_summary.recommendation_useful +
        data.feedback_summary.recommendation_not_useful +
        data.feedback_summary.price_correct +
        data.feedback_summary.price_incorrect +
        data.feedback_summary.routes_found +
        data.feedback_summary.routes_not_found +
        data.feedback_summary.bought +
        data.feedback_summary.not_today) > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Activity className="h-4 w-4" />
              User Feedback Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-3">
            {/* Recommendation */}
            {(data.feedback_summary.recommendation_useful + data.feedback_summary.recommendation_not_useful) > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Recommendations</p>
                <div className="flex gap-2 flex-wrap">
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium">
                    👍 {data.feedback_summary.recommendation_useful} useful
                  </span>
                  <span className="flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">
                    👎 {data.feedback_summary.recommendation_not_useful} not useful
                  </span>
                </div>
              </div>
            )}
            {/* Price accuracy */}
            {(data.feedback_summary.price_correct + data.feedback_summary.price_incorrect) > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Price Accuracy</p>
                <div className="flex gap-2 flex-wrap">
                  <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium">
                    ✓ {data.feedback_summary.price_correct} correct
                  </span>
                  <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
                    ✗ {data.feedback_summary.price_incorrect} flagged incorrect
                  </span>
                </div>
              </div>
            )}
            {/* Route success */}
            {(data.feedback_summary.routes_found + data.feedback_summary.routes_not_found) > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Route Success</p>
                <div className="flex gap-2 flex-wrap">
                  <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium">
                    📍 {data.feedback_summary.routes_found} found store
                  </span>
                  <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">
                    ✗ {data.feedback_summary.routes_not_found} didn't find it
                  </span>
                </div>
              </div>
            )}
            {/* Purchase conversion */}
            {(data.feedback_summary.bought + data.feedback_summary.not_today) > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Purchase Signals</p>
                <div className="flex gap-2 flex-wrap">
                  <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-semibold">
                    🛍️ {data.feedback_summary.bought} bought
                  </span>
                  <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium">
                    {data.feedback_summary.not_today} not today
                  </span>
                </div>
              </div>
            )}
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

// ── PriceCorrectionsQueue ─────────────────────────────────────────────────────

type CorrectionTab     = "pending" | "recent";
type ReviewActionState = "approve" | "reject" | "needs_verification" | null;

/** Inline confirm-form shown when an action button is pressed. */
function CorrectionReviewForm({
  report,
  action,
  accessToken,
  onCancel,
  onDone,
}: {
  report:       PriceCorrectionReport;
  action:       ReviewActionState;
  accessToken:  string;
  onCancel:     () => void;
  onDone:       (action: string) => void;
}) {
  const [approvedPrice,       setApprovedPrice]       = useState(
    report.reported_price != null ? String(report.reported_price) : ""
  );
  const [verificationMethod,  setVerificationMethod]  = useState("phone");
  const [dataSource,          setDataSource]          = useState("");
  const [adminNote,           setAdminNote]           = useState("");
  const [loading,             setLoading]             = useState(false);
  const [error,               setError]               = useState<string | null>(null);

  async function handleSubmit() {
    if (action === "approve") {
      const price = parseFloat(approvedPrice.replace(/[^0-9.]/g, ""));
      if (isNaN(price) || price <= 0) {
        setError("Approved price must be a positive number.");
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      await reviewPriceCorrection(
        report.id,
        {
          action: action!,
          ...(action === "approve" && {
            approved_price:       parseFloat(approvedPrice.replace(/[^0-9.]/g, "")),
            verification_method:  verificationMethod,
            data_source:          dataSource.trim() || undefined,
          }),
          admin_note: adminNote.trim() || undefined,
        },
        accessToken
      );
      onDone(action!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed — try again.");
      setLoading(false);
    }
  }

  const actionLabel =
    action === "approve"             ? "Approve & Update Price" :
    action === "reject"              ? "Reject Report"          :
                                       "Flag for Verification";
  const actionColorClass =
    action === "approve"             ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
    action === "reject"              ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" :
                                       "bg-amber-500 hover:bg-amber-600 text-white";

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      {action === "approve" && (
        <>
          <div>
            <label className="text-[10px] text-muted-foreground">Approved price (R)</label>
            <Input
              type="number"
              min="1"
              value={approvedPrice}
              onChange={(e) => setApprovedPrice(e.target.value)}
              placeholder="e.g. 3599"
              className="mt-0.5 h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Verification method</label>
            <Select value={verificationMethod} onValueChange={setVerificationMethod}>
              <SelectTrigger className="mt-0.5 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERIFICATION_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Data source</label>
            <Input
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value)}
              placeholder="e.g. Game website, in-store shelf"
              className="mt-0.5 h-8 text-sm"
            />
          </div>
        </>
      )}

      <div>
        <label className="text-[10px] text-muted-foreground">Admin note (optional)</label>
        <Input
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          placeholder="Internal note…"
          className="mt-0.5 h-8 text-sm"
        />
      </div>

      {error && (
        <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />{error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg h-8 text-xs font-semibold transition-all disabled:opacity-50",
            actionColorClass
          )}
        >
          {loading
            ? <><Loader2 className="h-3 w-3 animate-spin" />Processing…</>
            : actionLabel
          }
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Single report card — handles both pending (with action buttons) and reviewed. */
function CorrectionCard({
  report,
  accessToken,
  showReviewed,
  onActioned,
}: {
  report:       PriceCorrectionReport;
  accessToken:  string;
  showReviewed: boolean;
  onActioned:   () => void;
}) {
  const [activeAction,  setActiveAction]  = useState<ReviewActionState>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  function handleDone(action: string) {
    setActionSuccess(action);
    setActiveAction(null);
    setTimeout(onActioned, 800);
  }

  const STATUS_BADGE: Record<string, string> = {
    approved:           "bg-emerald-100 text-emerald-700",
    rejected:           "bg-red-100 text-red-700",
    needs_verification: "bg-amber-100 text-amber-700",
    pending:            "bg-muted text-muted-foreground",
  };

  const STATUS_LABEL: Record<string, string> = {
    approved:           "Approved",
    rejected:           "Rejected",
    needs_verification: "Needs Verification",
    pending:            "Pending",
  };

  const SOURCE_LABEL: Record<string, string> = {
    in_store_seen:    "Saw in-store",
    retailer_website: "Retailer website",
    catalogue:        "Catalogue / flyer",
    user_memory:      "User memory",
    other:            "Other",
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-3 pb-3 space-y-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-sm leading-tight">
              {report.product_name ?? report.product_id}
            </p>
            {report.shop_name && (
              <p className="text-xs text-muted-foreground">{report.shop_name}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {showReviewed && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                STATUS_BADGE[report.status] ?? STATUS_BADGE.pending
              )}>
                {STATUS_LABEL[report.status] ?? report.status}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/60">
              {formatRelativeTime(report.created_at)}
            </span>
          </div>
        </div>

        {/* Price comparison */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Currently:{" "}
            <span className="font-semibold text-foreground">
              {report.current_price != null ? `R${report.current_price}` : "—"}
            </span>
          </span>
          <span className="text-muted-foreground/50">→</span>
          <span className="text-muted-foreground">
            Reported:{" "}
            <span className="font-semibold text-amber-600">
              {report.reported_price != null ? `R${report.reported_price}` : "—"}
            </span>
          </span>
        </div>

        {/* Source + notes */}
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            Source:{" "}
            <span className="text-foreground">
              {SOURCE_LABEL[report.source_type ?? ""] ?? (report.source_type ?? "—")}
            </span>
          </p>
          {report.user_note && (
            <p>
              User note:{" "}
              <span className="text-foreground italic">"{report.user_note}"</span>
            </p>
          )}
          {showReviewed && report.admin_note && (
            <p>
              Admin note:{" "}
              <span className="text-foreground italic">"{report.admin_note}"</span>
            </p>
          )}
        </div>

        {/* Action success message */}
        {actionSuccess && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {actionSuccess === "approve"             ? "Price approved — product updated." :
             actionSuccess === "reject"              ? "Report rejected." :
                                                      "Flagged for verification."}
          </div>
        )}

        {/* Action buttons — pending only */}
        {!showReviewed && !actionSuccess && (
          activeAction ? (
            <CorrectionReviewForm
              report={report}
              action={activeAction}
              accessToken={accessToken}
              onCancel={() => setActiveAction(null)}
              onDone={handleDone}
            />
          ) : (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                onClick={() => setActiveAction("approve")}
                className="flex-1 min-w-[80px] h-8 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 active:scale-[0.98] transition-all"
              >
                Approve
              </button>
              <button
                onClick={() => setActiveAction("needs_verification")}
                className="flex-1 min-w-[80px] h-8 rounded-lg border border-amber-400 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 active:scale-[0.98] transition-all"
              >
                Needs Verify
              </button>
              <button
                onClick={() => setActiveAction("reject")}
                className="flex-1 min-w-[80px] h-8 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-xs font-semibold hover:bg-destructive/10 active:scale-[0.98] transition-all"
              >
                Reject
              </button>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

function PriceCorrectionsQueue() {
  const { session }    = useAuth();
  const [tab,          setTab]         = useState<CorrectionTab>("pending");
  const [pending,      setPending]     = useState<PriceCorrectionReport[]>([]);
  const [recent,       setRecent]      = useState<PriceCorrectionReport[]>([]);
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState<string | null>(null);
  const [refreshKey,   setRefreshKey]  = useState(0);

  useEffect(() => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    getAdminPriceCorrections(session.access_token)
      .then((data) => { setPending(data.pending); setRecent(data.recent); })
      .catch((e)   => setError(e instanceof Error ? e.message : String(e)))
      .finally(()  => setLoading(false));
  }, [session?.access_token, refreshKey]);

  const displayed = tab === "pending" ? pending : recent;

  return (
    <div className="space-y-3">
      {/* Tab toggle */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {(["pending", "recent"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-medium transition-all",
              tab === t
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "pending"
              ? `Pending (${pending.length})`
              : `Reviewed (${recent.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Trust impact callout — shown only when there are pending reports */}
      {!loading && tab === "pending" && pending.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
          <span>
            <strong>Trust impact:</strong> Pending reports will show affected products as{" "}
            <em>Recently disputed</em> in the app until reviewed and rejected or approved.
          </span>
        </div>
      )}

      {!loading && !error && displayed.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {tab === "pending"
              ? "No pending reports — inbox is clear."
              : "No reviewed reports yet."}
          </p>
        </div>
      )}

      {!loading && !error && displayed.length > 0 && session?.access_token && (
        <div className="space-y-3">
          {displayed.map((r) => (
            <CorrectionCard
              key={r.id}
              report={r}
              accessToken={session.access_token!}
              showReviewed={tab === "recent"}
              onActioned={() => setRefreshKey((k) => k + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── DataGuardian ──────────────────────────────────────────────────────────────

const GUARDIAN_FINDING_TYPES = [
  { value: "shop",          label: "Shop" },
  { value: "product",       label: "Product" },
  { value: "price",         label: "Price" },
  { value: "trading_hours", label: "Trading Hours" },
  { value: "floor_layout",  label: "Floor Layout" },
  { value: "route_hint",    label: "Route Hint" },
  { value: "promotion",     label: "Promotion" },
  { value: "other",         label: "Other" },
];

const GUARDIAN_SOURCE_TYPES = [
  { value: "official_website",  label: "Official Website" },
  { value: "retail_directory",  label: "Retail Directory" },
  { value: "public_flyer",      label: "Public Flyer" },
  { value: "manual_survey",     label: "Manual Survey" },
  { value: "press_release",     label: "Press Release" },
  { value: "social_media",      label: "Social Media" },
  { value: "other",             label: "Other" },
];

const GUARDIAN_SUBMITTER_TYPES: {
  value: DataGuardianInput["submitted_by_type"];
  label: string;
}[] = [
  { value: "user",      label: "User (shopper)" },
  { value: "admin",     label: "Admin" },
  { value: "retailer",  label: "Retailer" },
  { value: "mall",      label: "Mall management" },
  { value: "system",    label: "System" },
];

/** Colour classes for each trust level. */
function trustBadgeClass(trust: DataGuardianTrustLevel): string {
  switch (trust) {
    case "mall_verified":      return "bg-primary/15 text-primary";
    case "retailer_verified":  return "bg-emerald-100 text-emerald-800";
    case "physically_verified": return "bg-emerald-100 text-emerald-700";
    case "admin_verified":     return "bg-blue-100 text-blue-700";
    case "source_matched":     return "bg-sky-100 text-sky-700";
    case "evidence_submitted": return "bg-amber-100 text-amber-700";
    case "user_submitted":     return "bg-orange-100 text-orange-700";
    default:                   return "bg-muted text-muted-foreground";
  }
}

/** Colour classes for recommended action. */
function actionBadgeClass(action: DataGuardianRecommendedAction): string {
  switch (action) {
    case "apply_to_existing_record":  return "bg-primary/15 text-primary";
    case "approve_for_admin_review":  return "bg-emerald-100 text-emerald-700";
    case "create_finding":            return "bg-blue-100 text-blue-700";
    case "needs_more_info":           return "bg-amber-100 text-amber-700";
    case "reject":                    return "bg-red-100 text-red-700";
  }
}

function actionLabel(action: DataGuardianRecommendedAction): string {
  switch (action) {
    case "apply_to_existing_record":  return "Apply to existing record";
    case "approve_for_admin_review":  return "Approve for admin review";
    case "create_finding":            return "Create finding";
    case "needs_more_info":           return "Needs more information";
    case "reject":                    return "Reject";
  }
}

function ConfidenceBar({ score }: { score: number }) {
  const color =
    score >= 85 ? "bg-emerald-500" :
    score >= 65 ? "bg-blue-500"    :
    score >= 45 ? "bg-amber-500"   :
                  "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold w-8 text-right">{score}%</span>
    </div>
  );
}

function DataGuardian() {
  const { session } = useAuth();

  // ── Form state ─────────────────────────────────────────────────────────────
  const [findingType,   setFindingType]   = useState("shop");
  const [submitterType, setSubmitterType] = useState<DataGuardianInput["submitted_by_type"]>("user");
  const [sourceType,    setSourceType]    = useState("other");
  const [rawText,       setRawText]       = useState("");
  const [structuredJson, setStructuredJson] = useState("{}");
  const [observedAt,    setObservedAt]    = useState("");

  // Checkboxes
  const [hasPhoto,          setHasPhoto]          = useState(false);
  const [hasReceipt,        setHasReceipt]        = useState(false);
  const [hasOfficialSource, setHasOfficialSource] = useState(false);
  const [retailerConfirmed, setRetailerConfirmed] = useState(false);
  const [mallConfirmed,     setMallConfirmed]     = useState(false);
  const [physicallyVerified, setPhysicallyVerified] = useState(false);

  // ── Result state ───────────────────────────────────────────────────────────
  const [result,   setResult]   = useState<DataGuardianResult | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleReview() {
    if (!session?.access_token) {
      setError("No active session. Please sign in again.");
      return;
    }

    // Validate JSON
    let parsedData: Record<string, unknown> = {};
    try {
      parsedData = JSON.parse(structuredJson || "{}");
    } catch {
      setError("Structured data must be valid JSON.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const payload: DataGuardianInput = {
      finding_type:             findingType,
      submitted_by_type:        submitterType,
      source_type:              sourceType,
      raw_text:                 rawText.trim() || undefined,
      structured_data:          parsedData,
      observed_at:              observedAt || undefined,
      has_photo:                hasPhoto,
      has_receipt:              hasReceipt,
      has_official_source:      hasOfficialSource,
      has_retailer_confirmation: retailerConfirmed,
      has_mall_confirmation:    mallConfirmed,
      has_physical_verification: physicallyVerified,
    };

    try {
      const res = await reviewDataSubmission(payload, session.access_token);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed. Check backend connection.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">

      {/* ── Left: Form ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 pt-4 pb-4">

          {/* Row 1: Finding type + Submitted by */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Finding type</label>
              <Select value={findingType} onValueChange={setFindingType}>
                <SelectTrigger className="mt-0.5 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GUARDIAN_FINDING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Submitted by</label>
              <Select
                value={submitterType}
                onValueChange={(v) => setSubmitterType(v as DataGuardianInput["submitted_by_type"])}
              >
                <SelectTrigger className="mt-0.5 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GUARDIAN_SUBMITTER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value!}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Source type + Observed date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Source type</label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger className="mt-0.5 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GUARDIAN_SOURCE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Observed date</label>
              <Input
                type="date"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
                className="mt-0.5 h-8 text-xs"
              />
            </div>
          </div>

          {/* Raw text */}
          <div>
            <label className="text-[10px] text-muted-foreground">Raw text / description</label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste raw submission text, e.g. 'Pep Home opened near Clicks on Ground Floor'"
              rows={2}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* Structured data JSON */}
          <div>
            <label className="text-[10px] text-muted-foreground">Structured data (JSON)</label>
            <textarea
              value={structuredJson}
              onChange={(e) => setStructuredJson(e.target.value)}
              placeholder={'{ "name": "Pep Home", "floor": "G", "price": 299 }'}
              rows={3}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* Evidence checkboxes */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5">Evidence available</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { state: hasPhoto,           setter: setHasPhoto,           label: "Has photo" },
                { state: hasReceipt,         setter: setHasReceipt,         label: "Has receipt" },
                { state: hasOfficialSource,  setter: setHasOfficialSource,  label: "Official source" },
                { state: retailerConfirmed,  setter: setRetailerConfirmed,  label: "Retailer confirmed" },
                { state: mallConfirmed,      setter: setMallConfirmed,      label: "Mall confirmed" },
                { state: physicallyVerified, setter: setPhysicallyVerified, label: "Physically verified" },
              ].map(({ state, setter, label }) => (
                <label key={label} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={state}
                    onChange={(e) => setter(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span className={cn(
                    "text-xs transition-colors",
                    state ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground"
                  )}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={handleReview}
            disabled={loading}
            size="sm"
            className="w-full"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Reviewing…</>
            ) : (
              <><Bot className="mr-2 h-3.5 w-3.5" />Review Submission</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Right: Result ────────────────────────────────────────────────── */}
      <div>
        {!result && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-14 text-center">
            <Bot className="h-7 w-7 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Run a review to see the result here</p>
            <p className="text-xs text-muted-foreground/60">Trust level, confidence score, and missing evidence will appear in this panel.</p>
          </div>
        )}
        {result && (
        <div className="space-y-3">
          {/* must_not_update_live_data banner */}
          {result.must_not_update_live_data ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Must not update live data</p>
                <p className="mt-0.5 text-destructive/80">
                  This submission's trust level is insufficient to modify live shops, products, or routes.
                  It must become a finding and be explicitly applied by an admin.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-700">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Live update possible — but admin apply required</p>
                <p className="mt-0.5 text-amber-700/80">
                  Trust level is sufficient, but an explicit admin apply action is still required.
                  No automatic updates occur.
                </p>
              </div>
            </div>
          )}

          {/* Core result card */}
          <Card>
            <CardContent className="pt-3 pb-4 space-y-3">
              {/* Action + trust row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  actionBadgeClass(result.recommended_action)
                )}>
                  {actionLabel(result.recommended_action)}
                </span>
                <span className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  trustBadgeClass(result.trust_level)
                )}>
                  {result.trust_level.replace(/_/g, " ")}
                </span>
                <span className="text-[10px] text-muted-foreground capitalize">
                  {result.finding_type.replace(/_/g, " ")}
                </span>
              </div>

              {/* Confidence bar */}
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Confidence score</p>
                <ConfidenceBar score={result.confidence_score} />
              </div>

              {/* Safe badge */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] text-muted-foreground mb-0.5">Safe badge wording</p>
                <p className="text-xs font-semibold">{result.safe_badge}</p>
              </div>

              {/* Missing evidence */}
              {result.missing_evidence.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-[10px] text-amber-600 font-semibold mb-1.5">
                    <ListChecks className="h-3 w-3" />
                    Missing evidence ({result.missing_evidence.length})
                  </p>
                  <ul className="space-y-1">
                    {result.missing_evidence.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.missing_evidence.length === 0 && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  All required evidence fields present
                </div>
              )}

              {/* Reasoning summary */}
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Reasoning</p>
                <p className="text-xs text-foreground/80 leading-relaxed">
                  {result.reasoning_summary}
                </p>
              </div>

              {/* Admin note */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] text-muted-foreground mb-0.5">Admin note</p>
                <p className="text-xs text-foreground/70 leading-relaxed">{result.admin_note}</p>
              </div>
            </CardContent>
          </Card>

          <button
            onClick={handleReset}
            className="flex w-full items-center justify-center gap-1.5 h-8 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Review another submission
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

// ── MallDataCompiler ──────────────────────────────────────────────────────────

type DataTab        = "sources" | "findings";
type FindingsFilter = "pending" | "approved" | "rejected" | "needs_more_info";

const FINDINGS_FILTER_LABEL: Record<FindingsFilter, string> = {
  pending:        "Pending",
  approved:       "Approved",
  rejected:       "Rejected",
  needs_more_info: "Need Info",
};

const FINDING_STATUS_BADGE: Record<string, string> = {
  pending:        "bg-muted text-muted-foreground",
  approved:       "bg-emerald-100 text-emerald-700",
  rejected:       "bg-red-100 text-red-700",
  needs_more_info: "bg-amber-100 text-amber-700",
};

/** Single finding card with inline review flow. */
function FindingCard({
  finding,
  accessToken,
  showReview,
  onActioned,
}: {
  finding:     MallDataFinding;
  accessToken: string;
  showReview:  boolean;
  onActioned:  () => void;
}) {
  type ReviewAction = "approve" | "reject" | "needs_more_info";
  const [reviewAction,  setReviewAction]  = useState<ReviewAction | null>(null);
  const [reviewNote,    setReviewNote]    = useState("");
  const [reviewing,     setReviewing]     = useState(false);
  const [reviewErr,     setReviewErr]     = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  async function handleReview() {
    if (!reviewAction) return;
    setReviewing(true);
    setReviewErr(null);
    try {
      await reviewMallDataFinding(
        finding.id,
        { action: reviewAction, admin_note: reviewNote.trim() || null },
        accessToken
      );
      setReviewSuccess(reviewAction);
      setReviewAction(null);
      setTimeout(onActioned, 600);
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "Review failed.");
      setReviewing(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-2">
        {/* Header */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold capitalize">
                {finding.finding_type.replace(/_/g, " ")}
              </span>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                FINDING_STATUS_BADGE[finding.status] ?? FINDING_STATUS_BADGE.pending
              )}>
                {finding.status}
              </span>
            </div>
            {finding.mall_research_sources?.label && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {finding.mall_research_sources.label}
              </p>
            )}
          </div>
          {finding.confidence != null && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">
              {finding.confidence}% conf.
            </span>
          )}
        </div>

        {/* Data JSON preview */}
        <pre className="rounded-md bg-muted/50 p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-24 text-foreground/80">
          {JSON.stringify(finding.data, null, 2)}
        </pre>

        {finding.raw_snippet && (
          <p className="text-[10px] text-muted-foreground/70 italic line-clamp-2">
            "{finding.raw_snippet}"
          </p>
        )}

        {finding.admin_note && (
          <p className="text-[10px] text-muted-foreground">
            Admin note:{" "}
            <span className="text-foreground italic">"{finding.admin_note}"</span>
          </p>
        )}

        {/* Review success */}
        {reviewSuccess && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {reviewSuccess === "approve"
              ? "Finding approved."
              : reviewSuccess === "reject"
                ? "Finding rejected."
                : "Flagged for more information."}
          </div>
        )}

        {/* Review UI — pending only */}
        {showReview && !reviewSuccess && (
          reviewAction ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
              <Input
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Admin note (optional)"
                className="h-8 text-xs"
              />
              {reviewErr && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0" />{reviewErr}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleReview}
                  disabled={reviewing}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 h-7 rounded-lg text-xs font-semibold transition-all disabled:opacity-50",
                    reviewAction === "approve"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : reviewAction === "reject"
                        ? "bg-destructive hover:bg-destructive/90 text-white"
                        : "bg-amber-500 hover:bg-amber-600 text-white"
                  )}
                >
                  {reviewing
                    ? <><Loader2 className="h-3 w-3 animate-spin" />…</>
                    : reviewAction === "approve"
                      ? "Approve"
                      : reviewAction === "reject"
                        ? "Reject"
                        : "Need More Info"}
                </button>
                <button
                  onClick={() => { setReviewAction(null); setReviewErr(null); }}
                  disabled={reviewing}
                  className="h-7 px-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={() => setReviewAction("approve")}
                className="flex-1 h-7 rounded-lg bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700 active:scale-[0.98] transition-all"
              >
                Approve
              </button>
              <button
                onClick={() => setReviewAction("needs_more_info")}
                className="flex-1 h-7 rounded-lg border border-amber-400 bg-amber-50 text-amber-700 text-[10px] font-semibold hover:bg-amber-100 active:scale-[0.98] transition-all"
              >
                Need Info
              </button>
              <button
                onClick={() => setReviewAction("reject")}
                className="flex-1 h-7 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-[10px] font-semibold hover:bg-destructive/10 active:scale-[0.98] transition-all"
              >
                Reject
              </button>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

function MallDataCompiler() {
  const { session } = useAuth();
  const [tab, setTab] = useState<DataTab>("sources");

  // ── Malls (for dropdowns) ─────────────────────────────────────────────────
  const [malls, setMalls] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    supabase.from("malls").select("id, name").order("name")
      .then(({ data }) => setMalls((data ?? []) as Array<{ id: string; name: string }>));
  }, []);

  // ── Shared mall filter ────────────────────────────────────────────────────
  const [mallFilter, setMallFilter] = useState("all");

  // ── Sources state ─────────────────────────────────────────────────────────
  const [sources,        setSources]        = useState<MallDataSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError,   setSourcesError]   = useState<string | null>(null);
  const [sourcesKey,     setSourcesKey]     = useState(0);

  // Add source form
  const [showAddSrc,  setShowAddSrc]  = useState(false);
  const [srcMallId,   setSrcMallId]   = useState("");
  const [srcLabel,    setSrcLabel]    = useState("");
  const [srcType,     setSrcType]     = useState<MallDataSourceType>("official_website");
  const [srcUrl,      setSrcUrl]      = useState("");
  const [srcNotes,    setSrcNotes]    = useState("");
  const [addingSrc,   setAddingSrc]   = useState(false);
  const [addSrcErr,   setAddSrcErr]   = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;
    setSourcesLoading(true);
    setSourcesError(null);
    getMallDataSources(
      session.access_token,
      mallFilter !== "all" ? { mall_id: mallFilter } : undefined
    )
      .then(({ sources: data }) => setSources(data))
      .catch((e) => setSourcesError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSourcesLoading(false));
  }, [session?.access_token, sourcesKey, mallFilter]);

  async function handleAddSource() {
    if (!session?.access_token) return;
    if (!srcMallId) { setAddSrcErr("Select a mall."); return; }
    if (!srcLabel.trim()) { setAddSrcErr("Label is required."); return; }
    setAddingSrc(true);
    setAddSrcErr(null);
    try {
      await createMallDataSource(
        {
          mall_id:     srcMallId,
          label:       srcLabel.trim(),
          source_type: srcType,
          source_url:  srcUrl.trim() || null,
          notes:       srcNotes.trim() || null,
        },
        session.access_token
      );
      setSrcMallId(""); setSrcLabel(""); setSrcType("official_website");
      setSrcUrl(""); setSrcNotes("");
      setShowAddSrc(false);
      setSourcesKey((k) => k + 1);
    } catch (e) {
      setAddSrcErr(e instanceof Error ? e.message : "Failed to create source.");
    } finally {
      setAddingSrc(false);
    }
  }

  // ── Findings state ────────────────────────────────────────────────────────
  const [findings,        setFindings]        = useState<MallDataFinding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError,   setFindingsError]   = useState<string | null>(null);
  const [findingsKey,     setFindingsKey]     = useState(0);
  const [findingsStatus,  setFindingsStatus]  = useState<FindingsFilter>("pending");

  // Add finding form
  const [showAddFinding, setShowAddFinding] = useState(false);
  const [fndSourceId,    setFndSourceId]    = useState("");
  const [fndMallId,      setFndMallId]      = useState("");
  const [fndType,        setFndType]        = useState<MallDataFindingType>("shop");
  const [fndDataJson,    setFndDataJson]    = useState("{}");
  const [fndSnippet,     setFndSnippet]     = useState("");
  const [fndConfidence,  setFndConfidence]  = useState("80");
  const [addingFnd,      setAddingFnd]      = useState(false);
  const [addFndErr,      setAddFndErr]      = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;
    setFindingsLoading(true);
    setFindingsError(null);
    getMallDataFindings(session.access_token, {
      status:   findingsStatus as MallDataFindingStatus,
      ...(mallFilter !== "all" ? { mall_id: mallFilter } : {}),
    })
      .then(({ findings: data }) => setFindings(data))
      .catch((e) => setFindingsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setFindingsLoading(false));
  }, [session?.access_token, findingsKey, findingsStatus, mallFilter]);

  async function handleAddFinding() {
    if (!session?.access_token) return;
    if (!fndSourceId) { setAddFndErr("Select a source."); return; }
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(fndDataJson); } catch {
      setAddFndErr("Data must be valid JSON."); return;
    }
    const resolvedMallId =
      (fndMallId || sources.find((s) => s.id === fndSourceId)?.mall_id) ?? "";
    if (!resolvedMallId) { setAddFndErr("Could not determine mall_id from source."); return; }

    setAddingFnd(true);
    setAddFndErr(null);
    const conf = parseInt(fndConfidence, 10);
    try {
      await createMallDataFinding(
        {
          source_id:    fndSourceId,
          mall_id:      resolvedMallId,
          finding_type: fndType,
          data:         parsed,
          raw_snippet:  fndSnippet.trim() || null,
          confidence:   isNaN(conf) ? null : conf,
        },
        session.access_token
      );
      setFndSourceId(""); setFndMallId(""); setFndType("shop");
      setFndDataJson("{}"); setFndSnippet(""); setFndConfidence("80");
      setShowAddFinding(false);
      setFindingsStatus("pending");
      setFindingsKey((k) => k + 1);
    } catch (e) {
      setAddFndErr(e instanceof Error ? e.message : "Failed to log finding.");
    } finally {
      setAddingFnd(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Tab toggle */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {(["sources", "findings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-xs font-medium transition-all",
              tab === t
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "sources"
              ? `Sources (${sources.length})`
              : `Findings (${findings.length})`}
          </button>
        ))}
      </div>

      {/* Shared mall filter */}
      <Select value={mallFilter} onValueChange={setMallFilter}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="All malls" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All malls</SelectItem>
          {malls.map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* ── Sources tab ──────────────────────────────────────────────────── */}
      {tab === "sources" && (
        <div className="space-y-3">
          {/* Add source toggle */}
          <button
            onClick={() => setShowAddSrc((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 h-8 rounded-xl border border-dashed border-primary/40 text-xs font-medium text-primary/70 hover:border-primary hover:text-primary transition-all"
          >
            {showAddSrc
              ? <><X className="h-3.5 w-3.5" />Cancel</>
              : <><Plus className="h-3.5 w-3.5" />Add Research Source</>}
          </button>

          {showAddSrc && (
            <Card>
              <CardContent className="space-y-2 pt-3 pb-3">
                <p className="text-xs font-semibold text-muted-foreground">New Research Source</p>

                <Select value={srcMallId} onValueChange={setSrcMallId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select mall" />
                  </SelectTrigger>
                  <SelectContent>
                    {malls.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={srcLabel}
                  onChange={(e) => setSrcLabel(e.target.value)}
                  placeholder="Label, e.g. Sandton City website – May 2026"
                  className="h-8 text-xs"
                />

                <Select value={srcType} onValueChange={(v) => setSrcType(v as MallDataSourceType)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_TYPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={srcUrl}
                  onChange={(e) => setSrcUrl(e.target.value)}
                  placeholder="URL (optional)"
                  className="h-8 text-xs"
                />

                <Input
                  value={srcNotes}
                  onChange={(e) => setSrcNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="h-8 text-xs"
                />

                {addSrcErr && (
                  <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" />{addSrcErr}
                  </div>
                )}

                <Button size="sm" onClick={handleAddSource} disabled={addingSrc} className="w-full h-8 text-xs">
                  {addingSrc
                    ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Saving…</>
                    : <><Database className="mr-1.5 h-3 w-3" />Save Source</>}
                </Button>
              </CardContent>
            </Card>
          )}

          {sourcesLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {sourcesError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {sourcesError}
            </div>
          )}

          {!sourcesLoading && !sourcesError && sources.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Database className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No research sources yet.</p>
              <p className="text-xs text-muted-foreground/60">Add a source to start logging findings.</p>
            </div>
          )}

          {!sourcesLoading && sources.map((src) => (
            <Card key={src.id}>
              <CardContent className="pt-3 pb-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight truncate">{src.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {(src.malls as { name: string } | null)?.name ?? src.mall_id}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground capitalize">
                    {src.source_type.replace(/_/g, " ")}
                  </span>
                </div>
                {src.source_url && (
                  <a
                    href={src.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary truncate"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {src.source_url}
                  </a>
                )}
                {src.notes && (
                  <p className="text-[10px] text-muted-foreground/70 italic">{src.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Findings tab ─────────────────────────────────────────────────── */}
      {tab === "findings" && (
        <div className="space-y-3">
          {/* Status sub-tabs */}
          <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
            {(["pending", "approved", "rejected", "needs_more_info"] as FindingsFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setFindingsStatus(s)}
                className={cn(
                  "flex-1 rounded-lg py-1 text-[10px] font-medium transition-all",
                  findingsStatus === s
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {FINDINGS_FILTER_LABEL[s]}
              </button>
            ))}
          </div>

          {/* Add finding toggle */}
          <button
            onClick={() => setShowAddFinding((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 h-8 rounded-xl border border-dashed border-primary/40 text-xs font-medium text-primary/70 hover:border-primary hover:text-primary transition-all"
          >
            {showAddFinding
              ? <><X className="h-3.5 w-3.5" />Cancel</>
              : <><Plus className="h-3.5 w-3.5" />Log New Finding</>}
          </button>

          {showAddFinding && (
            <Card>
              <CardContent className="space-y-2 pt-3 pb-3">
                <p className="text-xs font-semibold text-muted-foreground">New Finding</p>

                <Select
                  value={fndSourceId}
                  onValueChange={(id) => {
                    setFndSourceId(id);
                    const src = sources.find((s) => s.id === id);
                    if (src) setFndMallId(src.mall_id);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                        {(s.malls as { name: string } | null)?.name
                          ? ` · ${(s.malls as { name: string }).name}`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {sources.length === 0 && (
                  <p className="text-[10px] text-amber-600">
                    No sources available — add a source first.
                  </p>
                )}

                <Select value={fndType} onValueChange={(v) => setFndType(v as MallDataFindingType)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FINDING_TYPES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div>
                  <label className="text-[10px] text-muted-foreground">Data (JSON)</label>
                  <textarea
                    value={fndDataJson}
                    onChange={(e) => setFndDataJson(e.target.value)}
                    placeholder={'{ "name": "Game", "floor": "G", "unit": "G14" }'}
                    rows={3}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground">Raw snippet (optional)</label>
                  <textarea
                    value={fndSnippet}
                    onChange={(e) => setFndSnippet(e.target.value)}
                    placeholder="Paste the original text this finding came from…"
                    rows={2}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground">Confidence (0–100)</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={fndConfidence}
                    onChange={(e) => setFndConfidence(e.target.value)}
                    className="mt-0.5 h-8 text-xs"
                  />
                </div>

                {addFndErr && (
                  <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" />{addFndErr}
                  </div>
                )}

                <Button size="sm" onClick={handleAddFinding} disabled={addingFnd} className="w-full h-8 text-xs">
                  {addingFnd
                    ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Saving…</>
                    : <><Plus className="mr-1.5 h-3 w-3" />Log Finding</>}
                </Button>
              </CardContent>
            </Card>
          )}

          {findingsLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {findingsError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {findingsError}
            </div>
          )}

          {!findingsLoading && !findingsError && findings.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No {FINDINGS_FILTER_LABEL[findingsStatus].toLowerCase()} findings.
              </p>
            </div>
          )}

          {!findingsLoading && findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              accessToken={session?.access_token ?? ""}
              showReview={findingsStatus === "pending"}
              onActioned={() => setFindingsKey((k) => k + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── DataIntelligenceBots ──────────────────────────────────────────────────────

type BotTab = "source" | "extractor" | "duplicates" | "assistant" | "planner";

const BOT_TABS: { id: BotTab; label: string; icon: React.ReactNode }[] = [
  { id: "source",     label: "Source",      icon: <Globe        className="h-3.5 w-3.5" /> },
  { id: "extractor",  label: "Extractor",   icon: <Pencil       className="h-3.5 w-3.5" /> },
  { id: "duplicates", label: "Duplicates",  icon: <Copy         className="h-3.5 w-3.5" /> },
  { id: "assistant",  label: "Reviewer",    icon: <ListChecks   className="h-3.5 w-3.5" /> },
  { id: "planner",    label: "Planner",     icon: <Layers       className="h-3.5 w-3.5" /> },
];

/** Colour classes for bot risk level */
function riskClass(level?: string): string {
  switch (level) {
    case "critical": return "bg-red-100 text-red-800";
    case "high":     return "bg-orange-100 text-orange-800";
    case "medium":   return "bg-yellow-100 text-yellow-800";
    case "low":      return "bg-green-100 text-green-800";
    default:         return "bg-muted text-muted-foreground";
  }
}

/** Colour classes for live data action safety */
function safetyClass(s?: string): string {
  switch (s) {
    case "safe_to_plan":      return "bg-green-100 text-green-800";
    case "requires_review":   return "bg-yellow-100 text-yellow-800";
    case "do_not_apply":      return "bg-orange-100 text-orange-800";
    case "blocked_by_policy": return "bg-red-100 text-red-800";
    default:                  return "bg-muted text-muted-foreground";
  }
}

/** Common result header shown above each bot output */
function BotResultHeader({ result }: { result: { bot_name: string; risk_level: string; live_data_action_safety: string; must_not_update_live_data: boolean } }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", riskClass(result.risk_level))}>
        Risk: {result.risk_level}
      </span>
      <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", safetyClass(result.live_data_action_safety))}>
        {result.live_data_action_safety.replace(/_/g, " ")}
      </span>
      {result.must_not_update_live_data && (
        <span className="inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
          <ShieldAlert className="h-3 w-3" /> No live update
        </span>
      )}
    </div>
  );
}

/** Numbered reasoning list */
function ReasoningList({ items }: { items: string[] }) {
  return (
    <ol className="mt-1.5 space-y-0.5 pl-4 list-decimal text-xs text-muted-foreground">
      {items.map((r, i) => <li key={i}>{r}</li>)}
    </ol>
  );
}

// ── Tab: Source Research ──────────────────────────────────────────────────────

function SourceResearchTab({ token }: { token: string }) {
  const [url,   setUrl]   = useState("");
  const [name,  setName]  = useState("");
  const [desc,  setDesc]  = useState("");
  const [by,    setBy]    = useState<"user" | "admin" | "retailer" | "mall" | "system">("admin");
  const [result, setResult] = useState<SourceResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await runSourceResearch({ source_url: url || undefined, source_name: name || undefined, source_description: desc || undefined, submitted_by_type: by }, token);
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left: form */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Classify a source URL or name. Blocks Google Maps / Apple Maps / Yelp / Foursquare by policy.</p>
        <div className="space-y-2">
          <Input placeholder="Source URL (optional)" value={url}  onChange={(e) => setUrl(e.target.value)}  className="h-8 text-xs" />
          <Input placeholder="Source name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
          <Input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} className="h-8 text-xs" />
          <Select value={by} onValueChange={(v) => setBy(v as typeof by)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["user","admin","retailer","mall","system"] as const).map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" onClick={run} disabled={loading || !token}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run Source Research Bot"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {/* Right: result */}
      <div>
        {!result && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Globe className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Result will appear here</p>
          </div>
        )}
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <BotResultHeader result={result} />
            <div className="text-xs space-y-0.5">
              <p><span className="font-medium">Category:</span> {result.source_category}</p>
              <p><span className="font-medium">Trust ceiling:</span> {result.trust_ceiling}</p>
              {result.is_restricted && <p className="text-red-700 font-medium">⛔ {result.restriction_reason}</p>}
            </div>
            {result.sa_relevance_signals.length > 0 && (
              <div className="text-xs"><span className="font-medium">SA signals:</span> {result.sa_relevance_signals.join("; ")}</div>
            )}
            {result.quality_flags.length > 0 && (
              <div className="text-xs text-yellow-700"><span className="font-medium">Quality flags:</span> {result.quality_flags.join("; ")}</div>
            )}
            <ReasoningList items={result.reasoning} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Finding Extractor ────────────────────────────────────────────────────

function FindingExtractorTab({ token }: { token: string }) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState("unknown");
  const [result, setResult] = useState<FindingExtractorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const HINT_TYPES = ["unknown","shop_listing","price","trading_hours","promotion","floor_layout","product"];

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await runFindingExtractor({ raw_text: text, hint_finding_type: hint !== "unknown" ? hint as never : undefined }, token);
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left: form */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Parse prices, floor codes, shop names and trading hours from free-form text.</p>
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-none h-28 focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Paste raw text here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Select value={hint} onValueChange={setHint}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Hint finding type" /></SelectTrigger>
          <SelectContent>
            {HINT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="w-full" onClick={run} disabled={loading || !text || !token}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run Finding Extractor Bot"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {/* Right: result */}
      <div>
        {!result && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Pencil className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Extracted fields will appear here</p>
          </div>
        )}
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <BotResultHeader result={result} />
            <p className="text-xs font-medium">{result.extraction_summary}</p>
            {result.extracted_findings.map((f, i) => (
              <div key={i} className="rounded border bg-background p-2 space-y-1">
                <p className="text-[10px] font-semibold text-primary uppercase">{f.finding_type}</p>
                {f.fields.map((fld, j) => (
                  <div key={j} className="flex items-baseline gap-2 text-xs">
                    <span className="font-medium w-24 shrink-0">{fld.field}</span>
                    <span className="text-muted-foreground">{String(fld.value)}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/60">{fld.confidence}%</span>
                  </div>
                ))}
              </div>
            ))}
            <ReasoningList items={result.reasoning} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Duplicate Detection ──────────────────────────────────────────────────

function DuplicateDetectionTab({ token }: { token: string }) {
  const [name,  setName]  = useState("");
  const [type,  setType]  = useState<"shop"|"product"|"price"|"other">("shop");
  const [mallId, setMallId] = useState("");
  const [result, setResult] = useState<DuplicateDetectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await runDuplicateDetection({ finding_type: type, name: name || undefined, mall_id: mallId || undefined }, token);
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left: form */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Search existing shops and products for potential duplicates before adding new data.</p>
        <div className="space-y-2">
          <Input placeholder="Name to check" value={name}   onChange={(e) => setName(e.target.value)}   className="h-8 text-xs" />
          <Input placeholder="Mall ID (optional)" value={mallId} onChange={(e) => setMallId(e.target.value)} className="h-8 text-xs" />
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["shop","product","price","other"] as const).map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" onClick={run} disabled={loading || !name || !token}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run Duplicate Detection Bot"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {/* Right: result */}
      <div>
        {!result && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Copy className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Duplicate candidates will appear here</p>
          </div>
        )}
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <BotResultHeader result={result} />
            <p className="text-xs">
              <span className="font-medium">{result.duplicates_found}</span> candidate(s) found ·{" "}
              <span className={cn("font-medium", result.dedup_recommendation === "create_new" ? "text-green-700" : result.dedup_recommendation === "link_to_existing" ? "text-orange-700" : "text-yellow-700")}>
                {result.dedup_recommendation.replace(/_/g, " ")}
              </span>
            </p>
            {result.all_candidates.slice(0, 5).map((c, i) => (
              <div key={i} className="rounded border bg-background p-2 text-xs space-y-0.5">
                <p className="font-medium">{c.matched_name}</p>
                <p className="text-muted-foreground">{c.matched_table} · score {c.match_score}% ({c.match_strength})</p>
                <p className="text-[10px] text-muted-foreground/70">{c.overlap_reason}</p>
              </div>
            ))}
            <ReasoningList items={result.reasoning} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Admin Review Assistant ───────────────────────────────────────────────

function AdminReviewAssistantTab({ token }: { token: string }) {
  const [guardianJson,  setGuardianJson]  = useState("");
  const [sourceJson,    setSourceJson]    = useState("");
  const [dupJson,       setDupJson]       = useState("");
  const [result, setResult] = useState<AdminReviewAssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function safeParse(s: string) {
    if (!s.trim()) return undefined;
    try { return JSON.parse(s); } catch { return undefined; }
  }

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await runAdminReviewAssistant({
        guardian_result:  safeParse(guardianJson),
        source_result:    safeParse(sourceJson),
        duplicate_result: safeParse(dupJson),
      }, token);
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left: form */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Paste JSON results from other bots to get a synthesised action summary.</p>
        <textarea className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-none h-16 focus:outline-none focus:ring-1 focus:ring-ring font-mono" placeholder='Guardian result JSON (optional)' value={guardianJson} onChange={(e) => setGuardianJson(e.target.value)} />
        <textarea className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-none h-16 focus:outline-none focus:ring-1 focus:ring-ring font-mono" placeholder='Source research result JSON (optional)' value={sourceJson}   onChange={(e) => setSourceJson(e.target.value)} />
        <textarea className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-none h-16 focus:outline-none focus:ring-1 focus:ring-ring font-mono" placeholder='Duplicate detection result JSON (optional)' value={dupJson}      onChange={(e) => setDupJson(e.target.value)} />
        <Button size="sm" className="w-full" onClick={run} disabled={loading || !token}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run Admin Review Assistant"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {/* Right: result */}
      <div>
        {!result && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <ListChecks className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Synthesised action list will appear here</p>
          </div>
        )}
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <BotResultHeader result={result} />
            <p className="text-xs font-medium">{result.summary_for_admin}</p>
            {result.recommended_actions.map((a, i) => (
              <div key={i} className={cn("rounded border p-2 text-xs", a.priority === "critical" ? "border-red-300 bg-red-50" : a.priority === "high" ? "border-orange-200 bg-orange-50" : "bg-background")}>
                <p className="font-semibold">{a.action_label}</p>
                <p className="text-muted-foreground mt-0.5">{a.description}</p>
              </div>
            ))}
            {result.blocker_reasons.length > 0 && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                <p className="font-semibold">Blockers:</p>
                <ul className="list-disc pl-4">{result.blocker_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
            <ReasoningList items={result.reasoning} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Live Data Apply Planner ──────────────────────────────────────────────

function LiveDataApplyPlannerTab({ token }: { token: string }) {
  const [findingType, setFindingType] = useState<"shop"|"product"|"price"|"trading_hours"|"floor_layout"|"promotion"|"other">("shop");
  const [trustLevel,  setTrustLevel]  = useState("admin_verified");
  const [confidence,  setConfidence]  = useState("85");
  const [recordId,    setRecordId]    = useState("");
  const [dataJson,    setDataJson]    = useState('{\n  "name": "Game",\n  "floor": "G"\n}');
  const [result, setResult] = useState<LiveDataApplyPlannerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const TRUST_LEVELS = ["demo","user_submitted","evidence_submitted","source_matched","admin_verified","physically_verified","retailer_verified","mall_verified"];
  const FINDING_TYPES = ["shop","product","price","trading_hours","floor_layout","promotion","other"] as const;

  async function run() {
    setLoading(true); setError(null); setResult(null);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(dataJson); } catch { setError("Invalid JSON in structured_data"); setLoading(false); return; }
    try {
      const r = await runLiveDataApplyPlanner({
        finding_type:     findingType,
        trust_level:      trustLevel,
        confidence_score: parseInt(confidence, 10),
        structured_data:  parsed,
        target_record_id: recordId || undefined,
      }, token);
      setResult(r);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left: form */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Propose a field-level patch plan. Returns a proposal only — no live data is updated.</p>
        <div className="grid grid-cols-2 gap-2">
          <Select value={findingType} onValueChange={(v) => setFindingType(v as typeof findingType)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{FINDING_TYPES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={trustLevel} onValueChange={setTrustLevel}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{TRUST_LEVELS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Confidence 0-100" value={confidence} onChange={(e) => setConfidence(e.target.value)} className="h-8 text-xs" type="number" min={0} max={100} />
          <Input placeholder="Target record ID (optional)" value={recordId} onChange={(e) => setRecordId(e.target.value)} className="h-8 text-xs" />
        </div>
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-xs resize-none h-24 focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          placeholder='Structured data JSON'
          value={dataJson}
          onChange={(e) => setDataJson(e.target.value)}
        />
        <Button size="sm" className="w-full" onClick={run} disabled={loading || !token}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run Live Data Apply Planner"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {/* Right: result */}
      <div>
        {!result && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <Layers className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground">Patch plan will appear here</p>
          </div>
        )}
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <BotResultHeader result={result} />
            {result.plan_blocked && (
              <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 font-medium">
                ⛔ Plan blocked: {result.block_reason}
              </div>
            )}
            {!result.plan_blocked && (
              <>
                <p className="text-xs font-medium">Target: <span className="font-mono">{result.target_table}</span>{result.target_record_id ? ` · ${result.target_record_id}` : " (new)"}</p>
                <p className="text-xs text-muted-foreground">{result.plan_summary}</p>
                <div className="space-y-1">
                  {result.proposed_patches.map((p, i) => (
                    <div key={i} className="flex items-baseline gap-2 rounded border bg-background p-2 text-xs">
                      <span className="font-mono font-medium w-28 shrink-0">{p.field}</span>
                      <span className="text-primary">{String(p.proposed_value)}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/60">{p.confidence}%</span>
                      {p.notes && <span className="text-[10px] text-yellow-700 block w-full mt-0.5">{p.notes}</span>}
                    </div>
                  ))}
                </div>
                {result.fields_skipped.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/70">Skipped: {result.fields_skipped.join(", ")}</p>
                )}
              </>
            )}
            <ReasoningList items={result.reasoning} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── DataIntelligenceBots container ────────────────────────────────────────────

function DataIntelligenceBots() {
  const { session } = useAuth();
  const [activeBotTab, setActiveBotTab] = useState<BotTab>("source");
  const token = session?.access_token ?? "";

  return (
    <div className="space-y-4">
      {/* Policy reminder */}
      <div className="flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[10px] text-orange-800">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        All bot outputs are proposals only. No live data is updated automatically. An explicit admin apply action is always required.
      </div>

      {/* Bot sub-tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b" role="tablist">
        {BOT_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeBotTab === tab.id}
            onClick={() => setActiveBotTab(tab.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 -mb-px px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
              activeBotTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bot tab content */}
      <div>
        {activeBotTab === "source"     && <SourceResearchTab       token={token} />}
        {activeBotTab === "extractor"  && <FindingExtractorTab     token={token} />}
        {activeBotTab === "duplicates" && <DuplicateDetectionTab   token={token} />}
        {activeBotTab === "assistant"  && <AdminReviewAssistantTab token={token} />}
        {activeBotTab === "planner"    && <LiveDataApplyPlannerTab token={token} />}
      </div>
    </div>
  );
}

// ── Mall Research Batch Workflow ──────────────────────────────────────────────

const RESEARCH_FINDING_TYPES: { value: MallResearchFindingType; label: string }[] = [
  { value: "shop",          label: "Shop" },
  { value: "product",       label: "Product" },
  { value: "trading_hours", label: "Trading Hours" },
  { value: "floor_layout",  label: "Floor Layout" },
  { value: "promotion",     label: "Promotion" },
  { value: "other",         label: "Other" },
];

const BATCH_STATUS_LABELS: Record<MallResearchBatchStatus, string> = {
  open:        "Open",
  in_progress: "In Progress",
  complete:    "Complete",
  archived:    "Archived",
};

const ITEM_STATUS_LABELS: Record<MallResearchItemStatus, string> = {
  pending:  "Pending",
  reviewed: "Reviewed",
  accepted: "Accepted",
  rejected: "Rejected",
  flagged:  "Flagged",
};

function batchStatusClasses(status: MallResearchBatchStatus): string {
  switch (status) {
    case "open":        return "bg-blue-100 text-blue-800";
    case "in_progress": return "bg-yellow-100 text-yellow-800";
    case "complete":    return "bg-green-100 text-green-800";
    case "archived":    return "bg-muted text-muted-foreground";
  }
}

function itemStatusClasses(status: MallResearchItemStatus): string {
  switch (status) {
    case "pending":  return "bg-yellow-100 text-yellow-800";
    case "reviewed": return "bg-blue-100 text-blue-800";
    case "accepted": return "bg-green-100 text-green-800";
    case "rejected": return "bg-red-100 text-red-800";
    case "flagged":  return "bg-orange-100 text-orange-800";
  }
}

// ── Batch Item Row ────────────────────────────────────────────────────────────

// ── Bot output summary sub-component ─────────────────────────────────────────

function BotOutputSection({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown> | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;

  const recommendation = (data.recommendation ?? data.recommended_action ?? data.dedup_recommendation) as string | undefined;
  const riskLevel      = (data.risk_level ?? data.overall_risk) as string | undefined;
  const trustLevel     = (data.trust_level) as string | undefined;
  const confidence     = (data.confidence_score) as number | undefined;
  const safeToProc     = (data.safe_to_proceed) as boolean | undefined;
  const isRestricted   = data.is_restricted as boolean | undefined;
  const reasoning      = (data.reasoning ?? data.reasoning_summary) as string | string[] | undefined;
  const summary        = (data.extraction_summary ?? data.summary_for_admin ?? data.admin_note ?? data.plan_summary) as string | undefined;

  const reasoningText = Array.isArray(reasoning)
    ? reasoning.slice(0, 2).join(" · ")
    : reasoning?.slice(0, 160);

  const riskColor = !riskLevel ? "" :
    riskLevel === "low"      ? "text-green-700" :
    riskLevel === "medium"   ? "text-yellow-700" :
    riskLevel === "critical" ? "text-red-700" : "text-orange-700";

  return (
    <div className="rounded border bg-muted/30 text-[11px]">
      <button
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="font-semibold">{label}</span>
        <div className="flex items-center gap-2">
          {isRestricted && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">BLOCKED</span>}
          {riskLevel && <span className={cn("text-[10px]", riskColor)}>{riskLevel}</span>}
          {trustLevel && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800">{trustLevel}</span>}
          {confidence !== undefined && <span className="text-muted-foreground">{confidence}%</span>}
          {safeToProc === true  && <span className="rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-800">safe</span>}
          {safeToProc === false && <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-800">review</span>}
          {recommendation && <span className="text-muted-foreground italic truncate max-w-[100px]">{recommendation}</span>}
          {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <div className="border-t px-2.5 py-2 space-y-1.5">
          {summary && <p className="text-muted-foreground">{summary}</p>}
          {reasoningText && <p className="text-muted-foreground">{reasoningText}</p>}
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Raw JSON</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[10px] leading-relaxed">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ── BatchItemRow ──────────────────────────────────────────────────────────────

function BatchItemRow({
  item: initialItem,
  token,
  onReview,
}: {
  item: MallResearchBatchItem;
  token: string;
  onReview: (itemId: string, status: MallResearchItemStatus, notes: string) => Promise<void>;
}) {
  const [open,    setOpen]    = useState(false);
  const [item,    setItem]    = useState<MallResearchBatchItem>(initialItem);
  const [notes,   setNotes]   = useState(item.admin_notes ?? "");
  const [saving,  setSaving]  = useState(false);

  // Bot action state — track which bot is currently running
  const [running, setRunning] = useState<string | null>(null);
  const [botError, setBotError] = useState<string | null>(null);

  // hints live view — keep in sync with item.bot_hints_used
  const hints = (item.bot_hints_used ?? {}) as Record<string, unknown>;
  const pipeline = hints.pipeline as Record<string, unknown> | undefined;
  const stepsCompleted = (pipeline?.steps_completed ?? []) as string[];

  async function runBot(
    label: string,
    fn: (itemId: string, token: string) => Promise<PipelineBotResult>
  ) {
    setRunning(label);
    setBotError(null);
    try {
      const result = await fn(item.id, token);
      // Merge returned bot_hints_used into local item state
      setItem((prev) => ({
        ...prev,
        bot_hints_used: result.bot_hints_used,
      }));
    } catch (e) {
      setBotError(String(e));
    } finally {
      setRunning(null);
    }
  }

  async function handleReview(status: MallResearchItemStatus) {
    setSaving(true);
    try {
      await onReview(item.id, status, notes);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  const anyRunning = running !== null;

  // Derive suggested action from Admin Review bot output
  const adminReview = hints.admin_review as Record<string, unknown> | undefined;
  const suggestedAction = adminReview?.recommended_actions as Array<{ priority: string; action_label: string; description: string }> | undefined;
  const topAction = suggestedAction?.find((a) => a.priority === "critical" || a.priority === "high") ?? suggestedAction?.[0];

  return (
    <div className="rounded-lg border bg-card text-xs">
      {/* Row header — always visible */}
      <button
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors rounded-lg"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
          itemStatusClasses(item.status)
        )}>
          {ITEM_STATUS_LABELS[item.status]}
        </span>
        <span className="mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {RESEARCH_FINDING_TYPES.find((t) => t.value === item.finding_type)?.label ?? item.finding_type}
        </span>
        {stepsCompleted.length > 0 && (
          <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {stepsCompleted.length} bot{stepsCompleted.length !== 1 ? "s" : ""}
          </span>
        )}
        <span className="flex-1 truncate text-foreground/80">
          {item.raw_text
            ? item.raw_text.slice(0, 100)
            : item.source_url ?? item.source_name ?? "(no text)"}
        </span>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t px-3 py-3 space-y-4">
          {/* Raw text + source */}
          {item.raw_text && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Raw text</p>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">{item.raw_text}</p>
            </div>
          )}
          {(item.source_url || item.source_name) && (
            <div className="flex flex-wrap gap-4">
              {item.source_name && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Tag className="h-3 w-3" />{item.source_name}
                </span>
              )}
              {item.source_url && (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <Link className="h-3 w-3" />{item.source_url.slice(0, 60)}
                </a>
              )}
            </div>
          )}

          {/* Advisory banner */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Bot outputs are advisory.</strong> They do not update live mall data.
              Only admin review/apply workflows can change live shops, products, or mall_nodes.
            </span>
          </div>

          {/* Bot Action buttons */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bot Actions</p>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "source",    label: "Source",    runLabel: "Running Source…",    fn: runResearchItemSourceResearch,    hasOutput: !!hints.source_research },
                { key: "extract",   label: "Extract",   runLabel: "Extracting…",         fn: runResearchItemFindingExtractor,  hasOutput: !!hints.finding_extractor },
                { key: "guardian",  label: "Guardian",  runLabel: "Reviewing…",          fn: runResearchItemDataGuardian,      hasOutput: !!hints.data_guardian },
                { key: "duplicate", label: "Duplicate", runLabel: "Checking…",           fn: runResearchItemDuplicateCheck,    hasOutput: !!hints.duplicate_detection },
                { key: "review",    label: "Review",    runLabel: "Reviewing…",          fn: runResearchItemAdminReview,       hasOutput: !!hints.admin_review },
              ].map(({ key, label, runLabel, fn, hasOutput }) => (
                <button
                  key={key}
                  disabled={anyRunning}
                  onClick={() => runBot(key, fn)}
                  className={cn(
                    "flex items-center gap-1 rounded border px-2.5 py-1 transition-colors disabled:opacity-50",
                    hasOutput
                      ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                      : "bg-card text-foreground/70 hover:bg-muted"
                  )}
                >
                  {running === key
                    ? <><Loader2 className="h-3 w-3 animate-spin" />{runLabel}</>
                    : <>{hasOutput ? <CheckCircle className="h-3 w-3" /> : <Bot className="h-3 w-3" />}{label}</>
                  }
                </button>
              ))}
              <button
                disabled={anyRunning}
                onClick={() => runBot("pipeline", runResearchItemFullPipeline)}
                className={cn(
                  "flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                )}
              >
                {running === "pipeline"
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Running Pipeline…</>
                  : <><Zap className="h-3 w-3" />Run Full Pipeline</>
                }
              </button>
            </div>
            {botError && (
              <p className="text-[11px] text-destructive">{botError}</p>
            )}
          </div>

          {/* Suggested action from Admin Review bot */}
          {topAction && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]",
              topAction.priority === "critical" ? "border-red-200 bg-red-50 text-red-900" :
              topAction.priority === "high"     ? "border-orange-200 bg-orange-50 text-orange-900" :
              "border-blue-200 bg-blue-50 text-blue-900"
            )}>
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Bot suggestion: {topAction.action_label}</p>
                <p className="mt-0.5 text-[10px] opacity-80">{topAction.description}</p>
                <p className="mt-1 text-[10px] italic opacity-70">
                  This is advisory only. Use the Accept/Reject/Flag buttons below to make your decision.
                </p>
              </div>
            </div>
          )}

          {/* Bot outputs (compact, expandable) */}
          {(hints.source_research || hints.finding_extractor || hints.data_guardian || hints.duplicate_detection || hints.admin_review) && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bot Outputs</p>
              <BotOutputSection label="Source Research"    data={hints.source_research as Record<string, unknown> | undefined} />
              <BotOutputSection label="Finding Extractor"  data={hints.finding_extractor as Record<string, unknown> | undefined} />
              <BotOutputSection label="Data Guardian"      data={hints.data_guardian as Record<string, unknown> | undefined} />
              <BotOutputSection label="Duplicate Detection" data={hints.duplicate_detection as Record<string, unknown> | undefined} />
              <BotOutputSection label="Admin Recommendation" data={hints.admin_review as Record<string, unknown> | undefined} />
              {pipeline && (
                <p className="text-[10px] text-muted-foreground">
                  Pipeline last run: {new Date(pipeline.last_run_at as string).toLocaleString("en-ZA")}
                  {(pipeline.warnings as string[] | undefined)?.length
                    ? ` · ${(pipeline.warnings as string[]).length} warning(s)`
                    : ""}
                </p>
              )}
            </div>
          )}

          {/* Admin notes + review action buttons */}
          <div className="space-y-2 border-t pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Admin Decision</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Admin notes (optional)…"
              rows={2}
              className="w-full rounded border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <div className="flex flex-wrap gap-2">
              <button
                disabled={saving}
                onClick={() => handleReview("accepted")}
                className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-white hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle className="h-3 w-3" /> Accept
              </button>
              <button
                disabled={saving}
                onClick={() => handleReview("rejected")}
                className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-white hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle className="h-3 w-3" /> Reject
              </button>
              <button
                disabled={saving}
                onClick={() => handleReview("flagged")}
                className="flex items-center gap-1 rounded bg-orange-500 px-2.5 py-1 text-white hover:bg-orange-600 disabled:opacity-50"
              >
                <Flag className="h-3 w-3" /> Flag
              </button>
              <button
                disabled={saving}
                onClick={() => handleReview("reviewed")}
                className="flex items-center gap-1 rounded border bg-card px-2.5 py-1 text-foreground/80 hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" /> Mark Reviewed
              </button>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground self-center" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Batch Detail View ─────────────────────────────────────────────────────────

function BatchDetailView({
  batchId,
  token,
  onBack,
}: {
  batchId: string;
  token: string;
  onBack: () => void;
}) {
  const [batch,   setBatch]   = useState<MallResearchBatchWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Add item form
  const [newText,    setNewText]    = useState("");
  const [newSource,  setNewSource]  = useState("");
  const [newType,    setNewType]    = useState<MallResearchFindingType>("other");
  const [addingItem, setAddingItem] = useState(false);
  const [addError,   setAddError]   = useState<string | null>(null);

  // Status change
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getMallResearchBatch(batchId, token);
      setBatch(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [batchId]);

  async function handleAddItem() {
    if (!newText.trim() && !newSource.trim()) return;
    setAddingItem(true);
    setAddError(null);
    try {
      await createMallResearchBatchItem(batchId, {
        finding_type: newType,
        raw_text:     newText.trim() || undefined,
        source_url:   newSource.trim() || undefined,
      }, token);
      setNewText("");
      setNewSource("");
      setNewType("other");
      await load();
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAddingItem(false);
    }
  }

  async function handleReviewItem(itemId: string, status: MallResearchItemStatus, notes: string) {
    await reviewMallResearchBatchItem(batchId, itemId, { status, admin_notes: notes }, token);
    await load();
  }

  async function handleStatusChange(status: MallResearchBatchStatus) {
    setUpdatingStatus(true);
    try {
      await updateMallResearchBatchStatus(batchId, status, token);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setUpdatingStatus(false);
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
  if (error) return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
      {error}
    </div>
  );
  if (!batch) return null;

  const pendingCount  = batch.items.filter((i) => i.status === "pending").length;
  const acceptedCount = batch.items.filter((i) => i.status === "accepted").length;
  const rejectedCount = batch.items.filter((i) => i.status === "rejected").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to batches
          </button>
          <h3 className="font-semibold text-sm">{batch.title}</h3>
          {batch.mall_name && (
            <p className="text-xs text-muted-foreground">{batch.mall_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium", batchStatusClasses(batch.status))}>
            {BATCH_STATUS_LABELS[batch.status]}
          </span>
          {updatingStatus && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Stats + status actions */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total items", value: batch.items.length, color: "" },
          { label: "Pending",     value: pendingCount,       color: "text-yellow-600" },
          { label: "Accepted",    value: acceptedCount,      color: "text-green-600" },
          { label: "Rejected",    value: rejectedCount,      color: "text-red-600" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-0">
            <CardContent className="flex flex-col gap-0.5 p-3">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <span className={cn("text-xl font-bold tabular-nums", color)}>{value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status transitions */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground self-center">Move batch to:</span>
        {(["open", "in_progress", "complete", "archived"] as MallResearchBatchStatus[])
          .filter((s) => s !== batch.status)
          .map((s) => (
            <button
              key={s}
              disabled={updatingStatus}
              onClick={() => handleStatusChange(s)}
              className="rounded border bg-card px-2.5 py-1 hover:bg-muted disabled:opacity-50"
            >
              {BATCH_STATUS_LABELS[s]}
            </button>
          ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {/* Add item form */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <FolderPlus className="h-3.5 w-3.5" /> Add Finding
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Finding type</label>
              <Select value={newType} onValueChange={(v) => setNewType(v as MallResearchFindingType)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESEARCH_FINDING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Raw text / observation</label>
              <textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="e.g. Game at Sandton City Ground Floor unit G12 is selling the Samsung 65″ TV for R12,999 on special"
                rows={3}
                className="w-full rounded border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Source URL (optional)</label>
              <Input
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                placeholder="https://sandtoncity.com/stores/game"
                className="h-8 text-xs"
              />
            </div>
            {addError && (
              <p className="text-xs text-destructive">{addError}</p>
            )}
            <Button
              size="sm"
              className="h-8 text-xs w-full"
              disabled={addingItem || (!newText.trim() && !newSource.trim())}
              onClick={handleAddItem}
            >
              {addingItem ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add Finding
            </Button>

            {/* Bot integration hints */}
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-1.5 text-[11px]">
              <p className="font-semibold text-muted-foreground">After adding an item, run these bots:</p>
              <ol className="space-y-1 list-decimal list-inside text-muted-foreground">
                <li><span className="text-foreground font-medium">Source Research Bot</span> — paste the source URL → validates it isn't Google Maps / Yelp</li>
                <li><span className="text-foreground font-medium">Finding Extractor Bot</span> — paste the raw text → extracts prices, unit codes, hours</li>
                <li><span className="text-foreground font-medium">Duplicate Detection Bot</span> — enter the shop/product name → checks for existing DB entries</li>
                <li><span className="text-foreground font-medium">Data Guardian</span> — score trust level before committing to live data</li>
              </ol>
              <p className="text-muted-foreground mt-1">All bots are in the <strong className="text-foreground">Bot Suite</strong> tab.</p>
            </div>
          </CardContent>
        </Card>

        {/* Items list */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Findings ({batch.items.length})
          </h4>
          {batch.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <FileText className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No findings yet. Add one using the form.</p>
            </div>
          ) : (
            batch.items.map((item) => (
              <BatchItemRow
                key={item.id}
                item={item}
                token={token}
                onReview={handleReviewItem}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mall Research Batches Root ────────────────────────────────────────────────

function MallResearchBatches({ token }: { token: string }) {
  const [batches,     setBatches]     = useState<MallResearchBatch[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);

  // Create form
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc,  setCreateDesc]  = useState("");
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Filter
  const [statusFilter, setStatusFilter] = useState<"all" | MallResearchBatchStatus>("all");

  async function loadBatches() {
    setLoading(true);
    setError(null);
    try {
      const result = await getMallResearchBatches(
        token,
        statusFilter !== "all" ? { status: statusFilter as MallResearchBatchStatus } : undefined
      );
      setBatches(result.batches);
      setTotal(result.total);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBatches(); }, [statusFilter]);

  async function handleCreate() {
    if (!createTitle.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const batch = await createMallResearchBatch({ title: createTitle.trim(), description: createDesc.trim() || undefined }, token);
      setCreateTitle("");
      setCreateDesc("");
      setBatches((prev) => [batch, ...prev]);
      setTotal((t) => t + 1);
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  }

  // Batch detail view
  if (selectedId) {
    return (
      <BatchDetailView
        batchId={selectedId}
        token={token}
        onBack={() => { setSelectedId(null); void loadBatches(); }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      {/* Create new batch */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <FolderPlus className="h-3.5 w-3.5" /> New Research Batch
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Create a batch to group all data findings for one mall research session.
            Batches do not write to shops, products, or mall_nodes automatically —
            they are a staging workspace only.
          </p>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Title *</label>
            <Input
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="e.g. Sandton City — May 2026 survey"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Description (optional)</label>
            <textarea
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="What are you researching in this batch?"
              rows={2}
              className="w-full rounded border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          {createError && <p className="text-xs text-destructive">{createError}</p>}
          <Button
            size="sm"
            className="h-8 text-xs w-full"
            disabled={creating || !createTitle.trim()}
            onClick={handleCreate}
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FolderPlus className="h-3.5 w-3.5 mr-1" />}
            Create Batch
          </Button>
        </CardContent>
      </Card>

      {/* Batch list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Batches ({total})
          </h3>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | MallResearchBatchStatus)}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All statuses</SelectItem>
                {(["open", "in_progress", "complete", "archived"] as MallResearchBatchStatus[]).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{BATCH_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadBatches}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        {!loading && !error && batches.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <FolderOpen className="h-7 w-7 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No batches yet. Create one using the form.</p>
          </div>
        )}
        {!loading && batches.map((b) => (
          <button
            key={b.id}
            onClick={() => setSelectedId(b.id)}
            className="w-full rounded-lg border bg-card px-3 py-2.5 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-medium truncate">{b.title}</p>
                {b.mall_name && (
                  <p className="text-[10px] text-muted-foreground">{b.mall_name}</p>
                )}
                {b.description && (
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{b.description}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", batchStatusClasses(b.status))}>
                  {BATCH_STATUS_LABELS[b.status]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {b.item_count} item{b.item_count !== 1 ? "s" : ""} · {b.reviewed_count} reviewed
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type AdminTab =
  | "overview"
  | "diagnostics"
  | "analytics"
  | "price-trust"
  | "mall-data"
  | "guardian"
  | "bots"
  | "research";

interface AdminTabDef {
  id:               AdminTab;
  label:            string;
  icon:             React.ReactNode;
  requiresBackend?: boolean;
}

const ADMIN_TABS: AdminTabDef[] = [
  { id: "overview",    label: "Overview",        icon: <BarChart3      className="h-3.5 w-3.5" /> },
  { id: "diagnostics", label: "Diagnostics",     icon: <Activity       className="h-3.5 w-3.5" /> },
  { id: "analytics",   label: "Analytics",       icon: <TrendingUp     className="h-3.5 w-3.5" />, requiresBackend: true },
  { id: "price-trust", label: "Price Trust",     icon: <ShieldCheck    className="h-3.5 w-3.5" /> },
  { id: "mall-data",   label: "Mall Data",       icon: <Database       className="h-3.5 w-3.5" />, requiresBackend: true },
  { id: "guardian",    label: "Data Guardian",   icon: <Bot            className="h-3.5 w-3.5" />, requiresBackend: true },
  { id: "bots",        label: "Bot Suite",       icon: <Cpu            className="h-3.5 w-3.5" />, requiresBackend: true },
  { id: "research",    label: "Research Batches",icon: <ClipboardList  className="h-3.5 w-3.5" />, requiresBackend: true },
];

function AdminDashboardContent() {
  const { session, profile } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const [counts, setCounts]                   = useState<Counts | null>(null);
  const [countsError, setCountsError]         = useState<string | null>(null);
  const [countsLoading, setCountsLoading]     = useState(true);

  const [products, setProducts]               = useState<ProductWithShop[]>([]);
  const [productsError, setProductsError]     = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [refreshKey, setRefreshKey]           = useState(0);

  const [analytics, setAnalytics]             = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError]   = useState<string | null>(null);

  const defaultVerifiedBy = profile?.full_name ?? session?.user?.email ?? "";
  const backendOk         = isGoogleBackendConfigured();

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

  useEffect(() => {
    if (!backendOk) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    getAdminStats()
      .then((resp) => setAnalytics(resp.analytics))
      .catch((e) => setAnalyticsError(String(e)))
      .finally(() => setAnalyticsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshAnalytics() {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    getAdminStats()
      .then((resp) => setAnalytics(resp.analytics))
      .catch((e) => setAnalyticsError(String(e)))
      .finally(() => setAnalyticsLoading(false));
  }

  const visibleTabs = ADMIN_TABS.filter((t) => !t.requiresBackend || backendOk);

  const needsBackend = (tab: AdminTab) =>
    ["analytics", "mall-data", "guardian", "bots", "research"].includes(tab);

  return (
    <div className="min-h-screen bg-background">

      {/* ── Sticky admin header + tab bar ─────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-screen-2xl px-4 md:px-6 lg:px-8">

          {/* Title / identity row */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h1 className="text-sm font-semibold leading-none sm:text-base">MallMind Admin</h1>
                <p className="mt-0.5 hidden text-[11px] text-muted-foreground leading-none sm:block">
                  Founder control centre · data quality, analytics &amp; intelligence bots
                </p>
              </div>
            </div>

            {/* Status pills — hidden on very small screens */}
            <div className="hidden items-center gap-2 sm:flex">
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                backendOk
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              )}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  backendOk ? "bg-emerald-500" : "bg-red-500"
                )} />
                {backendOk ? "Backend connected" : "Backend not set"}
              </span>
              {session && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <User className="h-2.5 w-2.5" />
                  {session.user?.email ?? "Admin"}
                </span>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div
            className="flex gap-0 overflow-x-auto scrollbar-hide"
            role="tablist"
            aria-label="Admin sections"
          >
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-6 lg:px-8">

        {/* ── Overview ────────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-8">

            {countsLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {countsError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Failed to load overview: {countsError}
              </div>
            )}

            {counts && (
              <>
                {/* Stat cards — 4 across on desktop */}
                <section>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Platform snapshot
                  </h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <StatCard icon={<Store      className="h-4 w-4" />} label="Malls"    value={counts.malls} />
                    <StatCard icon={<ShoppingBag className="h-4 w-4" />} label="Shops"    value={counts.shops} />
                    <StatCard icon={<Package    className="h-4 w-4" />} label="Products" value={counts.products.total} sub="across all shops" />
                    <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="Verified" value={counts.products.manually_verified + counts.products.live_feed} sub="verified or live feed" />
                  </div>
                </section>

                {/* Two-column: quality + quick nav */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <section>
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Product data quality
                    </h2>
                    <Card>
                      <CardContent className="space-y-3 pt-4 pb-4">
                        {counts.products.live_feed > 0 && (
                          <QualityRow label="live_feed"         count={counts.products.live_feed}         total={counts.products.total} color="bg-green-500" />
                        )}
                        {counts.products.manually_verified > 0 && (
                          <QualityRow label="manually_verified" count={counts.products.manually_verified} total={counts.products.total} color="bg-emerald-400" />
                        )}
                        <QualityRow label="demo"          count={counts.products.demo}          total={counts.products.total} color="bg-yellow-400" />
                        {counts.products.needs_review > 0 && (
                          <QualityRow label="needs_review"  count={counts.products.needs_review}  total={counts.products.total} color="bg-orange-400" />
                        )}
                        {counts.products.stale > 0 && (
                          <QualityRow label="stale"         count={counts.products.stale}         total={counts.products.total} color="bg-red-400" />
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

                  <section className="space-y-4">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick nav
                    </h2>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {([
                        { label: "Diagnostics",       tab: "diagnostics" as AdminTab, desc: "Test backend connection",      icon: <Activity       className="h-3.5 w-3.5 text-muted-foreground" /> },
                        { label: "Analytics",         tab: "analytics"   as AdminTab, desc: "Usage events & search trends", icon: <TrendingUp     className="h-3.5 w-3.5 text-muted-foreground" />, backend: true },
                        { label: "Price Trust",       tab: "price-trust" as AdminTab, desc: "Verify & correct prices",      icon: <ShieldCheck    className="h-3.5 w-3.5 text-muted-foreground" /> },
                        { label: "Mall Data",         tab: "mall-data"   as AdminTab, desc: "Sources & findings",           icon: <Database       className="h-3.5 w-3.5 text-muted-foreground" />, backend: true },
                        { label: "Data Guardian",     tab: "guardian"    as AdminTab, desc: "Trust scoring",                icon: <Bot            className="h-3.5 w-3.5 text-muted-foreground" />, backend: true },
                        { label: "Bot Suite",         tab: "bots"        as AdminTab, desc: "Intelligence bots",            icon: <Cpu            className="h-3.5 w-3.5 text-muted-foreground" />, backend: true },
                        { label: "Research Batches",  tab: "research"    as AdminTab, desc: "Per-mall research workflow",   icon: <ClipboardList  className="h-3.5 w-3.5 text-muted-foreground" />, backend: true },
                      ] as const).map((item) => {
                        const disabled = "backend" in item && item.backend && !backendOk;
                        return (
                          <button
                            key={item.tab}
                            onClick={() => !disabled && setActiveTab(item.tab)}
                            disabled={disabled}
                            className={cn(
                              "flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
                              disabled
                                ? "opacity-40 cursor-not-allowed"
                                : "hover:border-primary/40 hover:bg-primary/5"
                            )}
                          >
                            <span className="mt-0.5 shrink-0">{item.icon}</span>
                            <span>
                              <span className="block font-medium">{item.label}</span>
                              <span className="text-muted-foreground">{item.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Promote products to verified status:</p>
                      <ol className="mt-2 list-decimal space-y-1 pl-4">
                        <li>Run migration <code>007_price_verified_at.sql</code> in Supabase</li>
                        <li>Run migration <code>008_data_quality_fields.sql</code> in Supabase</li>
                        <li>Use <strong>Price Trust → Verification Queue</strong></li>
                      </ol>
                    </div>
                  </section>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Diagnostics ─────────────────────────────────────────────────── */}
        {activeTab === "diagnostics" && (
          <div className="max-w-2xl space-y-4">
            <div>
              <h2 className="text-sm font-semibold">System Diagnostics</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Backend connectivity, session status, and environment health checks.
              </p>
            </div>
            <SystemDiagnostics />
          </div>
        )}

        {/* ── Analytics ───────────────────────────────────────────────────── */}
        {activeTab === "analytics" && backendOk && (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold">Founder Analytics</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Live usage events, top searches, products viewed, and route requests.
                </p>
              </div>
              <button
                onClick={refreshAnalytics}
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
            {analyticsLoading && (
              <div className="flex justify-center py-12">
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
          </div>
        )}

        {/* ── Price Trust ─────────────────────────────────────────────────── */}
        {activeTab === "price-trust" && (
          <div className="space-y-8">
            {backendOk && (
              <section>
                <h2 className="mb-1 text-sm font-semibold">Price Correction Reports</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  User-reported price corrections awaiting admin review and approval.
                </p>
                <PriceCorrectionsQueue />
              </section>
            )}

            <section>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Price Verification Queue</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Manually verify product prices to upgrade their trust status.
                  </p>
                </div>
                <button
                  onClick={() => setRefreshKey((k) => k + 1)}
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Package className="h-8 w-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No products found.</p>
                </div>
              )}
              {!productsLoading && products.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          </div>
        )}

        {/* ── Mall Data ───────────────────────────────────────────────────── */}
        {activeTab === "mall-data" && backendOk && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Mall Data Compiler</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Research sources and structured findings — raw data only. No live data writes occur here.
              </p>
            </div>
            <MallDataCompiler />
          </div>
        )}

        {/* ── Data Guardian ───────────────────────────────────────────────── */}
        {activeTab === "guardian" && backendOk && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Data Guardian</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Deterministic trust scoring for any data submission. No live data is updated — findings only.
              </p>
            </div>
            <DataGuardian />
          </div>
        )}

        {/* ── Bot Suite ───────────────────────────────────────────────────── */}
        {activeTab === "bots" && backendOk && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Data Intelligence Bot Suite</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Five deterministic bots: source classification, field extraction, duplicate detection,
                review synthesis, and live data apply planning. No AI calls. No live data writes.
              </p>
            </div>
            <DataIntelligenceBots />
          </div>
        )}

        {/* ── Research Batches ─────────────────────────────────────────────── */}
        {activeTab === "research" && backendOk && session?.access_token && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Mall Research Batch Workflow</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Controlled workspace for per-mall data collection. Group findings by mall, review each item,
                and run Data Intelligence Bots before committing anything to live data. No automatic writes
                to shops, products, or mall_nodes.
              </p>
            </div>
            <MallResearchBatches token={session.access_token} />
          </div>
        )}

        {/* ── Backend-required tab but backend not configured ──────────────── */}
        {needsBackend(activeTab) && !backendOk && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <Server className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium">Backend not configured</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Set <code className="font-mono">VITE_GOOGLE_BACKEND_URL</code> in your .env to enable
              this section.
            </p>
            <button
              onClick={() => setActiveTab("diagnostics")}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Go to Diagnostics →
            </button>
          </div>
        )}
      </main>
    </div>
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
