import { Store, Navigation, ShoppingBag, Tag, CheckCircle2, Clock, ShieldCheck, AlertCircle, Zap, Star, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  // ── Sprint 8G: calculated trust fields (optional — absent on legacy/cached data) ──
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
    year: "numeric",
  });
}

/**
 * Resolve the effective trust state for display.
 * Sprint 8G: prefer the computed `trust_state` field from the backend.
 * Falls back to `data_quality_status` for legacy/cached cards that
 * don't have the new fields yet.
 */
function resolveTrustState(p: ProductResult): {
  state: ProductResult["trust_state"];
  label: string | null;
} {
  // New path: trust_state set by backend priceTrust.ts
  if (p.trust_state) {
    return { state: p.trust_state, label: p.trust_label ?? null };
  }
  // Legacy fallback: derive from data_quality_status
  switch (p.data_quality_status) {
    case "manually_verified": return { state: "verified",      label: "Verified price" };
    case "live_feed":         return { state: "live",          label: "Live price" };
    case "needs_review":      return { state: "needs_review",  label: "Needs review" };
    case "stale":             return { state: "expired",       label: "Verification expired" };
    default:                  return { state: "sample",        label: "Sample data · price may vary" };
  }
}

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

  return (
    <div className={cn(
      "rounded-2xl border bg-surface overflow-hidden transition-all",
      isBestPick
        ? "border-primary/60 shadow-[0_0_14px_hsl(190_100%_50%/0.18)]"
        : p.is_cheapest
          ? "border-secondary/50 shadow-[0_0_12px_hsl(142_70%_45%/0.15)]"
          : trustState === "verified"
            ? "border-emerald-500/40"
            : trustState === "disputed"
              ? "border-amber-500/40"
              : "border-border"
    )}>
      {/* Best pick strip */}
      {isBestPick && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 text-[10px] font-bold uppercase tracking-wider text-primary">
          <Star className="h-3 w-3 fill-primary" />
          Best pick
          {p.is_cheapest && (
            <span className="ml-auto font-normal normal-case tracking-normal">Cheapest in mall</span>
          )}
        </div>
      )}

      {/* Header strip for cheapest/special (when not best pick) */}
      {!isBestPick && (p.is_cheapest || hasDiscount) && (
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider",
          p.is_cheapest ? "bg-secondary/15 text-secondary" : "bg-primary/10 text-primary"
        )}>
          {p.is_cheapest && <CheckCircle2 className="h-3 w-3" />}
          {p.is_cheapest ? "Cheapest in mall" : ""}
          {hasDiscount && savings && (
            <span className={p.is_cheapest ? "ml-auto" : ""}>
              {p.discount_pct ? `${p.discount_pct}% off · ` : ""}Save R{savings}
            </span>
          )}
        </div>
      )}

      {/* ── Trust strip (Sprint 8G) ── */}
      {trustState === "verified" && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-[10px] font-semibold text-emerald-600">
          <ShieldCheck className="h-3 w-3 shrink-0" />
          <span>{trustLabel ?? "Verified price"}</span>
          {p.price_verified_at && (
            <span className="ml-auto font-normal text-emerald-600/70">
              {formatVerifiedDate(p.price_verified_at)}
            </span>
          )}
        </div>
      )}

      {trustState === "live" && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 text-[10px] font-semibold text-blue-500">
          <Zap className="h-3 w-3 shrink-0" />
          <span>{trustLabel ?? "Live price"}</span>
          {p.price_verified_at && (
            <span className="ml-auto font-normal text-blue-500/70">
              {formatVerifiedDate(p.price_verified_at)}
            </span>
          )}
        </div>
      )}

      {trustState === "expired" && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-[10px] font-semibold text-amber-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{trustLabel ?? "Verification expired"}</span>
          {p.price_age_days != null && (
            <span className="ml-auto font-normal text-amber-600/70">{p.price_age_days}d ago</span>
          )}
        </div>
      )}

      {trustState === "disputed" && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-[10px] font-semibold text-red-600">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>{trustLabel ?? "Recently disputed"}</span>
        </div>
      )}

      {trustState === "needs_review" && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-[10px] font-semibold text-amber-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{trustLabel ?? "Needs review"}</span>
        </div>
      )}

      {(trustState === "sample" || trustState === "unknown" || !trustState) && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/8 text-[10px] text-amber-600/80">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{trustLabel ?? "Sample data · price may vary"}</span>
        </div>
      )}

      {/* display_warning line — shown below trust strip when backend adds a caution */}
      {p.display_warning && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/5 text-[10px] text-amber-700/80 border-t border-amber-500/10">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>{p.display_warning}</span>
        </div>
      )}

      {/* Main content */}
      <div className="p-3 space-y-2.5">
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
            <p className="font-semibold text-sm leading-tight truncate">{p.name}</p>
            {p.brand && (
              <p className="text-[11px] text-muted-foreground">{p.brand}</p>
            )}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Tag className="h-3 w-3" />
                {p.shop_name}
              </span>
              <span className="text-muted-foreground/40 text-[10px]">·</span>
              <span className="text-[11px] text-muted-foreground">
                Floor {p.floor ?? "?"} · {p.unit_number ?? "—"}
              </span>
              {p.is_open_now === true && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">·</span>
                  <span className="flex items-center gap-0.5 text-[10px] text-green-500 font-medium">
                    <Clock className="h-3 w-3" /> Open
                  </span>
                </>
              )}
              {p.is_open_now === false && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">·</span>
                  <span className="flex items-center gap-0.5 text-[10px] text-destructive font-medium">
                    <Clock className="h-3 w-3" /> Closed
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Price */}
          <div className="text-right shrink-0">
            {hasDiscount && (
              <p className="text-[10px] text-muted-foreground line-through">
                R{p.original_price!.toFixed(0)}
              </p>
            )}
            <p className={cn(
              "font-display font-bold text-base",
              hasDiscount ? "text-secondary" : "text-foreground"
            )}>
              R{p.price.toFixed(0)}
            </p>
          </div>
        </div>

        {/* Reason tag */}
        {p.reason && !compact && (
          <p className="text-[10px] text-muted-foreground/80 italic px-0.5">{p.reason}</p>
        )}

        {/* Verified source line */}
        {isHighTrust && p.data_source && !compact && (
          <p className="text-[10px] text-emerald-600/70 px-0.5">
            Source: {p.data_source}
          </p>
        )}

        {/* Actions */}
        {!compact && (onNavigate || onAddToList) && (
          <div className="flex items-center gap-2 pt-0.5">
            {onNavigate && (
              <button
                onClick={() => onNavigate(p)}
                className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all glow-primary"
              >
                <Navigation className="h-3.5 w-3.5" />
                Guide me there
              </button>
            )}
            {onAddToList && (
              <button
                onClick={() => onAddToList(p)}
                className="flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl border border-border bg-surface/80 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Add to list
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
