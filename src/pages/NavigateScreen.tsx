import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock, Footprints, MapPin, Route as RouteIcon,
  CheckCircle2, Store, ArrowRight, RotateCcw, Search,
  Zap, Layers, ArrowUp, ArrowDown, Navigation,
  LocateFixed, Flag, Radar
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

const floors = ["G", "L1", "L2", "L3", "L4", "L5"];

function normalizeFloor(floor: string | null | undefined): string {
  if (!floor) return "G";
  const trimmed = String(floor).trim();
  const levelMatch = trimmed.match(/^Level\s+(\d+)$/i);
  if (levelMatch) return `L${levelMatch[1]}`;
  return trimmed;
}

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
  const [isAutoTracking, setIsAutoTracking]   = useState(false);
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
    ? (() => {
        const nextIdx = activeRouteSteps.findIndex((_, i) => !completedStepIndices.has(i));
        return nextIdx === -1 ? Math.max(activeRouteSteps.length - 1, 0) : nextIdx;
      })()
    : Math.min(currentStopIndex, Math.max(routeStops.length - 1, 0));

  const safeCurrentStepNum =
    Number.isFinite(currentStepNum)
      ? Math.min(Math.max(currentStepNum, 0), Math.max(stopCount - 1, 0))
      : Math.max(stopCount - 1, 0);

  const mapSource = hasRealRoute ? activeRouteSteps : routeStops;
  const mapPoints = mapSource.map((item, idx) => {
    const total = Math.max(mapSource.length - 1, 1);
    const progress = idx / total;

    const fallbackPath = [
      { x: 12, y: 78 },
      { x: 24, y: 62 },
      { x: 39, y: 62 },
      { x: 51, y: 44 },
      { x: 66, y: 44 },
      { x: 78, y: 30 },
      { x: 88, y: 30 },
    ];

    const p = fallbackPath[idx] ?? { x: 12 + progress * 76, y: 78 - progress * 48 };
    const anyItem = item as any;
    const rawX = Number(anyItem.x_coordinate ?? anyItem.x ?? anyItem.map_x);
    const rawY = Number(anyItem.y_coordinate ?? anyItem.y ?? anyItem.map_y);
    const hasRealCoords = Number.isFinite(rawX) && Number.isFinite(rawY);

    return {
      x: hasRealCoords ? Math.max(4, Math.min(96, rawX)) : p.x,
      y: hasRealCoords ? Math.max(4, Math.min(96, rawY)) : p.y,
      floor: normalizeFloor(anyItem.floor ?? "G"),
      instruction: hasRealRoute
        ? anyItem.instruction
        : `Go to ${anyItem.name ?? "next stop"}`,
      label: hasRealRoute
        ? (anyItem.node_name ?? anyItem.instruction ?? `Step ${idx + 1}`)
        : (anyItem.name ?? `Stop ${idx + 1}`),
      cumulativeMeters: Number(anyItem.cumulative_meters ?? 0),
    };
  });

  const currentMapPoint = mapPoints[safeCurrentStepNum];
  const destinationMapPoint = mapPoints[mapPoints.length - 1];
  const routePolyline = mapPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const completedPolyline = mapPoints.slice(0, Math.max(1, safeCurrentStepNum + 1)).map((p) => `${p.x},${p.y}`).join(" ");
  const remainingMeters = hasRealRoute
    ? Math.max(0, Math.round(totalMeters - (currentMapPoint?.cumulativeMeters ?? 0)))
    : Math.max(0, Math.round(totalMeters * (1 - (doneCount / Math.max(stopCount, 1)))));

  // Auto Tracking Demo Mode:
  // Moves the on-map position along real backend route nodes automatically.
  // Manual tapping remains available as a correction/fallback.
  useEffect(() => {
    if (!hasRealRoute || !isAutoTracking || allDone || stopCount <= 0) return;

    const timer = window.setTimeout(() => {
      markStepDone(safeCurrentStepNum);
    }, 2600);

    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealRoute, isAutoTracking, allDone, safeCurrentStepNum, stopCount]);

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

      {/* Virtual Indoor GPS map */}
      <div className="relative mx-5 h-[430px] overflow-hidden rounded-[2rem] border border-primary/25 bg-surface shadow-2xl">
        <div className="absolute inset-0 grid-bg opacity-80" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_85%_75%,rgba(14,165,233,0.16),transparent_32%)]" />

        {/* Simplified indoor mall blocks */}
        <div className="absolute left-[6%] top-[12%] h-[22%] w-[25%] rounded-2xl border border-border/70 bg-background/40 backdrop-blur-sm" />
        <div className="absolute right-[8%] top-[12%] h-[22%] w-[27%] rounded-2xl border border-border/70 bg-background/40 backdrop-blur-sm" />
        <div className="absolute left-[7%] bottom-[13%] h-[24%] w-[28%] rounded-2xl border border-border/70 bg-background/40 backdrop-blur-sm" />
        <div className="absolute right-[7%] bottom-[14%] h-[26%] w-[29%] rounded-2xl border border-border/70 bg-background/40 backdrop-blur-sm" />
        <div className="absolute left-[36%] top-[34%] h-[28%] w-[28%] rounded-3xl border border-primary/15 bg-primary/5 backdrop-blur-sm" />

        {/* Route line */}
        {mapPoints.length > 1 && (
          <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={routePolyline}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity="0.28"
              strokeWidth="4.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={routePolyline}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeOpacity="0.35"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1 6"
            />
            <polyline
              points={completedPolyline}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="4.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: "drop-shadow(0 0 5px hsl(var(--primary)))" }}
            />
          </svg>
        )}

        {/* Pins and current position */}
        {mapPoints.map((point, idx) => {
          const isCurrent = idx === safeCurrentStepNum && !allDone;
          const isDone = hasRealRoute ? completedStepIndices.has(idx) : completedStopIndices.has(idx);
          const isDestination = idx === mapPoints.length - 1;

          return (
            <div
              key={`${idx}-${point.x}-${point.y}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              {isCurrent && (
                <>
                  <div className="absolute -inset-5 rounded-full bg-primary/20 blur-md" />
                  <div className="absolute -inset-3 rounded-full border border-primary/50 animate-ping" />
                </>
              )}

              <div
                className={cn(
                  "relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-lg transition-all",
                  isCurrent
                    ? "scale-125 bg-primary text-primary-foreground glow-primary"
                    : isDone
                    ? "bg-muted-foreground text-background"
                    : isDestination
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-background text-muted-foreground border-border"
                )}
              >
                {isCurrent ? (
                  <Navigation className="h-3.5 w-3.5" />
                ) : isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : isDestination ? (
                  <Flag className="h-3.5 w-3.5" />
                ) : (
                  <span className="text-[10px] font-bold">{idx + 1}</span>
                )}
              </div>

              {(isCurrent || isDestination) && (
                <div className="absolute left-1/2 top-8 min-w-[96px] -translate-x-1/2 rounded-xl border border-border/70 bg-background/90 px-2 py-1 text-center text-[10px] font-semibold shadow-lg backdrop-blur">
                  {isCurrent ? "You are here" : point.label}
                </div>
              )}
            </div>
          );
        })}

        {/* GPS mode badge */}
        <div className="absolute left-3 top-3 rounded-2xl border border-primary/25 bg-background/85 px-3 py-2 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-primary font-bold">
                Indoor GPS
              </p>
              <p className="text-[10px] text-muted-foreground">
{hasRealRoute ? (isAutoTracking ? "Auto tracking" : "Manual correction") : "Preview"} · Floor {normalizeFloor(currentMapPoint?.floor ?? activeFloor)}
              </p>
            </div>
          </div>
        </div>

        {/* Floor selector */}
        <div className="absolute right-3 top-3 flex flex-col gap-1.5 rounded-2xl border border-border bg-background/85 backdrop-blur p-1.5 shadow-xl">
          <div className="flex items-center justify-center pb-1 text-[9px] text-muted-foreground">
            <Layers className="h-3 w-3" />
          </div>
          {floors.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFloor(f)}
              className={cn(
                "h-8 w-8 rounded-xl text-xs font-bold transition-all",
                activeFloor === f || normalizeFloor(currentMapPoint?.floor) === f
                  ? "bg-primary text-primary-foreground glow-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Bottom live instruction card */}
        <div className="absolute inset-x-3 bottom-3 rounded-3xl border border-primary/25 bg-background/92 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-start gap-3">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <div className="absolute h-9 w-9 rounded-full bg-primary/30 animate-ping" />
              <LocateFixed className="relative h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-primary font-bold">
                Next direction
              </p>
              <p className="mt-1 text-base font-bold leading-snug">
                {allDone ? "You've arrived" : currentMapPoint?.instruction ?? "Continue"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Floor {normalizeFloor(currentMapPoint?.floor ?? activeFloor)}</span>
                <span>·</span>
                <span>{remainingMeters}m left</span>
                <span>·</span>
                <span>{doneCount}/{stopCount} steps</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={() => setIsAutoTracking((prev) => !prev)}
              disabled={allDone || !hasRealRoute}
              className={cn(
                "flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold transition-all",
                allDone
                  ? "bg-muted text-muted-foreground"
                  : isAutoTracking
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/90"
              )}
            >
              {allDone ? (
                <>
                  <CheckCircle2 className="h-5 w-5" />
                  Route complete
                </>
              ) : isAutoTracking ? (
                <>
                  <LocateFixed className="h-5 w-5" />
                  Auto tracking
                </>
              ) : (
                <>
                  <Navigation className="h-5 w-5" />
                  Start tracking
                </>
              )}
            </button>

            <button
              onClick={() => hasRealRoute ? markStepDone(safeCurrentStepNum) : markStopDone(safeCurrentStepNum)}
              disabled={allDone}
              className={cn(
                "flex h-12 items-center justify-center rounded-2xl border px-4 text-xs font-bold transition-all",
                allDone
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-primary/35 bg-background/80 text-primary hover:bg-primary/10"
              )}
              title="Manual correction"
            >
              Correct
            </button>
          </div>
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
