/**
 * WayfindingPilot.tsx — the visitor navigation experience (one implementation, one journey).
 *
 *   OPEN / SCAN → START LOCATION → FIND DESTINATION → ROUTE OVERVIEW → START NAVIGATION →
 *   STEP-BY-STEP WALK (manual Next / Previous) → optional UPDATE MY LOCATION → ARRIVAL → NEXT ACTION
 *
 * Mounted embedded in the Navigate tab (NavigateScreen) and standalone at /pilot for controlled
 * testing. Mall-specific facts (names, starts, destinations, floors, evidence) come only from the
 * Venue Pack registry — this file contains no venue-specific logic.
 *
 * PRODUCT TRUTH: MallMind has no live indoor positioning. Progress is the visitor's own taps; the
 * map marks "the point this step takes you to" and "the point you last confirmed", never "you are
 * here". Metres and minutes appear only when the route is fully measured. Evidence is translated
 * into product language (Preview / Mapped / Verified route) by src/venue/evidence.ts.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, MapPin, Navigation, QrCode, LocateFixed, CheckCircle2, RotateCcw, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import { toFloorplanModel, buildRoutePolyline, attachFloorImages, floorKey } from "@/components/navigation/floorplanModel";
import {
  getWayfindingMall, listWayfindingMalls, startOptions, searchPois, defaultAnchor, anchorFor, anchorAtNode, pointsOfInterest, DEFAULT_WAYFINDING_MALL_ID,
  type PilotPoi, type PilotAnchor,
} from "@/components/navigation/mallDatasets";
import type { LoadedPilotDataset } from "@/components/navigation/mallDatasets";
import { truthCopy as venueTruthCopy, routeClaimExplanation, arrivalWording, arrivalNote } from "@/venue/evidence";
import { floorLabelFor } from "@/venue/instructions";
import {
  createNavigationSession, navigationReducer, sessionSteps, currentStep, upcomingStep, isRoutable,
  type NavigationSession, type NavigationAction,
} from "@/components/navigation/navigationSession";
import { routeClaim, routeEvidenceTier } from "@/components/navigation/routeEvidence";
import { safeSink, type NavigationEventSink } from "@/components/navigation/navigationEvents";
import { persistNavigationSession, loadPersistedNavigationSession, type PersistedNavigationSession } from "@/components/navigation/navigationSessionStore";

// ── Product language ─────────────────────────────────────────────────────────

/** How the trusted start was obtained, in visitor words (internal sources never leak). */
const START_SOURCE_LABEL: Partial<Record<PilotAnchor["source"], string>> = {
  url: "Location set from your link",
  qr: "Location set from MallMind QR",
};

/** Visitor-facing label for a search result's kind (pack vocabulary → words). */
const KIND_LABEL: Record<string, string> = {
  store: "Store", service: "Service", food: "Food", entertainment: "Entertainment", landmark: "Landmark",
  toilet: "Toilets", accessible_toilet: "Accessible toilet", baby_room: "Baby room", information: "Information", atm: "ATM",
  lift: "Lift", escalator: "Escalator", stairs: "Stairs", parking: "Parking", charging: "Charging", security: "Security",
  first_aid: "First aid", food_court: "Food court", seating: "Seating",
};
const kindLabel = (p: PilotPoi): string => KIND_LABEL[p.type] ?? (p.kind === "store" ? "Store" : "Facility");
const poiIcon = (p: PilotPoi): string =>
  p.kind === "store"
    ? ({ food: "🍽️", entertainment: "🎬", service: "🛠️", landmark: "📍" }[p.type] ?? "🛍️")
    : ({ toilet: "🚻", accessible_toilet: "♿", baby_room: "🍼", information: "ℹ️", atm: "🏧", lift: "🛗", escalator: "🪜", stairs: "🪜", parking: "🅿️", charging: "🔌", security: "🛡️", first_aid: "⛑️", food_court: "🍽️", seating: "🪑" }[p.type] ?? "📍");

/** The visitor-facing states this screen can be in (reported to the host so it can adapt its chrome). */
export type NavigationUiMode = "no-venue" | "search" | "overview" | "unroutable" | "walking" | "arrived";

export interface WayfindingPilotProps {
  /** Which registered venue to route over; defaults to the registry's first bundled venue. */
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
  /** Remember the session locally so a refresh or a second QR scan continues it. Default on. */
  rememberSession?: boolean;
  /** Tells the host which product state is showing (e.g. to hide app chrome while walking). */
  onModeChange?: (mode: NavigationUiMode) => void;
  /**
   * A destination chosen OUTSIDE this screen (a `?to=` link, the assistant's resolved navigation
   * intent). Validated against the venue's own vocabulary; an unknown id is ignored and the visitor
   * lands on search. Routing, session and wording are the same as a manual pick.
   */
  initialDestination?: { destinationId: string; source?: "link" | "assistant" } | null;
}

export default function WayfindingPilot({ mallId, onModeChange, ...rest }: WayfindingPilotProps) {
  const graph = useMemo(() => getWayfindingMall(mallId ?? DEFAULT_WAYFINDING_MALL_ID), [mallId]);
  const known = useMemo(() => listWayfindingMalls(), []);

  useEffect(() => { if (!graph) onModeChange?.("no-venue"); }, [graph, onModeChange]);

  if (!graph) {
    // Never invent a map: say so, and offer the venues MallMind can guide in (data, not code).
    return (
      <div data-testid="wayfinding-pilot" data-mall-id={mallId ?? ""} data-ui-mode="no-venue" data-session-status="none">
      <section className="px-4 py-6" data-testid="pilot-no-map" aria-labelledby="pilot-no-map-title">
        <h2 id="pilot-no-map-title" className="text-base font-semibold">MallMind doesn’t have a map for this mall yet.</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a mall MallMind can guide you in:</p>
        <ul className="mt-3 space-y-2" data-testid="pilot-venue-choices">
          {known.map((m) => (
            <li key={m.id}>
              <a href={`/navigate?mall=${encodeURIComponent(m.id)}`} className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-base font-medium">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />{m.name}
              </a>
            </li>
          ))}
        </ul>
      </section>
      </div>
    );
  }
  return <WayfindingPilotView key={`${graph.id}:${rest.initialDestination?.destinationId ?? ""}`} graph={graph} onModeChange={onModeChange} {...rest} />;
}

/** Rebuild a session from a remembered record (validated against the venue; anything stale → null). */
function restoreSession(graph: LoadedPilotDataset, saved: PersistedNavigationSession): NavigationSession | null {
  const destination = pointsOfInterest(graph).find((p) => p.id === saved.destinationId);
  if (!destination) return null;
  const start = startOptions(graph).find((s) => s.id === saved.anchorId || s.nodeId === saved.anchorNodeId);
  if (!start) return null;
  let s = createNavigationSession(graph.id, anchorFor(graph, start.id, saved.anchorSource));
  s = navigationReducer(graph, s, { type: "select_destination", destination });
  if (s.status !== "route_ready") return s.status === "unroutable" ? s : null;
  if (saved.status === "navigating" || saved.status === "arrived") {
    s = navigationReducer(graph, s, { type: "start_navigation" });
    // Clamp: a walking session never restores onto the arrival step; an arrived one restores as arrived.
    const last = sessionSteps(s).length - 1;
    const cap = saved.status === "arrived" ? last : Math.max(0, last - 1);
    for (let i = 0; i < Math.min(saved.stepIndex, cap); i++) s = navigationReducer(graph, s, { type: "next_step" });
  }
  return s;
}

/**
 * Build the initial session. A remembered session for THIS venue (within its TTL) is restored so
 * a refresh, browser back/forward or a second QR scan continues the journey; a link/QR anchor
 * arriving on top of it re-anchors (destination kept, route recalculated). Nothing is restored
 * across venues or after expiry, and anything that no longer resolves starts fresh.
 */
function initialSession(graph: LoadedPilotDataset, initialAnchor: PilotAnchor | null | undefined, remember: boolean, initialDestination?: { destinationId: string } | null): NavigationSession {
  const anchor = initialAnchor ?? defaultAnchor(graph);
  const fresh = createNavigationSession(graph.id, anchor);
  // An explicit destination (link / assistant intent) is validated against the venue and, when
  // known, becomes a fresh route from the trusted start — the same reducer path as a manual pick.
  const wanted = initialDestination ? pointsOfInterest(graph).find((p) => p.id === initialDestination.destinationId) ?? null : null;
  const base = (() => {
    if (!remember) return fresh;
    const saved = loadPersistedNavigationSession(graph.id);
    if (!saved) return fresh;
    const restored = restoreSession(graph, saved);
    if (!restored) return fresh;
    if (!initialAnchor) return restored;
    if (saved.anchorNodeId === initialAnchor.nodeId) return { ...restored, anchor: initialAnchor };
    return navigationReducer(graph, restored, { type: "reanchor", anchor: initialAnchor });
  })();
  return wanted ? navigationReducer(graph, { ...base, destination: null, route: null, status: "destination_selection", stepIndex: 0, completedSteps: [], lastReanchor: null }, { type: "select_destination", destination: wanted }) : base;
}

/** Walking mode owns one history entry so the browser Back button returns to the overview instead of leaving the app. */
function useWalkingHistory(active: boolean, onBack: () => void) {
  const pushed = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (active && !pushed.current) {
      try { window.history.pushState({ ...(window.history.state ?? {}), mallmindWalking: true }, ""); pushed.current = true; } catch { /* ignore */ }
    }
    if (!active) pushed.current = false;
  }, [active]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (e: PopStateEvent) => {
      const walkingEntry = Boolean((e.state as { mallmindWalking?: boolean } | null)?.mallmindWalking);
      if (pushed.current && !walkingEntry) { pushed.current = false; onBackRef.current(); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}

function WayfindingPilotView({ graph, initialAnchor, anchorNotice, embedded, onOpenAssistant, onEvent, rememberSession = true, onModeChange, initialDestination }: Omit<WayfindingPilotProps, "mallId"> & { graph: LoadedPilotDataset }) {
  const starts = useMemo(() => startOptions(graph), [graph]);
  const floorplan = useMemo(
    () => attachFloorImages(
      toFloorplanModel({ nodes: graph.nodes, edges: graph.edges }, { mallId: graph.id, mallName: graph.name }, { floors: graph.floors }),
      graph.floorImages,
    ),
    [graph],
  );
  const copy = useMemo(() => venueTruthCopy(graph.pack.venue, graph.metric), [graph]);
  const tier = routeEvidenceTier(graph);
  const claim = routeClaim(graph);
  const multiFloor = graph.floors.length > 1;
  const emit = useMemo(() => safeSink(onEvent), [onEvent]);

  const [session, setSession] = useState<NavigationSession>(() => initialSession(graph, initialAnchor, rememberSession, initialDestination));
  const [query, setQuery] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null);

  /** Apply an action and emit the matching lightweight events (best-effort, never blocking). */
  function send(action: NavigationAction) {
    const next = navigationReducer(graph, session, action);
    setSession(next);
    const base = { destination: next.destination?.id ?? null, anchor: next.anchor.nodeId, anchorSource: next.anchor.source, evidence: tier };
    switch (action.type) {
      case "select_destination":
        emit({ name: "destination_selected", mallId: graph.id, detail: { ...base, kind: action.destination.kind } });
        if (next.status === "unroutable") emit({ name: "navigation_unroutable", mallId: graph.id, detail: { ...base, reason: next.route?.message ?? "unroutable" } });
        else emit({ name: "route_overview_opened", mallId: graph.id, detail: { ...base, steps: sessionSteps(next).length, metric: Boolean(next.route?.metric) } });
        break;
      case "start_navigation":
        if (next.status !== session.status) emit({ name: "navigation_session_started", mallId: graph.id, detail: { ...base, steps: sessionSteps(next).length, metric: Boolean(next.route?.metric) } });
        break;
      case "next_step":
        if (next.stepIndex !== session.stepIndex) emit({ name: "navigation_step_advanced", mallId: graph.id, detail: { ...base, step: next.stepIndex + 1 } });
        if (next.status === "arrived" && session.status !== "arrived") emit({ name: "navigation_arrived", mallId: graph.id, detail: base });
        break;
      case "previous_step":
        if (next.stepIndex !== session.stepIndex) emit({ name: "navigation_step_back", mallId: graph.id, detail: { ...base, step: next.stepIndex + 1 } });
        break;
      case "reanchor":
        emit({ name: "navigation_reanchored", mallId: graph.id, detail: { ...base, from: session.anchor.nodeId, routable: isRoutable(next) } });
        if (next.status === "unroutable") emit({ name: "navigation_unroutable", mallId: graph.id, detail: { ...base, reason: next.route?.message ?? "unroutable" } });
        break;
      case "restart":
        emit({ name: "navigation_restarted", mallId: graph.id, detail: base });
        break;
      default:
        break;
    }
    return next;
  }

  // A new incoming link anchor (e.g. scanning a second QR in the same page) re-anchors the session.
  const lastLinkAnchor = useRef<PilotAnchor | null | undefined>(initialAnchor);
  useEffect(() => {
    if (initialAnchor && initialAnchor !== lastLinkAnchor.current) {
      lastLinkAnchor.current = initialAnchor;
      setLocationOpen(false);
      send({ type: "reanchor", anchor: initialAnchor });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnchor]);

  // Remember the session for refresh / re-entry (best-effort).
  useEffect(() => { if (rememberSession) persistNavigationSession(session); }, [session, rememberSession]);

  const { anchor, destination: dest, route, status } = session;
  const hasRoute = isRoutable(session);
  const steps = sessionSteps(session);
  const walking = status === "navigating";
  const arrived = status === "arrived";
  const mode: NavigationUiMode = !dest ? "search" : status === "unroutable" ? "unroutable" : walking ? "walking" : arrived ? "arrived" : "overview";
  useEffect(() => { onModeChange?.(mode); }, [mode, onModeChange]);

  // Move focus to the instruction whenever the step or route changes while walking.
  useEffect(() => {
    if (walking || arrived) focusRef.current?.focus();
  }, [walking, arrived, session.stepIndex, session.routeRevision]);

  // Browser Back while walking → route overview (route kept). Never destroys the route.
  useWalkingHistory(walking || arrived, () => setSession((s) => (s.status === "navigating" || s.status === "arrived" ? navigationReducer(graph, s, { type: "restart" }) : s)));

  const results = useMemo(() => searchPois(graph, query), [graph, query]);
  // Steps record their "to" node, so prepend the chosen start node: the START pin and the first
  // route segment then begin at the entrance the visitor actually chose, not at the first junction.
  const polyline = useMemo(() => {
    if (!hasRoute) return [];
    const startNode = graph.nodes.find((n) => n.id === anchor.nodeId);
    const lead = startNode
      ? [{ node_id: startNode.id, floor: startNode.floor, x_coordinate: startNode.x_coordinate, y_coordinate: startNode.y_coordinate }]
      : [];
    return buildRoutePolyline([...lead, ...steps]);
  }, [hasRoute, graph, anchor.nodeId, steps]);
  // The map shows the floor of the point the visitor LAST CONFIRMED: while a floor-change step is
  // current the visitor is still on the origin floor; only after tapping Next does the map switch.
  const anchorNode = graph.nodes.find((n) => n.id === anchor.nodeId) ?? null;
  const confirmedFloorId = (i: number) => (i <= 0 ? anchorNode?.floor : steps[i - 1]?.floor) ?? graph.floors[0]?.id;
  const activeFloor = floorKey(walking || arrived ? confirmedFloorId(arrived ? steps.length - 1 : session.stepIndex) : anchorNode?.floor ?? graph.floors[0]?.id);
  /** Floors this route visits, in order, with the connector that links each pair (for the floor strip). */
  const floorPath = useMemo(() => {
    const out: Array<{ floor: string; via: string | null }> = [];
    const first = anchorNode?.floor ?? steps[0]?.floor ?? graph.floors[0]?.id;
    if (first) out.push({ floor: first, via: null });
    for (const s of steps) if (s.via && s.via.to_floor !== out[out.length - 1]?.floor) out.push({ floor: s.via.to_floor, via: s.via.kind });
    return out;
  }, [anchorNode, steps, graph.floors]);
  const floorLabel = (id: string | null | undefined) => floorLabelFor(graph.floors, id ?? graph.floors[0]?.id, graph.policies.floors.display);
  const currentAnchorId = anchor.anchorId ?? starts.find((s) => s.nodeId === anchor.nodeId)?.id ?? anchor.nodeId;
  const startSource = START_SOURCE_LABEL[anchor.source] ?? null;
  const showMetrics = Boolean(hasRoute && route!.metric && route!.total_distance_meters !== null);
  const showMinutes = Boolean(showMetrics && route!.estimated_minutes !== null);
  const connectorRides = hasRoute ? route!.connector_count : 0;
  const CONNECTOR_WORD: Record<string, string> = { lift: "lift", escalator: "escalator", stairs: "stairs", ramp: "ramp" };
  const connectorWord = (kind: string) => CONNECTOR_WORD[kind] ?? "floor change";
  /** The current step's connector, positioned at its landing on the floor the visitor is on. */
  const connectorMarker = useMemo(() => {
    if (!walking) return null;
    const step = steps[session.stepIndex];
    if (!step?.via) return null;
    const landing = graph.nodes.find((n) => n.id === (steps[session.stepIndex - 1]?.node_id ?? anchor.nodeId));
    if (!landing) return null;
    return { x: (landing.x_coordinate ?? 0) * 10, y: (landing.y_coordinate ?? 0) * 6.2, label: `${connectorWord(step.via.kind).replace(/^./, (c) => c.toUpperCase())} to ${floorLabel(step.via.to_floor)}`, kind: step.via.kind };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, steps, session.stepIndex, graph, anchor.nodeId]);
  const exampleNames = useMemo(() => searchPois(graph, "").slice(0, 4).map((p) => p.name).join(", "), [graph]);
  const destNode = dest ? graph.nodes.find((n) => n.linked_shop_id === dest.id || n.id === dest.id) ?? null : null;
  const destArrival = (destNode?.arrival_evidence as "verified_public_door" | "corridor_arrival" | "unknown" | null | undefined) ?? undefined;
  const legCount = Math.max(0, steps.length - 1);
  const lastStep = Math.max(0, steps.length - 1);
  const nextIsArrival = session.stepIndex === steps.length - 2;
  /** After arrival, the destination becomes the next trusted start ONLY if the venue lists a start anchor at that node. */
  const arrivalAnchor = dest && destNode ? anchorAtNode(graph, destNode.id) : null;

  function choose(p: PilotPoi) { setLocationOpen(false); send({ type: "select_destination", destination: p }); }
  function changeDestination() { setQuery(""); setLocationOpen(false); send({ type: "clear_destination" }); }
  function changeAnchor(anchorId: string, source: PilotAnchor["source"] = "manual") {
    setLocationOpen(false);
    send({ type: "reanchor", anchor: anchorFor(graph, anchorId, source) });
  }
  function openLocation() {
    setLocationOpen(true);
    emit({ name: "location_update_opened", mallId: graph.id, detail: { destination: dest?.id ?? null, anchor: anchor.nodeId, status } });
  }
  function restart() {
    setLocationOpen(false);
    const back = send({ type: "restart" });
    setSession(navigationReducer(graph, back, { type: "start_navigation" }));
  }
  function navigateFromHere() {
    if (!arrivalAnchor) return;
    setQuery("");
    const moved = send({ type: "reanchor", anchor: arrivalAnchor });
    setSession(navigationReducer(graph, moved, { type: "clear_destination" }));
  }
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results.length > 0) { e.preventDefault(); choose(results[0]); }
    if (e.key === "Escape") setQuery("");
  }

  // ── Shared pieces ──────────────────────────────────────────────────────────
  const startChip = (
    <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2.5" data-testid="pilot-anchor-summary">
      {anchor.source === "qr" ? <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Starting from</p>
        <p className="text-base font-semibold leading-tight">{anchor.label}</p>
        {startSource && <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="pilot-anchor-source">{startSource}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" className="min-h-9 shrink-0" onClick={locationOpen ? () => setLocationOpen(false) : openLocation} data-testid="pilot-change-start" aria-expanded={locationOpen}>
        Change start
      </Button>
    </div>
  );

  const locationPanel = (
    <div className="rounded-xl border bg-card p-3" role="group" aria-labelledby="pilot-reanchor-title" data-testid="pilot-reanchor-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pilot-reanchor-title" className="text-sm font-semibold">Update my location</h2>
        <button type="button" aria-label="Close" onClick={() => setLocationOpen(false)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        Choose a nearby MallMind location or scan another MallMind QR code.{dest ? <> Your route to <span className="font-medium text-foreground">{dest.name}</span> will be recalculated from there.</> : null}
      </p>
      <ul className="mt-2 space-y-1.5" data-testid="pilot-reanchor-options">
        {starts.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => changeAnchor(s.id, "manual")}
              aria-current={s.id === currentAnchorId ? "location" : undefined}
              className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-base ${s.id === currentAnchorId ? "border-primary/50 bg-primary/5 font-medium" : ""}`}
            >
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1">{s.label}</span>
              {s.id === currentAnchorId && <span className="text-[11px] text-muted-foreground">current</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const routeUpdated = session.lastReanchor && (
    <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm leading-snug" role="status" data-testid="pilot-route-updated">
      <span className="font-medium">Route updated</span> — now starting from {session.lastReanchor.to.label}
      {START_SOURCE_LABEL[session.lastReanchor.to.source] ? ` (${START_SOURCE_LABEL[session.lastReanchor.to.source].toLowerCase()})` : ""}.
      {walking || arrived ? " Your steps start again from here." : ""}
    </div>
  );

  const routeDetails = (
    <details className="rounded-lg border px-3 py-2 text-xs text-muted-foreground" data-testid="pilot-disclaimer" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-0.5">
        <span className="flex items-center gap-1.5"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden /><span data-testid="pilot-status-line">{copy.summary}</span></span>
        <span className="shrink-0 underline">Route details</span>
      </summary>
      <ul className="space-y-1 pt-2 leading-snug">{copy.details.map((d) => <li key={d}>• {d}</li>)}</ul>
    </details>
  );

  const claimBadge = <Badge variant="outline" className="shrink-0 text-[11px]" data-testid="pilot-route-claim" title={routeClaimExplanation(tier)}>{claim}</Badge>;

  const header = embedded ? null : (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
      {dest && (
        <button type="button" aria-label="Back" onClick={changeDestination} className="-ml-1 grid h-11 w-11 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold leading-tight">{graph.name}</h1>
        <p className="truncate text-xs text-muted-foreground">Find a place and get walked there</p>
      </div>
    </header>
  );

  const mapBox = (height: number, walk: boolean) => (
    <div className="overflow-hidden rounded-xl border" style={{ height, background: "hsl(240 24% 4%)" }}>
      <IndoorMapCanvas
        floorplan={floorplan}
        activeFloor={activeFloor}
        routePolyline={polyline}
        progress={walk ? { confirmedIndex: Math.min(session.stepIndex, Math.max(0, polyline.length - 1)) } : null}
        mode={walk ? "walking" : "overview"}
        connectorMarker={walk ? connectorMarker : null}
      />
    </div>
  );

  // ── Views ──────────────────────────────────────────────────────────────────
  let view: ReactNode;

  if (!dest) {
    view = (
      <section data-testid="pilot-finder" className="space-y-4" aria-label="Find a destination">
        {startChip}
        {locationOpen && locationPanel}
        {routeUpdated}
        <div>
          <label htmlFor="pilot-search" id="pilot-search-title" className="mb-1.5 block text-base font-semibold">Where do you want to go?</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="pilot-search"
              type="search"
              inputMode="search"
              enterKeyHint="go"
              autoComplete="off"
              autoFocus={!locationOpen}
              className="h-12 pl-9 text-base"
              placeholder="Search a shop, toilets, ATM…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              aria-describedby="pilot-search-help"
              data-testid="pilot-search"
            />
          </div>
          <p id="pilot-search-help" className="mt-1.5 text-xs text-muted-foreground">Type a name, or pick from the list. Results show where MallMind can walk you to.</p>
        </div>

        {results.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="pilot-no-result" role="status">
            <p className="font-medium text-foreground">No match for “{query.trim()}”.</p>
            <p className="mt-1">Try another spelling, or a place like {exampleNames}.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3 min-h-10" onClick={() => setQuery("")}>Show all places</Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2" data-testid="pilot-suggestions" aria-label="Places you can walk to">
            {results.map((p) => (
              <li key={`${p.kind}-${p.id}`}>
                <button
                  type="button"
                  onClick={() => choose(p)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left active:scale-[0.99]"
                >
                  <span className="text-xl" aria-hidden>{poiIcon(p)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium leading-snug">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{kindLabel(p)}</span>
                  </span>
                  <Navigation className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {onOpenAssistant && (
          <Button type="button" variant="ghost" size="sm" className="h-auto min-h-10 w-full whitespace-normal text-muted-foreground" onClick={onOpenAssistant}>
            Looking for a product instead? Ask the assistant
          </Button>
        )}
        {routeDetails}
      </section>
    );
  } else if (status === "unroutable") {
    view = (
      <section className="space-y-4" data-testid="pilot-route-view" aria-labelledby="pilot-unroutable-title">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Back to search" onClick={changeDestination} className="-ml-1 grid h-11 w-11 place-items-center rounded-full hover:bg-muted">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Going to</p>
            <p className="line-clamp-2 text-lg font-semibold leading-tight" data-testid="pilot-dest-name">{dest.name}</p>
          </div>
        </div>
        {startChip}
        {locationOpen && locationPanel}
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3" role="alert" data-testid="pilot-failure">
          <h2 id="pilot-unroutable-title" className="text-base font-semibold">We don’t have a mapped route between these points yet.</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try starting from another MallMind location, or choose a different place.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" onClick={openLocation} data-testid="pilot-reanchor"><LocateFixed className="mr-1.5 h-4 w-4 shrink-0" aria-hidden />Update my location</Button>
          <Button type="button" className="h-auto min-h-12 whitespace-normal" onClick={changeDestination} data-testid="pilot-change-destination">Choose another destination</Button>
        </div>
        {routeDetails}
      </section>
    );
  } else if (walking || arrived) {
    const step = currentStep(session);
    const next = upcomingStep(session);
    view = (
      <section className="space-y-3" data-testid="pilot-navigation" aria-label={arrived ? `Arrived at ${dest.name}` : `Walking to ${dest.name}`}>
        {/* DESTINATION */}
        <div className="flex items-start gap-2">
          <button type="button" aria-label="Back to route overview" onClick={() => setSession((s) => navigationReducer(graph, s, { type: "restart" }))} className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-muted">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Going to</p>
            <p className="line-clamp-2 text-lg font-semibold leading-tight" data-testid="pilot-dest-name">{dest.name}</p>
          </div>
          <div className="pt-1.5">{claimBadge}</div>
        </div>

        {!arrived && routeUpdated}

        {arrived ? (
          /* ARRIVAL */
          <div ref={focusRef} tabIndex={-1} className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 outline-none" data-testid="pilot-arrival" role="status">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" aria-hidden />
              <h2 className="text-xl font-semibold leading-snug">{arrivalWording(dest.name, destArrival, tier)}</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground" data-testid="pilot-arrival-note">
              {arrivalNote({ name: dest.name, evidence: { identity: "unverified", arrival: destArrival ?? "unknown" } }, tier)}
            </p>
          </div>
        ) : (
          /* PROGRESS + CURRENT INSTRUCTION */
          <div className="rounded-xl border bg-primary/5 p-4" data-testid="pilot-step-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-muted-foreground" data-testid="pilot-step-counter">
                Step {session.stepIndex + 1} of {steps.length}
                {multiFloor ? <span data-testid="pilot-current-floor"> · You are on {floorLabel(confirmedFloorId(session.stepIndex))}</span> : null}
              </p>
            </div>
            <div className="mt-2 flex gap-1" role="progressbar" aria-label="Steps you have confirmed" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={Math.min(session.stepIndex, lastStep)} data-testid="pilot-progress">
              {steps.map((s, i) => <span key={s.step} className={`h-1.5 flex-1 rounded-full ${i < session.stepIndex ? "bg-primary" : i === session.stepIndex ? "bg-primary/60 ring-1 ring-primary" : "bg-muted"}`} />)}
            </div>
            <div ref={focusRef} tabIndex={-1} className="mt-3 outline-none">
              <h2 className="text-[1.375rem] font-semibold leading-snug [overflow-wrap:anywhere] min-[390px]:text-2xl" data-testid="pilot-step-current">{step?.instruction}</h2>
            </div>
            {showMetrics && step?.distance_meters != null && (
              <p className="mt-1.5 text-sm text-muted-foreground" data-testid="pilot-step-distance">About {step.distance_meters} m for this step</p>
            )}
            {step?.via && (
              <p className="mt-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm leading-snug" data-testid="pilot-floor-change-note">
                When you are on <span className="font-medium">{floorLabel(step.via.to_floor)}</span>, tap {nextIsArrival ? "I’m there" : "Next"}. The map will switch floors then.
              </p>
            )}
          </div>
        )}

        {/* MAP: current leg highlighted, target waypoint numbered */}
        {mapBox(184, true)}

        {/* NEXT PREVIEW */}
        {!arrived && next && session.stepIndex + 1 < lastStep && (
          <p className="text-sm text-muted-foreground" data-testid="pilot-step-next">
            <span className="font-medium text-foreground">Then:</span> {next.instruction}
          </p>
        )}

        {/* RECOVERY */}
        {locationOpen ? locationPanel : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">Not sure where you are?</span>
            <Button type="button" variant="link" className="h-auto min-h-10 px-0 text-sm" onClick={openLocation} data-testid="pilot-reanchor">
              <LocateFixed className="mr-1 h-4 w-4" aria-hidden />Update my location
            </Button>
          </div>
        )}

        {arrived ? (
          /* NEXT ACTION after arrival */
          <div className="space-y-2" data-testid="pilot-arrival-actions">
            <Button type="button" className="h-14 w-full text-base" onClick={changeDestination} data-testid="pilot-new-destination">
              <Search className="mr-2 h-4 w-4" aria-hidden />Find another place
            </Button>
            {arrivalAnchor ? (
              <Button type="button" variant="outline" className="h-auto min-h-12 w-full whitespace-normal" onClick={navigateFromHere} data-testid="pilot-navigate-from-here">
                <MapPin className="mr-2 h-4 w-4 shrink-0" aria-hidden />Navigate from {arrivalAnchor.label}
              </Button>
            ) : (
              <p className="text-xs leading-snug text-muted-foreground" data-testid="pilot-navigate-from-here-unavailable">
                Your next route will still start from {anchor.label}. To start from here, scan the MallMind QR code nearest you or update your location above.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => send({ type: "previous_step" })} data-testid="pilot-prev">
                <ChevronLeft className="mr-1 h-4 w-4 shrink-0" aria-hidden />Not there yet
              </Button>
              <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={restart} data-testid="pilot-restart">
                <RotateCcw className="mr-1 h-4 w-4 shrink-0" aria-hidden />Restart route
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Button type="button" variant="link" className="h-auto min-h-10 px-0 text-sm text-muted-foreground" onClick={restart} data-testid="pilot-restart"><RotateCcw className="mr-1 h-4 w-4" aria-hidden />Restart route</Button>
              <Button type="button" variant="link" className="h-auto min-h-10 px-0 text-sm text-muted-foreground" onClick={changeDestination} data-testid="pilot-change-destination"><Search className="mr-1 h-4 w-4" aria-hidden />Change destination</Button>
            </div>
            {routeDetails}
          </>
        )}
        {arrived && routeDetails}

        {/* CONTROLS — pinned to the bottom of the phone screen (fixed; sticky inside the desktop frame), safe-area aware, manual by design */}
        {!arrived && <div className="mm-walk-spacer h-24 md:hidden" aria-hidden />}
        {!arrived && (
          <div className="mm-walk-controls fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pt-2 backdrop-blur md:sticky md:inset-x-auto md:-mx-4" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }} data-testid="pilot-controls">
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-14 min-w-[6.5rem] shrink-0 text-base" disabled={session.stepIndex === 0} onClick={() => send({ type: "previous_step" })} data-testid="pilot-prev" aria-label="Previous step">
                <ChevronLeft className="mr-1 h-5 w-5" aria-hidden />Previous
              </Button>
              <Button type="button" className="h-14 min-w-0 flex-1 text-base font-semibold" onClick={() => send({ type: "next_step" })} data-testid="pilot-next" aria-label={nextIsArrival ? "I’m there" : "Next step"}>
                {nextIsArrival ? "I’m there" : "Next"}<ChevronRight className="ml-1 h-5 w-5 shrink-0" aria-hidden />
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[11px] leading-snug text-muted-foreground" data-testid="pilot-manual-note">
              {step?.via ? `When you are on ${floorLabel(step.via.to_floor)}, tap ${nextIsArrival ? "I’m there" : "Next"}.` : `When you reach this point, tap ${nextIsArrival ? "I’m there" : "Next"}.`} MallMind does not track your movement.
            </p>
          </div>
        )}
        {arrived && (
          <p className="text-[11px] leading-snug text-muted-foreground" data-testid="pilot-manual-note">MallMind does not track your movement — you confirmed each step yourself.</p>
        )}
      </section>
    );
  } else {
    /* ROUTE OVERVIEW */
    view = (
      <section className="space-y-4" data-testid="pilot-route-view" aria-labelledby="pilot-overview-title">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Back to search" onClick={changeDestination} className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-muted">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Route overview</p>
            <h2 id="pilot-overview-title" className="line-clamp-2 text-lg font-semibold leading-tight"><span className="sr-only">Going to </span><span data-testid="pilot-dest-name">{dest.name}</span></h2>
          </div>
          {claimBadge}
        </div>

        {/* FROM / TO */}
        <div className="rounded-xl border bg-card p-3" data-testid="pilot-from-to">
          <div className="flex items-start gap-2">
            {anchor.source === "qr" ? <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">From</p>
              <p className="text-base font-semibold leading-tight">{anchor.label}</p>
              {startSource && <p className="text-[11px] text-muted-foreground" data-testid="pilot-anchor-source">{startSource}</p>}
            </div>
            <label className="sr-only" htmlFor="pilot-start-select">Starting point</label>
            <select
              id="pilot-start-select"
              className="min-h-9 max-w-[45%] rounded-md border bg-background px-2 py-1 text-sm"
              value={currentAnchorId}
              onChange={(e) => changeAnchor(e.target.value)}
              data-testid="pilot-start-select"
            >
              {starts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="mt-2 flex items-start gap-2 border-t pt-2">
            <span className="mt-0.5 text-base leading-none" aria-hidden>{poiIcon(dest)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">To</p>
              <p className="text-base font-semibold leading-tight">{dest.name} <span className="text-xs font-normal text-muted-foreground">· {kindLabel(dest)}</span></p>
            </div>
          </div>
        </div>

        {routeUpdated}
        {locationOpen && locationPanel}

        {/* FLOORS visited (multi-floor routes only) */}
        {floorPath.length > 1 && (
          <ol className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="pilot-floor-strip" aria-label="Floors on this route">
            {floorPath.map((f, i) => (
              <li key={`${f.floor}-${i}`} className="flex items-center gap-1.5">
                {f.via && <span className="text-xs text-muted-foreground" aria-label={`then by ${connectorWord(f.via)}`}>→ {connectorWord(f.via)} →</span>}
                <span className={`rounded-full border px-2.5 py-1 ${i === 0 ? "bg-primary/10 font-medium" : i === floorPath.length - 1 ? "bg-emerald-500/10 font-medium" : ""}`}>
                  {floorLabel(f.floor)}{i === 0 ? " (start)" : i === floorPath.length - 1 ? " (destination)" : ""}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* MAP: whole route on the start floor */}
        {mapBox(220, false)}

        {/* DETAILS */}
        {showMetrics ? (
          <dl className="grid grid-cols-3 gap-2 text-center" data-testid="pilot-summary">
            <div className="rounded-lg border py-2"><dd className="text-lg font-semibold">{route!.total_distance_meters}<span className="text-xs font-normal"> m</span></dd><dt className="text-[11px] text-muted-foreground">walking</dt></div>
            {showMinutes ? (
              <div className="rounded-lg border py-2"><dd className="text-lg font-semibold">{route!.estimated_minutes}<span className="text-xs font-normal"> min</span></dd><dt className="text-[11px] text-muted-foreground">time</dt></div>
            ) : (
              <div className="rounded-lg border px-1 py-2" data-testid="pilot-time-unmeasured"><dd className="text-sm font-semibold leading-tight">+ {connectorRides} {connectorRides === 1 ? "ride" : "rides"}</dd><dt className="text-[11px] text-muted-foreground">time not measured</dt></div>
            )}
            <div className="rounded-lg border py-2"><dd className="text-lg font-semibold">{legCount}</dd><dt className="text-[11px] text-muted-foreground">{legCount === 1 ? "step" : "steps"}</dt></div>
          </dl>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-center" data-testid="pilot-summary-unscaled">
            <div className="rounded-lg border py-2"><dd className="text-lg font-semibold">{legCount}</dd><dt className="text-[11px] text-muted-foreground">{legCount === 1 ? "step" : "steps"}</dt></div>
            <div className="rounded-lg border px-2 py-2"><dd className="line-clamp-2 text-sm font-semibold leading-tight">{floorLabel(steps[0]?.floor)}</dd><dt className="text-[11px] text-muted-foreground">floor</dt></div>
            <p className="col-span-2 text-xs text-muted-foreground" data-testid="pilot-distance-unmeasured">Distance not yet measured</p>
          </dl>
        )}
        {showMetrics && floorPath.length <= 1 && <p className="text-xs text-muted-foreground">Floor: {floorLabel(steps[0]?.floor)}</p>}
        {connectorRides > 0 && <p className="text-xs text-muted-foreground" data-testid="pilot-connector-summary">Includes {connectorRides} floor {connectorRides === 1 ? "change" : "changes"}. You confirm each one yourself.</p>}

        {/* PRIMARY */}
        <Button type="button" className="h-14 w-full text-base font-semibold" onClick={() => send({ type: "start_navigation" })} data-testid="pilot-start-navigation">
          <Navigation className="mr-2 h-5 w-5" aria-hidden />Start navigation
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={changeDestination} data-testid="pilot-change-destination">Change destination</Button>
          <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={locationOpen ? () => setLocationOpen(false) : openLocation} data-testid="pilot-reanchor" aria-expanded={locationOpen}><LocateFixed className="mr-1.5 h-4 w-4 shrink-0" aria-hidden />Update my location</Button>
        </div>

        {/* STEPS */}
        <div>
          <h3 className="mb-2 text-sm font-medium">Directions</h3>
          <ol className="space-y-2" data-testid="pilot-steps">
            {steps.map((s, i) => (
              <li key={s.step} className="flex gap-3 rounded-lg border px-3 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold" aria-hidden>{s.step}</span>
                <span className="text-sm leading-snug"><span className="sr-only">Step {s.step}: </span>{s.instruction}</span>
              </li>
            ))}
          </ol>
        </div>
        {routeDetails}
      </section>
    );
  }

  return (
    <div
      className={embedded ? "flex flex-col" : "mx-auto flex min-h-[100dvh] max-w-md flex-col bg-background"}
      data-testid="wayfinding-pilot"
      data-mall-id={graph.id}
      data-dataset-status={tier}
      data-metric={graph.metric ? "true" : "false"}
      data-session-status={status}
      data-ui-mode={mode}
    >
      {header}
      <main className={embedded ? "flex-1 px-4 pb-2" : "flex-1 px-4 py-4"}>
        {anchorNotice && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm leading-snug" role="status" data-testid="pilot-anchor-notice">
            {anchorNotice}
          </div>
        )}
        {view}
      </main>
    </div>
  );
}
