import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, MapPin, Route as RouteIcon, ShoppingBag,
  Tag, CheckCircle2, Loader2, Store, ChevronRight, X, Zap
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { supabase, type Product, type Shop } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import PriceSubmitModal from "@/components/PriceSubmitModal";
import PriceAlertButton from "@/components/PriceAlertButton";
import { trackSearch } from "@/lib/analytics";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const FLOOR_ORDER: Record<string, number> = { B1: 0, G: 1, L1: 2, L2: 3, L3: 4, L4: 5 };

function sortShopsByFloor(a: Shop, b: Shop): number {
  const aOrd = FLOOR_ORDER[a.floor ?? ""] ?? 99;
  const bOrd = FLOOR_ORDER[b.floor ?? ""] ?? 99;
  if (aOrd !== bOrd) return aOrd - bOrd;
  return (a.unit_number ?? "").localeCompare(b.unit_number ?? "");
}

interface ProductMatch {
  product: Product & { data_quality_status?: string | null; price_verified_at?: string | null };
  shop: Shop;
  effectivePrice: number;
}

interface ProductGroup {
  name: string;
  matches: ProductMatch[];
}

const SUGGESTIONS = [
  "TV", "Sneakers", "Laptop", "Jeans", "Headphones",
  "Dress", "Perfume", "Watch", "Boots", "Jacket",
];

const SearchPage = () => {
  const navigate = useNavigate();
  const { selectedMall, routeStops, setRouteStops } = useShoppingSession();
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [selectedShopIds, setSelectedShopIds] = useState<Set<string | number>>(new Set());
  const [priceSubmit, setPriceSubmit] = useState<{ product: Product; shop: Shop } | null>(null);

  // Debounce search input 400ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const fetchProducts = useCallback(async (q: string) => {
    if (!selectedMall || q.length < 2) {
      setGroups([]);
      return;
    }
    setLoading(true);
    try {
      // Get shops for this mall first
      const { data: shopData, error: shopErr } = await supabase
        .from("shops")
        .select("id, mall_id, name, floor, unit_number, category, opening_hours")
        .eq("mall_id", selectedMall.id);

      if (shopErr || !shopData?.length) {
        setGroups([]);
        setLoading(false);
        return;
      }

      const shopIds = shopData.map((s) => s.id);
      const shopMap = Object.fromEntries(shopData.map((s) => [String(s.id), s]));

      // Get matching products from those shops
      const { data: productData, error: prodErr } = await supabase
        .from("products")
        .select("id, shop_id, mall_id, name, category, brand, model, price, original_price, is_on_special, in_stock, verified, data_quality_status, price_verified_at")
        .in("shop_id", shopIds)
        .ilike("name", `%${q}%`)
        .eq("in_stock", true)
        .order("price", { ascending: true });

      if (prodErr || !productData?.length) {
        setGroups([]);
        setLoading(false);
        return;
      }

      // Group by product name
      const grouped = new Map<string, ProductMatch[]>();
      for (const p of productData) {
        const shop = shopMap[String(p.shop_id)] as Shop;
        if (!shop) continue;
        const effectivePrice = p.is_on_special && p.original_price != null ? p.price : p.price;
        const key = p.name.toLowerCase();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push({ product: p as Product, shop, effectivePrice });
      }

      // Sort each group cheapest first
      const result: ProductGroup[] = [];
      for (const [, matches] of grouped) {
        matches.sort((a, b) => a.effectivePrice - b.effectivePrice);
        result.push({ name: matches[0].product.name, matches });
      }
      setGroups(result);
      // Track search event (fire-and-forget)
      trackSearch(q, result.length, selectedMall?.id, selectedMall?.name, user?.id);
    } finally {
      setLoading(false);
    }
  }, [selectedMall, user?.id]);

  useEffect(() => {
    fetchProducts(debouncedQuery);
  }, [debouncedQuery, fetchProducts]);

  function toggleShop(shopId: string | number) {
    setSelectedShopIds((prev) => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  }

  function buildRoute() {
    // Collect unique selected shops, sorted by floor
    const shopMap = new Map<string, Shop>();
    for (const g of groups) {
      for (const m of g.matches) {
        if (selectedShopIds.has(m.shop.id)) {
          shopMap.set(String(m.shop.id), m.shop);
        }
      }
    }
    const sorted = [...shopMap.values()].sort(sortShopsByFloor);
    setRouteStops(sorted);
    navigate("/navigate");
  }

  const hasStops = selectedShopIds.size > 0;

  return (
    <MobileShell>
      <ScreenHeader
        title="Find & Compare"
        subtitle={selectedMall ? `${selectedMall.name}` : "Select a mall first"}
        right={
          selectedMall ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary">
              <MapPin className="h-3 w-3" />
              {selectedMall.city ?? selectedMall.name}
            </div>
          ) : undefined
        }
      />

      <div className="px-5 space-y-4 animate-fade-in">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you looking for?"
            className="w-full h-12 pl-11 pr-10 rounded-2xl bg-surface/60 backdrop-blur border border-border/80 text-sm focus:outline-none focus:border-primary/50 focus:bg-surface focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.12)] transition-all"
            autoFocus
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setGroups([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Suggestions — horizontal scroll chips */}
        {!query && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2.5 px-1">
              Popular searches
            </p>
            <div
              className="overflow-x-auto scrollbar-hide -mx-5 px-5 pb-1"
            >
              <div className="flex gap-2 w-max">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setQuery(s)}
                    className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-4 py-2 text-xs font-medium text-primary/90 hover:bg-primary/15 hover:border-primary/40 whitespace-nowrap transition-all active:scale-95 shrink-0"
                  >
                    <Tag className="h-3 w-3 shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* No mall selected */}
        {!selectedMall && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/30 border border-border">
              <Store className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground max-w-[220px] leading-relaxed">
              Select a mall first so we know which stores to search.
            </p>
            <Button variant="glass" size="sm" onClick={() => navigate("/malls")}>
              Choose a Mall
            </Button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {/* No results */}
        {!loading && debouncedQuery.length >= 2 && groups.length === 0 && selectedMall && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingBag className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No products found for <span className="text-foreground font-medium">"{debouncedQuery}"</span>
              <br />in {selectedMall.name}.
            </p>
            <p className="text-xs text-muted-foreground">Try a different search term.</p>
          </div>
        )}

        {/* Product groups */}
        {!loading && groups.map((group) => (
          <div
            key={group.name}
            className="rounded-3xl border border-primary/15 bg-surface/60 backdrop-blur overflow-hidden animate-slide-up shadow-[0_4px_20px_hsl(0_0%_0%/0.2)]"
          >
            {/* Group header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-gradient-to-r from-primary/8 to-transparent">
              <ShoppingBag className="h-4 w-4 text-primary shrink-0" />
              <span className="font-display font-bold text-sm">{group.name}</span>
              {group.matches.length > 1 && (
                <span className="ml-auto text-[9px] uppercase tracking-wider text-secondary bg-secondary/10 border border-secondary/25 rounded-full px-2.5 py-0.5 font-bold">
                  {group.matches.length} stores
                </span>
              )}
            </div>

            <div className="divide-y divide-border/40">
              {group.matches.map((m, idx) => {
                const isSelected = selectedShopIds.has(m.shop.id);
                const isCheapest = idx === 0 && group.matches.length > 1;
                return (
                  <div
                    key={`${m.product.id}`}
                    className={cn(
                      "flex flex-col transition-all",
                      isSelected
                        ? "bg-primary/8 border-l-2 border-l-primary"
                        : "hover:bg-muted/20"
                    )}
                  >
                    {/* Main tap row */}
                    <button
                      onClick={() => toggleShop(m.shop.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                    >
                      {/* Store icon */}
                      <div className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all",
                        isSelected
                          ? "bg-primary/20 border-primary/40 text-primary"
                          : "bg-surface/80 border-border text-muted-foreground"
                      )}>
                        <Store className="h-4 w-4" />
                      </div>

                      {/* Store + floor info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{m.shop.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Floor {m.shop.floor ?? "?"} · Unit {m.shop.unit_number ?? "—"}
                        </p>
                      </div>

                      {/* Price */}
                      <div className="text-right shrink-0 pl-2">
                        {m.product.is_on_special && m.product.original_price != null && (
                          <p className="text-xs text-muted-foreground line-through leading-none mb-0.5">
                            R{m.product.original_price.toFixed(0)}
                          </p>
                        )}
                        <p className={cn(
                          "font-display font-bold text-lg leading-none",
                          m.product.is_on_special ? "text-secondary" : "text-foreground"
                        )}>
                          R{m.effectivePrice.toFixed(0)}
                        </p>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {isCheapest && (
                            <span className="text-[9px] uppercase tracking-wide text-secondary font-bold">
                              Cheapest
                            </span>
                          )}
                          {(m.product.data_quality_status === "manually_verified" ||
                            m.product.data_quality_status === "live_feed") && (
                            <span className="text-[9px] text-emerald-400 font-semibold">✓</span>
                          )}
                        </div>
                      </div>

                      {/* Selected indicator */}
                      {isSelected
                        ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0 ml-1" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 ml-1" />
                      }
                    </button>

                    {/* Price submit nudge + alert bell */}
                    <div className="px-4 pb-2.5 flex items-center justify-between">
                      <button
                        onClick={() => setPriceSubmit({ product: m.product, shop: m.shop })}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-secondary transition-colors"
                      >
                        <Zap className="h-3 w-3" />
                        Seen a different price? +50 XP
                      </button>
                      <PriceAlertButton productId={String(m.product.id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Spacer for the sticky CTA */}
        {hasStops && <div className="h-20" />}
      </div>

      {/* Sticky route builder */}
      {hasStops && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-[420px] px-5 z-20 animate-slide-up">
          <Button
            variant="neon"
            size="lg"
            className="w-full shadow-2xl"
            onClick={buildRoute}
          >
            <RouteIcon className="h-5 w-5" />
            Navigate {selectedShopIds.size} Stop{selectedShopIds.size !== 1 ? "s" : ""}
          </Button>
        </div>
      )}

      {/* Already-built route reminder */}
      {routeStops.length > 0 && !hasStops && (
        <div className="px-5 pb-4">
          <button
            onClick={() => navigate("/navigate")}
            className="w-full flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm hover:bg-primary/15 transition-colors"
          >
            <div className="flex items-center gap-2 text-primary">
              <RouteIcon className="h-4 w-4" />
              <span className="font-medium">Resume route · {routeStops.length} stops</span>
            </div>
            <ChevronRight className="h-4 w-4 text-primary" />
          </button>
        </div>
      )}

      {/* Price submit modal */}
      {priceSubmit && (
        <PriceSubmitModal
          product={priceSubmit.product}
          shop={priceSubmit.shop}
          onClose={() => setPriceSubmit(null)}
        />
      )}
    </MobileShell>
  );
};

export default SearchPage;
