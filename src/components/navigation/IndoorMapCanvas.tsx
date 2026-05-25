import { Flag, MapPin, Navigation, Store } from "lucide-react";
import { cn } from "@/lib/utils";

export type IndoorMapNode = {
  id: string;
  name: string;
  type: string;
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  source?: string | null;
};

export type IndoorMapEdge = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  distance_meters?: number | null;
  instruction?: string | null;
};

export type IndoorRoutePoint = {
  x: number;
  y: number;
  floor?: string | null;
  label?: string;
  instruction?: string;
};

type Props = {
  floorPlanSvg?: string | null;
  nodes: IndoorMapNode[];
  edges: IndoorMapEdge[];
  routePoints: IndoorRoutePoint[];
  completedPointCount: number;
  currentPoint?: IndoorRoutePoint | null;
  destinationPoint?: IndoorRoutePoint | null;
  activeFloor?: string | null;
  className?: string;
};

function clampPct(value: number | null | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(4, Math.min(96, n));
}

function floorKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function shortName(name: string): string {
  if (!name) return "Store";
  if (name.length <= 14) return name;
  return `${name.slice(0, 12)}…`;
}

function shopAccent(index: number): string {
  const variants = [
    "border-violet-300/35 bg-violet-500/18",
    "border-cyan-300/30 bg-cyan-500/15",
    "border-emerald-300/28 bg-emerald-500/14",
    "border-sky-300/30 bg-sky-500/15",
    "border-primary/30 bg-primary/14",
  ];
  return variants[index % variants.length];
}

export default function IndoorMapCanvas({
  floorPlanSvg,
  nodes,
  edges,
  routePoints,
  completedPointCount,
  currentPoint,
  destinationPoint,
  activeFloor,
  className,
}: Props) {
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
  const activeFloorKey = floorKey(activeFloor);

  const visibleNodes = nodes.filter((node) => {
    if (!activeFloorKey) return true;
    return floorKey(node.floor) === activeFloorKey;
  });

  const shops = visibleNodes.filter((node) => node.type === "shop").slice(0, 90);
  const corridors = visibleNodes.filter((node) => node.type === "corridor");
  const entrances = visibleNodes.filter((node) => node.type === "entrance");

  const graphLines = edges
    .map((edge) => {
      const from = nodeMap.get(String(edge.from_node_id));
      const to = nodeMap.get(String(edge.to_node_id));
      if (!from || !to) return null;

      if (activeFloorKey) {
        const fromFloor = floorKey(from.floor);
        const toFloor = floorKey(to.floor);
        if (fromFloor !== activeFloorKey && toFloor !== activeFloorKey) return null;
      }

      return {
        id: edge.id,
        x1: clampPct(from.x_coordinate, 50),
        y1: clampPct(from.y_coordinate, 50),
        x2: clampPct(to.x_coordinate, 50),
        y2: clampPct(to.y_coordinate, 50),
        corridor: from.type === "corridor" && to.type === "corridor",
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      corridor: boolean;
    }>;

  const routePolyline = routePoints.map((point) => `${point.x},${point.y}`).join(" ");
  const completedPolyline = routePoints
    .slice(0, Math.max(1, completedPointCount))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <div
      className={cn(
        "absolute inset-0 z-[5] pointer-events-none overflow-hidden rounded-[1.35rem] bg-background",
        className,
      )}
    >
      {/* dark premium base */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,hsl(var(--primary)/0.23),transparent_30%),radial-gradient(circle_at_74%_64%,hsl(var(--primary)/0.14),transparent_36%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.52))]" />
      <div className="absolute inset-0 opacity-[0.22] bg-[linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] bg-[size:22px_22px]" />

      {/* raised 2.5D mall deck */}
      <div className="absolute left-[4%] right-[4%] top-[9%] h-[70%] rounded-[2.2rem] border border-primary/22 bg-primary/[0.05] shadow-[0_32px_90px_hsl(var(--background)/0.88),inset_0_1px_0_hsl(var(--primary)/0.18)]" />
      <div className="absolute left-[8%] right-[8%] top-[14%] h-[58%] rounded-[1.7rem] border border-primary/12 bg-background/32 shadow-[inset_0_0_60px_hsl(var(--primary)/0.09)]" />

      {/* broad mall zones so it reads as a floor plan even when generated data is simple */}
      <div className="absolute left-[12%] top-[18%] h-[17%] w-[33%] rounded-2xl border border-violet-300/18 bg-violet-500/12 shadow-[0_12px_30px_hsl(var(--background)/0.5)]" />
      <div className="absolute right-[13%] top-[18%] h-[16%] w-[30%] rounded-2xl border border-cyan-300/16 bg-cyan-500/10 shadow-[0_12px_30px_hsl(var(--background)/0.5)]" />
      <div className="absolute left-[16%] top-[48%] h-[16%] w-[29%] rounded-2xl border border-emerald-300/16 bg-emerald-500/10 shadow-[0_12px_30px_hsl(var(--background)/0.5)]" />
      <div className="absolute right-[16%] top-[47%] h-[17%] w-[31%] rounded-2xl border border-violet-300/16 bg-violet-500/10 shadow-[0_12px_30px_hsl(var(--background)/0.5)]" />

      {/* subtle Map Factory SVG texture behind the live graph */}
      {floorPlanSvg && (
        <div
          className="absolute inset-0 opacity-[0.18] mix-blend-screen [&_svg]:h-full [&_svg]:w-full [&_rect]:stroke-primary/25"
          dangerouslySetInnerHTML={{ __html: floorPlanSvg }}
        />
      )}

      {/* storefront blocks */}
      {shops.map((node, index) => {
        const x = clampPct(node.x_coordinate, 50);
        const y = clampPct(node.y_coordinate, 50);
        const isDestination =
          destinationPoint &&
          Math.abs(destinationPoint.x - x) < 1.8 &&
          Math.abs(destinationPoint.y - y) < 1.8;

        return (
          <div
            key={`shop-${node.id}`}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border backdrop-blur-[1px]",
              "shadow-[0_14px_30px_hsl(var(--background)/0.62),inset_0_1px_0_rgba(255,255,255,0.10)]",
              shopAccent(index),
              isDestination && "z-30 border-secondary/75 bg-secondary/18 shadow-[0_0_30px_hsl(var(--secondary)/0.45)]"
            )}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: node.name.length > 18 ? "70px" : "58px",
              height: "36px",
            }}
            title={node.name}
          >
            {(isDestination || index < 18) && (
              <div className="absolute inset-0 flex items-center justify-center px-1 text-center text-[8px] font-bold leading-none text-foreground/88">
                {shortName(node.name)}
              </div>
            )}
          </div>
        );
      })}

      <svg className="absolute inset-0 z-20 h-full w-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* full mall graph */}
        {graphLines.map((line) => (
          <line
            key={line.id}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={line.corridor ? "hsl(var(--primary))" : "hsl(var(--border))"}
            strokeOpacity={line.corridor ? 0.62 : 0.32}
            strokeWidth={line.corridor ? 2.4 : 1.05}
            strokeLinecap="round"
          />
        ))}

        {/* active route glow */}
        {routePoints.length > 1 && (
          <polyline
            points={routePolyline}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeOpacity="0.34"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* active route dashed line */}
        {routePoints.length > 1 && (
          <polyline
            points={routePolyline}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeOpacity="0.94"
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1.2 4"
          />
        )}

        {/* completed route */}
        {routePoints.length > 1 && (
          <polyline
            points={completedPolyline}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="5.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 8px hsl(var(--primary)))" }}
          />
        )}
      </svg>

      {/* corridor hubs */}
      {corridors.map((node) => {
        const x = clampPct(node.x_coordinate, 50);
        const y = clampPct(node.y_coordinate, 50);

        return (
          <div
            key={`corridor-${node.id}`}
            className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
            title={node.name}
          >
            <div className="absolute -inset-5 rounded-full bg-primary/18 blur-xl" />
            <div className="relative h-4 w-4 rounded-full border border-primary/60 bg-primary/38 shadow-[0_0_18px_hsl(var(--primary)/0.42)]" />
          </div>
        );
      })}

      {/* entrances */}
      {entrances.map((node) => {
        const x = clampPct(node.x_coordinate, 8);
        const y = clampPct(node.y_coordinate, 78);

        return (
          <div
            key={`entrance-${node.id}`}
            className="absolute z-40 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
            title={node.name}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.55)]">
              <MapPin className="h-3.5 w-3.5" />
            </div>
          </div>
        );
      })}

      {/* destination */}
      {destinationPoint && (
        <div
          className="absolute z-50 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${destinationPoint.x}%`, top: `${destinationPoint.y}%` }}
        >
          <div className="absolute -inset-5 rounded-full bg-secondary/24 blur-lg" />
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-xl border-2 border-background">
            <Flag className="h-4 w-4" />
          </div>
          <div className="absolute left-1/2 top-10 min-w-[112px] -translate-x-1/2 rounded-xl border border-secondary/35 bg-background/92 px-2 py-1 text-center text-[10px] font-bold shadow-lg">
            {destinationPoint.label ?? "Destination"}
          </div>
        </div>
      )}

      {/* current location */}
      {currentPoint && (
        <div
          className="absolute z-[60] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${currentPoint.x}%`, top: `${currentPoint.y}%` }}
        >
          <div className="absolute -inset-8 rounded-full bg-primary/24 blur-xl" />
          <div className="absolute -inset-4 rounded-full border border-primary/60 animate-ping" />
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl border-2 border-background glow-primary">
            <Navigation className="h-4.5 w-4.5" />
          </div>
          <div className="absolute left-1/2 top-11 min-w-[104px] -translate-x-1/2 rounded-xl border border-primary/35 bg-background/92 px-2 py-1 text-center text-[10px] font-bold shadow-lg">
            You are here
          </div>
        </div>
      )}

      <div className="absolute left-3 bottom-3 z-[70] rounded-2xl border border-primary/25 bg-background/86 px-3 py-2 text-[10px] shadow-xl backdrop-blur">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Store className="h-3 w-3 text-primary" />
          2.5D schematic layout · Map Factory
        </div>
      </div>
    </div>
  );
}
