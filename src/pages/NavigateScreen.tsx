import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock, Footprints, MapPin, Route as RouteIcon,
  CheckCircle2, Store, ArrowRight, RotateCcw, Search,
  Zap, Layers, ArrowUp, ArrowDown, Navigation
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { awardXP, XP_REWARDS } from "@/lib/xp";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

// ── Fallback estimate (no graph data) ────────────────────────────────────────
function estimateRoute(stops: { floor: string | null }[]): { meters: number; minutes: number } {
  if (!stops.length) return { meters: 0, minutes: 0 };
  let meters = 50;
  const floorOrder: Record<string, number> = { B1: 0, G: 1, L1: 2, L2: 3, L3: 4 };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].floor ?? "G";
    const b = stops[i + 1].floor ?? "G";
    const diff = Math.abs((floorOrder[a] ?? 1) - (floorOrder[b] ?? 1));
    meters += 80 + diff * 40;
  }
  return { meters, minutes: Math.max(1, Math.round(meters / 72)) };
}

const floors = ["G", "L1", "L2", "L3"];

const NavigateScreen = () => {
  const navigate = useNavigate();
  const {
    selectedMall, routeStops, currentStopIndex, advanceStop, resetSession,
    activeRouteSteps, activeRouteId, clearRoute,
  } = useShoppingSession();
  const { user, profile, refreshProfile } = useAuth();

  const [activeFloor, setActiveFloor]         = useState<string>("G");
  const [completedStepIndices, setCompletedStepIndices] = useState<Set<number>>(new Set());
  const [completedStopIndices, setCompletedStopIndices] = useState<Set<number>>(new Set());
  const [xpToast, setXpToast]                 = useState<{ xp: number; leveledUp: boolean; badges: string[] } | null>(null);
  const xpAwardedRef = useRef(false);

  // Use real route steps if available, otherwise fall back to shop-list mode
  const hasRealRoute = activeRouteSteps.length > 0;
  const totalMeters  = hasRealRoute
    ? (activeRouteSteps.at(-1)?.cumulative_meters ?? 0)
    : estimateRoute(routeStops).meters;
  const totalMinutes = hasRealRoute
    ? Math.max(1, Math.round(totalMeters / 72))
    : estimateRoute(routeStops).minutes;

  const allDone = hasRealRoute
    ? completedStepIndices.size >= activeRouteSteps.length
    : (completedStopIndices.size === routeStops.length && routeStops.length > 0);

  // Award XP on completion
  useEffect(() => {
    if (allDone && !xpAwardedRef.current && user && profile) {
      xpAwardedRef.current = true;
      awardXP(user.id, XP_REWARDS.ROUTE_COMPLETE, profile.xp, profile.level).then((result) => {
        refreshProfile();
        setXpToast({ xp: result.xpGained, leveledUp: result.leveledUp, badges: result.newAchievements });
        setTimeout(() => setXpToast(null), 5000);
      });
      trackEvent("route_completed", {
        userId: user.id,
        mallId: selectedMall?.id,
        mallName: selectedMall?.name,
        metadata: { stops: hasRealRoute ? activeRouteSteps.length : routeStops.length, has_real_route: hasRealRoute },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  function markStepDone(idx: number) {
    setCompletedStepIndices((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    // Keep active floor synced
    const nextStep = activeRouteSteps[idx + 1];
    if (nextStep?.floor) setActiveFloor(nextStep.floor);
  }

  function markStopDone(idx: number) {
    setCompletedStopIndices((prev) => {
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

  function handleReset() {
    resetSession();
    clearRoute();
    navigate("/search");
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!hasRealRoute && !routeStops.length) {
    return (
      <MobileShell>
        <ScreenHeader title="Mall Map" subtitle="No active route" />
        <div className="flex flex-col items-center gap-5 px-5 pt-10 text-center animate-fade-in">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <div className="absolute h-20 w-20 rounded-full bg-primary/12 blur-xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
              <RouteIcon className="h-7 w-7 text-primary" />
            </div>
          </div>
          <div>
            <p className="font-display font-semibold text-lg">No Route Yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[240px] leading-relaxed">
              Ask the AI to find products and guide you — it'll build your route automatically.
            </p>
          </div>
          <Button variant="neon" size="lg" className="w-full max-w-xs" onClick={() => navigate("/assistant")}>
            <Navigation className="h-5 w-5" />
            Ask MallMind AI
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate("/search")}>
            <Search className="h-4 w-4" />
            Search Products
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate("/malls")}>
            <MapPin className="h-4 w-4" />
            Choose a Mall
          </Button>
        </div>
      </MobileShell>
    );
  }

  const stopCount = hasRealRoute ? activeRouteSteps.length : routeStops.length;
  const doneCount  = hasRealRoute ? completedStepIndices.size : completedStopIndices.size;
  const currentStepNum = hasRealRoute
    ? Math.min(...([...Array(activeRouteSteps.length).keys()].filter((i) => !completedStepIndices.has(i))))
    : currentStopIndex;

  return (
    <MobileShell>
      <ScreenHeader
        title="Your Route"
        subtitle={selectedMall ? `${selectedMall.name} · ${stopCount} steps` : `${stopCount} steps`}
        right={
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 mr-1"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New
          </button>
        }
      />

      {/* ── Route hero card ──────────────────────────────────────── */}
      <div className="mx-5 mb-3">
        <div className="relative rounded-2xl border border-primary/25 bg-primary/6 backdrop-blur overflow-hidden p-4">
          <div className="pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full bg-primary/12 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 border border-primary/35 glow-primary">
              <Navigation className="h-4.5 w-4.5 h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-primary font-bold">
                {hasRealRoute ? "AI-Optimised Route" : "Mall Navigation"}
              </p>
              <p className="font-display font-bold text-sm mt-0.5">
                {selectedMall?.name ?? "Shopping route"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-display font-bold text-xl leading-none text-primary">
                {doneCount}<span className="text-muted-foreground/40 text-sm">/{stopCount}</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">steps done</p>
            </div>
          </div>
          {/* Mini progress bar */}
          <div className="relative mt-3 h-1 rounded-full bg-primary/15 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary-glow transition-all duration-500"
              style={{ width: stopCount ? `${(doneCount / stopCount) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </div>

      {/* Schematic map */}
      <div className="relative mx-5 h-[200px] rounded-3xl border border-border bg-surface overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-80" />

        {/* Draw dots for each unique floor in the route */}
        {(hasRealRoute ? activeRouteSteps : routeStops).map((item, idx) => {
          const floor = hasRealRoute ? (item as typeof activeRouteSteps[0]).floor : (item as typeof routeStops[0]).floor;
          const total = hasRealRoute ? activeRouteSteps.length : routeStops.length;
          const x = 12 + (idx / Math.max(total - 1, 1)) * 76;
          const y = 15 + (idx % 2 === 0 ? 25 : 55);
          const isDone = hasRealRoute ? completedStepIndices.has(idx) : completedStopIndices.has(idx);
          const isCurrent = idx === currentStepNum;
          return (
            <div key={idx} className="absolute" style={{ left: `${x}%`, top: `${y}%` }}>
              {isCurrent && !isDone && (
                <div className="absolute inset-0 h-4 w-4 rounded-full bg-primary animate-ping opacity-60" />
              )}
              <div className={cn(
                "relative h-4 w-4 rounded-full border-2 border-background flex items-center justify-center",
                isDone ? "bg-muted-foreground" : isCurrent ? "bg-primary glow-primary" : "bg-secondary"
              )}>
                {isDone && <CheckCircle2 className="h-2.5 w-2.5 text-background" />}
              </div>
              {floor && (
                <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground font-medium">
                  {floor}
                </span>
              )}
            </div>
          );
        })}

        {/* Connecting line */}
        {(hasRealRoute ? activeRouteSteps : routeStops).length > 1 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={(hasRealRoute ? activeRouteSteps : routeStops).map((_, idx) => {
                const total = hasRealRoute ? activeRouteSteps.length : routeStops.length;
                const x = 12 + (idx / Math.max(total - 1, 1)) * 76;
                const y = 15 + (idx % 2 === 0 ? 27 : 57);
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
      <div className="mx-5 mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-primary/20 bg-primary/5 backdrop-blur p-3">
        <div className="text-center">
          <Clock className="mx-auto h-4 w-4 text-primary mb-1" />
          <p className="font-display font-bold text-lg leading-none">{totalMinutes}</p>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">min walk</p>
        </div>
        <div className="text-center border-x border-primary/15">
          <Footprints className="mx-auto h-4 w-4 text-secondary mb-1" />
          <p className="font-display font-bold text-lg leading-none">{Math.round(totalMeters)}</p>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">metres</p>
        </div>
        <div className="text-center">
          <MapPin className="mx-auto h-4 w-4 text-primary mb-1" />
          <p className="font-display font-bold text-lg leading-none">{doneCount}<span className="text-muted-foreground/50 text-sm">/{stopCount}</span></p>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">done</p>
        </div>
      </div>

      {/* ── REAL ROUTE STEPS (from build-route) ──────────────────────────────── */}
      {hasRealRoute && (
        <div className="mx-5 mt-3 space-y-2 pb-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground px-1 flex items-center gap-1.5">
            <Navigation className="h-3 w-3" /> Step-by-step directions
          </p>

          {allDone && (
            <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-4 text-center animate-fade-in">
              <p className="font-display font-bold text-secondary">🎉 Route complete!</p>
              <p className="text-xs text-muted-foreground mt-1">All stops visited. Head to your car.</p>
            </div>
          )}

          {activeRouteSteps.map((step, idx) => {
            const isDone = completedStepIndices.has(idx);
            const isCurrent = idx === currentStepNum && !allDone;
            return (
              <div
                key={step.node_id + idx}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-3.5 transition-all animate-slide-up",
                  isDone
                    ? "border-border bg-surface/40 opacity-40"
                    : isCurrent
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-surface/70"
                )}
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                {/* Step number / icon */}
                <div className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold mt-0.5",
                  isDone
                    ? "bg-muted border-border text-muted-foreground"
                    : step.floor_change
                    ? "bg-secondary/20 border-secondary/40 text-secondary"
                    : isCurrent
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-surface border-border text-muted-foreground"
                )}>
                  {isDone
                    ? <CheckCircle2 className="h-4 w-4" />
                    : step.floor_change
                    ? ((activeRouteSteps[idx - 1]?.floor ?? "G") < (step.floor ?? "G")
                        ? <ArrowUp className="h-4 w-4" />
                        : <ArrowDown className="h-4 w-4" />)
                    : step.step
                  }
                </div>

                {/* Step info */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-medium leading-snug",
                    isDone && "line-through text-muted-foreground"
                  )}>
                    {step.instruction}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {step.floor && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Layers className="h-3 w-3" /> Floor {step.floor}
                      </span>
                    )}
                    {step.distance_meters > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        ~{Math.round(step.distance_meters)}m
                      </span>
                    )}
                    {step.floor_change && (
                      <span className="text-[10px] text-secondary font-medium">Floor change</span>
                    )}
                  </div>
                </div>

                {/* Done button */}
                {!isDone && isCurrent && (
                  <button
                    onClick={() => markStepDone(idx)}
                    className="shrink-0 flex items-center gap-1 rounded-xl bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 hover:bg-primary/90 transition-all mt-0.5"
                  >
                    Done <ArrowRight className="h-3 w-3" />
                  </button>
                )}
                {!isDone && !isCurrent && (
                  <button
                    onClick={() => markStepDone(idx)}
                    className="shrink-0 flex items-center justify-center h-8 w-8 rounded-xl border border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-all mt-0.5"
                  >
                    <Store className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── FALLBACK: Shop stop list (when no real route) ─────────────────────── */}
      {!hasRealRoute && (
        <>
          {routeStops[currentStopIndex] && (
            <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-secondary/30 bg-secondary/10 px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-secondary animate-pulse shrink-0" />
              <p className="text-xs font-medium text-secondary">
                {completedStopIndices.size === 0
                  ? `Enter via ${routeStops[currentStopIndex].floor === "G" ? "Ground Floor" : `${routeStops[currentStopIndex].floor} entrance`} · Start at ${routeStops[currentStopIndex].name}`
                  : allDone
                  ? "All stops complete! Head to your car."
                  : `Next: Floor ${routeStops[currentStopIndex].floor} · ${routeStops[currentStopIndex].name}`}
              </p>
            </div>
          )}

          <div className="mx-5 mt-3 space-y-2 pb-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground px-1">Stops in order</p>
            {routeStops.map((stop, idx) => {
              const isDone = completedStopIndices.has(idx);
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
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold",
                    isDone ? "bg-muted border-border text-muted-foreground"
                    : isCurrent ? "bg-primary border-primary text-primary-foreground"
                    : "bg-surface border-border text-muted-foreground"
                  )}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium text-sm truncate", isDone && "line-through")}>
                      {stop.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Floor {stop.floor ?? "?"} · Unit {stop.unit_number ?? "—"}
                      {stop.category ? ` · ${stop.category}` : ""}
                    </p>
                  </div>
                  {!isDone && (
                    <button
                      onClick={() => markStopDone(idx)}
                      className={cn(
                        "shrink-0 flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium transition-all",
                        isCurrent
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
                      )}
                    >
                      {isCurrent ? <><span>Done</span><ArrowRight className="h-3 w-3" /></> : <Store className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* XP toast */}
      {xpToast && (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-2xl border border-secondary/40 bg-secondary/15 px-4 py-3 animate-slide-up">
          <Zap className="h-4 w-4 text-secondary shrink-0" />
          <div>
            <p className="text-sm font-bold text-secondary">+{xpToast.xp} XP — Route Complete!</p>
            {xpToast.leveledUp && <p className="text-xs text-primary font-medium animate-pulse">🎉 Level up!</p>}
            {xpToast.badges.map((b) => (
              <p key={b} className="text-xs text-secondary font-medium">🏆 Badge: {b}</p>
            ))}
          </div>
        </div>
      )}

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
