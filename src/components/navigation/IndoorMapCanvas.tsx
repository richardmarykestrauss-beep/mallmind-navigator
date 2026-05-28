/**
 * IndoorMapCanvas.tsx — Sprint 18B.5F
 *
 * Premium 2.5D GPS-style mall map renderer.
 *
 * GPS Camera: computes a bounding box over the active route points,
 * then sets the SVG viewBox to that region (+ padding) so the route
 * occupies the full map card — the same way a real GPS app zooms to
 * show your current leg of the journey.
 *
 * Architecture:
 *  - Data from mapModel prop (backend /indoor-map-model). No Supabase.
 *  - No useEffect. No data fetching. Pure derived rendering.
 *  - Floorplan SVG rendered directly at high opacity — NO invert filter.
 *    (The generated floorplan is already dark/premium; inverting damages it.)
 *  - Camera activates when route bbox < 70% of viewport in any dimension.
 */

import { useMemo, type CSSProperties } from "react";
import type { RouteStep } from "@/context/ShoppingSessionContext";

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
  mallId?: string | number | null;
  mapModel?: IndoorMapModel | null;
  activeFloor: string;
  activeRouteSteps: RouteStep[];
  completedStepIndices: Set<number>;
  currentStepIndex: number;
}

const VIEW_W = 360;
const VIEW_H = 172;
const MARGIN_X = 22;
const MARGIN_Y = 14;
const CORRIDOR_Y = VIEW_H / 2;
const CAMERA_PAD = 46;

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

function shortLabel(name: string): string {
  if (name.length <= 11) return name;
  const words = name.trim().split(/\s+/);
  if (words[0].length >= 4) return words[0];
  const two = `${words[0]} ${words[1] ?? ""}`.trim();
  return two.length <= 12 ? two : words[0];
}

function MapDefs() {
  return (
    <defs>
      <filter id="mmf-route-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <filter id="mmf-dest-glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <filter id="mmf-pos-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <linearGradient id="mmf-deck-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="hsl(240 18% 9%)" />
        <stop offset="100%" stopColor="hsl(240 16% 7%)" />
      </linearGradient>
    </defs>
  );
}

function DeckPlate() {
  return (
    <>
      <rect
        x={14}
        y={10}
        width={VIEW_W - 28}
        height={VIEW_H - 20}
        rx={7}
        fill="url(#mmf-deck-grad)"
        stroke="hsl(240 14% 16%)"
        strokeWidth="0.5"
      />
      <rect
        x={14}
        y={10}
        width={VIEW_W - 28}
        height={2}
        rx={1}
        fill="hsl(240 14% 20%)"
        opacity={0.6}
      />
    </>
  );
}

export default function IndoorMapCanvas({
  mallId: _mallId,
  mapModel,
  activeFloor,
  activeRouteSteps,
  completedStepIndices,
  currentStepIndex,
}: IndoorMapCanvasProps) {
  const svgX = (pct: number | null): number =>
    r(MARGIN_X + ((pct ?? 50) / 100) * (VIEW_W - 2 * MARGIN_X));

  const svgY = (pct: number | null): number =>
    r(MARGIN_Y + ((pct ?? 50) / 100) * (VIEW_H - 2 * MARGIN_Y));

  const floorNodes = useMemo(() => {
    if (!mapModel) return [];
    const target = normalizeFloorLabel(activeFloor);
    return mapModel.nodes.filter(
      (n) => !n.floor || normalizeFloorLabel(n.floor) === target
    );
  }, [mapModel, activeFloor]);

  const nodeById = useMemo(() => {
    const m = new Map<string, MapNode>();
    (mapModel?.nodes ?? []).forEach((n) => m.set(n.id, n));
    return m;
  }, [mapModel]);

  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    floorNodes.forEach((n) => {
      pos.set(n.id, { x: svgX(n.x_coordinate), y: svgY(n.y_coordinate) });
    });
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorNodes]);

  const floorNodeIds = useMemo(() => new Set(floorNodes.map((n) => n.id)), [floorNodes]);

  const visibleEdges = useMemo(() => {
    if (!mapModel) return [];
    return mapModel.edges.filter(
      (e) =>
        !e.floor_change &&
        floorNodeIds.has(e.from_node_id) &&
        floorNodeIds.has(e.to_node_id)
    );
  }, [mapModel, floorNodeIds]);

  type RoutePoint = { x: number; y: number; stepIdx: number };

  const allRoutePoints: RoutePoint[] = useMemo(() => {
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

  const completedRoutePts = allRoutePoints.filter((p) => completedStepIndices.has(p.stepIdx));
  const remainingRoutePts = allRoutePoints.filter((p) => !completedStepIndices.has(p.stepIdx));
  const lastCompletedPt = completedRoutePts.at(-1);
  const remainingWithBridge = lastCompletedPt
    ? [lastCompletedPt, ...remainingRoutePts]
    : remainingRoutePts;

  const currentStep = activeRouteSteps[currentStepIndex];
  const currentPos = currentStep ? (nodePositions.get(currentStep.node_id) ?? null) : null;
  const lastStep = activeRouteSteps[activeRouteSteps.length - 1];
  const destPos = lastStep ? (nodePositions.get(lastStep.node_id) ?? null) : null;
  const destName = (lastStep
    ? (nodeById.get(lastStep.node_id)?.name ?? lastStep.node_name)
    : null) ?? null;

  const FULL_VB = `0 0 ${VIEW_W} ${VIEW_H}`;

  const cameraViewBox = useMemo(() => {
    if (allRoutePoints.length < 2) return FULL_VB;

    const xs = allRoutePoints.map((p) => p.x);
    const ys = allRoutePoints.map((p) => p.y);

    const rMinX = Math.min(...xs);
    const rMaxX = Math.max(...xs);
    const rMinY = Math.min(...ys);
    const rMaxY = Math.max(...ys);

    const vbX = Math.max(12, rMinX - CAMERA_PAD);
    const vbY = Math.max(8, rMinY - CAMERA_PAD);
    const vbX2 = Math.min(VIEW_W - 12, rMaxX + CAMERA_PAD);
    const vbY2 = Math.min(VIEW_H - 8, rMaxY + CAMERA_PAD);

    const vbW = vbX2 - vbX;
    const vbH = vbY2 - vbY;

    if (vbW < 40 || vbH < 30) return FULL_VB;

    const zoomX = VIEW_W / vbW;
    const zoomY = VIEW_H / vbH;

    if (zoomX < 1.35 && zoomY < 1.35) return FULL_VB;

    return `${r(vbX)} ${r(vbY)} ${r(vbW)} ${r(vbH)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRoutePoints]);

  const isCameraActive = cameraViewBox !== FULL_VB;

  const floorplan = mapModel?.floorplan ?? null;
  const floorplanMatches =
    floorplan?.svg_output &&
    (floorplan.floor_label == null ||
      normalizeFloorLabel(floorplan.floor_label) === normalizeFloorLabel(activeFloor));

  const floorplanUri: string | null =
    floorplanMatches && floorplan?.svg_output
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(floorplan.svg_output))}`
      : null;

  const hasFloorplan = !!floorplanUri;
  const edgeOpacity = hasFloorplan ? "0.18" : "0.55";

  const isInfraNode = (n: MapNode) =>
    /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(n.name);

  const shopNodes = useMemo(
    () => floorNodes.filter((n) => n.type === "shop" && !isInfraNode(n)),
    [floorNodes]
  );

  const routeNodeIds = useMemo(
    () => new Set(activeRouteSteps.map((s) => s.node_id)),
    [activeRouteSteps]
  );

  const featuredShopIds = useMemo(() => {
    const ids = new Set<string>();

    if (lastStep?.node_id) ids.add(lastStep.node_id);
    if (currentStep?.node_id) ids.add(currentStep.node_id);

    activeRouteSteps.forEach((s) => ids.add(s.node_id));

    if (!isCameraActive || !hasFloorplan) {
      const nonRoute = shopNodes.filter((n) => !routeNodeIds.has(n.id));
      const step = Math.max(1, Math.floor(nonRoute.length / 6));

      nonRoute
        .filter((_, i) => i % step === 0)
        .slice(0, 6)
        .forEach((n) => ids.add(n.id));
    }

    return ids;
  }, [lastStep, currentStep, activeRouteSteps, shopNodes, isCameraActive, hasFloorplan, routeNodeIds]);

  const statsLabel = mapModel
    ? `backend map graph · ${mapModel.counts?.all_nodes ?? mapModel.nodes.length} nodes · ${mapModel.counts?.all_edges ?? mapModel.edges.length} edges`
    : null;

  if (!mapModel) {
    if (activeRouteSteps.length === 0) {
      return (
        <div className="flex items-center justify-center w-full h-full">
          <p className="text-xs text-muted-foreground">
            No map data for floor {activeFloor}.
          </p>
        </div>
      );
    }

    const spacing = (VIEW_W - 2 * MARGIN_X) / Math.max(activeRouteSteps.length - 1, 1);
    const fallbackPts = activeRouteSteps.map((_, i) => ({
      x: r(MARGIN_X + i * spacing),
      y: r(VIEW_H / 2),
    }));

    const fbDest = fallbackPts[fallbackPts.length - 1];
    const fbCur = fallbackPts[Math.min(currentStepIndex, fallbackPts.length - 1)] ?? fallbackPts[0];

    return (
      <svg
        viewBox={FULL_VB}
        className="w-full h-full"
        aria-label="Indoor schematic route (fallback)"
        style={{ display: "block" }}
      >
        <MapDefs />
        <rect width={VIEW_W} height={VIEW_H} fill="hsl(240 20% 4%)" />
        <DeckPlate />

        <rect
          x={14}
          y={VIEW_H / 2 - 8}
          width={VIEW_W - 28}
          height={16}
          fill="hsl(240 14% 9%)"
        />

        <polyline
          points={fallbackPts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 50% / 0.22)"
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#mmf-route-glow)"
        />

        <polyline
          points={fallbackPts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 70%)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {fallbackPts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={completedStepIndices.has(i)
              ? "hsl(190 100% 55% / 0.35)"
              : "hsl(190 100% 55%)"}
          />
        ))}

        <g transform={`translate(${fbDest.x},${fbDest.y})`} filter="url(#mmf-dest-glow)">
          <circle r={8} fill="hsl(111 100% 54% / 0.18)" stroke="hsl(111 100% 54%)" strokeWidth="1.5" />
          <circle r={3.5} fill="hsl(111 100% 58%)" />
        </g>

        <g transform={`translate(${fbCur.x},${fbCur.y})`} filter="url(#mmf-pos-glow)">
          <circle r={6} fill="hsl(190 100% 50% / 0.22)" stroke="hsl(190 100% 55%)" strokeWidth="1.5" />
          <circle r={2.8} fill="hsl(190 100% 65%)" />
        </g>

        <text
          x={VIEW_W / 2}
          y={VIEW_H - 6}
          textAnchor="middle"
          fontSize="5.5"
          fontFamily="Inter, system-ui, sans-serif"
          fill="hsl(240 8% 28%)"
        >
          route — {activeRouteSteps.length} stops · {activeFloor}
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox={cameraViewBox}
      className="w-full h-full"
      aria-label="Indoor mall schematic map"
      style={{ display: "block" }}
    >
      <MapDefs />

      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="hsl(240 20% 4%)" />

      <DeckPlate />

      {floorplanUri && (
        <image
          href={floorplanUri}
          x={14}
          y={10}
          width={VIEW_W - 28}
          height={VIEW_H - 20}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.96}
        />
      )}

      <rect
        x={14}
        y={CORRIDOR_Y - 8}
        width={VIEW_W - 28}
        height={16}
        fill="hsl(240 14% 9%)"
      />

      <line
        x1={18}
        y1={CORRIDOR_Y}
        x2={VIEW_W - 18}
        y2={CORRIDOR_Y}
        stroke="hsl(240 14% 22%)"
        strokeWidth="0.8"
        strokeDasharray="6 4"
      />

      {visibleEdges.map((edge) => {
        const from = nodePositions.get(edge.from_node_id);
        const to = nodePositions.get(edge.to_node_id);
        if (!from || !to) return null;

        return (
          <line
            key={edge.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="hsl(240 14% 17%)"
            strokeWidth="0.6"
            opacity={edgeOpacity}
          />
        );
      })}

      {allRoutePoints.length >= 2 && (
        <polyline
          points={allRoutePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 50% / 0.055)"
          strokeWidth="30"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {shopNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        const isFeatured = featuredShopIds.has(node.id);
        const isAbove = pos.y < CORRIDOR_Y;

        if (isFeatured) {
          const BW = 44;
          const BH = 17;

          return (
            <g key={node.id}>
              <line
                x1={pos.x}
                y1={pos.y + (isAbove ? BH / 2 : -BH / 2)}
                x2={pos.x}
                y2={CORRIDOR_Y + (isAbove ? -8 : 8)}
                stroke="hsl(240 14% 19%)"
                strokeWidth="0.5"
              />

              <rect
                x={pos.x - BW / 2}
                y={pos.y - BH / 2}
                width={BW}
                height={BH}
                rx={3}
                fill="hsl(240 14% 11%)"
                stroke="hsl(240 14% 21%)"
                strokeWidth="0.5"
              />

              <text
                x={pos.x}
                y={pos.y + 3.5}
                textAnchor="middle"
                fontSize="5.5"
                fontFamily="Inter, system-ui, sans-serif"
                fill="hsl(240 8% 50%)"
              >
                {shortLabel(node.name)}
              </text>
            </g>
          );
        }

        const SW = 20;
        const SH = 9;

        return (
          <rect
            key={node.id}
            x={pos.x - SW / 2}
            y={pos.y - SH / 2}
            width={SW}
            height={SH}
            rx={2}
            fill="hsl(240 14% 10%)"
            stroke="hsl(240 14% 18%)"
            strokeWidth="0.4"
            opacity={isCameraActive && hasFloorplan ? 0.22 : 0.55}
          />
        );
      })}

      {floorNodes
        .filter((n) => n.type === "entrance")
        .map((node) => {
          const pos = nodePositions.get(node.id);
          if (!pos) return null;

          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
              <rect
                x={-16}
                y={-8}
                width={32}
                height={16}
                rx={4}
                fill="hsl(190 100% 50% / 0.12)"
                stroke="hsl(190 100% 50% / 0.38)"
                strokeWidth="0.8"
              />

              <text
                x={0}
                y={3.5}
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

      {completedRoutePts.length >= 2 && (
        <polyline
          points={completedRoutePts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 50% / 0.20)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {remainingWithBridge.length >= 2 && (
        <>
          <polyline
            points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="hsl(190 100% 50% / 0.18)"
            strokeWidth="18"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#mmf-route-glow)"
          />

          <polyline
            points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="hsl(190 100% 60% / 0.45)"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <polyline
            points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="hsl(190 100% 70%)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {destPos && (
        <g transform={`translate(${destPos.x},${destPos.y})`} filter="url(#mmf-dest-glow)">
          <circle r={13} fill="none" stroke="hsl(111 100% 54% / 0.12)" strokeWidth="1" />
          <circle r={8} fill="hsl(111 100% 54% / 0.20)" stroke="hsl(111 100% 54%)" strokeWidth="1.5" />
          <circle r={3.5} fill="hsl(111 100% 60%)" />

          {destName && (
            <>
              <text
                x={0}
                y={-16}
                textAnchor="middle"
                fontSize="6"
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="700"
                stroke="hsl(240 20% 4%)"
                strokeWidth={3}
                fill="none"
              >
                {shortLabel(destName)}
              </text>

              <text
                x={0}
                y={-16}
                textAnchor="middle"
                fontSize="6"
                fontFamily="Inter, system-ui, sans-serif"
                fontWeight="700"
                fill="hsl(111 100% 68%)"
              >
                {shortLabel(destName)}
              </text>
            </>
          )}
        </g>
      )}

      {currentPos && (
        <g transform={`translate(${currentPos.x},${currentPos.y})`} filter="url(#mmf-pos-glow)">
          <circle
            r={9}
            fill="none"
            stroke="hsl(190 100% 50% / 0.45)"
            strokeWidth="1"
            className="animate-ping"
            style={{ transformBox: "fill-box", transformOrigin: "center" } as CSSProperties}
          />

          <circle
            r={6}
            fill="hsl(190 100% 50% / 0.22)"
            stroke="hsl(190 100% 55%)"
            strokeWidth="1.5"
          />

          <circle r={2.8} fill="hsl(190 100% 65%)" />
        </g>
      )}

      {statsLabel && (
        <text
          x={VIEW_W - 16}
          y={VIEW_H - 6}
          textAnchor="end"
          fontSize="5"
          fontFamily="Inter, system-ui, sans-serif"
          fill="hsl(240 8% 22%)"
        >
          {statsLabel}
        </text>
      )}

      {isCameraActive && (
        <text
          x={16}
          y={VIEW_H - 6}
          textAnchor="start"
          fontSize="5"
          fontFamily="Inter, system-ui, sans-serif"
          fill="hsl(190 100% 50% / 0.45)"
        >
          ⦿ route focus
        </text>
      )}
    </svg>
  );
}
