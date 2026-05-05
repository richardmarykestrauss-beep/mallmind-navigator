/**
 * PriceSubmitModal — "I saw a different price" flow.
 *
 * User taps the button on a product card → enters the price they saw →
 * we insert into price_submissions and award 50 XP.
 */

import { useState } from "react";
import { X, Zap, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase, type Product, type Shop } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { awardXP, XP_REWARDS } from "@/lib/xp";
import { LEVEL_NAMES } from "@/lib/levels";
import { cn } from "@/lib/utils";

interface Props {
  product: Product;
  shop: Shop;
  onClose: () => void;
}

export default function PriceSubmitModal({ product, shop, onClose }: Props) {
  const { user, profile, refreshProfile } = useAuth();
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ xp: number; leveledUp: boolean; newLevel: number; badges: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const parsed = parseFloat(price.replace(/[^0-9.]/g, ""));
    if (isNaN(parsed) || parsed < 1) {
      setError("Enter a valid price (e.g. 49.99)");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Insert price submission
      const { error: insertErr } = await supabase.from("price_submissions").insert({
        product_id: product.id,
        shop_id: shop.id,
        reported_price: parsed,
        user_id: user?.id ?? null,
        source: "user_submission",
      });

      if (insertErr) throw new Error(insertErr.message);

      // Award XP if logged in
      if (user && profile) {
        const result = await awardXP(user.id, XP_REWARDS.PRICE_SUBMIT, profile.xp, profile.level);
        await refreshProfile();
        setDone({
          xp: result.xpGained,
          leveledUp: result.leveledUp,
          newLevel: result.newLevel,
          badges: result.newAchievements,
        });
      } else {
        setDone({ xp: 0, leveledUp: false, newLevel: 1, badges: [] });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-[420px] rounded-3xl border border-border bg-surface shadow-2xl animate-slide-up overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <p className="font-display font-bold text-base">Seen a different price?</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[240px]">
              {product.name} · {shop.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {done ? (
            /* Success state */
            <div className="flex flex-col items-center gap-4 py-4 text-center animate-fade-in">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 border border-primary/30 glow-primary">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="font-display font-bold text-lg">Thanks for helping!</p>
                {user ? (
                  <div className="mt-2 space-y-1">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 border border-secondary/30 px-3 py-1.5">
                      <Zap className="h-3.5 w-3.5 text-secondary" />
                      <span className="text-sm font-bold text-secondary">+{done.xp} XP earned</span>
                    </div>
                    {done.leveledUp && (
                      <p className="text-sm font-medium text-primary animate-pulse">
                        🎉 Level up! You're now a {LEVEL_NAMES[done.newLevel]}
                      </p>
                    )}
                    {done.badges.map((b) => (
                      <p key={b} className="text-sm font-medium text-secondary animate-pulse">
                        🏆 Badge unlocked: {b}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">Sign in to earn XP for submissions</p>
                )}
              </div>
              <Button variant="neon" size="sm" onClick={onClose} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            /* Input state */
            <>
              <div className="mb-4">
                <p className="text-sm text-muted-foreground mb-1">Current price in app</p>
                <p className="font-display text-2xl font-bold text-muted-foreground line-through">
                  R{product.price.toFixed(0)}
                </p>
              </div>

              <div className="mb-4">
                <label className="text-sm font-medium mb-2 block">
                  Price you saw in-store
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">R</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={price}
                    onChange={(e) => { setPrice(e.target.value); setError(null); }}
                    placeholder="0.00"
                    className={cn(
                      "w-full h-14 pl-9 pr-4 rounded-2xl bg-muted border text-lg font-display font-bold",
                      "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all",
                      error ? "border-destructive" : "border-border"
                    )}
                    autoFocus
                  />
                </div>
                {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
              </div>

              {user && (
                <div className="flex items-center gap-2 rounded-xl bg-secondary/10 border border-secondary/20 px-3 py-2 mb-4">
                  <Zap className="h-4 w-4 text-secondary shrink-0" />
                  <p className="text-xs text-secondary font-medium">
                    You'll earn <span className="font-bold">+{XP_REWARDS.PRICE_SUBMIT} XP</span> for this submission
                  </p>
                </div>
              )}

              <Button
                variant="neon"
                size="lg"
                className="w-full"
                onClick={handleSubmit}
                disabled={submitting || !price}
              >
                {submitting
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : <><Zap className="h-5 w-5" /> Submit Price</>
                }
              </Button>
              <p className="text-[10px] text-center text-muted-foreground mt-2">
                3 matching submissions auto-update the listed price
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
