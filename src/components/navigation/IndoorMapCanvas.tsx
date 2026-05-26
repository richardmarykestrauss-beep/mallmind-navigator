import { useMemo } from "react";
import type { RouteStep } from "@/context/ShoppingSessionContext";

interface MallNode {
  id: string;
  name: string;
  type: "shop" | "entrance" | "corridor";
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id: string | null;
}

export interface IndoorMapCanvasProps {
  mallId: string | number | null;
  activeFloor: string;
  activeRouteSteps?: RouteStep[];
  completedStepIndices?: Set<number>;
  currentStepIndex?: number;
}

const VIEW_W = 360;
const VIEW_H = 172;
const MARGIN_X = 28;
const CORRIDOR_Y = VIEW_H / 2;

function shortLabel(name: string): string {
  if (!name) return "Store";
  if (name.length <= 11) return name;
  const words = name.trim().split(/\s+/);
  if (words[0]?.length >= 4) return words[0];
  const two = `${words[0] ?? ""} ${words[1] ?? ""}`.trim();
  return two.length <= 12 ? two : words[0] ?? "Store";
}

function normalizeFloor(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "G";
  if (/^ground floor$/i.test(raw)) return "Ground Floor";
  if (/^g$/i.test(raw)) return "Ground Floor";
  const level = raw.match(/^Level\s+(\d+)$/i);
  if (level) return `Level ${level[1]}`;
  return raw;
}

function isInternalNode(node: MallNode): boolean {
  if (node.linked_shop_id) return false;
  if (node.type !== "shop" && node.type !== "corridor") return false;
  return /spine\s*node|corridor\s*node|junction\s*node|route\s*node|\bnode\s+\d+\b/i.test(node.name);
}

export default function IndoorMapCanvas({
  mallId,
  activeFloor,
  activeRouteSteps = [],
  completedStepIndices = new Set<number>(),
  currentStepIndex = 0,
}: IndoorMapCanvasProps) {
  const safeSteps = Array.isArray(activeRouteSteps) ? activeRouteSteps : [];
  const floor = normalizeFloor(activeFloor);

  const floorSteps = useMemo(() => {
    const exact = safeSteps.filter((step) => normalizeFloor(step.floor) === floor);
    return exact.length > 0 ? exact : safeSteps;
  }, [safeSteps, floor]);

  const routeNodes = useMemo<MallNode[]>(() => {
    return floorSteps.map((step, index) => {
      const rawX = Number((step as any).x_coordinate);
      const rawY = Number((step as any).y_coordinate);

      const fallbackX = 10 + (index / Math.max(floorSteps.length - 1, 1)) * 80;
      const fallbackY = index % 2 === 0 ? 50 : 62;

      const name = step.node_name || step.instruction || `Route point ${index + 1}`;
      const isEntrance = index === 0 || /entrance/i.test(name);
      const isLast = index === floorSteps.length - 1;

      return {
        id: step.node_id || `route-${index}`,
        name,
        type: isEntrance ? "entrance" : isLast ? "shop" : "corridor",
        floor: normalizeFloor(step.floor ?? floor),
        x_coordinate: Number.isFinite(rawX) ? Math.max(0, Math.min(100, rawX)) : fallbackX,
        y_coordinate: Number.isFinite(rawY) ? Math.max(0, Math.min(100, rawY)) : fallbackY,
        linked_shop_id: isLast ? step.node_id : null,
      };
    });
  }, [floorSteps, floor]);

  const visibleNodes = routeNodes;

  const { minX, rangeX } = useMemo(() => {
    const xs = visibleNodes
      .map((n) => n.x_coordinate)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (xs.length < 2) return { minX: 0, rangeX: 100 };
    const mn = Math.min(...xs);
    const mx = Math.max(...xs);
    return { minX: mn, rangeX: Math.max(mx - mn, 10) };
  }, [visibleNodes]);

  const svgX = (x: number | null): number => {
    const v = x ?? minX + rangeX / 2;
    return MARGIN_X + ((v - minX) / rangeX) * (VIEW_W - 2 * MARGIN_X);
  };

  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();

    visibleNodes.forEach((node, index) => {
      if (node.type === "entrance") {
        pos.set(node.id, { x: svgX(node.x_coordinate), y: CORRIDOR_Y + 32 });
      } else if (node.type === "corridor" || isInternalNode(node)) {
        pos.set(node.id, { x: svgX(node.x_coordinate), y: CORRIDOR_Y });
      } else {
        pos.set(node.id, {
          x: svgX(node.x_coordinate),
          y: index % 2 === 0 ? CORRIDOR_Y - 30 : CORRIDOR_Y + 30,
        });
      }
    });

    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes, minX, rangeX]);

  const routePoints = floorSteps
    .map((step, index) => {
      const pos = nodePositions.get(step.node_id || `route-${index}`);
      if (!pos) return null;
      return { ...pos, stepIdx: safeSteps.indexOf(step) };
    })
    .filter((p): p is { x: number; y: number; stepIdx: number } => p !== null);

  const completedRoutePts = routePoints.filter((p) => completedStepIndices.has(p.stepIdx));
  const remainingRoutePts = routePoints.filter((p) => !completedStepIndices.has(p.stepIdx));
  const lastCompletedPt = completedRoutePts.at(-1);
  const remainingWithBridge = lastCompletedPt
    ? [lastCompletedPt, ...remainingRoutePts]
    : remainingRoutePts;

  const currentStep = safeSteps[currentStepIndex] ?? floorSteps[0];
  const currentPos = currentStep
    ? nodePositions.get(currentStep.node_id) ?? routePoints[0] ?? null
    : routePoints[0] ?? null;

  const lastStep = safeSteps[safeSteps.length - 1] ?? floorSteps[floorSteps.length - 1];
  const destPos = lastStep
    ? nodePositions.get(lastStep.node_id) ?? routePoints.at(-1) ?? null
    : routePoints.at(-1) ?? null;
  const destName = lastStep?.node_name ?? "Destination";

  const shopNodes = visibleNodes.filter((n) => !isInternalNode(n) && n.type === "shop");
  const entranceNodes = visibleNodes.filter((n) => n.type === "entrance");
  const corridorNodes = visibleNodes.filter((n) => n.type === "corridor" || isInternalNode(n));

  if (!mallId) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No mall selected.</p>
      </div>
    );
  }

  if (safeSteps.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <p className="text-xs text-muted-foreground">No active route data.</p>
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
        x={14}
        y={10}
        width={VIEW_W - 28}
        height={VIEW_H - 20}
        rx={8}
        fill="hsl(240 16% 7%)"
        stroke="hsl(240 14% 16%)"
        strokeWidth="0.5"
      />

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

      {routePoints.length >= 2 && (
        <polyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="hsl(240 14% 17%)"
          strokeWidth="0.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {shopNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        const isAbove = pos.y < CORRIDOR_Y;
        const BW = 50;
        const BH = 19;

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
              stroke="hsl(240 14% 24%)"
              strokeWidth="0.6"
            />
            <text
              x={pos.x}
              y={pos.y + 3.5}
              textAnchor="middle"
              fontSize="5.7"
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
            r={2.1}
            fill="hsl(190 100% 50% / 0.25)"
            stroke="hsl(190 100% 50% / 0.45)"
            strokeWidth="0.6"
          />
        );
      })}

      {entranceNodes.map((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return null;

        return (
          <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
            <rect
              x={-17}
              y={-8}
              width={34}
              height={16}
              rx={4}
              fill="hsl(190 100% 50% / 0.12)"
              stroke="hsl(190 100% 50% / 0.45)"
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
          stroke="hsl(190 100% 50% / 0.2)"
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
            stroke="hsl(190 100% 50% / 0.25)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#mmf-route-glow)"
          />
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
    </svg>
  );
}
