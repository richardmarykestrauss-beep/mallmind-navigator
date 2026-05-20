import {
  Store, Navigation, ShoppingBag, CheckCircle2, Clock,
  ShieldCheck, AlertCircle, Zap, Star, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProductResult {
  product_id: string;
  shop_id: string;
  name: string;
  brand: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  discount_pct?: number | null;
  shop_name: string;
  floor: string | null;
  unit_number: string | null;
  is_cheapest?: boolean;
  is_open_now?: boolean | null;
  reason?: string;
  /** Price trust level — from products.data_quality_status */
  data_quality_status?: string | null;
  /** ISO timestamp of last manual verification */
  price_verified_at?: string | null;
  /** Free-text origin, e.g. "Game website", "in-store shelf" */
  data_source?: string | null;
  /** How the price was confirmed */
  price_verification_method?: string | null;
  // ── Sprint 8G: calculated trust fields ──
  trust_label?: string | null;
  trust_level?: "high" | "medium" | "low" | "disputed" | null;
  trust_state?: "verified" | "live" | "expired" | "disputed" | "needs_review" | "sample" | "unknown" | null;
  is_price_expired?: boolean | null;
  has_pending_dispute?: boolean | null;
  price_age_days?: number | null;
  display_warning?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVerifiedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * Resolve the effective trust state for display.
 * Prefers the computed `trust_state` from the backend; falls back to
 * `data_quality_status` for legacy/cached cards.
 */
function resolveTrustState(p: ProductResult): {
  state: ProductResult["trust_state"];
  label: string | null;
} {
  if (p.trust_state) {
    return { state: p.trust_state, label: p.trust_label ?? null };
  }
  switch (p.data_quality_status) {
    case "manually_verified": return { state: "verified",     label: "Verified price"        };
    case "live_feed":         return { state: "live",         label: "Live price"             };
    case "needs_review":      return { state: "needs_review", label: "Needs review"           };
    case "stale":             return { state: "expired",      label: "Verification expired"   };
    default:                  return { state: "sample",       label: "Sample data"            };
  }
}

// ── Trust seal pill ───────────────────────────────────────────────────────────

function TrustSeal({ state, label, price_verified_at, price_age_days }: {
  state: ProductResult["trust_state"];
  label: string | null;
  price_verified_at?: string | null;
  price_age_days?: number | null;
}) {
  if (state === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">
        <ShieldCheck className="h-3 w-3 shrink-0" />
        {label ?? "Verified"}
        {price_verified_at && (
          <span className="opacity-60 ml-0.5">· {formatVerifiedDate(price_verified_at)}</span>
        )}
      </span>
    );
  }
  if (state === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-400">
        <Zap className="h-3 w-3 shrink-0" />
        {label ?? "Live price"}
      </span>
    );
  }
  if (state === "expired") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-500">
        <AlertCircle className="h-3 w-3 shrink-0" />
        {label ?? "Expired"}
        {price_age_days != null && <span className="opacity-70 ml-0.5">· {price_age_days}d ago</span>}
      </span>
    );
  }
  if (state === "disputed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold text-red-400">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        {label ?? "Disputed"}
      </span>
    );
  }
  if (state === "needs_review") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-500">
        <AlertCircle className="h-3 w-3 shrink-0" />
        {label ?? "Needs review"}
      </span>
    );
  }
  // sample / unknown / null
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface/60 px-2.5 py-1 text-[10px] text-muted-foreground/70">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {label ?? "Sample data"}
    </span>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface RecommendationCardProps {
  product: ProductResult;
  onNavigate?: (product: ProductResult) => void;
  onAddToList?: (product: ProductResult) => void;
  compact?: boolean;
  /** Show "Best pick" crown strip at the top of the card */
  isBestPick?: boolean;
}

export default function RecommendationCard({
  product: p,
  onNavigate,
  onAddToList,
  compact = false,
  isBestPick = false,
}: RecommendationCardProps) {
  const hasDiscount = p.is_on_special && p.original_price != null;
  const savings = hasDiscount ? Math.round(p.original_price! - p.price) : null;

  const { state: trustState, label: trustLabel } = resolveTrustState(p);
  const isHighTrust = trustState === "verified" || trustState === "live";

  // Card border and glow vary by pick/cheapest/trust
  const cardBorder = isBestPick
    ? "border-primary/50 shadow-[0_0_0_1px_hsl(190_100%_50%/0.2),0_8px_30px_hsl(190_100%_50%/0.12)]"
    : p.is_cheapest
      ? "border-secondary/45 shadow-[0_0_0_1px_hsl(111_100%_54%/0.15),0_8px_24px_hsl(111_100%_54%/0.08)]"
      : trustState === "disputed"
        ? "border-red-500/35"
        : "border-border/70";

  return (
    <div className={cn(
      "rounded-3xl border bg-surface/60 backdrop-blur overflow-hidden transition-all premium-card",
      cardBorder
    )}>

      {/* ── Best pick strip ──────────────────────────────────────── */}
      {isBestPick && (
        <div className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent border-b border-primary/20">
          <Star className="h-3 w-3 fill-primary text-primary shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Best pick</span>
          {p.is_cheapest && (
            <span className="ml-auto text-[10px] font-normal text-primary/60 normal-case tracking-normal">
              Cheapest in mall
            </span>
          )}
        </div>
      )}

      {/* ── display_warning strip (if set) ───────────────────────── */}
      {p.display_warning && (
        <div className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500/8 border-b border-amber-500/15 text-[10px] text-amber-500/90">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {p.display_warning}
        </div>
      )}

      {/* ── Main body ────────────────────────────────────────────── */}
      <div className="p-3.5 space-y-3">

        {/* Product + Price row */}
        <div className="flex items-start gap-3">
          {/* Store icon */}
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border mt-0.5",
            p.is_cheapest
              ? "bg-secondary/15 border-secondary/30 text-secondary"
              : "bg-primary/10 border-primary/20 text-primary"
          )}>
            <Store className="h-4.5 w-4.5 h-5 w-5" />
          </div>

          {/* Product info */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight line-clamp-2">{p.name}</p>
            {p.brand && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{p.brand}</p>
            )}
          </div>

          {/* Price — dominant, right-aligned */}
          <div className="text-right shrink-0 pl-1">
            {hasDiscount && (
              <p className="text-xs text-muted-foreground line-through leading-none mb-0.5">
                R{p.original_price!.toFixed(0)}
              </p>
            )}
            <p className={cn(
              "font-display font-bold text-[22px] leading-none",
              hasDiscount ? "text-secondary text-glow-secondary" : "text-foreground"
            )}>
              R{p.price.toFixed(0)}
            </p>
            {hasDiscount && savings && (
              <p className="text-[10px] text-secondary/70 mt-0.5">Save R{savings}</p>
            )}
          </div>
        </div>

        {/* Trust seal + cheapest badge row */}
        <div className="flex items-center gap-2 flex-wrap -mt-0.5">
          <TrustSeal
            state={trustState}
            label={trustLabel}
            price_verified_at={p.price_verified_at}
            price_age_days={p.price_age_days}
          />
          {p.is_cheapest && !isBestPick && (
            <span className="inline-flex items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2.5 py-1 text-[10px] font-bold text-secondary">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Cheapest in mall
            </span>
          )}
        </div>

        {/* Location row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">
            {p.shop_name}
          </span>
          <span className="text-muted-foreground/30 text-[10px]">·</span>
          <span className="text-[11px] text-muted-foreground">
            Floor {p.floor ?? "?"} · {p.unit_number ?? "—"}
          </span>
          {p.is_open_now === true && (
            <>
              <span className="text-muted-foreground/30 text-[10px]">·</span>
              <span className="flex items-center gap-0.5 text-[10px] text-green-400 font-medium">
                <Clock className="h-3 w-3" /> Open now
              </span>
            </>
          )}
          {p.is_open_now === false && (
            <>
              <span className="text-muted-foreground/30 text-[10px]">·</span>
              <span className="flex items-center gap-0.5 text-[10px] text-destructive font-medium">
                <Clock className="h-3 w-3" /> Closed
              </span>
            </>
          )}
        </div>

        {/* Reason tag */}
        {p.reason && !compact && (
          <p className="text-[10px] text-muted-foreground/75 italic">{p.reason}</p>
        )}

        {/* Verified source line */}
        {isHighTrust && p.data_source && !compact && (
          <p className="text-[10px] text-emerald-400/60">
            Source: {p.data_source}
          </p>
        )}

        {/* Actions */}
        {!compact && (onNavigate || onAddToList) && (
          <div className="flex items-center gap-2 pt-0.5">
            {onNavigate && (
              <button
                onClick={() => onNavigate(p)}
                className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all glow-primary"
              >
                <Navigation className="h-3.5 w-3.5" />
                Guide me there
              </button>
            )}
            {onAddToList && (
              <button
                onClick={() => onAddToList(p)}
                className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-surface/80 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                List
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
