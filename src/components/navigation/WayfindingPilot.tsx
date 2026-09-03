/**
 * WayfindingPilot.tsx — the shared destination-first wayfinding experience.
 *
 * One implementation, two mounts:
 *   • /navigate (NavigateScreen) — embedded inside MobileShell for shoppers.
 *   • /pilot (MallRedsPilot)     — standalone, for controlled testing.
 *
 * Flow: "Where do you want to go?" → pick a real tenant or amenity → "Starting from …" (changeable,
 * re-routes instantly) → route summary + first instruction + map + step-by-step viewer. Reuses
 * pilotBuildRoute + IndoorMapCanvas over whichever mall dataset `mallId` selects (mallDatasets.ts).
 *
 * The route depends ONLY on a start ANCHOR (PilotAnchor). Today it comes from manual selection or a
 * /navigate?mall=&start= link (what QR signage encodes); a future positioning provider fills the
 * same seam. NO live positioning, NO official-floorplan claim, NO product/price dependency, NO
 * simulated movement.
 *
 * DISTANCE TRUTH: metres and minutes are rendered only when the route reports `metric: true`
 * (every traversed edge measured). An unscaled, source-backed dataset shows topology only and the
 * line "Source-backed route preview. Distance not yet measured."
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, MapPin, Navigation, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import { toFloorplanModel, buildRoutePolyline, attachFloorImages, normalizeFloorLabel } from "@/components/navigation/floorplanModel";
import { pilotBuildRoute } from "@/components/navigation/pilotRoute";
import {
  getWayfindingMall, startOptions, searchPois, defaultAnchor, anchorFor, DEFAULT_WAYFINDING_MALL_ID,
  type PilotPoi, type PilotAnchor,
} from "@/components/navigation/mallDatasets";
import type { LoadedPilotDataset } from "@/components/navigation/mallRedsPilotDataset";

const poiIcon = (p: PilotPoi): string =>
  p.kind === "store" ? "🛍️" : ({ toilet: "🚻", lift: "🛗", escalator: "🪜", stairs: "🪜", food_court: "🍽️", landmark: "ℹ️" }[p.type] ?? "📍");

const ANCHOR_SOURCE_LABEL: Partial<Record<PilotAnchor["source"], string>> = {
  url: "from your link",
  qr: "from the QR code you scanned",
};

/** Honest status wording derived from the DATA, never from the UI's optimism. */
function truthCopy(g: LoadedPilotDataset): { summary: string; statusLine: string; details: string[] } {
  const measured = g.metric ? "" : " Distance not yet measured.";
  if (g.datasetStatus === "schematic") {
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
  const verified = g.fieldVerified ? "walked on site" : "not yet walked on site";
  return {
    summary: `Source-backed route preview · ${verified}${g.metric ? "" : " · distance not measured"}`,
    statusLine: `Source-backed route preview.${measured} Your position is not tracked.`,
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
}

export default function WayfindingPilot({ mallId, initialAnchor, anchorNotice, embedded, onOpenAssistant }: WayfindingPilotProps) {
  const graph = useMemo(() => getWayfindingMall(mallId ?? DEFAULT_WAYFINDING_MALL_ID), [mallId]);

  if (!graph) {
    // Defensive: callers validate mall ids first (wayfindingAnchor.ts); never invent a map.
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground" data-testid="pilot-no-map">
        MallMind does not have a map for this mall yet.
      </div>
    );
  }
  return <WayfindingPilotView key={graph.mallId} graph={graph} initialAnchor={initialAnchor} anchorNotice={anchorNotice} embedded={embedded} onOpenAssistant={onOpenAssistant} />;
}

function WayfindingPilotView({ graph, initialAnchor, anchorNotice, embedded, onOpenAssistant }: Omit<WayfindingPilotProps, "mallId"> & { graph: LoadedPilotDataset }) {
  const starts = useMemo(() => startOptions(graph), [graph]);
  const floorplan = useMemo(
    () => attachFloorImages(
      toFloorplanModel({ nodes: graph.nodes, edges: graph.edges }, { mallId: graph.mallId, mallName: graph.mallName }),
      graph.floorImages,
    ),
    [graph],
  );
  const copy = useMemo(() => truthCopy(graph), [graph]);

  const [anchor, setAnchor] = useState<PilotAnchor>(() => initialAnchor ?? defaultAnchor(graph));
  const [dest, setDest] = useState<PilotPoi | null>(null);
  const [query, setQuery] = useState("");
  const [stepMode, setStepMode] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  // A new incoming link anchor (e.g. scanning a second QR) replaces the start.
  useEffect(() => {
    if (initialAnchor) { setAnchor(initialAnchor); setStepIdx(0); }
  }, [initialAnchor]);

  const results = useMemo(() => searchPois(graph, query), [graph, query]);
  const route = useMemo(
    () => (dest ? pilotBuildRoute(graph.nodes, graph.edges, anchor.nodeId, dest.id) : null),
    [graph, dest, anchor],
  );
  const hasRoute = Boolean(route?.found && !route?.fallback && route!.steps.length);
  const steps = route?.steps ?? [];
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
  const activeFloor = normalizeFloorLabel(steps[stepMode ? stepIdx : 0]?.floor ?? graph.dataset.floors[0]?.id ?? "G");
  const anchorSourceLabel = ANCHOR_SOURCE_LABEL[anchor.source] ?? null;
  const showMetrics = Boolean(hasRoute && route!.metric && route!.total_distance_meters !== null && route!.estimated_minutes !== null);
  const exampleNames = useMemo(() => searchPois(graph, "").slice(0, 5).map((p) => p.name).join(", "), [graph]);

  function choose(p: PilotPoi) { setDest(p); setStepMode(false); setStepIdx(0); }
  function clearDest() { setDest(null); setQuery(""); setStepMode(false); setStepIdx(0); }
  function changeAnchor(nodeId: string) { setAnchor(anchorFor(graph, nodeId, "manual")); setStepIdx(0); } // route rebuilds via memo

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

  return (
    <div
      className={embedded ? "flex flex-col" : "mx-auto flex min-h-[100dvh] max-w-md flex-col bg-background"}
      data-testid="mallreds-pilot"
      data-mall-id={graph.mallId}
      data-dataset-status={graph.datasetStatus}
      data-metric={graph.metric ? "true" : "false"}
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
        ) : (
          /* ── Route view ───────────────────────────────────────────────── */
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
                <Button variant="outline" size="sm" onClick={clearDest}>Change</Button>
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
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" data-testid="pilot-failure">
                {route?.message ?? `We couldn’t route to “${dest.name}”.`}
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

                {/* Map */}
                <div className="overflow-hidden rounded-xl border" style={{ height: 240, background: "hsl(240 24% 4%)" }}>
                  <IndoorMapCanvas
                    floorplan={floorplan}
                    activeFloor={activeFloor}
                    routePolyline={polyline}
                    completedStepIndices={new Set<number>()}
                    currentStepIndex={stepMode ? stepIdx : 0}
                    simulatedPosition={null}
                    isDemo={graph.datasetStatus === "schematic"}
                  />
                </div>

                {/* Step mode toggle */}
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Directions</p>
                  <Button variant={stepMode ? "default" : "outline"} size="sm" onClick={() => { setStepMode((v) => !v); setStepIdx(0); }} data-testid="pilot-stepmode-toggle">
                    {stepMode ? "View full route" : "Step-by-step"}
                  </Button>
                </div>

                {stepMode ? (
                  <div className="space-y-3" data-testid="pilot-stepmode">
                    <p className="text-xs text-muted-foreground">Step {stepIdx + 1} of {steps.length}</p>
                    <div className="rounded-xl border bg-primary/5 p-4 text-lg font-medium leading-snug" data-testid="pilot-step-current">
                      {steps[stepIdx]?.instruction}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" disabled={stepIdx === 0} onClick={() => setStepIdx((i) => Math.max(0, i - 1))}>
                        <ChevronLeft className="mr-1 h-4 w-4" />Previous
                      </Button>
                      <Button className="flex-1" disabled={stepIdx >= steps.length - 1} onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}>
                        Next<ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ol className="space-y-2" data-testid="pilot-steps">
                    {steps.map((s, i) => (
                      <li key={s.step} className={`flex gap-3 rounded-lg border px-3 py-2.5 ${i === 0 ? "border-primary/40 bg-primary/5" : ""}`}>
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{s.step}</span>
                        <span className={`text-sm ${i === 0 ? "font-medium" : ""}`}>{s.instruction}</span>
                      </li>
                    ))}
                  </ol>
                )}
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
