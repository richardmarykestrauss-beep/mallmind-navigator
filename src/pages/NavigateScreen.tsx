import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock, Footprints, MapPin, Route as RouteIcon,
  CheckCircle2, Store, ArrowRight, RotateCcw, Search
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { cn } from "@/lib/utils";

const floors = ["G", "L1", "L2", "L3"];

// Rough walking estimates: ~80m per floor level, ~1.2m/s walking speed
function estimateRoute(stops: { floor: string | null }[]): { meters: number; minutes: number } {
  if (!stops.length) return { meters: 0, minutes: 0 };
  let meters = 50; // entry walk
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].floor ?? "G";
    const b = stops[i + 1].floor ?? "G";
    const floorOrder: Record<string, number> = { B1: 0, G: 1, L1: 2, L2: 3, L3: 4 };
    const floorDiff = Math.abs((floorOrder[a] ?? 1) - (floorOrder[b] ?? 1));
    meters += 80 + floorDiff * 40;
  }
  return { meters, minutes: Math.round(meters / 72) }; // ~72m/min walking
}

const NavigateScreen = () => {
  const navigate = useNavigate();
  const { selectedMall, routeStops, currentStopIndex, advanceStop, resetSession } = useShoppingSession();
  const [activeFloor, setActiveFloor] = useState<string>("G");
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());

  const { meters, minutes } = estimateRoute(routeStops);
  const currentStop = routeStops[currentStopIndex];
  const allDone = completedIndices.size === routeStops.length && routeStops.length > 0;

  function markDone(idx: number) {
    setCompletedIndices((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    if (idx === currentStopIndex && currentStopIndex < routeStops.length - 1) {
      advanceStop();
      const nextFloor = routeStops[currentStopIndex + 1]?.floor;
      if (nextFloor) setActiveFloor(nextFloor);
    }
  }

  // No active session
  if (!routeStops.length) {
    return (
      <MobileShell>
        <ScreenHeader title="Mall Map" subtitle="No active route" />
        <div className="flex flex-col items-center gap-5 px-5 pt-10 text-center animate-fade-in">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/30 border border-border">
            <RouteIcon className="h-9 w-9 text-muted-foreground" />
          </div>
          <div>
            <p className="font-display font-bold text-lg">No Route Yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[240px] leading-relaxed">
              Search for items, select stores, and your optimised route will appear here.
            </p>
          </div>
          <Button variant="neon" size="lg" className="w-full max-w-xs" onClick={() => navigate("/search")}>
            <Search className="h-5 w-5" />
            Find & Compare Items
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate("/malls")}>
            <MapPin className="h-4 w-4" />
            Choose a Mall
          </Button>
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      <ScreenHeader
        title="Your Route"
        subtitle={
          selectedMall
            ? `${selectedMall.name} · ${routeStops.length} stops`
            : `${routeStops.length} stops`
        }
        right={
          <button
            onClick={() => { resetSession(); navigate("/search"); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 mr-1"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New
          </button>
        }
      />

      {/* Map area */}
      <div className="relative mx-5 h-[220px] rounded-3xl border border-border bg-surface overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-80" />
        <div className="absolute inset-0 p-5 grid grid-cols-4 grid-rows-4 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-lg bg-muted/40 border border-border" />
          ))}
        </div>

        {/* Route dots for each stop */}
        {routeStops.map((stop, idx) => {
          const x = 15 + (idx / Math.max(routeStops.length - 1, 1)) * 70;
          const y = 20 + (idx % 2 === 0 ? 30 : 55);
          const isDone = completedIndices.has(idx);
          const isCurrent = idx === currentStopIndex;
          return (
            <div
              key={String(stop.id)}
              className="absolute"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {isCurrent && !isDone && (
                <div className="absolute inset-0 h-4 w-4 rounded-full bg-primary animate-ping opacity-60" />
              )}
              <div className={cn(
                "relative h-4 w-4 rounded-full border-2 border-background flex items-center justify-center",
                isDone ? "bg-muted-foreground" : isCurrent ? "bg-primary glow-primary" : "bg-secondary"
              )}>
                {isDone && <CheckCircle2 className="h-2.5 w-2.5 text-background" />}
              </div>
            </div>
          );
        })}

        {/* SVG connecting line */}
        {routeStops.length > 1 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={routeStops.map((_, idx) => {
                const x = 15 + (idx / Math.max(routeStops.length - 1, 1)) * 70;
                const y = 20 + (idx % 2 === 0 ? 32 : 57);
                return `${x},${y}`;
              }).join(" ")}
              stroke="hsl(var(--primary))"
              strokeWidth="0.8"
              strokeDasharray="2 2"
              fill="none"
              style={{ filter: "drop-shadow(0 0 3px hsl(var(--primary)))" }}
            />
          </svg>
        )}

        {/* Floor selector */}
        <div className="absolute right-3 top-3 flex flex-col gap-1.5 rounded-2xl border border-border bg-background/80 backdrop-blur p-1.5">
          {floors.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFloor(f)}
              className={cn(
                "h-8 w-8 rounded-xl text-xs font-bold transition-all",
                activeFloor === f
                  ? "bg-primary text-primary-foreground glow-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="mx-5 mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-border bg-surface p-3">
        <div className="text-center">
          <Clock className="mx-auto h-4 w-4 text-primary mb-1" />
          <p className="font-display font-bold text-base">{minutes} min</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Walk</p>
        </div>
        <div className="text-center border-x border-border">
          <Footprints className="mx-auto h-4 w-4 text-secondary mb-1" />
          <p className="font-display font-bold text-base">{meters}m</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Distance</p>
        </div>
        <div className="text-center">
          <MapPin className="mx-auto h-4 w-4 text-primary mb-1" />
          <p className="font-display font-bold text-base">{completedIndices.size}/{routeStops.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Done</p>
        </div>
      </div>

      {/* Entrance recommendation */}
      {currentStop && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-secondary/30 bg-secondary/10 px-3 py-2">
          <div className="h-2 w-2 rounded-full bg-secondary animate-pulse shrink-0" />
          <p className="text-xs font-medium text-secondary">
            {completedIndices.size === 0
              ? `Enter via ${currentStop.floor === "G" ? "Ground Floor" : `${currentStop.floor} entrance`} · Start at ${currentStop.name}`
              : allDone
              ? "All stops complete! Head to your car."
              : `Next: Floor ${currentStop.floor} · ${currentStop.name}`}
          </p>
        </div>
      )}

      {/* Stop list */}
      <div className="mx-5 mt-3 space-y-2 pb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground px-1">Stops in order</p>
        {routeStops.map((stop, idx) => {
          const isDone = completedIndices.has(idx);
          const isCurrent = idx === currentStopIndex && !isDone;
          return (
            <div
              key={String(stop.id)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-4 transition-all animate-slide-up",
                isDone
                  ? "border-border bg-surface/40 opacity-50"
                  : isCurrent
                  ? "border-primary/50 bg-primary/10 glow-primary"
                  : "border-border bg-surface/70"
              )}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              {/* Step number */}
              <div className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold",
                isDone
                  ? "bg-muted border-border text-muted-foreground"
                  : isCurrent
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-surface border-border text-muted-foreground"
              )}>
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>

              {/* Stop info */}
              <div className="flex-1 min-w-0">
                <p className={cn("font-medium text-sm truncate", isDone && "line-through")}>
                  {stop.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Floor {stop.floor ?? "?"} · Unit {stop.unit_number ?? "—"}
                  {stop.category ? ` · ${stop.category}` : ""}
                </p>
              </div>

              {/* Action */}
              {!isDone && (
                <button
                  onClick={() => markDone(idx)}
                  className={cn(
                    "shrink-0 flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium transition-all",
                    isCurrent
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
                  )}
                >
                  {isCurrent ? (
                    <>Done <ArrowRight className="h-3 w-3" /></>
                  ) : (
                    <Store className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Return to car CTA */}
      {allDone && (
        <div className="px-5 pb-6 animate-slide-up">
          <Button variant="neonGreen" size="lg" className="w-full" onClick={() => navigate("/parking")}>
            <MapPin className="h-5 w-5" />
            Return to My Car
          </Button>
        </div>
      )}
    </MobileShell>
  );
};

export default NavigateScreen;
