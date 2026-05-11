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
} from "lucide-react";
import {
  verifyProductPrice,
  type PriceVerificationMethod,
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
