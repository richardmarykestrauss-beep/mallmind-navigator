import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Navigation, Tag, Image as ImgIcon, Loader2, MapPin, Percent, Store } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { cn } from "@/lib/utils";
import { supabase, type BestDeal, type Shop } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";

const BADGE_GRADIENTS = [
  "from-secondary to-primary",
  "from-primary to-primary-glow",
  "from-primary to-secondary",
  "from-secondary to-primary",
];

/** Calculate real discount % from prices; fall back to stored value */
function discountPct(deal: BestDeal): number {
  if (deal.original_price && deal.original_price > deal.price) {
    return Math.round(((deal.original_price - deal.price) / deal.original_price) * 100);
  }
  return Math.round(Number(deal.discount_percent) || 0);
}

const Deals = () => {
  const navigate = useNavigate();
  const { selectedMall, setRouteStops } = useShoppingSession();

  const [active, setActive] = useState("All");
  const [deals, setDeals] = useState<BestDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState<number | null>(null);

  // Load deals — scoped to selected mall when one is chosen
  useEffect(() => {
    const load = async () => {
      setLoading(true);

      let q = supabase
        .from("best_deals")
        .select("product_name, brand, category, shop_name, mall_name, price, original_price, is_on_special, discount_percent, floor, unit_number, price_rank")
        .order("discount_percent", { ascending: false })
        .limit(80);

      if (selectedMall) {
        q = q.eq("mall_name", selectedMall.name);
      }

      const { data } = await q;
      setDeals((data ?? []) as BestDeal[]);
      setActive("All"); // reset filter when mall changes
      setLoading(false);
    };
    load();
  }, [selectedMall]);

  // Derive category chips from loaded data
  const categories = useMemo(() => {
    const seen = new Set<string>();
    deals.forEach((d) => { if (d.category) seen.add(d.category); });
    const cats = Array.from(seen).sort();
    // Add "On Sale" chip only if any items have a real discount
    const hasDiscounts = deals.some((d) => discountPct(d) > 0);
    return ["All", ...cats, ...(hasDiscounts ? ["On Sale"] : [])];
  }, [deals]);

  const filtered = useMemo(() => {
    if (active === "All") return deals;
    if (active === "On Sale") return deals.filter((d) => discountPct(d) > 0);
    return deals.filter((d) => d.category === active);
  }, [deals, active]);

  const handleNavigate = useCallback(async (deal: BestDeal, idx: number) => {
    setNavigating(idx);
    try {
      // Look up the mall by name first to get its id
      const mallName = deal.mall_name ?? selectedMall?.name;
      if (!mallName) {
        navigate(`/search?q=${encodeURIComponent(deal.product_name)}`);
        return;
      }

      const { data: mallRows } = await supabase
        .from("malls")
        .select("id")
        .ilike("name", `%${mallName}%`)
        .limit(1);

      if (!mallRows?.length) {
        navigate(`/search?q=${encodeURIComponent(deal.product_name)}`);
        return;
      }

      const { data: shops } = await supabase
        .from("shops")
        .select("id, mall_id, name, floor, unit_number, category, opening_hours")
        .eq("mall_id", mallRows[0].id)
        .ilike("name", `%${deal.shop_name.split(" ").slice(0, 2).join(" ")}%`)
        .limit(1);

      if (shops?.length) {
        setRouteStops(shops as Shop[]);
        navigate("/navigate");
      } else {
        // Fallback: go to search with the product name pre-filled
        navigate(`/search?q=${encodeURIComponent(deal.product_name)}`);
      }
    } finally {
      setNavigating(null);
    }
  }, [selectedMall, setRouteStops, navigate]);

  return (
    <MobileShell>
      <ScreenHeader
        title="Best Deals"
        subtitle={selectedMall ? `at ${selectedMall.name}` : "Pick a mall to see local deals"}
        back={false}
        right={
          !selectedMall ? (
            <button
              onClick={() => navigate("/malls")}
              className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary"
            >
              <MapPin className="h-3 w-3" />
              Pick Mall
            </button>
          ) : undefined
        }
      />

      {/* Category filter chips */}
      <div className="flex gap-2 px-5 overflow-x-auto scrollbar-hide pb-2 animate-fade-in">
        {categories.map((f) => (
          <button
            key={f}
            onClick={() => setActive(f)}
            className={cn(
              "shrink-0 rounded-full border px-4 h-9 text-sm font-medium transition-all",
              active === f
                ? "bg-primary text-primary-foreground border-primary glow-primary"
                : "border-border bg-surface/60 text-muted-foreground hover:text-foreground"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Deals list */}
      <div className="px-5 mt-3 space-y-3.5 pb-24">
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && !selectedMall && deals.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-12 text-center animate-fade-in">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 border border-border">
              <Tag className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-display font-bold">Select a mall first</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[240px] leading-relaxed">
                Pick your mall to see live specials and deals from stores near you.
              </p>
            </div>
            <button
              onClick={() => navigate("/malls")}
              className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary font-medium"
            >
              <MapPin className="h-4 w-4" />
              Choose a Mall
            </button>
          </div>
        )}

        {!loading && selectedMall && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Tag className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {active === "All"
                ? `No specials found at ${selectedMall.name} right now.`
                : `No ${active} deals at ${selectedMall.name} right now.`
              }
            </p>
          </div>
        )}

        {filtered.map((d, i) => {
          const pct = discountPct(d);
          const hasDiscount = pct > 0;

          return (
            <div
              key={`${d.product_name}-${d.shop_name}-${i}`}
              className="rounded-2xl border border-border bg-surface/80 backdrop-blur overflow-hidden animate-slide-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex gap-3 p-3.5">
                {/* Image placeholder */}
                <div className="relative h-24 w-24 shrink-0 rounded-xl bg-gradient-to-br from-muted to-surface-elevated grid-bg flex items-center justify-center border border-border">
                  <ImgIcon className="h-8 w-8 text-muted-foreground" />
                  {hasDiscount && (
                    <span
                      className={`absolute -top-2 -left-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-gradient-to-br ${BADGE_GRADIENTS[i % BADGE_GRADIENTS.length]} px-2 text-[11px] font-bold text-background shadow-[0_0_15px_hsl(190_100%_50%/0.5)]`}
                    >
                      -{pct}%
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <p className="font-semibold text-sm leading-tight line-clamp-2">{d.product_name}</p>

                  {/* Shop + location */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Store className="h-3 w-3 shrink-0" />
                    <span className="truncate">{d.shop_name}</span>
                  </div>

                  {(d.floor || d.unit_number) && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      <span>
                        {[d.floor ? `Floor ${d.floor}` : null, d.unit_number].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  )}

                  {/* Show mall name when no mall is selected */}
                  {!selectedMall && d.mall_name && (
                    <div className="flex items-center gap-1.5 text-[10px] text-primary/70">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      <span>{d.mall_name}</span>
                    </div>
                  )}

                  {/* Price row */}
                  <div className="mt-auto flex items-end gap-2">
                    <p className="font-display text-xl font-bold leading-none">
                      R{Number(d.price).toLocaleString()}
                    </p>
                    {hasDiscount ? (
                      <div className="flex items-center gap-1.5">
                        {d.original_price && (
                          <span className="text-xs text-muted-foreground line-through">
                            R{Number(d.original_price).toLocaleString()}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary/15 border border-secondary/40 px-2 py-0.5 text-[10px] font-bold text-secondary">
                          <Percent className="h-2.5 w-2.5" />{pct} OFF
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Special
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleNavigate(d, i)}
                disabled={navigating === i}
                className="w-full flex items-center justify-center gap-2 border-t border-border bg-primary/5 hover:bg-primary/10 py-3 text-sm font-semibold text-primary transition-colors disabled:opacity-60"
              >
                {navigating === i
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Navigation className="h-4 w-4" />
                }
                Navigate There
              </button>
            </div>
          );
        })}
      </div>
    </MobileShell>
  );
};

export default Deals;
