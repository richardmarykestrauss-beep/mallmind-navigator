/**
 * MallRedsPilot.tsx — Mall@Reds NAVIGATION PILOT (schematic, honestly labelled).
 *
 * A self-contained shopper flow: choose a start point → search/pick a real tenant → the
 * existing routing logic (client port of routingService) builds a route → it renders on the
 * existing IndoorMapCanvas with turn-by-turn steps. NO live positioning, NO official
 * floorplan claim, NO product/price dependency. Swapping in a verified map later is a data
 * replacement (real mall_nodes/mall_edges), not a rewrite.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import IndoorMapCanvas from "@/components/navigation/IndoorMapCanvas";
import { toFloorplanModel, buildRoutePolyline } from "@/components/navigation/floorplanModel";
import { pilotBuildRoute, type PilotRouteResult } from "@/components/navigation/pilotRoute";
import {
  MALL_REDS_PILOT_NODES, MALL_REDS_PILOT_EDGES, MALL_REDS_PILOT_MALL_ID, MALL_REDS_PILOT_MALL_NAME,
  pilotStartOptions, pilotDestinations,
} from "@/components/navigation/mallRedsPilotGraph";

const DISCLAIMERS = [
  "Pilot schematic — route geometry awaiting on-site verification.",
  "Not an official Mall@Reds floorplan.",
  "Route preview only — live indoor positioning is not active.",
  "Not verified for accessibility. Not for emergency or evacuation use.",
];

export default function MallRedsPilot() {
  const starts = useMemo(() => pilotStartOptions(), []);
  const destinations = useMemo(() => pilotDestinations(), []);
  const floorplan = useMemo(
    () => toFloorplanModel(
      { nodes: MALL_REDS_PILOT_NODES, edges: MALL_REDS_PILOT_EDGES },
      { mallId: MALL_REDS_PILOT_MALL_ID, mallName: MALL_REDS_PILOT_MALL_NAME },
    ),
    [],
  );

  const [startId, setStartId] = useState<string>(starts[0]?.id ?? "");
  const [query, setQuery] = useState<string>("");
  const [route, setRoute] = useState<PilotRouteResult | null>(null);
  const [destName, setDestName] = useState<string>("");

  function go(shopId: string, name: string) {
    setDestName(name);
    setRoute(pilotBuildRoute(MALL_REDS_PILOT_NODES, MALL_REDS_PILOT_EDGES, startId, shopId));
  }

  function search() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = destinations.find((d) => d.name.toLowerCase().includes(q));
    if (match) return go(match.shopId, match.name);
    // Honest unknown — route through the engine so the failure text is the engine's.
    setDestName(query.trim());
    setRoute(pilotBuildRoute(MALL_REDS_PILOT_NODES, MALL_REDS_PILOT_EDGES, startId, q));
  }

  const polyline = route?.steps.length ? buildRoutePolyline(route.steps) : [];
  const hasRoute = Boolean(route?.found && !route?.fallback && route.steps.length);

  return (
    <div className="mx-auto max-w-md px-4 py-5 space-y-4" data-testid="mallreds-pilot">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Mall@Reds — Navigation Pilot</h1>
        <p className="text-xs text-muted-foreground">Ask for a shop and we’ll walk you there.</p>
      </header>

      {/* Honest status labels */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300 space-y-0.5">
        {DISCLAIMERS.map((d) => <div key={d}>• {d}</div>)}
      </div>

      {/* Start point — never auto-detected */}
      <label className="block space-y-1">
        <span className="text-sm font-medium">Where are you starting?</span>
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={startId}
          onChange={(e) => { setStartId(e.target.value); setRoute(null); }}
        >
          {starts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>

      {/* Destination search + curated pilot destinations */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Search a shop e.g. Clicks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          />
          <Button size="sm" onClick={search}>Find</Button>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Pilot destinations (routable now):</p>
          <div className="flex flex-wrap gap-2">
            {destinations.map((d) => (
              <Button key={d.shopId} variant="outline" size="sm" onClick={() => go(d.shopId, d.name)}>{d.name}</Button>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      {route && !hasRoute && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm" data-testid="pilot-failure">
          {route.message ?? `We couldn’t route to “${destName}”.`}
        </div>
      )}

      {hasRoute && (
        <div className="space-y-3" data-testid="pilot-route">
          <div className="overflow-hidden rounded-xl border">
            <IndoorMapCanvas
              floorplan={floorplan}
              activeFloor="Ground Floor"
              routePolyline={polyline}
              completedStepIndices={new Set<number>()}
              currentStepIndex={0}
              simulatedPosition={null}   /* no live marker — route preview only */
              isDemo
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>To {destName} · Ground Floor</span>
            <span>~{route!.total_distance_meters} m · ~{route!.estimated_minutes} min</span>
          </div>
          <ol className="space-y-1.5" data-testid="pilot-steps">
            {route!.steps.map((s) => (
              <li key={s.step} className="flex gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="font-semibold text-muted-foreground">{s.step}</span>
                <span>{s.instruction}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground">Route preview only — this does not track your live position.</p>
        </div>
      )}
    </div>
  );
}
