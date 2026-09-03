import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Clock, Footprints, MapPin,
  CheckCircle2, Store, ArrowRight, RotateCcw,
  Zap, Layers, ArrowUp, ArrowDown, Navigation,
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import WayfindingPilot from "@/components/navigation/WayfindingPilot";
import { parseWayfindingAnchor } from "@/components/navigation/wayfindingAnchor";
import {
  toFloorplanModel, schematicModelFromRoute, buildRoutePolyline,
  routeFloors, normalizeFloorLabel, floorChip, type FloorplanModel,
} from "@/components/navigation/floorplanModel";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { awardXP, XP_REWARDS } from "@/lib/xp";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { describeShopFloor, describeEntrance } from "@/lib/shopLocation";
import { getIndoorMapModel, type IndoorMapModel } from "@/lib/googleBackendClient";

/**
 * NavigateScreen — the shopper "Navigate" tab.
 *
 * 1. No active route (or an incoming ?mall=&start= link): the shared
 *    destination-first wayfinding experience (WayfindingPilot) — "Where do
 *    you want to go?" → destination → start → route preview.
 * 2. An active route built by the assistant / build-route: the route preview
 *    with a floor map, next-instruction card and a manual step checklist.
 *
 * Neither mode tracks or simulates the shopper's position. The old
 * simulated walk-through was removed from the shopper build (Sept 2026) so a
 * moving marker can never be mistaken for live positioning.
 */

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
  const { search } = useLocation();
  const linkAnchor = useMemo(() => parseWayfindingAnchor(search), [search]);

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

  // Route geometry (floor-unit polyline) derived from the route steps.
  const routePolyline = useMemo(() => buildRoutePolyline(activeRouteSteps), [activeRouteSteps]);

  useEffect(() => {
    if (activeRouteSteps.length > 0 && activeRouteSteps[0].floor) {
      setActiveFloor(normalizeFloorLabel(activeRouteSteps[0].floor));
    }
  }, [activeRouteSteps]);

  // A new route clears all progress so the checklist, percentage, arrival state
  // and one-shot XP guard start fresh.
  useEffect(() => {
    setCompletedStepIndices(new Set());
    setCompletedStopIndices(new Set());
    xpAwardedRef.current = false;
  }, [activeRouteId]);

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
      }).catch(() => { /* XP is non-critical */ });

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
    navigate("/navigate", { replace: true });
  }

  // ── Mode 1: destination-first wayfinding ────────────────────────────────────
  // Shown when there is no active route, or when the shopper arrived through a
  // /navigate?mall=&start= link (e.g. QR signage) — that link always means
  // "start a new search from here", even if an older route is still stored.
  const showWayfinding = linkAnchor.status !== "none" || (!hasRealRoute && !routeStops.length);

  if (showWayfinding) {
    return (
      <MobileShell>
        <ScreenHeader
          title="Navigate"
          subtitle="Mall@Reds · pilot"
          back={false}
          right={
            (hasRealRoute || routeStops.length > 0) ? (
              <button
                onClick={() => navigate("/navigate", { replace: true })}
                className="mt-1 mr-1 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Navigation className="h-3.5 w-3.5" />
                Current route
              </button>
            ) : undefined
          }
        />
        <WayfindingPilot
          embedded
          initialAnchor={linkAnchor.status === "ok" ? linkAnchor.anchor : null}
          anchorNotice={linkAnchor.status === "invalid" ? linkAnchor.reason : null}
          onOpenAssistant={() => navigate("/assistant")}
        />
      </MobileShell>
    );
  }

  // ── Mode 2: an active route (assistant / build-route) ──────────────────────
  return (
    <MobileShell>
      <ScreenHeader
        title="Route preview"
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
          <span className="text-[11px] font-bold tracking-widest text-secondary uppercase">
            {hasRealRoute ? "Route preview" : "Stop list"}
          </span>

          <span className="text-[11px] text-muted-foreground/80">
            {indoorMapModelStatus === "ready" ? "Map: mall graph" : indoorMapModelStatus === "loading" ? "Map: loading" : "Map: schematic"}
          </span>
        </div>

        <div
          className="relative rounded-2xl border border-primary/25 overflow-hidden shadow-[0_10px_44px_-14px_hsl(190_100%_50%/0.35)]"
          style={{ height: 268, background: "hsl(240 24% 4%)" }}
        >
          {/* One honest status badge: this is a preview, position is not tracked. */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-primary/30 bg-background/70 px-2.5 py-1 backdrop-blur-md">
            <span className="text-[11px] font-semibold text-primary">Preview · position not tracked</span>
          </div>

          <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-border/50 bg-background/75 p-1 backdrop-blur-md">
            {visibleFloors.slice(0, 5).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFloor(f)}
                title={`Floor ${floorChip(f)}`}
                className={cn(
                  "h-9 w-9 rounded-lg text-[11px] font-bold leading-none transition-all",
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
            simulatedPosition={null}
          />
        </div>
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
          <p className="text-xs text-muted-foreground mt-1">All stops visited.</p>
        </div>
      )}

      {hasRealRoute && !allDone && currentStep && (
        <div className="mx-4 mb-3">
          <div className="rounded-2xl border border-primary/35 bg-gradient-to-b from-primary/12 to-primary/5 p-3.5 shadow-[0_6px_28px_-14px_hsl(190_100%_50%/0.5)]">
            <div className="flex items-center justify-between mb-2.5">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                Next
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground">
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
                    <span className="flex items-center gap-0.5 rounded-md bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground border border-border/50">
                      <Layers className="h-3 w-3" />
                      {currentStep.floor}
                    </span>
                  )}

                  {currentStep.distance_meters > 0 && (
                    <span className="flex items-center gap-0.5 rounded-md bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground border border-border/50">
                      <Footprints className="h-3 w-3" />
                      ~{Math.round(currentStep.distance_meters)}m
                    </span>
                  )}

                  {currentStep.floor_change && (
                    <span className="rounded-md bg-secondary/15 px-1.5 py-0.5 text-[11px] text-secondary font-semibold border border-secondary/30">Floor change</span>
                  )}

                  {nextStep && (
                    <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
                      <ArrowRight className="h-3 w-3" />
                      then {shortStepLabel(nextStep.instruction)}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => markStepDone(currentStepNum)}
                className="shrink-0 flex items-center gap-1 rounded-xl bg-primary text-primary-foreground text-xs font-semibold px-3.5 py-2.5 hover:bg-primary/90 transition-all mt-0.5 shadow-[0_0_16px_hsl(190_100%_50%/0.35)]"
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
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground px-0.5 flex items-center gap-1.5 mb-2">
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
                      <span className="rounded-full bg-secondary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-secondary border border-secondary/30">
                        Destination
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-0.5">
                    {step.floor && (
                      <span className="text-[11px] text-muted-foreground/70">{step.floor}</span>
                    )}

                    {step.distance_meters > 0 && (
                      <span className="text-[11px] text-muted-foreground/70">
                        ~{Math.round(step.distance_meters)}m
                      </span>
                    )}
                  </div>
                </div>

                {!isDone && !isCurrent && (
                  <button
                    onClick={() => markStepDone(idx)}
                    title="Mark as done"
                    aria-label="Mark step as done"
                    className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
                  >
                    <Store className="h-3.5 w-3.5" />
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
              <div className="h-2 w-2 rounded-full bg-secondary shrink-0" />

              <p className="text-xs font-medium text-secondary">
                {completedStopIndices.size === 0
                  ? `Enter via ${describeEntrance(routeStops[currentStopIndex].floor)} · Start at ${routeStops[currentStopIndex].name}`
                  : allDone
                  ? "All stops complete."
                  : `Next: ${describeShopFloor(routeStops[currentStopIndex].floor)} · ${routeStops[currentStopIndex].name}`}
              </p>
            </div>
          )}

          <div className="mx-4 space-y-2 pb-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground px-0.5">Stops in order · walking directions not available</p>

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
                      {describeShopFloor(stop.floor)} · Unit {stop.unit_number ?? "—"}
                      {stop.category ? ` · ${stop.category}` : ""}
                    </p>
                  </div>

                  {!isDone && (
                    <button
                      onClick={() => markStopDone(idx)}
                      className={cn(
                        "shrink-0 flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-all",
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
            {xpToast.leveledUp && <p className="text-xs text-primary font-medium">🎉 Level up!</p>}
            {xpToast.badges.map((b) => (
              <p key={b} className="text-xs text-secondary font-medium">🏆 Badge: {b}</p>
            ))}
          </div>
        </div>
      )}

      {allDone && (
        <div className="px-4 pb-6 animate-slide-up">
          <Button variant="neonGreen" size="lg" className="w-full" onClick={handleReset}>
            <Navigation className="h-5 w-5" />
            Find another shop
          </Button>
        </div>
      )}
    </MobileShell>
  );
};

export default NavigateScreen;
