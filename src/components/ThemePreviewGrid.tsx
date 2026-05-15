/**
 * ThemePreviewGrid
 *
 * Displays the 6 MallMind theme swatches in a 3-column grid.
 * Used in the Profile page to preview upcoming theme skins.
 * Purely visual — no theme switching logic yet.
 */

import { THEMES } from "@/lib/themes";
import { Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ThemePreviewGrid() {
  return (
    <div className="px-5 mt-6 animate-fade-in">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Visual themes</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Unlock custom skins in v2.0</p>
        </div>
        <span className="flex items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-[10px] font-semibold text-primary">
          <Sparkles className="h-3 w-3" />
          Preview
        </span>
      </div>

      {/* Theme grid — 3 columns */}
      <div className="grid grid-cols-3 gap-2.5">
        {THEMES.map((theme) => (
          <div
            key={theme.id}
            className={cn(
              "relative rounded-2xl border p-3 transition-all overflow-hidden",
              theme.available
                ? "border-primary/40 bg-primary/5 shadow-[0_0_16px_hsl(190_100%_50%/0.1)]"
                : "border-border/60 bg-surface/40"
            )}
          >
            {/* Color swatches row */}
            <div className="flex gap-1 mb-2.5">
              {[
                theme.colors.background,
                theme.colors.primary,
                theme.colors.secondary,
                theme.colors.surface,
              ].map((color, i) => (
                <div
                  key={i}
                  className="h-4 flex-1 rounded-sm border border-white/10"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            {/* Theme name */}
            <p className={cn(
              "text-[11px] font-semibold leading-tight truncate",
              theme.available ? "text-foreground" : "text-muted-foreground"
            )}>
              {theme.name}
            </p>

            {/* Status tag */}
            <div className="mt-1.5">
              {theme.available ? (
                <span className="flex items-center gap-0.5 text-[9px] font-bold text-primary uppercase tracking-wide">
                  <Sparkles className="h-2.5 w-2.5" />
                  Active
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground/55 uppercase tracking-wide">
                  <Lock className="h-2.5 w-2.5" />
                  Coming soon
                </span>
              )}
            </div>

            {/* Subtle shine on active */}
            {theme.available && (
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/8 to-transparent" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
