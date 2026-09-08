/**
 * WayfindingPilot.tsx — the shared visitor navigation experience.
 *
 * One implementation, two mounts:
 *   • /navigate (NavigateScreen) — embedded inside MobileShell for shoppers.
 *   • /pilot (MallRedsPilot)     — standalone, for controlled testing.
 *
 * Journey (navigationSession.ts): scan QR / open link → mall + trusted start anchor → "Where do
 * you want to go?" → route calculated → START NAVIGATION → focused instruction view with MANUAL
 * Next / Previous → arrival. "Update my location" re-anchors from another trusted start (manual
 * pick, or a second QR / deep link) and recalculates the route while keeping the destination.
 *
 * The route depends ONLY on a trusted anchor (anchorProvider.ts). NO live positioning, NO
 * simulated movement, NO blue dot: every step change is the visitor's own tap, and the wording
 * says so. Mall-specific facts (names, starts, destinations, evidence) come from the registry —
 * this file contains no mall-specific logic.
 *
 * DISTANCE TRUTH: metres and minutes are rendered only when the route reports `metric: true`.
 * EVIDENCE TRUTH: the claim ("Schematic route preview" / "Source-backed route" / "Field-verified
 * route") and the arrival wording come from routeEvidence.ts — field verification changes what is
 * claimed, never how the session works.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, MapPin, Navigation, QrCode, LocateFixed, CheckCircle2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import { toFloorplanModel, buildRoutePolyline, attachFloorImages, normalizeFloorLabel } from "@/components/navigation/floorplanModel";
import {
  getWayfindingMall, startOptions, searchPois, defaultAnchor, anchorFor, pointsOfInterest, DEFAULT_WAYFINDING_MALL_ID,
  type PilotPoi, type PilotAnchor,
} from "@/components/navigation/mallDatasets";
import type { LoadedPilotDataset } from "@/components/navigation/mallRedsPilotDataset";
import {
  createNavigationSession, navigationReducer, sessionSteps, currentStep, upcomingStep, isRoutable,
  type NavigationSession, type NavigationAction,
} from "@/components/navigation/navigationSession";
import { routeClaim, routeEvidenceTier, isArrivalVerified } from "@/components/navigation/routeEvidence";
import { safeSink, type NavigationEventSink } from "@/components/navigation/navigationEvents";
import { persistNavigationSession, loadPersistedNavigationSession } from "@/components/navigation/navigationSessionStore";

const poiIcon = (p: PilotPoi): string =>
  p.kind === "store" ? "🛍️" : ({ toilet: "🚻", lift: "🛗", escalator: "🪜", stairs: "🪜", food_court: "🍽️", landmark: "ℹ️" }[p.type] ?? "📍");

const ANCHOR_SOURCE_LABEL: Partial<Record<PilotAnchor["source"], string>> = {
  url: "from your link",
  qr: "from the QR code you scanned",
};

/** Honest status wording derived from the DATA, never from the UI's optimism. */
function truthCopy(g: LoadedPilotDataset): { summary: string; statusLine: string; details: string[] } {
  const measured = g.metric ? "" : " Distance not yet measured.";
  const tier = routeEvidenceTier(g);
  if (tier === "schematic") {
    return {
      summary: "Pilot schematic · not an official floorplan · route preview only",
      statusLine: `Route preview — your position is not tracked.${measured}`,
      details: [
        "Pilot schematic — route geometry awaits on-site verification.",
        `Not an official ${g.mallName} floorplan.`,
        "Route preview only — live indoor positioning is not active.",
        "Not accessibility-verified. Not for emergency or evacuation use.",
      ],
    };
  }
  const verified = tier === "field-verified" ? "walked on site" : "not yet walked on site";
  const claim = tier === "field-verified" ? "Field-verified route" : "Source-backed route preview";
  return {
    summary: `${claim} · ${verified}${g.metric ? "" : " · distance not measured"}`,
    statusLine: `${claim}.${measured} Your position is not tracked.`,
    details: [
      `Route traced from ${g.mallName}'s published floor plan; ${verified}.`,
      `Not an official ${g.mallName} deployment. Controlled pilot only.`,
      g.metric ? "Distances are measured." : "Distance not yet measured — no walking time is shown.",
      "Store entrances shown as the nearest corridor point, not the door.",
      "Not accessibility-verified. Not for emergency or evacuation use.",
    ],
  };
}

export interface WayfindingPilotProps {
  /** Which bundled mall dataset to route over; defaults to the Mall@Reds pilot. */
  mallId?: string;
  /** Start anchor resolved from a link / QR (same model as manual selection). */
  initialAnchor?: PilotAnchor | null;
  /** Human-readable reason an incoming link anchor was rejected (manual start still works). */
  anchorNotice?: string | null;
  /** Mounted inside MobileShell (no own header, no full-height wrapper). */
  embedded?: boolean;
  /** Optional escape hatch to the AI assistant (rendered only when provided). */
  onOpenAssistant?: () => void;
  /** Analytics seam — best-effort, never awaited (navigationEvents.ts). */
  onEvent?: NavigationEventSink;
  /** Remember the destination locally so a second QR scan (fresh page load) keeps it. Default on. */
  rememberSession?: boolean;
}

export default function WayfindingPilot({ mallId, ...rest }: WayfindingPilotProps) {
  const graph = useMemo(() => getWayfindingMall(mallId ?? DEFAULT_WAYFINDING_MALL_ID), [mallId]);

  if (!graph) {
    // Defensive: callers validate mall ids first (wayfindingAnchor.ts); never invent a map.
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground" data-testid="pilot-no-map">
        MallMind does not have a map for this mall yet.
      </div>
    );
  }
  return <WayfindingPilotView key={graph.mallId} graph={graph} {...rest} />;
}

/**
 * Build the initial session. A deep-link anchor (url / qr) arriving on a fresh page load restores
 * a remembered destination for the same mall so a second scan mid-route re-anchors instead of
 * starting over. Manual entry never restores anything.
 */
function initialSession(graph: LoadedPilotDataset, initialAnchor: PilotAnchor | null | undefined, remember: boolean): NavigationSession {
  const anchor = initialAnchor ?? defaultAnchor(graph);
  const fresh = createNavigationSession(graph.mallId, anchor);
  if (!remember || !initialAnchor || (initialAnchor.source !== "url" && initialAnchor.source !== "qr")) return fresh;
  const saved = loadPersistedNavigationSession(graph.mallId);
  if (!saved) return fresh;
  const destination = pointsOfInterest(graph).find((p) => p.id === saved.destinationId);
  if (!destination) return fresh;
  // Replay: previous anchor → destination → (walking?) → re-anchor at the scanned start.
  let s = createNavigationSession(graph.mallId, anchorFor(graph, saved.anchorNodeId, "manual"));
  s = navigationReducer(graph, s, { type: "select_destination", destination });
  if (saved.status === "navigating" || saved.status === "arrived") s = navigationReducer(graph, s, { type: "start_navigation" });
  if (saved.anchorNodeId === initialAnchor.nodeId) return { ...s, anchor: initialAnchor };
  return navigationReducer(graph, s, { type: "reanchor", anchor: initialAnchor });
}

function WayfindingPilotView({ graph, initialAnchor, anchorNotice, embedded, onOpenAssistant, onEvent, rememberSession = true }: Omit<WayfindingPilotProps, "mallId"> & { graph: LoadedPilotDataset }) {
  const starts = useMemo(() => startOptions(graph), [graph]);
  const floorplan = useMemo(
    () => attachFloorImages(
      toFloorplanModel({ nodes: graph.nodes, edges: graph.edges }, { mallId: graph.mallId, mallName: graph.mallName }),
      graph.floorImages,
    ),
    [graph],
  );
  const copy = useMemo(() => truthCopy(graph), [graph]);
  const claim = routeClaim(graph);
  const emit = useMemo(() => safeSink(onEvent), [onEvent]);

  const [session, setSession] = useState<NavigationSession>(() => initialSession(graph, initialAnchor, rememberSession));
  const [query, setQuery] = useState("");
  const [reanchorOpen, setReanchorOpen] = useState(false);
  const stepHeadingRef = useRef<HTMLDivElement>(null);

  /** Apply an action and emit the matching lightweight events (best-effort, never blocking). */
  function send(action: NavigationAction) {
    const next = navigationReducer(graph, session, action);
    setSession(next);
    const base = { destination: next.destination?.id ?? null, anchor: next.anchor.nodeId, anchorSource: next.anchor.source, evidence: routeEvidenceTier(graph) };
    switch (action.type) {
      case "select_destination":
        if (next.status === "unroutable") emit({ name: "navigation_failed", mallId: graph.mallId, detail: { ...base, reason: next.route?.message ?? "unroutable" } });
        break;
      case "start_navigation":
        if (next.status !== session.status) emit({ name: "navigation_session_started", mallId: graph.mallId, detail: { ...base, steps: sessionSteps(next).length, metric: Boolean(next.route?.metric) } });
        break;
      case "next_step":
        if (next.stepIndex !== session.stepIndex) emit({ name: "navigation_step_advanced", mallId: graph.mallId, detail: { ...base, step: next.stepIndex + 1 } });
        if (next.status === "arrived" && session.status !== "arrived") emit({ name: "navigation_arrived", mallId: graph.mallId, detail: base });
        break;
      case "previous_step":
        if (next.stepIndex !== session.stepIndex) emit({ name: "navigation_step_back", mallId: graph.mallId, detail: { ...base, step: next.stepIndex + 1 } });
        break;
      case "reanchor":
        emit({ name: "navigation_reanchored", mallId: graph.mallId, detail: { ...base, from: session.anchor.nodeId, routable: isRoutable(next) } });
        if (next.status === "unroutable") emit({ name: "navigation_failed", mallId: graph.mallId, detail: { ...base, reason: next.route?.message ?? "unroutable" } });
        break;
      default:
        break;
    }
  }

  // A new incoming link anchor (e.g. scanning a second QR in the same page) re-anchors the session:
  // destination preserved, trusted start replaced, route recalculated.
  const lastLinkAnchor = useRef<PilotAnchor | null | undefined>(initialAnchor);
  useEffect(() => {
    if (initialAnchor && initialAnchor !== lastLinkAnchor.current) {
      lastLinkAnchor.current = initialAnchor;
      setReanchorOpen(false);
      send({ type: "reanchor", anchor: initialAnchor });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnchor]);

  // Remember the destination for deep-link re-entry (best-effort).
  useEffect(() => { if (rememberSession) persistNavigationSession(session); }, [session, rememberSession]);

  // Move focus to the step heading whenever the step or route changes while navigating.
  useEffect(() => {
    if (session.status === "navigating" || session.status === "arrived") stepHeadingRef.current?.focus();
  }, [session.status, session.stepIndex, session.routeRevision]);

  const { anchor, destination: dest, route, status } = session;
  const results = useMemo(() => searchPois(graph, query), [graph, query]);
  const hasRoute = isRoutable(session);
  const steps = sessionSteps(session);
  // Steps record their "to" node, so prepend the chosen start node: the START pin and the first
  // route segment then begin at the entrance the shopper actually chose, not at the first junction.
  const polyline = useMemo(() => {
    if (!hasRoute) return [];
    const startNode = graph.nodes.find((n) => n.id === anchor.nodeId);
    const lead = startNode
      ? [{ node_id: startNode.id, floor: startNode.floor, x_coordinate: startNode.x_coordinate, y_coordinate: startNode.y_coordinate }]
      : [];
    return buildRoutePolyline([...lead, ...steps]);
  }, [hasRoute, graph, anchor.nodeId, steps]);
  const navigating = status === "navigating" || status === "arrived";
  const activeFloor = normalizeFloorLabel(steps[navigating ? session.stepIndex : 0]?.floor ?? graph.dataset.floors[0]?.id ?? "G");
  const anchorSourceLabel = ANCHOR_SOURCE_LABEL[anchor.source] ?? null;
  const showMetrics = Boolean(hasRoute && route!.metric && route!.total_distance_meters !== null && route!.estimated_minutes !== null);
  const exampleNames = useMemo(() => searchPois(graph, "").slice(0, 5).map((p) => p.name).join(", "), [graph]);
  const destNode = dest ? graph.nodes.find((n) => n.linked_shop_id === dest.id || n.id === dest.id) ?? null : null;
  const arrivalVerified = destNode ? isArrivalVerified(destNode) : false;

  function choose(p: PilotPoi) { send({ type: "select_destination", destination: p }); }
  function clearDest() { setQuery(""); setReanchorOpen(false); send({ type: "clear_destination" }); }
  function changeAnchor(nodeId: string, source: PilotAnchor["source"] = "manual") {
    setReanchorOpen(false);
    send({ type: "reanchor", anchor: anchorFor(graph, nodeId, source) });
  }

  const header = embedded ? null : (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
      {dest && (
        <button aria-label="Back" onClick={clearDest} className="-ml-1 rounded-full p-1.5 hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold leading-tight">{graph.mallName} · Wayfinding</h1>
        <p className="truncate text-xs text-muted-foreground">Find a shop or facility and get walked there</p>
      </div>
    </header>
  );

  const reanchorPanel = (
    <div className="rounded-xl border bg-card p-3" role="group" aria-labelledby="pilot-reanchor-title" data-testid="pilot-reanchor-panel">
      <div className="flex items-center justify-between">
        <p id="pilot-reanchor-title" className="text-sm font-medium">Where are you now?</p>
        <button type="button" aria-label="Close" onClick={() => setReanchorOpen(false)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose the MallMind point nearest you. The route to <span className="font-medium text-foreground">{dest?.name}</span> will be recalculated from there.
      </p>
      <ul className="mt-2 space-y-1.5" data-testid="pilot-reanchor-options">
        {starts.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => changeAnchor(s.id, "manual")}
              aria-current={s.id === anchor.nodeId ? "location" : undefined}
              className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${s.id === anchor.nodeId ? "border-primary/50 bg-primary/5 font-medium" : ""}`}
            >
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1">{s.label}</span>
              {s.id === anchor.nodeId && <span className="text-[11px] text-muted-foreground">current start</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Or scan the nearest MallMind QR code with your camera — your route to {dest?.name} continues from that point.
      </p>
    </div>
  );

  return (
    <div
      className={embedded ? "flex flex-col" : "mx-auto flex min-h-[100dvh] max-w-md flex-col bg-background"}
      data-testid="mallreds-pilot"
      data-mall-id={graph.mallId}
      data-dataset-status={graph.datasetStatus}
      data-metric={graph.metric ? "true" : "false"}
      data-session-status={status}
    >
      {header}

      <main className={embedded ? "flex-1 px-4 pb-2" : "flex-1 px-4 py-4"}>
        {anchorNotice && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-snug" role="status" data-testid="pilot-anchor-notice">
            {anchorNotice}
          </div>
        )}

        {!dest ? (
          /* ── Destination-first finder ─────────────────────────────────── */
          <section data-testid="pilot-finder" className="space-y-4">
            <div>
              <label htmlFor="pilot-search" className="mb-1.5 block text-sm font-medium">Where do you want to go?</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pilot-search"
                  autoFocus
                  className="h-12 pl-9 text-base"
                  placeholder="Search e.g. Clicks, toilets, lifts"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="pilot-search"
                />
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground" data-testid="pilot-anchor-summary">
                <MapPin className="h-3 w-3" />
                Starting from <span className="font-medium text-foreground">{anchor.label}</span>
                {anchorSourceLabel && <span>· {anchorSourceLabel}</span>}
              </p>
            </div>

            {results.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="pilot-no-result">
                No match for “{query.trim()}” in this pilot.<br />Try {exampleNames}.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2" data-testid="pilot-suggestions">
                {results.map((p) => (
                  <button
                    key={`${p.kind}-${p.id}`}
                    onClick={() => choose(p)}
                    className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left active:scale-[0.99]"
                  >
                    <span className="text-xl" aria-hidden>{poiIcon(p)}</span>
                    <span className="flex-1 text-base font-medium">{p.name}</span>
                    <Badge variant="secondary" className="text-[11px]">{p.kind === "store" ? "Store" : "Facility"}</Badge>
                    <Navigation className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {onOpenAssistant && (
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onOpenAssistant}>
                Looking for a product instead? Ask the assistant
              </Button>
            )}
          </section>
        ) : navigating && hasRoute ? (
          /* ── Navigation session: focused instruction view ─────────────── */
          <section className="space-y-3" data-testid="pilot-navigation" aria-label={`Navigating to ${dest.name}`}>
            <div className="flex items-center gap-2">
              {embedded && (
                <button aria-label="Back" onClick={clearDest} className="-ml-1 rounded-full p-1.5 hover:bg-muted">
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Going to</p>
                <p className="truncate text-base font-semibold leading-tight" data-testid="pilot-dest-name">{dest.name}</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-[11px]" data-testid="pilot-route-claim">{claim}</Badge>
            </div>

            {session.lastReanchor && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs leading-snug" role="status" data-testid="pilot-route-updated">
                Route updated — now starting from <span className="font-medium">{session.lastReanchor.to.label}</span>
                {ANCHOR_SOURCE_LABEL[session.lastReanchor.to.source] ? ` (${ANCHOR_SOURCE_LABEL[session.lastReanchor.to.source]})` : ""}. Your steps start again from here.
              </div>
            )}

            {status === "arrived" ? (
              <div ref={stepHeadingRef} tabIndex={-1} className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 outline-none" data-testid="pilot-arrival" role="status">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
                  <p className="text-lg font-semibold leading-snug">{currentStep(session)?.instruction}</p>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground" data-testid="pilot-arrival-note">
                  {arrivalVerified
                    ? "This doorway was verified on site."
                    : `MallMind's map ends at the corridor point nearest ${dest.name}, not at its door. Look for the storefront from here.`}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border bg-primary/5 p-4" data-testid="pilot-step-card">
                <div ref={stepHeadingRef} tabIndex={-1} className="outline-none">
                  <p className="text-xs text-muted-foreground" data-testid="pilot-step-counter">
                    Step {session.stepIndex + 1} of {steps.length}
                    <span aria-hidden> · </span>
                    <span>Floor {normalizeFloorLabel(currentStep(session)?.floor ?? "G")}</span>
                  </p>
                  <p className="mt-1 text-lg font-medium leading-snug" data-testid="pilot-step-current">{currentStep(session)?.instruction}</p>
                </div>
                {showMetrics && currentStep(session)?.distance_meters != null && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="pilot-step-distance">
                    About {currentStep(session)!.distance_meters} m for this step
                  </p>
                )}
                {upcomingStep(session) && (
                  <p className="mt-2 border-t pt-2 text-xs text-muted-foreground" data-testid="pilot-step-next">
                    <span className="font-medium text-foreground">Then:</span> {upcomingStep(session)!.instruction}
                  </p>
                )}
              </div>
            )}

            {/* Manual progression — MallMind does not detect movement. */}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-h-11 flex-1" disabled={session.stepIndex === 0} onClick={() => send({ type: "previous_step" })} data-testid="pilot-prev">
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />Previous
              </Button>
              {status === "arrived" ? (
                <Button type="button" className="min-h-11 flex-1" onClick={clearDest} data-testid="pilot-new-destination">
                  New destination
                </Button>
              ) : (
                <Button type="button" className="min-h-11 flex-1" onClick={() => send({ type: "next_step" })} data-testid="pilot-next">
                  {session.stepIndex === steps.length - 2 ? "I’m there" : "Next step"}<ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground" data-testid="pilot-manual-note">
              {status === "arrived"
                ? "Not there yet? Tap Previous to go back a step. MallMind does not track your movement."
                : "Tap Next when you’ve done this step. MallMind does not track your movement."}
            </p>

            {reanchorOpen ? reanchorPanel : (
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setReanchorOpen(true)} data-testid="pilot-reanchor">
                  <LocateFixed className="mr-1.5 h-4 w-4" aria-hidden />Update my location
                </Button>
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => send({ type: "restart" })} aria-label="Restart route from the beginning" data-testid="pilot-restart">
                  <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />Restart
                </Button>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border" style={{ height: 200, background: "hsl(240 24% 4%)" }}>
              <IndoorMapCanvas
                floorplan={floorplan}
                activeFloor={activeFloor}
                routePolyline={polyline}
                completedStepIndices={new Set<number>(Array.from({ length: session.stepIndex + 1 }, (_, i) => i))}
                currentStepIndex={session.stepIndex}
                markerStyle="step"
                simulatedPosition={null}
                isDemo={graph.datasetStatus === "schematic"}
              />
            </div>
            <p className="text-xs text-muted-foreground" data-testid="pilot-status-line">{copy.statusLine}</p>
          </section>
        ) : (
          /* ── Route view (route_ready / unroutable) ────────────────────── */
          <section className="space-y-4" data-testid="pilot-route-view">
            {/* Destination + start */}
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-2">
                {embedded && (
                  <button aria-label="Back" onClick={clearDest} className="-ml-1 rounded-full p-1.5 hover:bg-muted">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                )}
                <span className="text-2xl" aria-hidden>{poiIcon(dest)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Going to</p>
                  <p className="truncate text-lg font-semibold leading-tight" data-testid="pilot-dest-name">{dest.name}</p>
                </div>
                <Button variant="outline" size="sm" className="min-h-9" onClick={clearDest}>Change</Button>
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                {anchor.source === "url" || anchor.source === "qr"
                  ? <QrCode className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Start set from a link" />
                  : <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">Starting from</span>
                <select
                  className="ml-auto min-h-9 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                  value={anchor.nodeId}
                  onChange={(e) => changeAnchor(e.target.value)}
                  aria-label="Starting point"
                  data-testid="pilot-start-select"
                >
                  {starts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              {anchorSourceLabel && (
                <p className="mt-1 px-1 text-[11px] text-muted-foreground" data-testid="pilot-anchor-source">
                  Start point {anchorSourceLabel}. Not where you are now? Change it above.
                </p>
              )}
            </div>

            {!hasRoute ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" role="alert" data-testid="pilot-failure">
                <p>{route?.message ?? `We couldn’t route to “${dest.name}”.`}</p>
                <p className="mt-1 text-xs text-muted-foreground">Try another starting point above, or choose a different destination.</p>
              </div>
            ) : (
              <>
                {/* Summary — metres/minutes ONLY for measured routes; never for an unscaled source. */}
                {showMetrics ? (
                  <div className="grid grid-cols-3 gap-2 text-center" data-testid="pilot-summary">
                    <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{route!.total_distance_meters}<span className="text-xs font-normal"> m</span></div><div className="text-[11px] text-muted-foreground">distance</div></div>
                    <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{route!.estimated_minutes}<span className="text-xs font-normal"> min</span></div><div className="text-[11px] text-muted-foreground">walk</div></div>
                    <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{steps[0]?.floor ?? "G"}</div><div className="text-[11px] text-muted-foreground">floor</div></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-center" data-testid="pilot-summary-unscaled">
                    <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{steps.length - 1}</div><div className="text-[11px] text-muted-foreground">{steps.length - 1 === 1 ? "leg" : "legs"}</div></div>
                    <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{steps[0]?.floor ?? "G"}</div><div className="text-[11px] text-muted-foreground">floor</div></div>
                    <p className="col-span-2 text-xs text-muted-foreground" data-testid="pilot-distance-unmeasured">Distance not yet measured — no walking time shown.</p>
                  </div>
                )}

                <Button type="button" className="min-h-12 w-full text-base" onClick={() => send({ type: "start_navigation" })} data-testid="pilot-start-navigation">
                  <Navigation className="mr-2 h-4 w-4" aria-hidden />Start navigation
                </Button>

                {/* Map */}
                <div className="overflow-hidden rounded-xl border" style={{ height: 240, background: "hsl(240 24% 4%)" }}>
                  <IndoorMapCanvas
                    floorplan={floorplan}
                    activeFloor={activeFloor}
                    routePolyline={polyline}
                    completedStepIndices={new Set<number>()}
                    currentStepIndex={-1}
                    simulatedPosition={null}
                    isDemo={graph.datasetStatus === "schematic"}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Directions</p>
                  <Badge variant="outline" className="text-[11px]" data-testid="pilot-route-claim">{claim}</Badge>
                </div>
                <ol className="space-y-2" data-testid="pilot-steps">
                  {steps.map((s, i) => (
                    <li key={s.step} className={`flex gap-3 rounded-lg border px-3 py-2.5 ${i === 0 ? "border-primary/40 bg-primary/5" : ""}`}>
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{s.step}</span>
                      <span className={`text-sm ${i === 0 ? "font-medium" : ""}`}>{s.instruction}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground" data-testid="pilot-status-line">{copy.statusLine}</p>
              </>
            )}
          </section>
        )}
      </main>

      {/* Compact honest-status area (not visually dominant) */}
      <details className="border-t px-4 py-2 text-xs text-muted-foreground" data-testid="pilot-disclaimer">
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <span>{copy.summary}</span>
          <span className="underline">details</span>
        </summary>
        <ul className="space-y-0.5 pt-2 leading-snug">{copy.details.map((d) => <li key={d}>• {d}</li>)}</ul>
      </details>
    </div>
  );
}
