import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Store, ArrowRight, RotateCcw, Navigation, ListChecks } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import WayfindingPilot, { type NavigationUiMode } from "@/components/navigation/WayfindingPilot";
import { parseWayfindingAnchor } from "@/components/navigation/wayfindingAnchor";
import { getWayfindingMall, DEFAULT_WAYFINDING_MALL_ID } from "@/components/navigation/mallDatasets";
import { routeClaim } from "@/components/navigation/routeEvidence";
import type { NavigationEvent } from "@/components/navigation/navigationEvents";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { describeShopFloor } from "@/lib/shopLocation";
import { findVenueForMall, navigationIntentLink, parseNavigationIntentLink, resolveNavigationIntent } from "@/navigation/navigationIntent";

/**
 * NavigateScreen — the shopper "Navigate" tab.
 *
 * ONE navigation runtime. Every route a visitor sees here comes from the Venue Pack → deterministic
 * router → NavigationSession → Navigation Experience V2 (WayfindingPilot). The destination may be
 * chosen on this screen (search), by a link (`?mall=&to=`; the assistant hands over its resolved
 * intent this way) or by a QR start anchor (`?mall=&start=`). No other component renders route
 * steps, floors or a map for a visitor, and nothing here fetches a route from a backend.
 *
 * The "stop list" is a different, non-spatial feature: a checklist of shops the visitor picked in
 * Find & Compare or Deals. It has no map, no steps, no distances and no walking directions; each
 * stop only offers to hand that shop to the navigation runtime as a destination.
 *
 * Nothing on this screen tracks or simulates the shopper's position.
 */

const NavigateScreen = () => {
  const navigate = useNavigate();
  const { search } = useLocation();
  const linkAnchor = useMemo(() => parseWayfindingAnchor(search), [search]);
  const linkIntent = useMemo(() => parseNavigationIntentLink(search), [search]);
  // Which venue the finder routes over: the link's venue when valid; a venue MallMind does not know
  // is passed through so the visitor gets a "choose a mall" state (never a silent fallback); with no
  // venue in the link, the registry's default.
  const requestedMall = useMemo(() => (new URLSearchParams(search).get("mall") ?? "").trim(), [search]);
  const wayfindingMallId = linkAnchor.mallId ?? (requestedMall && !getWayfindingMall(requestedMall) ? requestedMall : DEFAULT_WAYFINDING_MALL_ID);
  const wayfindingMall = getWayfindingMall(wayfindingMallId);
  // A destination handed over by a link or the assistant: only the id travels; the venue's own
  // vocabulary decides whether it exists (WayfindingPilot validates it again).
  const initialDestination = useMemo(
    () => (linkIntent && linkIntent.venueId === wayfindingMallId
      ? { destinationId: linkIntent.destinationId, source: linkIntent.source === "assistant" ? "assistant" as const : "link" as const }
      : null),
    [linkIntent, wayfindingMallId],
  );
  // Walking / arrival are focus modes: the app's bottom nav and page header step aside.
  const [uiMode, setUiMode] = useState<NavigationUiMode>("search");
  const focusMode = uiMode === "walking" || uiMode === "arrived";

  const { selectedMall, routeStops, currentStopIndex, advanceStop, resetSession } = useShoppingSession();
  const { user } = useAuth();
  const [completedStopIndices, setCompletedStopIndices] = useState<Set<number>>(new Set());

  // The stop list's shops live in the directory mall; the navigation runtime needs its Venue Pack.
  const stopListVenue = useMemo(() => findVenueForMall(selectedMall?.name), [selectedMall?.name]);

  const allStopsDone = routeStops.length > 0 && completedStopIndices.size === routeStops.length;
  useEffect(() => {
    if (!allStopsDone) return;
    trackEvent("route_completed", {
      userId: user?.id ?? null,
      mallId: selectedMall?.id,
      mallName: selectedMall?.name,
      metadata: { stops: routeStops.length, kind: "stop_list", has_real_route: false },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStopsDone]);

  function markStopDone(idx: number) {
    setCompletedStopIndices((prev) => new Set(prev).add(idx));
    if (idx === currentStopIndex && currentStopIndex < routeStops.length - 1) advanceStop();
  }

  function handleReset() {
    resetSession();
    setCompletedStopIndices(new Set());
    navigate("/navigate", { replace: true });
  }

  /** Hand one stop to the navigation runtime: resolve the shop name like any other intent. */
  function guideToStop(name: string) {
    if (!stopListVenue) return;
    const res = resolveNavigationIntent(stopListVenue, name, "search");
    trackEvent("navigation_intent", { userId: user?.id ?? null, mallId: stopListVenue.id, mallName: stopListVenue.name, metadata: { source: "stop_list", status: res.status } });
    if (res.status === "resolved") navigate(navigationIntentLink(res.intent));
    else navigate(`/navigate?mall=${encodeURIComponent(stopListVenue.id)}`); // let the visitor pick from search
  }

  // The navigation runtime shows unless the visitor deliberately opened their stop list (plain
  // /navigate with stops stored). Any link with a venue, start or destination always means
  // "navigate", even if a stop list is stored.
  const showStopList = routeStops.length > 0 && linkAnchor.status === "none" && !linkIntent;

  if (!showStopList) {
    return (
      <MobileShell hideNav={focusMode}>
        {!focusMode && <ScreenHeader
          title="Navigate"
          subtitle={wayfindingMall ? `${wayfindingMall.name} · ${routeClaim(wayfindingMall)}` : "Choose a mall"}
          back={false}
          right={
            routeStops.length > 0 ? (
              <button
                onClick={() => navigate("/navigate", { replace: true })}
                className="mt-1 mr-1 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                data-testid="navigate-open-stop-list"
              >
                <ListChecks className="h-3.5 w-3.5" />
                Stop list
              </button>
            ) : undefined
          }
        />}
        {focusMode && <div className="h-3" aria-hidden />}
        <WayfindingPilot
          embedded
          mallId={wayfindingMallId}
          initialAnchor={linkAnchor.status === "ok" ? linkAnchor.anchor : null}
          initialDestination={initialDestination}
          anchorNotice={linkAnchor.status === "invalid" && wayfindingMall ? linkAnchor.reason : null}
          onModeChange={setUiMode}
          onOpenAssistant={() => navigate("/assistant")}
          onEvent={(e: NavigationEvent) => trackEvent(e.name, { userId: user?.id ?? null, mallId: e.mallId, mallName: wayfindingMall?.name ?? null, metadata: e.detail })}
        />
      </MobileShell>
    );
  }

  // ── Stop list: a non-spatial checklist (no map, no steps, no distances) ─────────────────────
  return (
    <MobileShell>
      <ScreenHeader
        title="Stop list"
        subtitle={selectedMall?.name ?? "Shops to visit"}
        back={false}
        right={
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 mr-1"
            data-testid="stop-list-reset"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        }
      />

      <div className="mx-4 mb-3 rounded-xl border border-border/60 bg-surface/50 px-4 py-3" data-testid="stop-list-note">
        <p className="text-xs text-muted-foreground">
          A checklist of the shops you picked, in order. It is not a route: no map, no distances, no walking
          directions. Tap <span className="font-semibold text-foreground">Guide me</span> on a stop to get
          directions to it.
        </p>
      </div>

      {allStopsDone && (
        <div className="mx-4 mb-3 rounded-2xl border border-secondary/40 bg-secondary/10 p-4 text-center animate-fade-in" data-testid="stop-list-complete">
          <p className="font-display font-bold text-secondary text-base">All stops ticked off.</p>
        </div>
      )}

      <div className="mx-4 space-y-2 pb-4" data-testid="stop-list">
        {routeStops.map((stop, idx) => {
          const isDone = completedStopIndices.has(idx);
          const isCurrent = idx === currentStopIndex && !isDone;
          return (
            <div
              key={String(stop.id)}
              className={cn(
                "rounded-2xl border p-3.5 transition-all animate-slide-up",
                isDone ? "border-border bg-surface/40 opacity-50" : isCurrent ? "border-primary/50 bg-primary/10" : "border-border bg-surface/70",
              )}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold",
                    isDone ? "bg-muted border-border text-muted-foreground" : isCurrent ? "bg-primary border-primary text-primary-foreground" : "bg-surface border-border text-muted-foreground",
                  )}
                >
                  {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={cn("font-medium text-sm truncate", isDone && "line-through")}>{stop.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {describeShopFloor(stop.floor)} · Unit {stop.unit_number ?? "—"}
                    {stop.category ? ` · ${stop.category}` : ""}
                  </p>
                </div>

                {!isDone && (
                  <button
                    onClick={() => markStopDone(idx)}
                    aria-label={`Mark ${stop.name} as done`}
                    className={cn(
                      "shrink-0 flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-all",
                      isCurrent ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border text-muted-foreground hover:border-primary/50 hover:text-primary",
                    )}
                  >
                    {isCurrent ? (<><span>Done</span><ArrowRight className="h-3 w-3" /></>) : <Store className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>

              {!isDone && stopListVenue && (
                <button
                  onClick={() => guideToStop(stop.name)}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                  data-testid="stop-list-guide"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Guide me to {stop.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!stopListVenue && (
        <p className="mx-4 mb-4 text-[11px] text-muted-foreground" data-testid="stop-list-no-venue">
          MallMind cannot give walking directions in {selectedMall?.name ?? "this mall"} yet.
        </p>
      )}

      <div className="px-4 pb-6">
        <Button
          variant="neonGreen"
          size="lg"
          className="w-full"
          onClick={() => navigate(`/navigate?mall=${encodeURIComponent(stopListVenue?.id ?? DEFAULT_WAYFINDING_MALL_ID)}`)}
          data-testid="stop-list-open-navigate"
        >
          <Navigation className="h-5 w-5" />
          Find a place
        </Button>
      </div>
    </MobileShell>
  );
};

export default NavigateScreen;
