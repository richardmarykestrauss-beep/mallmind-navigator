import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navigation, Trophy, Image as ImgIcon, Loader2 } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { cn } from "@/lib/utils";
import { supabase, type BestDeal } from "@/lib/supabaseClient";

const filters = ["All", "Electronics", "Clothing", "Food", "Home"];
const badges = [
  "from-secondary to-primary",
  "from-primary to-primary-glow",
  "from-primary to-secondary",
  "from-secondary to-primary",
];

const Deals = () => {
  const navigate = useNavigate();
  const [active, setActive] = useState("All");
  const [deals, setDeals] = useState<BestDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("best_deals")
        .select("id, product_name, shop_name, price, discount_percentage");
      if (error) setError(error.message);
      else setDeals((data ?? []) as BestDeal[]);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <MobileShell>
      <ScreenHeader title="Best Deals For You" subtitle="Live prices from nearby stores" back={false} />

      {/* Filters */}
      <div className="flex gap-2 px-5 overflow-x-auto scrollbar-hide pb-2 animate-fade-in">
        {filters.map((f) => (
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

      {/* Deals */}
      <div className="px-5 mt-3 space-y-3.5">
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && deals.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">No deals available.</div>
        )}

        {deals.map((d, i) => (
          <div
            key={d.id}
            className="rounded-2xl border border-border bg-surface/80 backdrop-blur overflow-hidden animate-slide-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex gap-3 p-3.5">
              <div className="relative h-24 w-24 shrink-0 rounded-xl bg-gradient-to-br from-muted to-surface-elevated grid-bg flex items-center justify-center border border-border">
                <ImgIcon className="h-8 w-8 text-muted-foreground" />
                <span
                  className={`absolute -top-2 -left-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-gradient-to-br ${badges[i % badges.length]} px-2 text-[11px] font-bold text-background shadow-[0_0_15px_hsl(190_100%_50%/0.5)]`}
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
              onClick={() => navigate("/navigate")}
              className="w-full flex items-center justify-center gap-2 border-t border-border bg-primary/5 hover:bg-primary/10 py-3 text-sm font-semibold text-primary transition-colors"
            >
              <Navigation className="h-4 w-4" />
              Navigate There
            </button>
          </div>
        ))}
      </div>
    </MobileShell>
  );
};

export default Deals;
