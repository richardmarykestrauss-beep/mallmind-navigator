import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock, Footprints, MapPin,
  CheckCircle2, Store, ArrowRight, RotateCcw, Search,
  Zap, Layers, ArrowUp, ArrowDown, Navigation, Play, Pause,
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import { computeRouteWalk } from "@/components/navigation/routeWalk";
import { reachedNodeCount, walkCompletedSteps } from "@/components/navigation/routeWalkProgress";
import {
  toFloorplanModel, schematicModelFromRoute, buildRoutePolyline, polylineToWalkNodes,
  routeFloors, normalizeFloorLabel, floorChip, type FloorplanModel,
} from "@/components/navigation/floorplanModel";
import { MALL_REDS_GAME_FLOORPLAN, buildDemoRoutePolyline } from "@/components/navigation/demoFloorplan";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { awardXP, XP_REWARDS } from "@/lib/xp";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { getIndoorMapModel, type IndoorMapModel } from "@/lib/googleBackendClient";

/** Truncate a step instruction for the compact "then …" next-action hint. */
function shortStepLabel(s: string): string {
  const clean = s.trim();
  return clean.length <= 22 ? clean : `${clean.slice(0, 20).trimEnd()}…`;
}

function estimateRoute(stops: { floor: string | null }[]): { meters: number; minutes: number } {
  if (!stops.length) return { meters: 0, minutes: 0 };
  let meters = 50;
  const floorOrder: Record<string, number> = { B1: 0, G: 1, L1: 2, L2: 3, L3: 4 };

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].floor ?? "G";
    const b = stops[i + 1].floor ?? "G";
    meters += 80 + Math.abs((floorOrder[a] ?? 1) - (floorOrder[b] ?? 1)) * 40;
  }

  return { meters, minutes: Math.max(1, Math.round(meters / 72)) };
}

const NavigateScreen = () => {
  const navigate = useNavigate();

  const {
    selectedMall,
    routeStops,
    currentStopIndex,
    advanceStop,
    resetSession,
    activeRouteSteps,
    activeRouteId,
    clearRoute,
  } = useShoppingSession();

  const { user, profile, refreshProfile } = useAuth();

  const [activeFloor, setActiveFloor] = useState<string>("Ground Floor");
  const [completedStepIndices, setCompletedStepIndices] = useState<Set<number>>(new Set());
  const [completedStopIndices, setCompletedStopIndices] = useState<Set<number>>(new Set());
  const [xpToast, setXpToast] = useState<{ xp: number; leveledUp: boolean; badges: string[] } | null>(null);
  const [indoorMapModel, setIndoorMapModel] = useState<IndoorMapModel | null>(null);
  const [indoorMapModelStatus, setIndoorMapModelStatus] = useState<"idle" | "loading" | "ready" | "fallback" | "error">("idle");

  const xpAwardedRef = useRef(false);

  // ── Route-walk simulation (not live GPS) ──────────────────────────────────
  const SEGMENT_MS = 1800;
  const [isWalking, setIsWalking] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Route geometry (floor-unit polyline) derived from the route steps. The
  // simulated marker travels along THIS polyline, so its motion follows the real
  // floorplan geometry — not arbitrary progress.
  const routePolyline = useMemo(() => buildRoutePolyline(activeRouteSteps), [activeRouteSteps]);
  const walkNodes = useMemo(() => polylineToWalkNodes(routePolyline), [routePolyline]);

  const walk = useMemo(
    () => computeRouteWalk(walkNodes, elapsedMs, SEGMENT_MS),
    [walkNodes, elapsedMs],
  );

  // Nodes the simulated marker has reached — one route step per crossed node.
  const walkReachedCount = useMemo(
    () => reachedNodeCount(walk, walkNodes.length),
    [walk, walkNodes.length],
  );

  const simEngaged = elapsedMs > 0 || isWalking;

  useEffect(() => {
    if (activeRouteSteps.length > 0 && activeRouteSteps[0].floor) {
      setActiveFloor(normalizeFloorLabel(activeRouteSteps[0].floor));
    }
  }, [activeRouteSteps]);

  // Animation loop — advances elapsed time while playing. Cleans up on pause,
  // route change and unmount (the effect re-runs / tears down on every dep change).
  useEffect(() => {
    if (!isWalking) return;

    let raf = 0;
    let last: number | null = null;
    const tick = (ts: number) => {
      if (last !== null) setElapsedMs((prev) => prev + (ts - last!));
      last = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [isWalking]);

  // Stop the loop once the simulated walk reaches the final node.
  useEffect(() => {
    if (walk.done && isWalking) setIsWalking(false);
  }, [walk.done, isWalking]);

  // A new route resets and stops the simulation, and clears all progress so the
  // checklist, percentage, arrival state and one-shot XP guard start fresh.
  useEffect(() => {
    setIsWalking(false);
    setElapsedMs(0);
    setCompletedStepIndices(new Set());
    setCompletedStopIndices(new Set());
    xpAwardedRef.current = false;
  }, [activeRouteId]);

  // Follow the simulated marker across floor transitions.
  useEffect(() => {
    if (simEngaged && walk.floor) setActiveFloor(walk.floor);
  }, [walk.floor, simEngaged]);

  useEffect(() => {
    const mallId = selectedMall?.id;

    if (!mallId) {
      setIndoorMapModel(null);
      setIndoorMapModelStatus("idle");
      return;
    }

    let cancelled = false;
    setIndoorMapModelStatus("loading");

    getIndoorMapModel({
      mall_id: mallId,
      floor: activeFloor,
    })
      .then((res) => {
        if (cancelled) return;

        if (res.ok && res.model) {
          setIndoorMapModel(res.model);
          setIndoorMapModelStatus("ready");
        } else {
          setIndoorMapModel(null);
          setIndoorMapModelStatus("fallback");
        }
      })
      .catch((err) => {
        console.error("[NavigateScreen] Failed to load indoor map model", err);
        if (!cancelled) {
          setIndoorMapModel(null);
          setIndoorMapModelStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMall?.id, activeFloor]);

  const hasRealRoute = activeRouteSteps.length > 0;

  // Build the floor-unit FloorplanModel that drives the canvas: the backend map
  // graph when available, else a schematic generated from the route itself.
  const floorplanModel: FloorplanModel = useMemo(() => {
    const meta = { mallId: String(selectedMall?.id ?? "mall"), mallName: selectedMall?.name ?? "Mall" };
    if (indoorMapModel) return toFloorplanModel(indoorMapModel, meta);
    return schematicModelFromRoute(activeRouteSteps, meta);
  }, [indoorMapModel, activeRouteSteps, selectedMall?.id, selectedMall?.name]);

  // Synchronise route progress with the simulated marker: mark each route node
  // complete as the marker reaches it. Additive and monotonic (a set union), so
  // progress never moves backwards, never double-counts a node, reaches 100% when
  // the marker arrives, and composes with manual "Done" presses.
  useEffect(() => {
    setCompletedStepIndices((prev) =>
      walkCompletedSteps(prev, walkReachedCount, simEngaged && hasRealRoute),
    );
  }, [walkReachedCount, simEngaged, hasRealRoute]);

  const totalMeters = hasRealRoute
    ? activeRouteSteps.at(-1)?.cumulative_meters ?? 0
    : estimateRoute(routeStops).meters;

  const totalMinutes = hasRealRoute
    ? Math.max(1, Math.round(totalMeters / 72))
    : estimateRoute(routeStops).minutes;

  const allDone = hasRealRoute
    ? completedStepIndices.size >= activeRouteSteps.length
    : completedStopIndices.size === routeStops.length && routeStops.length > 0;

  const currentStepNum = useMemo(() => {
    if (!hasRealRoute) return currentStopIndex;

    const first = [...Array(activeRouteSteps.length).keys()].find(
      (i) => !completedStepIndices.has(i),
    );

    return first ?? activeRouteSteps.length;
  }, [hasRealRoute, completedStepIndices, activeRouteSteps.length, currentStopIndex]);

  const currentStep = activeRouteSteps[currentStepNum];
  const nextStep = activeRouteSteps[currentStepNum + 1];
  const stopCount = hasRealRoute ? activeRouteSteps.length : routeStops.length;
  const doneCount = hasRealRoute ? completedStepIndices.size : completedStopIndices.size;
  const routePct = stopCount ? Math.round((doneCount / stopCount) * 100) : 0;

  const visibleFloors = useMemo(() => {
    const fs = routeFloors(routePolyline);
    return fs.length ? fs : ["Ground Floor"];
  }, [routePolyline]);

  useEffect(() => {
    if (allDone && !xpAwardedRef.current && user && profile) {
      xpAwardedRef.current = true;

      awardXP(user.id, XP_REWARDS.ROUTE_COMPLETE, profile.xp, profile.level).then((result) => {
        refreshProfile();
        setXpToast({
          xp: result.xpGained,
          leveledUp: result.leveledUp,
          badges: result.newAchievements,
        });

        setTimeout(() => setXpToast(null), 5000);
      });

      trackEvent("route_completed", {
        userId: user.id,
        mallId: selectedMall?.id,
        mallName: selectedMall?.name,
        metadata: {
          stops: stopCount,
          has_real_route: hasRealRoute,
        },
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

    const nextStep = activeRouteSteps[idx + 1];
    if (nextStep?.floor) setActiveFloor(normalizeFloorLabel(nextStep.floor));
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

  function startWalk() {
    if (walk.done) {
      // Restart a finished walk from the top — clear progress so the marker and
      // checklist advance together from the route start (no stale 100% state).
      setElapsedMs(0);
      setCompletedStepIndices(new Set());
    }
    setIsWalking(true);
  }

  function pauseWalk() {
    // Pause only stops the clock; elapsed time and completed steps are preserved.
    setIsWalking(false);
  }

  function resetWalk() {
    setIsWalking(false);
    setElapsedMs(0);
    setCompletedStepIndices(new Set());
    if (activeRouteSteps[0]?.floor) setActiveFloor(normalizeFloorLabel(activeRouteSteps[0].floor));
  }

  if (!hasRealRoute && !routeStops.length) {
    return (
      <MobileShell>
        <ScreenHeader title="Mall Map" subtitle="No active route" />

        {/* Demo of the indoor map engine — a real floorplan coordinate model. */}
        <div className="mx-4 mb-4 mt-1 animate-fade-in">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Indoor map engine · demo</span>
            <span className="text-[10px] text-muted-foreground/70">Mall@Reds → Game</span>
          </div>
          <div
            className="relative overflow-hidden rounded-2xl border border-primary/25 shadow-[0_10px_44px_-14px_hsl(190_100%_50%/0.35)]"
            style={{ height: 220, background: "hsl(240 24% 4%)" }}
          >
            <IndoorMapCanvas
              floorplan={MALL_REDS_GAME_FLOORPLAN}
              activeFloor="Ground Floor"
              routePolyline={buildDemoRoutePolyline()}
              completedStepIndices={new Set()}
              currentStepIndex={0}
              isDemo
            />
          </div>
          <p className="mt-2 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
            Schematic floorplan generated from the MallMind route graph — a simulated preview, not live GPS.
          </p>
        </div>

        <div className="flex flex-col items-center gap-5 px-5 pt-2 text-center animate-fade-in">
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

  return (
    <MobileShell>
      <ScreenHeader
        title="Mall Map"
        subtitle={selectedMall?.name ?? "Navigation"}
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

      <div className="mx-4 mb-3">
        <div className="flex items-center justify-between mb-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest text-secondary uppercase">
              {hasRealRoute ? "AI-Assisted Route" : "Prototype route preview"}
            </span>
          </div>

          <span className="text-[10px] text-muted-foreground/70">
            2.5D schematic · Map Factory
            {indoorMapModelStatus === "ready" ? " · live graph" : indoorMapModelStatus === "loading" ? " · loading" : " · route fallback"}
          </span>
        </div>

        <div
          className="relative rounded-2xl border border-primary/25 overflow-hidden shadow-[0_10px_44px_-14px_hsl(190_100%_50%/0.35)]"
          style={{ height: 268, background: "hsl(240 24% 4%)" }}
        >
          {/* Honest badge — this is a prototype simulation, NOT live GPS positioning */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-primary/30 bg-background/70 px-2.5 py-1 backdrop-blur-md shadow-[0_0_14px_hsl(190_100%_50%/0.18)]">
            <span className={cn("h-1.5 w-1.5 rounded-full bg-primary", isWalking ? "animate-ping" : "animate-pulse")} />
            <span className="text-[9px] font-bold text-primary uppercase tracking-[0.16em]">
              {isWalking ? "Simulating" : "Prototype preview"}
            </span>
          </div>

          <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-border/50 bg-background/75 p-1 backdrop-blur-md">
            {visibleFloors.slice(0, 5).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFloor(f)}
                title={`Floor ${floorChip(f)}`}
                className={cn(
                  "h-8 w-8 rounded-lg text-[10px] font-bold leading-none transition-all",
                  normalizeFloorLabel(activeFloor) === f
                    ? "bg-primary text-primary-foreground shadow-[0_0_14px_hsl(190_100%_50%/0.5)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {floorChip(f)}
              </button>
            ))}
          </div>

          <IndoorMapCanvas
            floorplan={floorplanModel}
            activeFloor={activeFloor}
            routePolyline={routePolyline}
            completedStepIndices={completedStepIndices}
            currentStepIndex={currentStepNum}
            simulatedPosition={hasRealRoute && simEngaged ? walk.point : null}
          />
        </div>

        {/* Simulated-walk controls — move the marker without pressing Done each step. */}
        {hasRealRoute && walkNodes.length > 1 && (
          <div className="mt-2 flex items-center gap-2">
            {isWalking ? (
              <Button variant="glass" size="sm" className="flex-1" onClick={pauseWalk}>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
            ) : (
              <Button variant="neon" size="sm" className="flex-1" onClick={startWalk}>
                <Play className="h-3.5 w-3.5" />
                {elapsedMs > 0 && !walk.done ? "Resume walk" : "Start walk"}
              </Button>
            )}

            <Button
              variant="glass"
              size="sm"
              className="flex-1"
              onClick={resetWalk}
              disabled={elapsedMs === 0 && !isWalking}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        )}

        {/* Demo honesty line — explicit that the moving marker is a simulation. */}
        <p className="mt-2 px-0.5 text-[10px] text-muted-foreground leading-relaxed">
          This is a simulated walk-through that animates along your route — not live
          GPS or indoor positioning.
        </p>
      </div>

      <div className="mx-4 mb-3 flex items-center justify-between rounded-xl border border-primary/12 bg-primary/5 px-4 py-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-foreground">{totalMinutes}</span> min
        </div>

        <div className="h-3 w-px bg-border" />

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Footprints className="h-3.5 w-3.5 text-secondary" />
          <span className="font-medium text-foreground">{Math.round(totalMeters)}</span> m
        </div>

        <div className="h-3 w-px bg-border" />

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-foreground">{doneCount}</span>
          <span>/ {stopCount}</span>
          <span>done</span>
        </div>
      </div>

      {allDone && (
        <div className="mx-4 mb-3 rounded-2xl border border-secondary/40 bg-secondary/10 p-4 text-center animate-fade-in">
          <p className="font-display font-bold text-secondary text-base">🎉 Route complete!</p>
          <p className="text-xs text-muted-foreground mt-1">All stops visited. Head to your car.</p>
        </div>
      )}

      {hasRealRoute && !allDone && currentStep && (
        <div className="mx-4 mb-3">
          <div className="rounded-2xl border border-primary/35 bg-gradient-to-b from-primary/12 to-primary/5 p-3.5 shadow-[0_6px_28px_-14px_hsl(190_100%_50%/0.5)]">
            {/* HUD header — live navigation status + progress percent */}
            <div className="flex items-center justify-between mb-2.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                <span className={cn("h-1.5 w-1.5 rounded-full bg-primary", isWalking && "animate-ping")} />
                {isWalking ? "Navigating" : "Next stop"}
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">
                Step {Math.min(doneCount + 1, stopCount)} of {stopCount} · <span className="text-primary">{routePct}%</span>
              </span>
            </div>

            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm font-bold mt-0.5",
                  currentStep.floor_change
                    ? "bg-secondary/20 border-secondary/40 text-secondary shadow-[0_0_16px_hsl(111_100%_54%/0.35)]"
                    : "bg-primary/20 border-primary/45 text-primary shadow-[0_0_16px_hsl(190_100%_50%/0.35)]",
                )}
              >
                {currentStep.floor_change
                  ? ((activeRouteSteps[currentStepNum - 1]?.floor ?? "") < (currentStep.floor ?? "")
                    ? <ArrowUp className="h-4 w-4" />
                    : <ArrowDown className="h-4 w-4" />)
                  : currentStep.step}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{currentStep.instruction}</p>

                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {currentStep.floor && (
                    <span className="flex items-center gap-0.5 rounded-md bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border/50">
                      <Layers className="h-3 w-3" />
                      {currentStep.floor}
                    </span>
                  )}

                  {currentStep.distance_meters > 0 && (
                    <span className="flex items-center gap-0.5 rounded-md bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border/50">
                      <Footprints className="h-3 w-3" />
                      ~{Math.round(currentStep.distance_meters)}m
                    </span>
                  )}

                  {currentStep.floor_change && (
                    <span className="rounded-md bg-secondary/15 px-1.5 py-0.5 text-[10px] text-secondary font-semibold border border-secondary/30">Floor change</span>
                  )}

                  {nextStep && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
                      <ArrowRight className="h-3 w-3" />
                      then {shortStepLabel(nextStep.instruction)}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => markStepDone(currentStepNum)}
                className="shrink-0 flex items-center gap-1 rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3.5 py-2 hover:bg-primary/90 transition-all mt-0.5 shadow-[0_0_16px_hsl(190_100%_50%/0.35)]"
              >
                Done <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="mt-3 h-1.5 rounded-full bg-primary/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary-glow transition-all duration-500"
                style={{ width: `${routePct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {hasRealRoute && (
        <div className="mx-4 space-y-1.5 pb-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground px-0.5 flex items-center gap-1.5 mb-2">
            <Navigation className="h-3 w-3" />
            All steps
          </p>

          {activeRouteSteps.map((step, idx) => {
            const isDone = completedStepIndices.has(idx);
            const isCurrent = idx === currentStepNum && !allDone;
            const isDestination = idx === activeRouteSteps.length - 1 && activeRouteSteps.length > 1;

            return (
              <div
                key={step.node_id + idx}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all animate-slide-up",
                  isDone
                    ? "border-border bg-surface/30 opacity-35"
                    : isCurrent
                    ? "border-primary/40 bg-primary/8"
                    : isDestination
                    ? "border-secondary/40 bg-secondary/8"
                    : "border-border bg-surface/50",
                )}
                style={{ animationDelay: `${idx * 25}ms` }}
              >
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold mt-0.5",
                    isDone
                      ? "bg-muted border-border text-muted-foreground"
                      : step.floor_change
                      ? "bg-secondary/15 border-secondary/35 text-secondary"
                      : isCurrent
                      ? "bg-primary border-primary text-primary-foreground"
                      : isDestination
                      ? "bg-secondary/15 border-secondary/40 text-secondary"
                      : "bg-surface border-border text-muted-foreground",
                  )}
                >
                  {isDone
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : isDestination
                    ? <MapPin className="h-3.5 w-3.5" />
                    : step.floor_change
                    ? ((activeRouteSteps[idx - 1]?.floor ?? "") < (step.floor ?? "")
                      ? <ArrowUp className="h-3 w-3" />
                      : <ArrowDown className="h-3 w-3" />)
                    : step.step}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className={cn("text-xs font-medium leading-snug", isDone && "line-through text-muted-foreground")}>
                      {step.instruction}
                    </p>
                    {isDestination && !isDone && (
                      <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-secondary border border-secondary/30">
                        Destination
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-0.5">
                    {step.floor && (
                      <span className="text-[9px] text-muted-foreground/70">{step.floor}</span>
                    )}

                    {step.distance_meters > 0 && (
                      <span className="text-[9px] text-muted-foreground/70">
                        ~{Math.round(step.distance_meters)}m
                      </span>
                    )}
                  </div>
                </div>

                {!isDone && !isCurrent && (
                  <button
                    onClick={() => markStepDone(idx)}
                    title="Mark as done"
                    className="shrink-0 flex items-center justify-center h-7 w-7 rounded-lg border border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-all mt-0.5"
                  >
                    <Store className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!hasRealRoute && (
        <>
          {routeStops[currentStopIndex] && (
            <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-secondary/30 bg-secondary/8 px-3 py-2">
              <div className="h-2 w-2 rounded-full bg-secondary animate-pulse shrink-0" />

              <p className="text-xs font-medium text-secondary">
                {completedStopIndices.size === 0
                  ? `Enter via ${routeStops[currentStopIndex].floor === "G" ? "Ground Floor" : `${routeStops[currentStopIndex].floor} entrance`} · Start at ${routeStops[currentStopIndex].name}`
                  : allDone
                  ? "All stops complete! Head to your car."
                  : `Next: ${routeStops[currentStopIndex].floor} · ${routeStops[currentStopIndex].name}`}
              </p>
            </div>
          )}

          <div className="mx-4 space-y-2 pb-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground px-0.5">Stops in order</p>

            {routeStops.map((stop, idx) => {
              const isDone = completedStopIndices.has(idx);
              const isCurrent = idx === currentStopIndex && !isDone;

              return (
                <div
                  key={String(stop.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3.5 transition-all animate-slide-up",
                    isDone
                      ? "border-border bg-surface/40 opacity-50"
                      : isCurrent
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-surface/70",
                  )}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold",
                      isDone
                        ? "bg-muted border-border text-muted-foreground"
                        : isCurrent
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-surface border-border text-muted-foreground",
                    )}
                  >
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium text-sm truncate", isDone && "line-through")}>
                      {stop.name}
                    </p>

                    <p className="text-[11px] text-muted-foreground">
                      {stop.floor ?? "?"} · Unit {stop.unit_number ?? "—"}
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
                          : "border border-border text-muted-foreground hover:border-primary/50 hover:text-primary",
                      )}
                    >
                      {isCurrent ? (
                        <>
                          <span>Done</span>
                          <ArrowRight className="h-3 w-3" />
                        </>
                      ) : (
                        <Store className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {xpToast && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-2xl border border-secondary/40 bg-secondary/12 px-4 py-3 animate-slide-up">
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

      {allDone && (
        <div className="px-4 pb-6 animate-slide-up">
          <Button variant="neonGreen" size="lg" className="w-full" onClick={() => navigate("/parking")}>
            <MapPin className="h-5 w-5" />
            Return to My Car
          </Button>
        </div>
      )}

      {activeRouteId && null}
    </MobileShell>
  );
};

export default NavigateScreen;
