/**
 * IndoorMapCanvas.tsx — MallMind indoor map engine renderer.
 *
 * Renders a single floor of a FloorplanModel (see floorplanModel.ts) as a
 * premium, self-contained SVG indoor map — real floor dimensions, walkable
 * corridors, store/unit blocks, a glowing animated route line, START /
 * DESTINATION pins and a pulsing simulated-position marker that travels along
 * the route polyline geometry. No paid SDKs, no Google Maps.
 *
 * When a floor has an imageUrl it is drawn as the base layer; otherwise the
 * geometry is rendered as an honest generated schematic ("Schematic floorplan
 * generated from MallMind route graph"). Everything stays truthful: this is a
 * simulated route preview, not live GPS.
 */

import { useMemo, type CSSProperties } from "react";
import {
  floorChip, normalizeFloorLabel, pointsForFloor, pointsBounds,
  type FloorplanModel, type FloorplanCoordinate, type RoutePolylinePoint,
} from "./floorplanModel";

export interface IndoorMapCanvasProps {
  floorplan: FloorplanModel;
  activeFloor: string;
  /** Route geometry (all floors) in floor-unit space. */
  routePolyline: RoutePolylinePoint[];
  completedStepIndices: Set<number>;
  currentStepIndex: number;
  /** Simulated marker position in floor-unit space (not live GPS). */
  simulatedPosition?: FloorplanCoordinate | null;
  /** Show the "demo" tag when this is illustrative demo geometry. */
  isDemo?: boolean;
}

const CAMERA_PAD = 150;
const HONEST_LIVE = "Route preview · not live GPS";
const HONEST_SCHEMATIC = "Schematic floorplan generated from MallMind route graph";

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function shortLabel(name: string, max = 14): string {
  const clean = name.trim();
  if (clean.length <= max) return clean;
  const words = clean.split(/\s+/);
  if (words[0].length >= 4) return words[0];
  return `${words[0]} ${words[1] ?? ""}`.trim().slice(0, max);
}

// ── SVG defs (blueprint grid + gradients + glow filters) ────────────────────
function MapDefs() {
  return (
    <defs>
      <pattern id="mmf-grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M40 0H0V40" fill="none" stroke="hsl(190 100% 55% / 0.055)" strokeWidth="1.2" />
      </pattern>
      <radialGradient id="mmf-vignette" cx="50%" cy="42%" r="78%">
        <stop offset="52%" stopColor="hsl(240 24% 6% / 0)" />
        <stop offset="100%" stopColor="hsl(240 32% 2% / 0.9)" />
      </radialGradient>
      <linearGradient id="mmf-stage" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="hsl(240 22% 6.5%)" />
        <stop offset="100%" stopColor="hsl(240 24% 3.5%)" />
      </linearGradient>
      <linearGradient id="mmf-route" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="hsl(190 100% 62%)" />
        <stop offset="100%" stopColor="hsl(165 100% 60%)" />
      </linearGradient>
      <radialGradient id="mmf-corridor" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="hsl(240 16% 15%)" />
        <stop offset="100%" stopColor="hsl(240 16% 10%)" />
      </radialGradient>
      <filter id="mmf-route-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="12" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="mmf-pin-glow" x="-90%" y="-90%" width="280%" height="280%">
        <feGaussianBlur stdDeviation="9" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

function DestinationPin({ x, y, label }: { x: number; y: number; label: string | null }) {
  return (
    <g transform={`translate(${x},${y})`} filter="url(#mmf-pin-glow)">
      <ellipse cx={0} cy={3} rx={16} ry={5} fill="hsl(240 30% 2% / 0.5)" />
      <circle r={44} fill="none" stroke="hsl(111 100% 54% / 0.2)" strokeWidth="3">
        <animate attributeName="r" values="30;46;30" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.55;0;0.55" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <path d="M0 0 C -19 -34 -19 -52 0 -60 C 19 -52 19 -34 0 0 Z" fill="hsl(111 100% 46%)" stroke="hsl(111 100% 74%)" strokeWidth="3" />
      <circle cx={0} cy={-40} r={9} fill="hsl(240 30% 6%)" />
      {label && (
        <>
          <text x={0} y={-72} textAnchor="middle" fontSize="21" fontFamily="Inter, system-ui, sans-serif" fontWeight="800"
            stroke="hsl(240 30% 3%)" strokeWidth={7} fill="none" strokeLinejoin="round">{shortLabel(label)}</text>
          <text x={0} y={-72} textAnchor="middle" fontSize="21" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fill="hsl(111 100% 75%)">{shortLabel(label)}</text>
        </>
      )}
    </g>
  );
}

function StartPin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r={17} fill="hsl(190 100% 50% / 0.12)" stroke="hsl(190 100% 62% / 0.75)" strokeWidth="3" />
      <circle r={6} fill="hsl(190 100% 80%)" />
      <text x={0} y={38} textAnchor="middle" fontSize="15" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" letterSpacing="0.14em"
        stroke="hsl(240 30% 3%)" strokeWidth={5} fill="none" strokeLinejoin="round">START</text>
      <text x={0} y={38} textAnchor="middle" fontSize="15" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" letterSpacing="0.14em" fill="hsl(190 100% 74%)">START</text>
    </g>
  );
}

function PositionMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} filter="url(#mmf-pin-glow)">
      <circle r={28} fill="none" stroke="hsl(190 100% 55% / 0.5)" strokeWidth="3" className="animate-ping"
        style={{ transformBox: "fill-box", transformOrigin: "center" } as CSSProperties} />
      <circle r={19} fill="hsl(190 100% 50% / 0.2)" stroke="hsl(190 100% 62% / 0.85)" strokeWidth="3">
        <animate attributeName="r" values="16;22;16" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle r={9} fill="hsl(190 100% 72%)" stroke="hsl(0 0% 100%)" strokeWidth="2.4" />
    </g>
  );
}

export default function IndoorMapCanvas({
  floorplan, activeFloor, routePolyline, completedStepIndices, currentStepIndex, simulatedPosition, isDemo,
}: IndoorMapCanvasProps) {
  const target = normalizeFloorLabel(activeFloor);
  const floor = useMemo(
    () => floorplan.floors.find((f) => normalizeFloorLabel(f.label) === target) ?? floorplan.floors[0] ?? null,
    [floorplan, target],
  );

  const nodePos = useMemo(() => {
    const m = new Map<string, FloorplanCoordinate>();
    floor?.nodes.forEach((n) => m.set(n.id, n.position));
    return m;
  }, [floor]);

  const floorPts = useMemo(() => pointsForFloor(routePolyline, target), [routePolyline, target]);
  const completedPts = floorPts.filter((p) => completedStepIndices.has(p.stepIndex));
  const remainingPts = floorPts.filter((p) => !completedStepIndices.has(p.stepIndex));
  const bridge = completedPts.length ? [completedPts[completedPts.length - 1], ...remainingPts] : remainingPts;

  const firstPt = routePolyline[0];
  const lastPt = routePolyline[routePolyline.length - 1];
  const startOnFloor = firstPt && normalizeFloorLabel(firstPt.floor) === target ? firstPt : null;
  const destOnFloor = lastPt && normalizeFloorLabel(lastPt.floor) === target ? lastPt : null;
  const destName = destOnFloor
    ? (floor?.stores.find((s) => s.shopId === destOnFloor.nodeId)?.name
       ?? floor?.nodes.find((n) => n.id === destOnFloor.nodeId)?.name
       ?? null)
    : null;

  const stepPt = floorPts.find((p) => p.stepIndex === currentStepIndex) ?? null;
  const currentPos = simulatedPosition ?? (stepPt ? { x: stepPt.x, y: stepPt.y } : null);

  const W = floor?.width ?? 1000;
  const H = floor?.height ?? 620;
  const fullVB = `0 0 ${W} ${H}`;

  const cameraVB = useMemo(() => {
    const b = pointsBounds(floorPts);
    if (!b) return fullVB;
    const vbX = Math.max(0, b.minX - CAMERA_PAD);
    const vbY = Math.max(0, b.minY - CAMERA_PAD);
    const vbW = Math.min(W, b.maxX + CAMERA_PAD) - vbX;
    const vbH = Math.min(H, b.maxY + CAMERA_PAD) - vbY;
    if (vbW < 120 || vbH < 90) return fullVB;
    if (W / vbW < 1.25 && H / vbH < 1.25) return fullVB;
    return `${r1(vbX)} ${r1(vbY)} ${r1(vbW)} ${r1(vbH)}`;
  }, [floorPts, W, H, fullVB]);

  if (!floor) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-xs text-muted-foreground">No floor data for {activeFloor}.</p>
      </div>
    );
  }

  const hasImage = !!floor.imageUrl;
  const routeD = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={cameraVB} className="h-full w-full"
      aria-label={hasImage ? "Indoor mall map" : "Schematic floorplan generated from MallMind route graph"}
      style={{ display: "block" }}>
      <MapDefs />

      {/* Stage + base layer */}
      <rect x={0} y={0} width={W} height={H} fill="url(#mmf-stage)" />
      {hasImage ? (
        <image href={floor.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid meet" opacity={0.95} />
      ) : (
        <rect x={0} y={0} width={W} height={H} fill="url(#mmf-grid)" />
      )}

      {/* Walkable corridors from graph edges */}
      {!hasImage && floor.edges.map((e, i) => {
        const a = nodePos.get(e.from); const b = nodePos.get(e.to);
        if (!a || !b) return null;
        return <line key={`c${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="url(#mmf-corridor)" strokeWidth="34" strokeLinecap="round" />;
      })}
      {!hasImage && floor.edges.map((e, i) => {
        const a = nodePos.get(e.from); const b = nodePos.get(e.to);
        if (!a || !b) return null;
        return <line key={`cl${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="hsl(190 100% 55% / 0.12)" strokeWidth="1.4" strokeDasharray="10 12" />;
      })}

      {/* Store / unit blocks */}
      {floor.stores.map((s) => {
        const bx = s.bounds?.x ?? s.position.x - 60;
        const by = s.bounds?.y ?? s.position.y - 34;
        const bw = s.bounds?.width ?? 120;
        const bh = s.bounds?.height ?? 68;
        const isDest = destOnFloor?.nodeId === s.shopId;
        return (
          <g key={s.shopId}>
            <rect x={bx} y={by} width={bw} height={bh} rx={12}
              fill={isDest ? "hsl(111 100% 46% / 0.12)" : "hsl(240 16% 12%)"}
              stroke={isDest ? "hsl(111 100% 54% / 0.6)" : "hsl(200 40% 42% / 0.4)"} strokeWidth="2" />
            <rect x={bx + 7} y={by + 5} width={bw - 14} height={3} rx={1.5} fill="hsl(200 55% 58% / 0.2)" />
            <text x={bx + bw / 2} y={by + bh / 2 + 2} textAnchor="middle" fontSize="19"
              fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fill={isDest ? "hsl(111 100% 80%)" : "hsl(210 22% 70%)"}>
              {shortLabel(s.name, 12)}
            </text>
            {s.unitCode && (
              <text x={bx + bw / 2} y={by + bh - 9} textAnchor="middle" fontSize="12"
                fontFamily="Inter, system-ui, sans-serif" fill="hsl(210 12% 46%)">{s.unitCode}</text>
            )}
          </g>
        );
      })}

      {/* Entrances / vertical transitions */}
      {floor.nodes.filter((n) => n.type === "entrance" || n.type === "lift" || n.type === "escalator" || n.type === "stairs").map((n) => {
        const isEntry = n.type === "entrance";
        const txt = isEntry ? "ENTRY" : n.type === "lift" ? "LIFT" : n.type === "escalator" ? "ESC" : "STAIRS";
        return (
          <g key={n.id} transform={`translate(${n.position.x},${n.position.y})`}>
            <rect x={-52} y={-24} width={104} height={48} rx={14}
              fill={isEntry ? "hsl(190 100% 50% / 0.12)" : "hsl(270 60% 55% / 0.14)"}
              stroke={isEntry ? "hsl(190 100% 50% / 0.42)" : "hsl(270 70% 62% / 0.45)"} strokeWidth="2.4" />
            <text x={0} y={7} textAnchor="middle" fontSize="16" fontFamily="Inter, system-ui, sans-serif" fontWeight="700"
              letterSpacing="0.08em" fill={isEntry ? "hsl(190 100% 70%)" : "hsl(270 90% 82%)"}>{txt}</text>
          </g>
        );
      })}

      {/* Route: completed (dim), active glow, animated flow */}
      {completedPts.length >= 2 && (
        <polyline points={routeD(completedPts)} fill="none" stroke="hsl(190 100% 50% / 0.22)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {bridge.length >= 2 && (
        <>
          <polyline points={routeD(bridge)} fill="none" stroke="hsl(190 100% 50% / 0.18)" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" filter="url(#mmf-route-glow)" />
          <polyline points={routeD(bridge)} fill="none" stroke="hsl(190 100% 58% / 0.5)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={routeD(bridge)} fill="none" stroke="url(#mmf-route)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={routeD(bridge)} fill="none" stroke="hsl(0 0% 100% / 0.9)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 42">
            <animate attributeName="stroke-dashoffset" from="0" to="-44" dur="0.9s" repeatCount="indefinite" />
          </polyline>
        </>
      )}

      {/* Pins + marker on top */}
      {startOnFloor && <StartPin x={startOnFloor.x} y={startOnFloor.y} />}
      {destOnFloor && <DestinationPin x={destOnFloor.x} y={destOnFloor.y} label={destName} />}
      {currentPos && <PositionMarker x={currentPos.x} y={currentPos.y} />}

      {/* Honest caption + floor + demo tag (drawn in full-viewport coords) */}
      <text x={20} y={H - 16} textAnchor="start" fontSize="16" fontFamily="Inter, system-ui, sans-serif" fontWeight="600"
        fill={hasImage ? "hsl(240 10% 44%)" : "hsl(190 30% 46%)"}>
        {hasImage ? HONEST_LIVE : HONEST_SCHEMATIC}
      </text>
      <text x={W - 20} y={H - 16} textAnchor="end" fontSize="15" fontFamily="Inter, system-ui, sans-serif" fill="hsl(240 8% 40%)">
        {floorplan.mallName} · {floorChip(floor.label)}{isDemo ? " · demo" : ""}
      </text>
    </svg>
  );
}
