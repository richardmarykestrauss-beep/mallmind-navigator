/**
 * IndoorMapCanvas.tsx — premium indoor-navigation canvas ("MallMind Indoor GPS").
 *
 * A self-contained SVG/CSS renderer (no paid SDKs, no external services) that
 * turns the route graph into a demo-grade indoor map: blueprint grid, walkable
 * corridors, store zones, a glowing animated route line, a strong pulsing
 * position marker, and clear START / DESTINATION pins — while staying honest
 * that this is a *schematic route preview, not live GPS*.
 *
 * Contract is unchanged: same props, same simulated-position handling, same
 * floor filtering + GPS-style camera. Only the visual rendering is upgraded, and
 * the missing-floorplan case now falls back to a premium schematic (never an
 * empty/broken box). See mapRenderMode.ts for the pure render decision.
 */

import { useMemo, type CSSProperties } from "react";
import type { RouteStep } from "@/context/ShoppingSessionContext";
import { selectMapRenderMode, buildSchematicRoute } from "./mapRenderMode";

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface MapFloorplan {
  id: string;
  floor_label: string | null;
  svg_output: string | null;
  layout_json: unknown;
  status: string | null;
  created_at: string | null;
}

export interface IndoorMapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  counts: MapCounts;
  floorplan?: MapFloorplan | null;
}

export interface IndoorMapCanvasProps {
  mallId?: string | number | null;   // passed by NavigateScreen, not used for fetching
  mapModel?: IndoorMapModel | null;
  activeFloor: string;
  activeRouteSteps: RouteStep[];
  completedStepIndices: Set<number>;
  currentStepIndex: number;
  /**
   * Simulated walk position in route coordinate space (percent-style x/y), when a
   * route-walk simulation is active. Overrides the step-based current marker so the
   * marker glides between nodes instead of teleporting on "Done". Not live GPS.
   */
  simulatedPosition?: { x: number; y: number } | null;
}

// ── Viewport constants ─────────────────────────────────────────────────────────

const VIEW_W     = 360;
const VIEW_H     = 176;
const MARGIN_X   = 24;
const MARGIN_Y   = 16;
const CORRIDOR_Y = VIEW_H / 2;
const CAMERA_PAD = 60;
const FULL_VB    = `0 0 ${VIEW_W} ${VIEW_H}`;

/** Honest, always-visible caption — this is a simulation, not live positioning. */
const HONEST_CAPTION = "Schematic route preview · not live GPS";

// ── Helpers ────────────────────────────────────────────────────────────────────

function r(n: number): number {
  return Math.round(n * 10) / 10;
}

function normalizeFloorLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^g$/i.test(raw)) return "Ground Floor";
  if (/^ground$/i.test(raw)) return "Ground Floor";
  if (/^ground\s+floor$/i.test(raw)) return "Ground Floor";
  const level = raw.match(/^l(?:evel)?\s*(\d+)$/i);
  if (level) return `Level ${level[1]}`;
  return raw;
}

function sanitizeSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
}

function shortLabel(name: string, max = 13): string {
  const clean = name.trim();
  if (clean.length <= max) return clean;
  const words = clean.split(/\s+/);
  if (words[0].length >= 4) return words[0];
  const two = `${words[0]} ${words[1] ?? ""}`.trim();
  return two.length <= max ? two : words[0];
}

function isInfraNode(n: MapNode): boolean {
  return /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(n.name);
}

// ── Shared SVG defs (gradients / filters / blueprint grid) ──────────────────────

function MapDefs() {
  return (
    <defs>
      {/* Blueprint grid — faint cyan lattice for a "technical mall plan" feel. */}
      <pattern id="mmf-grid" width="13" height="13" patternUnits="userSpaceOnUse">
        <path d="M13 0H0V13" fill="none" stroke="hsl(190 100% 55% / 0.05)" strokeWidth="0.5" />
      </pattern>
      <radialGradient id="mmf-vignette" cx="50%" cy="42%" r="75%">
        <stop offset="55%" stopColor="hsl(240 24% 6% / 0)" />
        <stop offset="100%" stopColor="hsl(240 30% 2% / 0.85)" />
      </radialGradient>
      <linearGradient id="mmf-stage-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="hsl(240 22% 6%)" />
        <stop offset="100%" stopColor="hsl(240 24% 3.5%)" />
      </linearGradient>
      <linearGradient id="mmf-deck-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="hsl(240 18% 10%)" />
        <stop offset="100%" stopColor="hsl(240 18% 7%)" />
      </linearGradient>
      <linearGradient id="mmf-route-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor="hsl(190 100% 62%)" />
        <stop offset="100%" stopColor="hsl(165 100% 60%)" />
      </linearGradient>
      <radialGradient id="mmf-corridor-grad" cx="50%" cy="50%" r="60%">
        <stop offset="0%"   stopColor="hsl(240 16% 14%)" />
        <stop offset="100%" stopColor="hsl(240 16% 10%)" />
      </radialGradient>
      <filter id="mmf-route-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="mmf-dest-glow" x="-90%" y="-90%" width="280%" height="280%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="mmf-pos-glow" x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="2.4" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

/** Deep gradient stage + rounded deck plate + blueprint grid + vignette. */
function PremiumBackground() {
  return (
    <>
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#mmf-stage-grad)" />
      <rect
        x={12} y={10} width={VIEW_W - 24} height={VIEW_H - 20} rx={10}
        fill="url(#mmf-deck-grad)" stroke="hsl(240 14% 17%)" strokeWidth="0.7"
      />
      <rect x={12} y={10} width={VIEW_W - 24} height={VIEW_H - 20} rx={10} fill="url(#mmf-grid)" />
      {/* Top inner sheen */}
      <rect x={16} y={12} width={VIEW_W - 32} height={2} rx={1} fill="hsl(200 60% 40% / 0.25)" />
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="url(#mmf-vignette)" pointerEvents="none" />
    </>
  );
}

/** Glowing route line + a subtle animated "flow" of light travelling to the goal. */
function RouteLine({ pts, animated }: { pts: { x: number; y: number }[]; animated: boolean }) {
  if (pts.length < 2) return null;
  const d = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <>
      <polyline points={d} fill="none" stroke="hsl(190 100% 50% / 0.16)" strokeWidth="16"
        strokeLinecap="round" strokeLinejoin="round" filter="url(#mmf-route-glow)" />
      <polyline points={d} fill="none" stroke="hsl(190 100% 58% / 0.5)" strokeWidth="5"
        strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={d} fill="none" stroke="url(#mmf-route-grad)" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round" />
      {/* Animated light dots flowing toward the destination (SMIL — no global CSS). */}
      {animated && (
        <polyline points={d} fill="none" stroke="hsl(0 0% 100% / 0.9)" strokeWidth="1.6"
          strokeLinecap="round" strokeDasharray="0.5 13">
          <animate attributeName="stroke-dashoffset" from="0" to="-13.5" dur="0.9s" repeatCount="indefinite" />
        </polyline>
      )}
    </>
  );
}

/** Green teardrop destination pin (tip at the point) with a haloed store label. */
function DestinationPin({ x, y, label }: { x: number; y: number; label: string | null }) {
  return (
    <g transform={`translate(${x},${y})`} filter="url(#mmf-dest-glow)">
      <ellipse cx={0} cy={1} rx={5} ry={1.6} fill="hsl(240 30% 2% / 0.5)" />
      <circle r={15} fill="none" stroke="hsl(111 100% 54% / 0.18)" strokeWidth="1">
        <animate attributeName="r" values="11;16;11" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <path d="M0 0 C -6.5 -12 -6.5 -18 0 -21 C 6.5 -18 6.5 -12 0 0 Z"
        fill="hsl(111 100% 46%)" stroke="hsl(111 100% 72%)" strokeWidth="1" />
      <circle cx={0} cy={-14} r={3} fill="hsl(240 30% 6%)" />
      {label && (
        <>
          <text x={0} y={-26} textAnchor="middle" fontSize="7"
            fontFamily="Inter, system-ui, sans-serif" fontWeight="800"
            stroke="hsl(240 30% 3%)" strokeWidth={3.2} fill="none" strokeLinejoin="round">
            {shortLabel(label)}
          </text>
          <text x={0} y={-26} textAnchor="middle" fontSize="7"
            fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fill="hsl(111 100% 74%)">
            {shortLabel(label)}
          </text>
        </>
      )}
    </g>
  );
}

/** Cyan origin marker — a calm ring + "START" tag, distinct from the moving dot. */
function StartPin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r={6} fill="hsl(190 100% 50% / 0.12)" stroke="hsl(190 100% 60% / 0.7)" strokeWidth="1" />
      <circle r={2} fill="hsl(190 100% 78%)" />
      <text x={0} y={13} textAnchor="middle" fontSize="4.6"
        fontFamily="Inter, system-ui, sans-serif" fontWeight="800" letterSpacing="0.12em"
        stroke="hsl(240 30% 3%)" strokeWidth={2.4} fill="none" strokeLinejoin="round">START</text>
      <text x={0} y={13} textAnchor="middle" fontSize="4.6"
        fontFamily="Inter, system-ui, sans-serif" fontWeight="800" letterSpacing="0.12em"
        fill="hsl(190 100% 72%)">START</text>
    </g>
  );
}

/** Strong pulsing "you are here" simulated-position marker. */
function PositionMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} filter="url(#mmf-pos-glow)">
      <circle r={10} fill="none" stroke="hsl(190 100% 55% / 0.5)" strokeWidth="1"
        className="animate-ping"
        style={{ transformBox: "fill-box", transformOrigin: "center" } as CSSProperties} />
      <circle r={7} fill="hsl(190 100% 50% / 0.18)" stroke="hsl(190 100% 60% / 0.8)" strokeWidth="1">
        <animate attributeName="r" values="6.2;8;6.2" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle r={3.4} fill="hsl(190 100% 72%)" stroke="hsl(0 0% 100%)" strokeWidth="0.8" />
    </g>
  );
}

/** Small honest caption pinned to the bottom of the canvas. */
function HonestCaption() {
  return (
    <text x={VIEW_W / 2} y={VIEW_H - 6} textAnchor="middle" fontSize="5.4"
      fontFamily="Inter, system-ui, sans-serif" fontWeight="600" letterSpacing="0.02em"
      fill="hsl(240 10% 42%)">
      {HONEST_CAPTION}
    </text>
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
  simulatedPosition,
}: IndoorMapCanvasProps) {

  const safeNodes = mapModel?.nodes ?? [];
  const safeEdges = mapModel?.edges ?? [];

  const svgX = (pct: number | null): number =>
    r(MARGIN_X + ((pct ?? 50) / 100) * (VIEW_W - 2 * MARGIN_X));
  const svgY = (pct: number | null): number =>
    r(MARGIN_Y + ((pct ?? 50) / 100) * (VIEW_H - 2 * MARGIN_Y));

  const floorNodes = useMemo(() => {
    if (safeNodes.length === 0) return [];
    const target = normalizeFloorLabel(activeFloor);
    return safeNodes.filter((n) => !n.floor || normalizeFloorLabel(n.floor) === target);
  }, [safeNodes, activeFloor]);

  const nodeById = useMemo(() => {
    const m = new Map<string, MapNode>();
    safeNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [safeNodes]);

  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    floorNodes.forEach((n) => pos.set(n.id, { x: svgX(n.x_coordinate), y: svgY(n.y_coordinate) }));
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorNodes]);

  const floorNodeIds = useMemo(() => new Set(floorNodes.map((n) => n.id)), [floorNodes]);

  const visibleEdges = useMemo(() => {
    if (safeEdges.length === 0) return [];
    return safeEdges.filter(
      (e) => !e.floor_change && floorNodeIds.has(e.from_node_id) && floorNodeIds.has(e.to_node_id),
    );
  }, [safeEdges, floorNodeIds]);

  type RoutePoint = { x: number; y: number; stepIdx: number };

  const allRoutePoints: RoutePoint[] = useMemo(() => {
    if (activeRouteSteps.length === 0) return [];
    const target = normalizeFloorLabel(activeFloor);
    return activeRouteSteps
      .map((step, i) => {
        if (step.floor && normalizeFloorLabel(step.floor) !== target) return null;
        const pos = nodePositions.get(step.node_id);
        if (!pos) return null;
        return { ...pos, stepIdx: i };
      })
      .filter((p): p is RoutePoint => p !== null);
  }, [activeRouteSteps, activeFloor, nodePositions]);

  const completedRoutePts   = allRoutePoints.filter((p) => completedStepIndices.has(p.stepIdx));
  const remainingRoutePts   = allRoutePoints.filter((p) => !completedStepIndices.has(p.stepIdx));
  const lastCompletedPt     = completedRoutePts.at(-1);
  const remainingWithBridge = lastCompletedPt ? [lastCompletedPt, ...remainingRoutePts] : remainingRoutePts;

  const currentStep = activeRouteSteps[currentStepIndex] ?? null;
  const stepPos  = currentStep ? (nodePositions.get(currentStep.node_id) ?? null) : null;
  const simPos = simulatedPosition ? { x: svgX(simulatedPosition.x), y: svgY(simulatedPosition.y) } : null;
  const currentPos = simPos ?? stepPos;

  const firstStep = activeRouteSteps[0] ?? null;
  const startPos = firstStep && (!firstStep.floor || normalizeFloorLabel(firstStep.floor) === normalizeFloorLabel(activeFloor))
    ? (nodePositions.get(firstStep.node_id) ?? null) : null;

  const lastStep = activeRouteSteps.length > 0 ? activeRouteSteps[activeRouteSteps.length - 1] : null;
  const destPos  = lastStep ? (nodePositions.get(lastStep.node_id) ?? null) : null;
  const destName = lastStep ? (nodeById.get(lastStep.node_id)?.name ?? lastStep.node_name ?? null) : null;

  const markerNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (lastStep?.node_id)    ids.add(lastStep.node_id);
    if (currentStep?.node_id) ids.add(currentStep.node_id);
    if (firstStep?.node_id)   ids.add(firstStep.node_id);
    return ids;
  }, [lastStep, currentStep, firstStep]);

  const cameraViewBox = useMemo(() => {
    if (allRoutePoints.length < 2) return FULL_VB;
    const xs = allRoutePoints.map((p) => p.x);
    const ys = allRoutePoints.map((p) => p.y);
    const vbX  = Math.max(6,          Math.min(...xs) - CAMERA_PAD);
    const vbY  = Math.max(6,          Math.min(...ys) - CAMERA_PAD);
    const vbX2 = Math.min(VIEW_W - 6, Math.max(...xs) + CAMERA_PAD);
    const vbY2 = Math.min(VIEW_H - 6, Math.max(...ys) + CAMERA_PAD);
    const vbW  = vbX2 - vbX;
    const vbH  = vbY2 - vbY;
    if (vbW < 40 || vbH < 30) return FULL_VB;
    if (VIEW_W / vbW < 1.35 && VIEW_H / vbH < 1.35) return FULL_VB;
    return `${r(vbX)} ${r(vbY)} ${r(vbW)} ${r(vbH)}`;
  }, [allRoutePoints]);

  const isCameraActive = cameraViewBox !== FULL_VB;

  const floorplan = mapModel?.floorplan ?? null;
  const floorplanMatches =
    floorplan?.svg_output != null && floorplan.svg_output.length > 0 &&
    (floorplan.floor_label == null || normalizeFloorLabel(floorplan.floor_label) === normalizeFloorLabel(activeFloor));
  const floorplanUri: string | null =
    floorplanMatches && floorplan?.svg_output
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(floorplan.svg_output))}`
      : null;
  const hasFloorplan = !!floorplanUri;
  const edgeOpacity = hasFloorplan ? "0.08" : "0.5";

  const shopNodes = useMemo(
    () => floorNodes.filter((n) => n.type === "shop" && !isInfraNode(n)),
    [floorNodes],
  );

  const routeNodeIds = useMemo(() => new Set(activeRouteSteps.map((s) => s.node_id)), [activeRouteSteps]);

  const featuredShopIds = useMemo(() => {
    const ids = new Set<string>();
    activeRouteSteps.forEach((s) => ids.add(s.node_id));
    if (!isCameraActive || !hasFloorplan) {
      const nonRoute = shopNodes.filter((n) => !routeNodeIds.has(n.id));
      const step = Math.max(1, Math.floor(nonRoute.length / 6));
      nonRoute.filter((_, i) => i % step === 0).slice(0, 6).forEach((n) => ids.add(n.id));
    }
    return ids;
  }, [activeRouteSteps, shopNodes, isCameraActive, hasFloorplan, routeNodeIds]);

  const floorStepCount = activeRouteSteps.filter(
    (s) => !s.floor || normalizeFloorLabel(s.floor) === normalizeFloorLabel(activeFloor),
  ).length;
  const hasPartialRoute = floorStepCount > 0 && allRoutePoints.length > 0 && allRoutePoints.length < floorStepCount;

  const renderMode = selectMapRenderMode({
    hasMapModel: !!mapModel,
    routeStepCount: activeRouteSteps.length,
  });

  // ── "empty" — no model, no route ────────────────────────────────────────────
  if (renderMode === "empty") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-xs text-muted-foreground">No map data for floor {activeFloor}.</p>
      </div>
    );
  }

  // ── "schematic" — no map model but a route exists → premium fallback ─────────
  if (renderMode === "schematic") {
    const pts = buildSchematicRoute(activeRouteSteps.length, { width: VIEW_W, height: VIEW_H, marginX: MARGIN_X });
    const done = pts.filter((_, i) => completedStepIndices.has(i));
    const remaining = pts.filter((_, i) => !completedStepIndices.has(i));
    const bridge = done.length ? [done[done.length - 1], ...remaining] : remaining;
    const cur = pts[Math.min(currentStepIndex, pts.length - 1)] ?? pts[0];

    return (
      <svg viewBox={FULL_VB} className="h-full w-full" aria-label="Schematic route preview (generated from route graph)" style={{ display: "block" }}>
        <MapDefs />
        <PremiumBackground />

        {/* Walkable corridor ribbon following the schematic route */}
        {pts.length >= 2 && (
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none"
            stroke="url(#mmf-corridor-grad)" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {done.length >= 2 && (
          <polyline points={done.map((p) => `${p.x},${p.y}`).join(" ")} fill="none"
            stroke="hsl(190 100% 50% / 0.22)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        <RouteLine pts={bridge} animated />

        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.4}
            fill={completedStepIndices.has(i) ? "hsl(190 100% 55% / 0.4)" : "hsl(190 100% 62%)"} />
        ))}

        {startPos == null && pts[0] && <StartPin x={pts[0].x} y={pts[0].y} />}
        {pts.length > 0 && <DestinationPin x={pts[pts.length - 1].x} y={pts[pts.length - 1].y} label={destName} />}
        {cur && <PositionMarker x={cur.x} y={cur.y} />}

        <text x={16} y={VIEW_H - 6} textAnchor="start" fontSize="5"
          fontFamily="Inter, system-ui, sans-serif" fill="hsl(240 8% 34%)">
          preview · {activeRouteSteps.length} stops · {activeFloor}
        </text>
        <HonestCaption />
      </svg>
    );
  }

  // ── "full" — backend map model present ──────────────────────────────────────
  return (
    <svg viewBox={cameraViewBox} className="h-full w-full" aria-label="Indoor mall map" style={{ display: "block" }}>
      <MapDefs />
      <PremiumBackground />

      {/* Floorplan SVG base layer (already dark/premium — no filter) */}
      {floorplanUri && (
        <image href={floorplanUri} x={12} y={10} width={VIEW_W - 24} height={VIEW_H - 20}
          preserveAspectRatio="xMidYMid meet" opacity={0.95} />
      )}

      {/* Walkable corridors — thick rounded ribbons under the graph edges */}
      {!hasFloorplan && visibleEdges.map((edge) => {
        const from = nodePositions.get(edge.from_node_id);
        const to   = nodePositions.get(edge.to_node_id);
        if (!from || !to) return null;
        return (
          <line key={`corridor-${edge.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="url(#mmf-corridor-grad)" strokeWidth="11" strokeLinecap="round" />
        );
      })}
      {/* Central concourse guide */}
      {!hasFloorplan && (
        <line x1={20} y1={CORRIDOR_Y} x2={VIEW_W - 20} y2={CORRIDOR_Y}
          stroke="hsl(190 100% 55% / 0.14)" strokeWidth="0.8" strokeDasharray="5 5" />
      )}

      {/* Faint node graph */}
      {visibleEdges.map((edge) => {
        const from = nodePositions.get(edge.from_node_id);
        const to   = nodePositions.get(edge.to_node_id);
        if (!from || !to) return null;
        return (
          <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="hsl(240 14% 24%)" strokeWidth="0.5" opacity={edgeOpacity} />
        );
      })}

      {/* Route ambient wash */}
      {allRoutePoints.length >= 2 && (
        <polyline points={allRoutePoints.map((p) => `${p.x},${p.y}`).join(" ")} fill="none"
          stroke="hsl(190 100% 50% / 0.06)" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Store zones — glassy rounded blocks; markers skip their own nodes */}
      {shopNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos || markerNodeIds.has(node.id)) return null;
        const isFeatured = featuredShopIds.has(node.id);
        const isAbove = pos.y < CORRIDOR_Y;
        if (isFeatured) {
          const BW = 46, BH = 18;
          return (
            <g key={node.id}>
              <line x1={pos.x} y1={pos.y + (isAbove ? BH / 2 : -BH / 2)} x2={pos.x} y2={CORRIDOR_Y + (isAbove ? -8 : 8)}
                stroke="hsl(240 14% 22%)" strokeWidth="0.5" />
              <rect x={pos.x - BW / 2} y={pos.y - BH / 2} width={BW} height={BH} rx={4}
                fill="hsl(240 16% 12%)" stroke="hsl(200 40% 40% / 0.35)" strokeWidth="0.6" />
              <rect x={pos.x - BW / 2 + 2} y={pos.y - BH / 2 + 1.5} width={BW - 4} height={1} rx={0.5}
                fill="hsl(200 50% 55% / 0.18)" />
              <text x={pos.x} y={pos.y + 3} textAnchor="middle" fontSize="6"
                fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fill="hsl(210 20% 66%)">
                {shortLabel(node.name, 11)}
              </text>
            </g>
          );
        }
        const SW = 22, SH = 10;
        return (
          <rect key={node.id} x={pos.x - SW / 2} y={pos.y - SH / 2} width={SW} height={SH} rx={2.5}
            fill="hsl(240 16% 11%)" stroke="hsl(240 14% 20%)" strokeWidth="0.4"
            opacity={isCameraActive && hasFloorplan ? 0.22 : 0.6} />
        );
      })}

      {/* Entrances */}
      {floorNodes.filter((n) => n.type === "entrance").map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;
        return (
          <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
            <rect x={-16} y={-8} width={32} height={16} rx={5}
              fill="hsl(190 100% 50% / 0.12)" stroke="hsl(190 100% 50% / 0.4)" strokeWidth="0.8" />
            <text x={0} y={3.5} textAnchor="middle" fontSize="5" fontFamily="Inter, system-ui, sans-serif"
              fontWeight="700" fill="hsl(190 100% 68%)" letterSpacing="0.06em">ENTRY</text>
          </g>
        );
      })}

      {/* Completed route (dimmed) */}
      {completedRoutePts.length >= 2 && (
        <polyline points={completedRoutePts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none"
          stroke="hsl(190 100% 50% / 0.22)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Active route — glow + animated flow */}
      <RouteLine pts={remainingWithBridge} animated />

      {/* Pins + marker (drawn last, on top) */}
      {startPos && <StartPin x={startPos.x} y={startPos.y} />}
      {destPos && <DestinationPin x={destPos.x} y={destPos.y} label={destName} />}
      {currentPos && <PositionMarker x={currentPos.x} y={currentPos.y} />}

      {/* Status (bottom-left) + honest caption (bottom-centre) */}
      <text x={16} y={VIEW_H - 6} textAnchor="start" fontSize="5"
        fontFamily="Inter, system-ui, sans-serif"
        fill={isCameraActive ? "hsl(190 100% 50% / 0.5)" : "hsl(240 8% 34%)"}>
        {[isCameraActive ? "⦿ route focus" : null, hasFloorplan ? "live floorplan" : "graph schematic", hasPartialRoute ? "partial" : null]
          .filter(Boolean).join(" · ")}
      </text>
      <HonestCaption />
    </svg>
  );
}
