import { useMemo } from "react";
import type { RouteStep } from "@/context/ShoppingSessionContext";
import type { IndoorMapModel, IndoorMapModelNode } from "@/lib/googleBackendClient";

export interface IndoorMapCanvasProps {
  mallId: string | number | null;
  activeFloor: string;
  activeRouteSteps?: RouteStep[];
  completedStepIndices?: Set<number>;
  currentStepIndex?: number;
  mapModel?: IndoorMapModel | null;
}

const VIEW_W = 360;
const VIEW_H = 172;
const MARGIN_X = 24;
const MARGIN_Y = 16;

function shortLabel(name: string): string {
  if (!name) return "Store";
  if (name.length <= 12) return name;
  const words = name.trim().split(/\s+/);
  if (words[0]?.length >= 4) return words[0];
  const two = `${words[0] ?? ""} ${words[1] ?? ""}`.trim();
  return two.length <= 12 ? two : words[0] ?? "Store";
}

function normalizeFloor(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Ground Floor";
  if (/^g$/i.test(raw)) return "Ground Floor";
  if (/^ground$/i.test(raw)) return "Ground Floor";
  if (/^ground floor$/i.test(raw)) return "Ground Floor";
  const level = raw.match(/^l(?:evel)?\s*(\d+)$/i);
  if (level) return `Level ${level[1]}`;
  return raw;
}

function isInternalNodeName(name: string): boolean {
  return /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(name);
}

function clampPct(value: number | null | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export default function IndoorMapCanvas({
  mallId,
  activeFloor,
  activeRouteSteps = [],
  completedStepIndices = new Set<number>(),
  currentStepIndex = 0,
  mapModel = null,
}: IndoorMapCanvasProps) {
  const safeSteps = Array.isArray(activeRouteSteps) ? activeRouteSteps : [];
  const floor = normalizeFloor(activeFloor);

  const modelNodes = useMemo(() => {
    const nodes = mapModel?.nodes ?? [];
    if (!nodes.length) return [];

    const exact = nodes.filter((node) => normalizeFloor(node.floor) === floor);
    return exact.length ? exact : nodes;
  }, [mapModel, floor]);

  const routeFallbackNodes = useMemo<IndoorMapModelNode[]>(() => {
    return safeSteps.map((step, index) => {
      const rawX = Number((step as any).x_coordinate);
      const rawY = Number((step as any).y_coordinate);

      const fallbackX = 10 + (index / Math.max(safeSteps.length - 1, 1)) * 80;
      const fallbackY = index % 2 === 0 ? 50 : 62;

      const name = step.node_name || step.instruction || `Route point ${index + 1}`;
      const isEntrance = index === 0 || /entrance/i.test(name);
      const isLast = index === safeSteps.length - 1;

      return {
        id: step.node_id || `route-${index}`,
        name,
        type: isEntrance ? "entrance" : isLast ? "shop" : "corridor",
        floor: normalizeFloor(step.floor ?? floor),
        x_coordinate: Number.isFinite(rawX) ? rawX : fallbackX,
        y_coordinate: Number.isFinite(rawY) ? rawY : fallbackY,
        linked_shop_id: isLast ? step.node_id : null,
      };
    });
  }, [safeSteps, floor]);

  const visibleNodes = modelNodes.length > 0 ? modelNodes : routeFallbackNodes;
  const usingBackendModel = modelNodes.length > 0;

  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();

    visibleNodes.forEach((node, index) => {
      const xPct = clampPct(node.x_coordinate, 10 + (index / Math.max(visibleNodes.length - 1, 1)) * 80);
      const yPct = clampPct(node.y_coordinate, node.type === "shop" ? (index % 2 === 0 ? 30 : 70) : 50);

      pos.set(node.id, {
        x: MARGIN_X + (xPct / 100) * (VIEW_W - MARGIN_X * 2),
        y: MARGIN_Y + (yPct / 100) * (VIEW_H - MARGIN_Y * 2),
      });
    });

    return pos;
  }, [visibleNodes]);

  const modelEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return (mapModel?.edges ?? []).filter(
      (edge) => ids.has(edge.from_node_id) && ids.has(edge.to_node_id),
    );
  }, [mapModel, visibleNodes]);

  const routePoints = safeSteps
    .map((step, index) => {
      const pos = nodePositions.get(step.node_id || `route-${index}`);
      if (!pos) return null;
      return { ...pos, stepIdx: index };
    })
    .filter((p): p is { x: number; y: number; stepIdx: number } => p !== null);

  const completedRoutePts = routePoints.filter((p) => completedStepIndices.has(p.stepIdx));
  const remainingRoutePts = routePoints.filter((p) => !completedStepIndices.has(p.stepIdx));
  const lastCompletedPt = completedRoutePts.at(-1);
  const remainingWithBridge = lastCompletedPt
    ? [lastCompletedPt, ...remainingRoutePts]
    : remainingRoutePts;

  const currentStep = safeSteps[currentStepIndex] ?? safeSteps[0];
  const currentPos = currentStep
    ? nodePositions.get(currentStep.node_id) ?? routePoints[0] ?? null
    : routePoints[0] ?? null;

  const lastStep = safeSteps[safeSteps.length - 1];
  const destPos = lastStep
    ? nodePositions.get(lastStep.node_id) ?? routePoints.at(-1) ?? null
    : routePoints.at(-1) ?? null;
  const destName = lastStep?.node_name ?? "Destination";

  const shopNodes = visibleNodes.filter((node) => node.type === "shop" && !isInternalNodeName(node.name));
  const corridorNodes = visibleNodes.filter((node) => node.type !== "shop" || isInternalNodeName(node.name));
  const entranceNodes = visibleNodes.filter((node) => node.type === "entrance");

  if (!mallId) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No mall selected.</p>
      </div>
    );
  }

  if (visibleNodes.length === 0 && safeSteps.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No indoor map model available.</p>
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full h-full"
      aria-label="Indoor mall schematic map"
      style={{ display: "block" }}
    >
      <defs>
        <filter id="mmf-route-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="mmf-dest-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} fill="hsl(240 20% 4%)" />

      <rect
        x={12}
        y={10}
        width={VIEW_W - 24}
        height={VIEW_H - 20}
        rx={9}
        fill="hsl(240 16% 7%)"
        stroke="hsl(240 14% 16%)"
        strokeWidth="0.6"
      />

      <g opacity="0.26">
        {Array.from({ length: 8 }).map((_, i) => (
          <line
            key={`grid-x-${i}`}
            x1={16}
            x2={VIEW_W - 16}
            y1={24 + i * 16}
            y2={24 + i * 16}
            stroke="hsl(240 14% 17%)"
            strokeWidth="0.35"
          />
        ))}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`grid-y-${i}`}
            y1={14}
            y2={VIEW_H - 14}
            x1={24 + i * 27}
            x2={24 + i * 27}
            stroke="hsl(240 14% 17%)"
            strokeWidth="0.35"
          />
        ))}
      </g>

      {modelEdges.map((edge) => {
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
            stroke="hsl(240 14% 25%)"
            strokeWidth={edge.floor_change ? 1.2 : 0.65}
            strokeOpacity={edge.floor_change ? 0.75 : 0.52}
            strokeLinecap="round"
          />
        );
      })}

      {shopNodes.slice(0, 90).map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        const BW = 42;
        const BH = 16;

        return (
          <g key={node.id}>
            <rect
              x={pos.x - BW / 2}
              y={pos.y - BH / 2}
              width={BW}
              height={BH}
              rx={3}
              fill="hsl(240 14% 11%)"
              stroke="hsl(240 14% 24%)"
              strokeWidth="0.6"
            />
            <text
              x={pos.x}
              y={pos.y + 3.3}
              textAnchor="middle"
              fontSize="5.2"
              fontFamily="Inter, system-ui, sans-serif"
              fill="hsl(240 8% 62%)"
            >
              {shortLabel(node.name)}
            </text>
          </g>
        );
      })}

      {corridorNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        return (
          <circle
            key={node.id}
            cx={pos.x}
            cy={pos.y}
            r={node.type === "entrance" ? 3 : 2}
            fill="hsl(190 100% 50% / 0.22)"
            stroke="hsl(190 100% 50% / 0.45)"
            strokeWidth="0.55"
          />
        );
      })}

      {entranceNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        return (
          <g key={`entry-${node.id}`} transform={`translate(${pos.x}, ${pos.y})`}>
            <rect
              x={-15}
              y={-7}
              width={30}
              height={14}
              rx={4}
              fill="hsl(190 100% 50% / 0.12)"
              stroke="hsl(190 100% 50% / 0.46)"
              strokeWidth="0.75"
            />
            <text
              x={0}
              y={3.2}
              textAnchor="middle"
              fontSize="4.8"
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

      {routePoints.length >= 2 && (
        <polyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 50% / 0.16)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#mmf-route-glow)"
        />
      )}

      {completedRoutePts.length >= 2 && (
        <polyline
          points={completedRoutePts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 50% / 0.24)"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {remainingWithBridge.length >= 2 && (
        <polyline
          points={remainingWithBridge.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(190 100% 58%)"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {destPos && (
        <g transform={`translate(${destPos.x}, ${destPos.y})`} filter="url(#mmf-dest-glow)">
          <circle r={7} fill="hsl(111 100% 54% / 0.18)" stroke="hsl(111 100% 54%)" strokeWidth="1.5" />
          <circle r={3} fill="hsl(111 100% 58%)" />
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
        </g>
      )}

      {currentPos && (
        <g transform={`translate(${currentPos.x}, ${currentPos.y})`}>
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
          <circle
            r={5.5}
            fill="hsl(190 100% 50% / 0.25)"
            stroke="hsl(190 100% 50%)"
            strokeWidth="1.5"
          />
          <circle r={2.5} fill="hsl(190 100% 62%)" />
        </g>
      )}

      <text
        x={16}
        y={VIEW_H - 8}
        fontSize="5.3"
        fontFamily="Inter, system-ui, sans-serif"
        fill="hsl(240 8% 48%)"
      >
        {usingBackendModel ? "backend map graph" : "route fallback"}
      </text>
    </svg>
  );
}
