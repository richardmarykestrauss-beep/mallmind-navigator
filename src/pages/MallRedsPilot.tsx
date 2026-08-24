/**
 * MallRedsPilot.tsx — Mall@Reds NAVIGATION PILOT v2 (mobile-first, destination-first).
 *
 * Flow: "Where do you want to go?" → pick a real tenant or amenity → "Starting from …" (changeable,
 * re-routes instantly) → route summary + prominent first instruction + schematic map + step-by-step
 * viewer. Reuses the existing routing logic + IndoorMapCanvas. NO live positioning, NO official
 * floorplan claim, NO product/price dependency. The route depends only on a current-location ANCHOR
 * (PilotAnchor) — a seam a future positioning provider can fill without changing this UI.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import { toFloorplanModel, buildRoutePolyline } from "@/components/navigation/floorplanModel";
import { pilotBuildRoute } from "@/components/navigation/pilotRoute";
import {
  MALL_REDS_PILOT_NODES as NODES, MALL_REDS_PILOT_EDGES as EDGES,
  MALL_REDS_PILOT_MALL_ID, MALL_REDS_PILOT_MALL_NAME,
  pilotStartOptions, searchPilotPois, defaultPilotAnchor, anchorFromStart,
  type PilotPoi,
} from "@/components/navigation/mallRedsPilotGraph";

const DISCLAIMERS = [
  "Pilot schematic — route geometry awaits on-site verification.",
  "Not an official Mall@Reds floorplan.",
  "Route preview only — live indoor positioning is not active.",
  "Not accessibility-verified. Not for emergency or evacuation use.",
];

const poiIcon = (p: PilotPoi): string =>
  p.kind === "store" ? "🛍️" : ({ toilet: "🚻", lift: "🛗", escalator: "🪜", stairs: "🪜", food_court: "🍽️", landmark: "ℹ️" }[p.type] ?? "📍");

export default function MallRedsPilot() {
  const starts = useMemo(() => pilotStartOptions(), []);
  const floorplan = useMemo(
    () => toFloorplanModel({ nodes: NODES, edges: EDGES }, { mallId: MALL_REDS_PILOT_MALL_ID, mallName: MALL_REDS_PILOT_MALL_NAME }),
    [],
  );

  const [anchor, setAnchor] = useState(defaultPilotAnchor());
  const [dest, setDest] = useState<PilotPoi | null>(null);
  const [query, setQuery] = useState("");
  const [stepMode, setStepMode] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  const results = useMemo(() => searchPilotPois(query), [query]);
  const route = useMemo(
    () => (dest ? pilotBuildRoute(NODES, EDGES, anchor.nodeId, dest.id) : null),
    [dest, anchor],
  );
  const hasRoute = Boolean(route?.found && !route?.fallback && route!.steps.length);
  const polyline = hasRoute ? buildRoutePolyline(route!.steps) : [];
  const steps = route?.steps ?? [];

  function choose(p: PilotPoi) { setDest(p); setStepMode(false); setStepIdx(0); }
  function clearDest() { setDest(null); setQuery(""); setStepMode(false); setStepIdx(0); }
  function changeAnchor(nodeId: string) { setAnchor(anchorFromStart(nodeId)); setStepIdx(0); } // route rebuilds via memo

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col bg-background" data-testid="mallreds-pilot">
      {/* Compact header */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        {dest && (
          <button aria-label="Back" onClick={clearDest} className="-ml-1 rounded-full p-1.5 hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-tight">Mall@Reds · Wayfinding</h1>
          <p className="truncate text-[11px] text-muted-foreground">Find a shop or facility and get walked there</p>
        </div>
      </header>

      <main className="flex-1 px-4 py-4">
        {!dest ? (
          /* ── Destination-first finder ─────────────────────────────────── */
          <section data-testid="pilot-finder" className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Where do you want to go?</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  className="h-12 pl-9 text-base"
                  placeholder="Search e.g. Clicks, toilets, lifts"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="pilot-search"
                />
              </div>
            </div>

            {results.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="pilot-no-result">
                No match for “{query.trim()}” in this pilot.<br />Try Clicks, Game, Dis-Chem, Pick n Pay, Woolworths, toilets or lifts.
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
                    <Badge variant="secondary" className="text-[10px]">{p.kind === "store" ? "Store" : "Facility"}</Badge>
                    <Navigation className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          /* ── Route view ───────────────────────────────────────────────── */
          <section className="space-y-4" data-testid="pilot-route-view">
            {/* Destination + start */}
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl" aria-hidden>{poiIcon(dest)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Going to</p>
                  <p className="truncate text-lg font-semibold leading-tight" data-testid="pilot-dest-name">{dest.name}</p>
                </div>
                <Button variant="outline" size="sm" onClick={clearDest}>Change</Button>
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Starting from</span>
                <select
                  className="ml-auto min-h-9 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                  value={anchor.nodeId}
                  onChange={(e) => changeAnchor(e.target.value)}
                  data-testid="pilot-start-select"
                >
                  {starts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            </div>

            {!hasRoute ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" data-testid="pilot-failure">
                {route?.message ?? `We couldn’t route to “${dest.name}”.`}
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-3 gap-2 text-center" data-testid="pilot-summary">
                  <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{route!.total_distance_meters}<span className="text-xs font-normal"> m</span></div><div className="text-[10px] text-muted-foreground">distance</div></div>
                  <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{route!.estimated_minutes}<span className="text-xs font-normal"> min</span></div><div className="text-[10px] text-muted-foreground">walk</div></div>
                  <div className="rounded-lg border py-2"><div className="text-lg font-semibold">{steps[0]?.floor ?? "G"}</div><div className="text-[10px] text-muted-foreground">floor</div></div>
                </div>

                {/* Map */}
                <div className="overflow-hidden rounded-xl border">
                  <IndoorMapCanvas
                    floorplan={floorplan}
                    activeFloor="Ground Floor"
                    routePolyline={polyline}
                    completedStepIndices={new Set<number>()}
                    currentStepIndex={stepMode ? stepIdx : 0}
                    simulatedPosition={null}
                    isDemo
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
                <p className="text-[11px] text-muted-foreground">Route preview only — this does not track your live position.</p>
              </>
            )}
          </section>
        )}
      </main>

      {/* Compact honest-status area (not visually dominant) */}
      <details className="border-t px-4 py-2 text-[11px] text-muted-foreground" data-testid="pilot-disclaimer">
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <span>Pilot schematic · not an official floorplan · route preview only</span>
          <span className="underline">details</span>
        </summary>
        <ul className="space-y-0.5 pt-2 leading-snug">{DISCLAIMERS.map((d) => <li key={d}>• {d}</li>)}</ul>
      </details>
    </div>
  );
}
