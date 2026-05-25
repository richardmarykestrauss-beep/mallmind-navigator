/**
 * IndoorMapCanvas.tsx
 *
 * Premium 2.5D schematic mall map rendered as a pure SVG.
 * Loads mall_nodes + mall_edges once per mallId, then renders:
 *   - Mall deck background plate
 *   - Corridor spine with centre guide
 *   - Edge network (grey connector lines between nodes on the same floor)
 *   - Storefront blocks (shop nodes, alternating above/below corridor)
 *   - Entrance nodes (highlighted with cyan border)
 *   - Completed route path (dimmed blue)
 *   - Active (remaining) route path (glowing cyan)
 *   - Destination marker (green)
 *   - Current-position marker (cyan pulsing dot)
 *
 * Labels are honest: internal routing nodes (Spine Node, Corridor Node, etc.)
 * are never exposed by name — they appear only as corridor passthrough points.
 *
 * No libraries beyond @supabase/supabase-js (already a dep). Pure SVG/CSS.
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { RouteStep } from "@/context/ShoppingSessionContext";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MallNode {
  id: string;
  name: string;
  type: "shop" | "entrance" | "escalator" | "lift" | "toilet" | "food_court" | "parking";
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id: string | null;
}

interface MallEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  floor_change: boolean;
}

export interface IndoorMapCanvasProps {
  mallId: string | number | null;
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
const CORRIDOR_Y = VIEW_H / 2; // 86 — central corridor spine

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Internal routing/infrastructure nodes should not be exposed by name.
 * Real store nodes always have a linked_shop_id; non-shop types are
 * physical features (entrances, lifts) — never infrastructure.
 */
function isInternalNode(node: MallNode): boolean {
  if (node.linked_shop_id) return false;
  if (node.type !== "shop") return false;
  return /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(
    node.name,
  );
}

/** Truncate a store name for tight map labels. */
function shortLabel(name: string): string {
  if (name.length <= 11) return name;
  const words = name.trim().split(/\s+/);
  if (words[0].length >= 4) return words[0];
  const two = `${words[0]} ${words[1] ?? ""}`.trim();
  return two.length <= 12 ? two : words[0];
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function IndoorMapCanvas({
  mallId,
  activeFloor,
  activeRouteSteps,
  completedStepIndices,
  currentStepIndex,
}: IndoorMapCanvasProps) {
  const [allNodes, setAllNodes] = useState<MallNode[]>([]);
  const [allEdges, setAllEdges] = useState<MallEdge[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Load graph once per mallId ──────────────────────────────────────────────
  useEffect(() => {
    if (!mallId) return;
    setLoading(true);
    const id = String(mallId);
    Promise.all([
      supabase
        .from("mall_nodes")
        .select("id,name,type,floor,x_coordinate,y_coordinate,linked_shop_id")
        .eq("mall_id", id),
      supabase
        .from("mall_edges")
        .select("id,from_node_id,to_node_id,floor_change")
        .eq("mall_id", id),
    ]).then(([nr, er]) => {
      setAllNodes((nr.data ?? []) as MallNode[]);
      setAllEdges((er.data ?? []) as MallEdge[]);
      setLoading(false);
    });
  }, [mallId]);

  // ── Floor-scoped nodes ─────────────────────────────────────────────────────
  const floorNodes = useMemo(
    () => allNodes.filter((n) => n.floor === activeFloor),
    [allNodes, activeFloor],
  );

  const nodeById = useMemo(
    () => new Map<string, MallNode>(allNodes.map((n) => [n.id, n])),
    [allNodes],
  );

  // ── X-normalisation (handle all-same-x edge case) ─────────────────────────
  const { minX, rangeX } = useMemo(() => {
    const xs = floorNodes
      .map((n) => n.x_coordinate)
      .filter((v): v is number => v !== null);
    if (xs.length < 2) return { minX: 0, rangeX: 100 };
    const mn = Math.min(...xs);
    const mx = Math.max(...xs);
    return { minX: mn, rangeX: Math.max(mx - mn, 10) };
  }, [floorNodes]);

  const svgX = (x: number | null): number => {
    const v = x ?? minX + rangeX / 2;
    return MARGIN_X + ((v - minX) / rangeX) * (VIEW_W - 2 * MARGIN_X);
  };

  // ── Node SVG positions ──────────────────────────────────────────────────────
  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();

    // Shops: sorted by x, alternating above/below corridor
    const shops = floorNodes
      .filter((n) => !isInternalNode(n) && n.type === "shop")
      .sort((a, b) => (a.x_coordinate ?? 0) - (b.x_coordinate ?? 0));

    shops.forEach((n, i) => {
      pos.set(n.id, {
        x: svgX(n.x_coordinate),
        y: i % 2 === 0 ? CORRIDOR_Y - 30 : CORRIDOR_Y + 30,
      });
    });

    // Internal corridor/spine nodes: on the spine itself
    floorNodes.filter(isInternalNode).forEach((n) => {
      pos.set(n.id, { x: svgX(n.x_coordinate), y: CORRIDOR_Y });
    });

    // Entrances, escalators, etc.: above corridor
    floorNodes
      .filter((n) => !isInternalNode(n) && n.type !== "shop")
      .forEach((n, i) => {
        pos.set(n.id, {
          x: svgX(n.x_coordinate),
          y: CORRIDOR_Y - 38 - (i % 2) * 6,
        });
      });

    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorNodes, minX, rangeX]);

  // ── Route points (only nodes visible on this floor) ───────────────────────
  type RoutePoint = { x: number; y: number; stepIdx: number };
  const allRoutePoints: RoutePoint[] = useMemo(
    () =>
      activeRouteSteps
        .map((step, i) => {
          if (step.floor !== null && step.floor !== activeFloor) return null;
          const pos = nodePositions.get(step.node_id);
          if (!pos) return null;
          return { ...pos, stepIdx: i };
        })
        .filter((p): p is RoutePoint => p !== null),
    [activeRouteSteps, activeFloor, nodePositions],
  );

  const completedRoutePts = allRoutePoints.filter((p) =>
    completedStepIndices.has(p.stepIdx),
  );
  const remainingRoutePts = allRoutePoints.filter(
    (p) => !completedStepIndices.has(p.stepIdx),
  );
  // Bridge the gap so the remaining line starts from the last completed point
  const lastCompletedPt = completedRoutePts.at(-1);
  const remainingWithBridge = lastCompletedPt
    ? [lastCompletedPt, ...remainingRoutePts]
    : remainingRoutePts;

  // ── Current position & destination ────────────────────────────────────────
  const currentStep = activeRouteSteps[currentStepIndex];
  const currentPos  = currentStep
    ? (nodePositions.get(currentStep.node_id) ?? null)
    : null;

  const lastStep = activeRouteSteps[activeRouteSteps.length - 1];
  const destPos  = lastStep ? (nodePositions.get(lastStep.node_id) ?? null) : null;
  const destName = lastStep
    ? (nodeById.get(lastStep.node_id)?.name ?? lastStep.node_name)
    : null;

  // ── Edges on this floor ───────────────────────────────────────────────────
  const floorNodeIds = useMemo(
    () => new Set(floorNodes.map((n) => n.id)),
    [floorNodes],
  );
  const visibleEdges = allEdges.filter(
    (e) =>
      !e.floor_change &&
      floorNodeIds.has(e.from_node_id) &&
      floorNodeIds.has(e.to_node_id),
  );

  const shopNodes     = useMemo(() => floorNodes.filter((n) => !isInternalNode(n) && n.type === "shop"),     [floorNodes]);
  const entranceNodes = useMemo(() => floorNodes.filter((n) => n.type === "entrance"), [floorNodes]);

  // ── Loading / empty states ─────────────────────────────────────────────────
  if (loading && floorNodes.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="flex flex-col items-center gap-2">
          <div className="h-5 w-5 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
          <p className="text-[10px] text-muted-foreground tracking-wide">Loading map…</p>
        </div>
      </div>
    );
  }

  if (!mallId) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No mall selected.</p>
      </div>
    );
  }

  if (!loading && floorNodes.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No map data for floor {activeFloor}.</p>
      </div>
    );
  }

  // ── SVG render ─────────────────────────────────────────────────────────────
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full"
      aria-label="Indoor mall schematic map"
      style={{ display: "block" }}
    >
      <defs>
        {/* Route glow */}
        <filter id="mmf-route-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Destination pin glow */}
        <filter id="mmf-dest-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── 1. Stage background ─────────────────────────────────────────── */}
      <rect width={VIEW_W} height={VIEW_H} fill="hsl(240 20% 4%)" />

      {/* ── 2. Mall deck plate ──────────────────────────────────────────── */}
      <rect
        x={14} y={10}
        width={VIEW_W - 28} height={VIEW_H - 20}
        rx={8}
        fill="hsl(240 16% 7%)"
        stroke="hsl(240 14% 16%)"
        strokeWidth="0.5"
      />

      {/* ── 3. Corridor band + spine guide ──────────────────────────────── */}
      <rect
        x={14} y={CORRIDOR_Y - 8}
        width={VIEW_W - 28} height={16}
        fill="hsl(240 14% 9%)"
      />
      <line
        x1={18} y1={CORRIDOR_Y}
        x2={VIEW_W - 18} y2={CORRIDOR_Y}
        stroke="hsl(240 14% 22%)"
        strokeWidth="0.8"
        strokeDasharray="6 4"
      />

      {/* ── 4. Edge network (connector lines) ───────────────────────────── */}
      {visibleEdges.map((edge) => {
        const from = nodePositions.get(edge.from_node_id);
        const to   = nodePositions.get(edge.to_node_id);
        if (!from || !to) return null;
        return (
          <line
            key={edge.id}
            x1={from.x} y1={from.y}
            x2={to.x}   y2={to.y}
            stroke="hsl(240 14% 17%)"
            strokeWidth="0.6"
          />
        );
      })}

      {/* ── 5. Storefront blocks ────────────────────────────────────────── */}
      {shopNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        const isAbove = pos.y < CORRIDOR_Y;
        const BW = 44, BH = 17;
        return (
          <g key={node.id}>
            {/* Tenon line from shop face to corridor band */}
            <line
              x1={pos.x}
              y1={pos.y + (isAbove ? BH / 2 : -BH / 2)}
              x2={pos.x}
              y2={CORRIDOR_Y + (isAbove ? -8 : 8)}
              stroke="hsl(240 14% 19%)"
              strokeWidth="0.5"
            />
            {/* Store unit block */}
            <rect
              x={pos.x - BW / 2} y={pos.y - BH / 2}
              width={BW} height={BH}
              rx={3}
              fill="hsl(240 14% 11%)"
              stroke="hsl(240 14% 21%)"
              strokeWidth="0.5"
            />
            {/* Store label */}
            <text
              x={pos.x} y={pos.y + 3.5}
              textAnchor="middle"
              fontSize="5.5"
              fontFamily="Inter, system-ui, sans-serif"
              fill="hsl(240 8% 50%)"
            >
              {shortLabel(node.name)}
            </text>
          </g>
        );
      })}

      {/* ── 6. Entrance nodes ───────────────────────────────────────────── */}
      {entranceNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        return (
          <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
            <rect
              x={-16} y={-8} width={32} height={16} rx={4}
              fill="hsl(190 100% 50% / 0.12)"
              stroke="hsl(190 100% 50% / 0.38)"
              strokeWidth="0.8"
            />
            <text
              x={0} y={3.5}
              textAnchor="middle"
              fontSize="5"
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight="700"
              fill="hsl(190 100% 65%)"
              letterSpacing="0.06em"
            >
              ENTRY
            </text>
          </g>
        );
      })}

      {/* ── 7. Completed route (dimmed) ─────────────────────────────────── */}
      {completedRoutePts.length >= 2 && (
        <polyline
          points={completedRoutePts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 50% / 0.2)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* ── 8. Active (remaining) route — glowing cyan ──────────────────── */}
      {remainingWithBridge.length >= 2 && (
        <>
          {/* Wide glow halo */}
          <polyline
            points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="hsl(190 100% 50% / 0.25)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#mmf-route-glow)"
          />
          {/* Core route line */}
          <polyline
            points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="hsl(190 100% 55%)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {/* ── 9. Destination marker (green) ───────────────────────────────── */}
      {destPos && (
        <g
          transform={`translate(${destPos.x}, ${destPos.y})`}
          filter="url(#mmf-dest-glow)"
        >
          <circle r={7} fill="hsl(111 100% 54% / 0.18)" stroke="hsl(111 100% 54%)" strokeWidth="1.5" />
          <circle r={3} fill="hsl(111 100% 58%)" />
          {destName && (
            <text
              y={-11}
              textAnchor="middle"
              fontSize="5.5"
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight="700"
              fill="hsl(111 100% 62%)"
            >
              {shortLabel(destName)}
            </text>
          )}
        </g>
      )}

      {/* ── 10. Current-position marker (cyan pulsing) ──────────────────── */}
      {currentPos && (
        <g transform={`translate(${currentPos.x}, ${currentPos.y})`}>
          {/* Pulse ring — CSS animate-ping via transform-box: fill-box */}
          <circle
            r={8}
            fill="none"
            stroke="hsl(190 100% 50% / 0.55)"
            strokeWidth="1"
            className="animate-ping"
            style={
              {
                transformBox: "fill-box",
                transformOrigin: "center",
              } as React.CSSProperties
            }
          />
          {/* Outer ring */}
          <circle
            r={5.5}
            fill="hsl(190 100% 50% / 0.25)"
            stroke="hsl(190 100% 50%)"
            strokeWidth="1.5"
          />
          {/* Inner filled dot */}
          <circle r={2.5} fill="hsl(190 100% 62%)" />
        </g>
      )}
    </svg>
  );
}
