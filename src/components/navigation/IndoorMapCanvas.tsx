/**
 * IndoorMapCanvas.tsx — Sprint 18B.4A (model-first, premium renderer)
 *
 * Data source: mapModel prop from backend /indoor-map-model.
 * NO supabase import. NO useEffect data fetch. NO mall_nodes/mall_edges query.
 *
 * Prop compatibility:
 *   mallId  — accepted for prop compat with NavigateScreen; not used for fetching
 *   mapModel — primary data source; when null + activeRouteSteps exist, renders
 *              a schematic fallback from step positions only
 *
 * Visual changes:
 *  - Two-tier shops: subtleShopNodes (tiny, no label) + featuredShopNodes (label)
 *  - Labels only for: destination, current step, route waypoints, ≤6 anchors
 *  - Three-layer route: ambient band → wide halo → bright 3.5px core
 *  - Completed route as dashed dimmed trail
 *  - Dominant destination: triple-ring green + label chip + glow filter
 *  - Dominant current-position: large cyan rings + pulse + glow filter
 *  - Richer 2.5D deck: gradient + top-face highlight strip + shadow layer
 *  - Stats badge: "backend map graph · N nodes · M edges"
 */

import React, { useMemo } from "react";
import type { RouteStep } from "@/context/ShoppingSessionContext";

// ── IndoorMapModel types ───────────────────────────────────────────────────────

interface MapNode {
  id: string;
  name: string;
  type: string;
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id?: string | null;
  source?: string | null;
}

interface MapEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  floor_change?: boolean | null;
  distance_meters?: number | null;
  instruction?: string | null;
}

interface MapCounts {
  all_nodes?: number;
  all_edges?: number;
  floor_nodes?: number;
  floor_edges?: number;
  floorplans?: number;
  [key: string]: unknown;
}

export interface IndoorMapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  counts: MapCounts;
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface IndoorMapCanvasProps {
  /** Kept for prop compatibility with NavigateScreen — not used for data fetching. */
  mallId?: string | number | null;
  mapModel?: IndoorMapModel | null;
  activeFloor: string;
  activeRouteSteps: RouteStep[];
  completedStepIndices: Set<number>;
  /** Index into activeRouteSteps for the current (first incomplete) step. */
  currentStepIndex: number;
}

// ── SVG viewport constants ─────────────────────────────────────────────────────

const VIEW_W     = 360;
const VIEW_H     = 172;
const MARGIN_X   = 28;
const CORRIDOR_Y = VIEW_H / 2; // 86

// ── Helpers ────────────────────────────────────────────────────────────────────

function isInternalNode(node: MapNode): boolean {
  if (node.linked_shop_id) return false;
  if (node.type !== "shop") return false;
  return /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(node.name);
}

function shortLabel(name: string): string {
  if (name.length <= 11) return name;
  const words = name.trim().split(/\s+/);
  if (words[0].length >= 4) return words[0];
  const two = `${words[0]} ${words[1] ?? ""}`.trim();
  return two.length <= 12 ? two : words[0];
}

// ── Shared SVG defs ────────────────────────────────────────────────────────────

function MapDefs() {
  return (
    <defs>
      <filter id="mmf-deck-shadow" x="-4%" y="-8%" width="108%" height="124%">
        <feDropShadow dx="0" dy="3" stdDeviation="5"
          floodColor="hsl(240 20% 2%)" floodOpacity="0.9" />
      </filter>
      <filter id="mmf-route-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="5.0" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="mmf-dest-glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="4.0" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="mmf-pos-glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="3.0" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient id="mmf-deck-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="hsl(240 20% 11%)" />
        <stop offset="18%"  stopColor="hsl(240 16% 7%)" />
        <stop offset="100%" stopColor="hsl(240 14% 5%)" />
      </linearGradient>
    </defs>
  );
}

function DeckPlate() {
  return (
    <>
      <rect width={VIEW_W} height={VIEW_H} fill="hsl(240 22% 3%)" />
      <rect x={16} y={13} width={VIEW_W - 28} height={VIEW_H - 20} rx={9}
        fill="hsl(240 20% 2%)" opacity={0.85} filter="url(#mmf-deck-shadow)" />
      <rect x={14} y={10} width={VIEW_W - 28} height={VIEW_H - 20} rx={8}
        fill="url(#mmf-deck-grad)" stroke="hsl(240 14% 19%)" strokeWidth="0.6" />
      <rect x={15} y={11} width={VIEW_W - 30} height={5} rx={7}
        fill="hsl(240 20% 16% / 0.55)" />
      <rect x={14} y={CORRIDOR_Y - 9} width={VIEW_W - 28} height={18}
        fill="hsl(240 14% 8%)" stroke="hsl(240 14% 14%)" strokeWidth="0.4" />
      <line x1={18} y1={CORRIDOR_Y} x2={VIEW_W - 18} y2={CORRIDOR_Y}
        stroke="hsl(240 14% 25%)" strokeWidth="0.7" strokeDasharray="5 4" />
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function IndoorMapCanvas({
  mallId: _mallId,
  mapModel,
  activeFloor,
  activeRouteSteps,
  completedStepIndices,
  currentStepIndex,
}: IndoorMapCanvasProps) {

  // ── ① ROUTE FALLBACK — mapModel not loaded but route steps exist ─────────────
  const fallbackSteps = useMemo(
    () => activeRouteSteps.filter((s) => s.floor === null || s.floor === activeFloor),
    [activeRouteSteps, activeFloor],
  );

  if (!mapModel && activeRouteSteps.length > 0) {
    const total = fallbackSteps.length;
    type FBPt = { x: number; y: number; origIdx: number; step: RouteStep };
    const pts: FBPt[] = fallbackSteps.map((step, i) => ({
      x: total > 1
        ? MARGIN_X + (i / (total - 1)) * (VIEW_W - 2 * MARGIN_X)
        : VIEW_W / 2,
      y: CORRIDOR_Y,
      origIdx: activeRouteSteps.indexOf(step),
      step,
    }));

    const completedPts = pts.filter((p) => completedStepIndices.has(p.origIdx));
    const remainingPts = pts.filter((p) => !completedStepIndices.has(p.origIdx));
    const bridge       = completedPts.at(-1);
    const remaining    = bridge ? [bridge, ...remainingPts] : remainingPts;
    const destPt       = pts.at(-1);
    const currentPt    = pts.find((p) => p.origIdx === currentStepIndex) ?? pts[0];

    const labeledIdxs = new Set<number>(
      pts
        .filter((_, i) => i === 0 || i === total - 1 || pts[i].origIdx === currentStepIndex || i % 4 === 0)
        .map((p) => p.origIdx),
    );

    return (
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-full"
        aria-label="Indoor route schematic (map loading)" style={{ display: "block" }}>
        <MapDefs />
        <DeckPlate />

        {remaining.length >= 2 && (
          <polyline points={remaining.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none" stroke="hsl(190 100% 50% / 0.055)"
            strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {pts.map((p) => (
          <circle key={p.origIdx} cx={p.x} cy={p.y} r={3}
            fill={completedStepIndices.has(p.origIdx) ? "hsl(240 14% 20%)" : "hsl(240 14% 28%)"}
            stroke="hsl(240 14% 35%)" strokeWidth="0.5" />
        ))}

        {pts.filter((p) => labeledIdxs.has(p.origIdx)).map((p) => {
          const isAbove = p.origIdx % 2 === 0;
          return (
            <text key={p.origIdx}
              x={p.x} y={p.y + (isAbove ? -8 : 14)}
              textAnchor="middle" fontSize="5"
              fontFamily="Inter, system-ui, sans-serif"
              fill="hsl(240 8% 45%)">
              {shortLabel(p.step.node_name)}
            </text>
          );
        })}

        {completedPts.length >= 2 && (
          <polyline points={completedPts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none" stroke="hsl(190 100% 40% / 0.20)"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="4 3" />
        )}

        {remaining.length >= 2 && (
          <>
            <polyline points={remaining.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke="hsl(190 100% 50% / 0.17)" strokeWidth="18"
              strokeLinecap="round" strokeLinejoin="round" filter="url(#mmf-route-glow)" />
            <polyline points={remaining.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke="hsl(190 100% 55% / 0.50)" strokeWidth="5.5"
              strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={remaining.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke="hsl(190 100% 70%)" strokeWidth="3.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}

        {destPt && (
          <g transform={`translate(${destPt.x}, ${destPt.y})`} filter="url(#mmf-dest-glow)">
            <circle r={9} fill="hsl(111 100% 54% / 0.16)"
              stroke="hsl(111 100% 54%)" strokeWidth="1.3" />
            <circle r={4.5} fill="hsl(111 100% 62%)" />
            <rect x={-22} y={-24} width={44} height={12} rx={3}
              fill="hsl(111 40% 5% / 0.92)" stroke="hsl(111 100% 40% / 0.45)" strokeWidth="0.5" />
            <text y={-15} textAnchor="middle" fontSize="5.5"
              fontFamily="Inter, system-ui, sans-serif" fontWeight="700"
              fill="hsl(111 100% 67%)">
              {shortLabel(destPt.step.node_name)}
            </text>
          </g>
        )}

        {currentPt && (
          <g transform={`translate(${currentPt.x}, ${currentPt.y})`} filter="url(#mmf-pos-glow)">
            <circle r={11} fill="none" stroke="hsl(190 100% 50% / 0.50)" strokeWidth="1.2"
              className="animate-ping"
              style={{ transformBox: "fill-box", transformOrigin: "center" } as React.CSSProperties} />
            <circle r={7} fill="hsl(190 100% 50% / 0.22)"
              stroke="hsl(190 100% 55%)" strokeWidth="1.5" />
            <circle r={3.5} fill="hsl(190 100% 72%)" />
          </g>
        )}

        <g opacity="0.5">
          <rect x={15} y={VIEW_H - 14} width={90} height={11} rx={2.5}
            fill="hsl(240 22% 3% / 0.85)" />
          <text x={19} y={VIEW_H - 5.5} fontSize="4.5" fontFamily="monospace"
            fill="hsl(240 8% 40%)" letterSpacing="0.02em">
            route · map loading…
          </text>
        </g>
      </svg>
    );
  }

  // ── ② TRUE NO-DATA FALLBACK — no mapModel AND no route steps ────────────────
  if (!mapModel) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="flex flex-col items-center gap-2">
          <div className="h-5 w-5 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
          <p className="text-[10px] text-muted-foreground tracking-wide">Loading map…</p>
        </div>
      </div>
    );
  }

  // ── ③ FULL MODEL RENDER ──────────────────────────────────────────────────────

  const allNodes: MapNode[] = mapModel.nodes ?? [];
  const allEdges: MapEdge[] = mapModel.edges ?? [];

  const floorNodes = allNodes.filter((n) => n.floor === activeFloor);
  const nodeById   = new Map<string, MapNode>(allNodes.map((n) => [n.id, n]));

  const xs     = floorNodes.map((n) => n.x_coordinate).filter((v): v is number => v !== null);
  const minX   = xs.length >= 2 ? Math.min(...xs) : 0;
  const maxX   = xs.length >= 2 ? Math.max(...xs) : 100;
  const rangeX = Math.max(maxX - minX, 10);

  const svgX = (x: number | null): number => {
    const v = x ?? minX + rangeX / 2;
    return MARGIN_X + ((v - minX) / rangeX) * (VIEW_W - 2 * MARGIN_X);
  };

  const nodePositions = (() => {
    const pos = new Map<string, { x: number; y: number }>();

    const shops = floorNodes
      .filter((n) => !isInternalNode(n) && n.type === "shop")
      .sort((a, b) => (a.x_coordinate ?? 0) - (b.x_coordinate ?? 0));
    shops.forEach((n, i) => {
      pos.set(n.id, { x: svgX(n.x_coordinate), y: i % 2 === 0 ? CORRIDOR_Y - 30 : CORRIDOR_Y + 30 });
    });

    floorNodes.filter(isInternalNode).forEach((n) => {
      pos.set(n.id, { x: svgX(n.x_coordinate), y: CORRIDOR_Y });
    });

    floorNodes
      .filter((n) => !isInternalNode(n) && n.type !== "shop")
      .forEach((n, i) => {
        pos.set(n.id, { x: svgX(n.x_coordinate), y: CORRIDOR_Y - 38 - (i % 2) * 6 });
      });

    return pos;
  })();

  const routeNodeIds = new Set(activeRouteSteps.map((s) => s.node_id));

  type RoutePoint = { x: number; y: number; stepIdx: number };
  const allRoutePoints: RoutePoint[] = activeRouteSteps
    .map((step, i) => {
      if (step.floor !== null && step.floor !== activeFloor) return null;
      const p = nodePositions.get(step.node_id);
      if (!p) return null;
      return { ...p, stepIdx: i };
    })
    .filter((p): p is RoutePoint => p !== null);

  const completedRoutePts   = allRoutePoints.filter((p) =>  completedStepIndices.has(p.stepIdx));
  const remainingRoutePts   = allRoutePoints.filter((p) => !completedStepIndices.has(p.stepIdx));
  const lastCompletedPt     = completedRoutePts.at(-1);
  const remainingWithBridge = lastCompletedPt ? [lastCompletedPt, ...remainingRoutePts] : remainingRoutePts;

  const currentStep       = activeRouteSteps[currentStepIndex];
  const currentPos        = currentStep ? (nodePositions.get(currentStep.node_id) ?? null) : null;
  const lastStep          = activeRouteSteps[activeRouteSteps.length - 1];
  const destPos           = lastStep ? (nodePositions.get(lastStep.node_id) ?? null) : null;
  const destName          = lastStep ? (nodeById.get(lastStep.node_id)?.name ?? lastStep.node_name) : null;
  const destinationNodeId = lastStep?.node_id;
  const currentNodeId     = currentStep?.node_id;

  const floorNodeIds  = new Set(floorNodes.map((n) => n.id));
  const visibleEdges  = allEdges.filter(
    (e) => !e.floor_change && floorNodeIds.has(e.from_node_id) && floorNodeIds.has(e.to_node_id),
  );

  const shopNodes     = floorNodes.filter((n) => !isInternalNode(n) && n.type === "shop");
  const entranceNodes = floorNodes.filter((n) => n.type === "entrance");

  const labeledShopIds = (() => {
    const ids = new Set<string>();
    if (destinationNodeId) ids.add(destinationNodeId);
    if (currentNodeId)     ids.add(currentNodeId);
    shopNodes.forEach((n) => { if (routeNodeIds.has(n.id)) ids.add(n.id); });

    const candidates = shopNodes
      .filter((n) => !ids.has(n.id))
      .sort((a, b) => (a.x_coordinate ?? 0) - (b.x_coordinate ?? 0));
    const stride = Math.max(1, Math.floor(candidates.length / 6));
    let added = 0;
    for (let i = 0; i < candidates.length && added < 6; i += stride) {
      ids.add(candidates[i].id);
      added++;
    }
    return ids;
  })();

  const subtleShopNodes   = shopNodes.filter((n) => !labeledShopIds.has(n.id));
  const featuredShopNodes = shopNodes.filter((n) =>  labeledShopIds.has(n.id));

  // Safe stats label — counts fields are all optional
  const nodeCount  = mapModel.counts?.all_nodes   ?? mapModel.nodes.length;
  const edgeCount  = mapModel.counts?.all_edges   ?? mapModel.edges.length;
  const statsLabel = `backend map graph · ${nodeCount} nodes · ${edgeCount} edges`;

  if (floorNodes.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No map data for floor {activeFloor}.</p>
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-full"
      aria-label="Indoor mall schematic map" style={{ display: "block" }}>
      <MapDefs />
      <DeckPlate />

      {/* Edge network */}
      {visibleEdges.map((edge) => {
        const from = nodePositions.get(edge.from_node_id);
        const to   = nodePositions.get(edge.to_node_id);
        if (!from || !to) return null;
        return (
          <line key={edge.id}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="hsl(240 14% 18%)" strokeWidth="0.28" strokeOpacity="0.16" />
        );
      })}

      {/* Route corridor ambient band */}
      {remainingWithBridge.length >= 2 && (
        <polyline points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke="hsl(190 100% 50% / 0.055)"
          strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Subtle background stores */}
      {subtleShopNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        return (
          <rect key={node.id}
            x={pos.x - 8} y={pos.y - 3} width={16} height={6} rx={2}
            fill="hsl(240 14% 8% / 0.58)" stroke="hsl(240 14% 16% / 0.42)" strokeWidth="0.22" />
        );
      })}

      {/* Featured stores with labels */}
      {featuredShopNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        const isAbove   = pos.y < CORRIDOR_Y;
        const isDest    = node.id === destinationNodeId;
        const isCurrent = node.id === currentNodeId;
        const BW = 44, BH = 17;
        const fillCol   = isDest    ? "hsl(111 55% 9%)"              : isCurrent ? "hsl(190 55% 9%)"              : "hsl(240 14% 12%)";
        const strokeCol = isDest    ? "hsl(111 100% 48% / 0.65)"     : isCurrent ? "hsl(190 100% 48% / 0.55)"     : "hsl(240 14% 26%)";
        const strokeW   = isDest || isCurrent ? 1.0 : 0.5;
        const textFill  = isDest    ? "hsl(111 100% 64%)"            : isCurrent ? "hsl(190 100% 66%)"            : "hsl(240 8% 58%)";
        return (
          <g key={node.id}>
            <line
              x1={pos.x} y1={pos.y + (isAbove ? BH / 2 : -BH / 2)}
              x2={pos.x} y2={CORRIDOR_Y + (isAbove ? -9 : 9)}
              stroke="hsl(240 14% 20%)" strokeWidth="0.5" />
            <rect x={pos.x - BW / 2} y={pos.y - BH / 2} width={BW} height={BH} rx={3}
              fill={fillCol} stroke={strokeCol} strokeWidth={strokeW} />
            <text x={pos.x} y={pos.y + 3.5} textAnchor="middle"
              fontSize={isDest || isCurrent ? "6" : "5.5"}
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight={isDest || isCurrent ? "700" : "400"}
              fill={textFill}>
              {shortLabel(node.name)}
            </text>
          </g>
        );
      })}

      {/* Entrance nodes */}
      {entranceNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        return (
          <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
            <rect x={-18} y={-9} width={36} height={18} rx={4}
              fill="hsl(190 100% 50% / 0.10)" stroke="hsl(190 100% 50% / 0.42)" strokeWidth="0.8" />
            <text x={0} y={3.5} textAnchor="middle" fontSize="5"
              fontFamily="Inter, system-ui, sans-serif" fontWeight="700"
              fill="hsl(190 100% 65%)" letterSpacing="0.06em">
              ENTRY
            </text>
          </g>
        );
      })}

      {/* Completed route — dashed trail */}
      {completedRoutePts.length >= 2 && (
        <polyline points={completedRoutePts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke="hsl(190 100% 40% / 0.20)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
      )}

      {/* Active route — 3-layer premium glow */}
      {remainingWithBridge.length >= 2 && (
        <>
          <polyline points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none" stroke="hsl(190 100% 50% / 0.17)" strokeWidth="18"
            strokeLinecap="round" strokeLinejoin="round" filter="url(#mmf-route-glow)" />
          <polyline points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none" stroke="hsl(190 100% 55% / 0.50)" strokeWidth="5.5"
            strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none" stroke="hsl(190 100% 70%)" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {/* Destination marker */}
      {destPos && (
        <g transform={`translate(${destPos.x}, ${destPos.y})`} filter="url(#mmf-dest-glow)">
          <circle r={14} fill="hsl(111 100% 50% / 0.07)" stroke="none" />
          <circle r={9} fill="hsl(111 100% 54% / 0.16)" stroke="hsl(111 100% 54%)" strokeWidth="1.3" />
          <circle r={4.5} fill="hsl(111 100% 62%)" />
          {destName && (
            <>
              <rect x={-24} y={-27} width={48} height={13} rx={3}
                fill="hsl(111 40% 5% / 0.92)" stroke="hsl(111 100% 40% / 0.45)" strokeWidth="0.5" />
              <text y={-17.5} textAnchor="middle" fontSize="6"
                fontFamily="Inter, system-ui, sans-serif" fontWeight="700"
                fill="hsl(111 100% 67%)">
                {shortLabel(destName)}
              </text>
            </>
          )}
        </g>
      )}

      {/* Current-position marker */}
      {currentPos && (
        <g transform={`translate(${currentPos.x}, ${currentPos.y})`} filter="url(#mmf-pos-glow)">
          <circle r={11} fill="none" stroke="hsl(190 100% 50% / 0.50)" strokeWidth="1.2"
            className="animate-ping"
            style={{ transformBox: "fill-box", transformOrigin: "center" } as React.CSSProperties} />
          <circle r={7} fill="hsl(190 100% 50% / 0.22)" stroke="hsl(190 100% 55%)" strokeWidth="1.5" />
          <circle r={3.5} fill="hsl(190 100% 72%)" />
        </g>
      )}

      {/* Stats badge */}
      <g opacity="0.6">
        <rect x={15} y={VIEW_H - 14} width={166} height={11} rx={2.5}
          fill="hsl(240 22% 3% / 0.85)" />
        <text x={19} y={VIEW_H - 5.5} fontSize="4.5" fontFamily="monospace"
          fill="hsl(240 8% 40%)" letterSpacing="0.02em">
          {statsLabel}
        </text>
      </g>
    </svg>
  );
}
