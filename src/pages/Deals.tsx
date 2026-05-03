import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Navigation, Trophy, Image as ImgIcon, Loader2, MapPin, Tag } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { cn } from "@/lib/utils";
import { supabase, type BestDeal, type Shop } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";

// Keyword-based client-side category filter
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Electronics: ["tv", "phone", "laptop", "headphone", "playstation", "samsung", "apple", "sony", "hisense", "airpod", "speaker", "iphone", "galaxy", "xbox"],
  Clothing: ["shoe", "sneaker", "dress", "jean", "jacket", "shirt", "boot", "nike", "adidas", "puma", "cotton on", "zara"],
  Food: ["food", "grocery", "woolworths", "checkers", "pick n pay", "coffee", "bread", "milk"],
  Home: ["home", "furniture", "appliance", "bed", "couch", "kettle", "pot", "towel"],
};

const FILTERS = ["All", "Electronics", "Clothing", "Food", "Home"];

const BADGE_GRADIENTS = [
  "from-secondary to-primary",
  "from-primary to-primary-glow",
  "from-primary to-secondary",
  "from-secondary to-primary",
];

function matchesCategory(deal: BestDeal, category: string): boolean {
  if (category === "All") return true;
  const keywords = CATEGORY_KEYWORDS[category] ?? [];
  const haystack = `${deal.product_name} ${deal.shop_name}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

const Deals = () => {
  const navigate = useNavigate();
  const { selectedMall, setRouteStops } = useShoppingSession();

  const [active, setActive] = useState("All");
  const [deals, setDeals] = useState<BestDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState<string | number | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("best_deals")
        .select("id, product_name, shop_name, price, discount_percentage")
        .order("discount_percentage", { ascending: false });
      setDeals((data ?? []) as BestDeal[]);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = deals.filter((d) => matchesCategory(d, active));

  const handleNavigate = useCallback(async (deal: BestDeal) => {
    setNavigating(deal.id);
    try {
      // Find the shop by name (scoped to selected mall if one is chosen)
      let q = supabase
        .from("shops")
        .select("id, mall_id, name, floor, unit_number, category, opening_hours")
        .ilike("name", `%${deal.shop_name}%`)
        .limit(1);

      if (selectedMall) q = q.eq("mall_id", selectedMall.id);

      const { data: shops } = await q;

      if (shops?.length) {
        setRouteStops(shops as Shop[]);
        navigate("/navigate");
      } else {
        // Fallback: go to search pre-filled with product name
        navigate(`/search?q=${encodeURIComponent(deal.product_name)}`);
      }
    } finally {
      setNavigating(null);
    }
  }, [selectedMall, setRouteStops, navigate]);

  return (
    <MobileShell>
      <ScreenHeader
        title="Best Deals For You"
        subtitle={selectedMall ? `at ${selectedMall.name}` : "All malls"}
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

      {/* Filters */}
      <div className="flex gap-2 px-5 overflow-x-auto scrollbar-hide pb-2 animate-fade-in">
        {FILTERS.map((f) => (
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

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Tag className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {active === "All" ? "No deals available right now." : `No ${active} deals right now.`}
            </p>
          </div>
        )}

        {filtered.map((d, i) => (
          <div
            key={d.id}
            className="rounded-2xl border border-border bg-surface/80 backdrop-blur overflow-hidden animate-slide-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex gap-3 p-3.5">
              {/* Image placeholder */}
              <div className="relative h-24 w-24 shrink-0 rounded-xl bg-gradient-to-br from-muted to-surface-elevated grid-bg flex items-center justify-center border border-border">
                <ImgIcon className="h-8 w-8 text-muted-foreground" />
                <span
                  className={`absolute -top-2 -left-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-gradient-to-br ${BADGE_GRADIENTS[i % BADGE_GRADIENTS.length]} px-2 text-[11px] font-bold text-background shadow-[0_0_15px_hsl(190_100%_50%/0.5)]`}
                >
                  #{i + 1}
                </span>
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <p className="font-semibold text-sm leading-tight line-clamp-2">{d.product_name}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                    <Trophy className="h-2.5 w-2.5 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground">{d.shop_name}</span>
                </div>
                <div className="mt-auto flex items-end justify-between">
                  <div>
                    <p className="font-display text-xl font-bold leading-none">
                      R{Number(d.price).toLocaleString()}
                    </p>
                    <span className="mt-1.5 inline-block rounded-full bg-secondary/15 border border-secondary/40 px-2 py-0.5 text-[10px] font-bold text-secondary">
                      {Number(d.discount_percentage)}% OFF
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => handleNavigate(d)}
              disabled={navigating === d.id}
              className="w-full flex items-center justify-center gap-2 border-t border-border bg-primary/5 hover:bg-primary/10 py-3 text-sm font-semibold text-primary transition-colors disabled:opacity-60"
            >
              {navigating === d.id
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Navigation className="h-4 w-4" />
              }
              Navigate There
            </button>
          </div>
        ))}
      </div>
    </MobileShell>
  );
};

export default Deals;
