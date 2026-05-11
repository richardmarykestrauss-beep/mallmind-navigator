import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import MobileShell from "@/components/MobileShell";
import AdminGuard from "./AdminGuard";
import { Loader2, Store, ShoppingBag, Package, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

interface RecentProduct {
  id: string;
  name: string;
  category: string | null;
  price: number;
  data_quality_status: string | null;
  shops: {
    name: string;
  } | null;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

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
      total: products.length,
      demo: byStatus("demo"),
      manually_verified: byStatus("manually_verified"),
      live_feed: byStatus("live_feed"),
      stale: byStatus("stale"),
      user_submitted: byStatus("user_submitted"),
      needs_review: byStatus("needs_review"),
    },
  };
}

async function fetchRecentProducts(): Promise<RecentProduct[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, price, data_quality_status, shops(name)")
    .limit(10);

  if (error) {
    throw error;
  }

  return (data ?? []) as RecentProduct[];
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

// ── Page ──────────────────────────────────────────────────────────────────────

function AdminDashboardContent() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [recentProducts, setRecentProducts] = useState<RecentProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchCounts(), fetchRecentProducts()])
      .then(([countsData, productsData]) => {
        setCounts(countsData);
        setRecentProducts(productsData);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const formatRand = (amount: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  return (
    <MobileShell hideNav>
      <div className="flex min-h-screen flex-col bg-background">
        {/* Header */}
        <header className="border-b bg-card px-4 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Read-only · MallMind Data Engine</p>
        </header>

        <main className="flex-1 space-y-6 p-4">
          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              Failed to load data: {error}
            </div>
          )}

          {/* Counts */}
          {counts && (
            <>
              {/* Top stat cards */}
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

              {/* Data quality breakdown */}
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Product Data Quality
                </h2>
                <Card>
                  <CardContent className="space-y-3 pt-4">
                    {counts.products.live_feed > 0 && (
                      <QualityRow
                        label="live_feed"
                        count={counts.products.live_feed}
                        total={counts.products.total}
                        color="bg-green-500"
                      />
                    )}
                    {counts.products.manually_verified > 0 && (
                      <QualityRow
                        label="manually_verified"
                        count={counts.products.manually_verified}
                        total={counts.products.total}
                        color="bg-emerald-400"
                      />
                    )}
                    <QualityRow
                      label="demo"
                      count={counts.products.demo}
                      total={counts.products.total}
                      color="bg-yellow-400"
                    />
                    {counts.products.needs_review > 0 && (
                      <QualityRow
                        label="needs_review"
                        count={counts.products.needs_review}
                        total={counts.products.total}
                        color="bg-orange-400"
                      />
                    )}
                    {counts.products.stale > 0 && (
                      <QualityRow
                        label="stale"
                        count={counts.products.stale}
                        total={counts.products.total}
                        color="bg-red-400"
                      />
                    )}
                    {counts.products.user_submitted > 0 && (
                      <QualityRow
                        label="user_submitted"
                        count={counts.products.user_submitted}
                        total={counts.products.total}
                        color="bg-blue-400"
                      />
                    )}

                    {/* Divider + total */}
                    <div className="border-t pt-2">
                      <div className="flex items-center justify-between text-sm font-medium">
                        <span>Total products</span>
                        <span>{counts.products.total}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Recent products */}
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent Products
                </h2>
                <Card>
                  <CardContent className="space-y-3 pt-4">
                    {recentProducts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent products found.</p>
                    ) : (
                      recentProducts.map((product) => (
                        <div
                          key={product.id}
                          className="grid grid-cols-1 gap-2 border-b pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[1fr_auto]"
                        >
                          <div>
                            <p className="text-sm font-medium">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {product.shops?.name ?? "Unknown shop"}
                              {product.category ? ` · ${product.category}` : ""}
                            </p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-sm font-semibold">{formatRand(product.price)}</p>
                            <p className="text-xs text-muted-foreground">
                              {product.data_quality_status ?? "demo"}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </section>

              {/* Next steps hint */}
              <section className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">To promote products to VERIFIED_DATA:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>Run migration <code>007_price_verified_at.sql</code> in Supabase</li>
                  <li>Run migration <code>008_data_quality_fields.sql</code> in Supabase</li>
                  <li>
                    Update a product row:{" "}
                    <code>data_quality_status = 'manually_verified'</code>,{" "}
                    <code>price_verified_at = now()</code>
                  </li>
                </ol>
              </section>
            </>
          )}
        </main>
      </div>
    </MobileShell>
  );
}

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <AdminDashboardContent />
    </AdminGuard>
  );
}
