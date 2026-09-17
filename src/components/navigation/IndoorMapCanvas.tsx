/**
 * IndoorMapCanvas.tsx — MallMind indoor map renderer (SVG, no paid SDKs).
 *
 * Renders one floor of a FloorplanModel (floorplanModel.ts): corridors, store blocks, entrances,
 * and the route. The route is drawn in three explicitly different styles so a visitor can tell
 * without colour alone which part is done, which part the current instruction refers to, and what
 * is still to come:
 *
 *   COMPLETED   thin, solid, faded                 (points the visitor has confirmed)
 *   CURRENT LEG wide, glowing, animated flow       (the segment the current instruction describes;
 *                                                   its target waypoint carries the step number)
 *   REMAINING   dashed, medium                     (not yet walked)
 *   START / DESTINATION pins                        (the trusted start and the arrival point)
 *
 * NOTHING here is a live position. The numbered marker is "the point step N takes you to"; the
 * small ring is "the point you last confirmed". There is no pulsing "you are here" dot.
 *
 * Camera: overview mode fits the whole route on the floor; walking mode fits the current leg with
 * some surrounding context. Neither follows the visitor — MallMind does not know where they are.
 */

import { useMemo, type CSSProperties } from "react";
import {
  floorChip, floorKey, pointsForFloor, pointsBounds,
  type FloorplanModel, type FloorplanCoordinate, type RoutePolylinePoint,
} from "./floorplanModel";

export interface IndoorMapCanvasProps {
  floorplan: FloorplanModel;
  activeFloor: string;
  /** Route geometry (all floors) in floor-unit space; index 0 is the start point. */
  routePolyline: RoutePolylinePoint[];
  /**
   * Manual-navigation progress: the polyline index of the point the visitor last CONFIRMED
   * (0 = the start). The current leg runs from that point to the next one. When given, the map is
   * in walking mode; when absent, in overview mode.
   */
  progress?: { confirmedIndex: number } | null;
  /** Legacy inputs (assistant route preview): step indices marked done + the current step index. */
  completedStepIndices?: Set<number>;
  currentStepIndex?: number;
  /** Legacy marker style; "step" is the only style the visitor experience uses. */
  markerStyle?: "position" | "step";
  /** Simulated marker position in floor-unit space (legacy preview only; never live GPS). */
  simulatedPosition?: FloorplanCoordinate | null;
  /** Show a small "demo" tag for illustrative demo geometry (legacy). */
  isDemo?: boolean;
  /** Camera: fit the whole route (overview) or the current leg with context (walking). Derived from `progress` when omitted. */
  mode?: "overview" | "walking";
}

const OVERVIEW_PAD = 150;
const WALK_PAD = 130;
const WALK_MIN_W = 360;
const WALK_MIN_H = 224;
const CAPTION_LIVE = "Map preview · your position is not tracked";
const CAPTION_SCHEMATIC = "Simplified map · not to scale";

function r1(n: number): number { return Math.round(n * 10) / 10; }

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

function DestinationPin({ x, y, label, motion }: { x: number; y: number; label: string | null; motion: boolean }) {
  return (
    <g transform={`translate(${x},${y})`} filter="url(#mmf-pin-glow)" data-testid="map-destination-pin">
      <title>Destination{label ? `: ${label}` : ""}</title>
      <ellipse cx={0} cy={3} rx={16} ry={5} fill="hsl(240 30% 2% / 0.5)" />
      {motion && (
        <circle r={44} fill="none" stroke="hsl(111 100% 54% / 0.2)" strokeWidth="3">
          <animate attributeName="r" values="30;46;30" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.55;0;0.55" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
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
    <g transform={`translate(${x},${y})`} data-testid="map-start-pin">
      <title>Start</title>
      <circle r={17} fill="hsl(190 100% 50% / 0.12)" stroke="hsl(190 100% 62% / 0.75)" strokeWidth="3" />
      <circle r={6} fill="hsl(190 100% 80%)" />
      <text x={0} y={38} textAnchor="middle" fontSize="15" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" letterSpacing="0.14em"
        stroke="hsl(240 30% 3%)" strokeWidth={5} fill="none" strokeLinejoin="round">START</text>
      <text x={0} y={38} textAnchor="middle" fontSize="15" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" letterSpacing="0.14em" fill="hsl(190 100% 74%)">START</text>
    </g>
  );
}

/** Legacy pulsing marker (assistant preview only; never used by the visitor session). */
function PositionMarker({ x, y, animate }: { x: number; y: number; animate: boolean }) {
  return (
    <g transform={`translate(${x},${y})`} filter="url(#mmf-pin-glow)">
      <circle r={28} fill="none" stroke="hsl(190 100% 55% / 0.5)" strokeWidth="3" className={animate ? "animate-ping" : undefined}
        style={{ transformBox: "fill-box", transformOrigin: "center" } as CSSProperties} />
      <circle r={19} fill="hsl(190 100% 50% / 0.2)" stroke="hsl(190 100% 62% / 0.85)" strokeWidth="3" />
      <circle r={9} fill="hsl(190 100% 72%)" stroke="hsl(0 0% 100%)" strokeWidth="2.4" />
    </g>
  );
}

/** The point step N takes the visitor to: a static numbered ring. Deliberately not a "blue dot". */
function StepTargetMarker({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g transform={`translate(${x},${y})`} data-testid="map-step-marker">
      <title>Step {label} takes you here</title>
      <circle r={24} fill="hsl(240 24% 6% / 0.92)" stroke="hsl(190 100% 62%)" strokeWidth="3.5" />
      <text y={7} textAnchor="middle" fontSize="19" fontWeight="800" fontFamily="Inter, system-ui, sans-serif" fill="hsl(190 100% 82%)">{label}</text>
    </g>
  );
}

/** The point the visitor last confirmed (their own tap) — a small hollow ring, no label, no pulse. */
function ConfirmedMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} data-testid="map-confirmed-marker">
      <title>Point you last confirmed</title>
      <circle r={13} fill="hsl(240 24% 6% / 0.9)" stroke="hsl(190 100% 62% / 0.9)" strokeWidth="3" strokeDasharray="5 4" />
      <circle r={4} fill="hsl(190 100% 80%)" />
    </g>
  );
}

/** True when the viewer asked for reduced motion (matchMedia is stubbed in tests). */
function prefersReducedMotion(): boolean {
  try { return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); }
  catch { return false; }
}

export default function IndoorMapCanvas({
  floorplan, activeFloor, routePolyline, progress, completedStepIndices, currentStepIndex, simulatedPosition, isDemo, markerStyle = "step", mode,
}: IndoorMapCanvasProps) {
  const target = floorKey(activeFloor);
  const motion = !prefersReducedMotion();
  const floor = useMemo(
    () => floorplan.floors.find((f) => floorKey(f.id) === target)
      ?? floorplan.floors.find((f) => floorKey(f.label) === target)
      ?? floorplan.floors[0] ?? null,
    [floorplan, target],
  );

  const nodePos = useMemo(() => {
    const m = new Map<string, FloorplanCoordinate>();
    floor?.nodes.forEach((n) => m.set(n.id, n.position));
    return m;
  }, [floor]);

  // ── Leg semantics ──────────────────────────────────────────────────────────
  const walking = mode === "walking" || (mode == null && progress != null);
  const confirmed = progress ? Math.max(0, Math.min(routePolyline.length - 1, progress.confirmedIndex)) : null;
  const legacyDone = completedStepIndices ?? new Set<number>();
  const isDone = (p: RoutePolylinePoint) => (confirmed != null ? p.stepIndex <= confirmed : legacyDone.has(p.stepIndex));
  const floorPts = useMemo(() => pointsForFloor(routePolyline, target), [routePolyline, target]);
  const completedPts = floorPts.filter(isDone);
  const remainingPts = floorPts.filter((p) => !isDone(p));
  // Current leg = last confirmed point → next point (both on this floor).
  const currentLeg = confirmed != null
    ? [routePolyline[confirmed], routePolyline[confirmed + 1]].filter((p): p is RoutePolylinePoint => Boolean(p) && floorKey(p.floor) === target)
    : [];
  const bridge = completedPts.length ? [completedPts[completedPts.length - 1], ...remainingPts] : remainingPts;
  const remainingAfterLeg = confirmed != null ? floorPts.filter((p) => p.stepIndex >= confirmed + 1) : [];

  const firstPt = routePolyline[0];
  const lastPt = routePolyline[routePolyline.length - 1];
  const startOnFloor = firstPt && floorKey(firstPt.floor) === target ? firstPt : null;
  const destOnFloor = lastPt && floorKey(lastPt.floor) === target ? lastPt : null;
  const destName = destOnFloor
    ? (floor?.stores.find((s) => s.shopId === destOnFloor.nodeId)?.name
       ?? floor?.nodes.find((n) => n.id === destOnFloor.nodeId)?.name
       ?? null)
    : null;

  const targetPt = confirmed != null ? routePolyline[confirmed + 1] ?? null : null;
  const targetOnFloor = targetPt && floorKey(targetPt.floor) === target ? targetPt : null;
  const confirmedPt = confirmed != null ? routePolyline[confirmed] ?? null : null;
  const confirmedOnFloor = confirmedPt && floorKey(confirmedPt.floor) === target ? confirmedPt : null;

  // Legacy marker (assistant preview)
  const legacyStepPt = confirmed == null && currentStepIndex != null ? floorPts.find((p) => p.stepIndex === currentStepIndex) ?? null : null;
  const legacyPos = simulatedPosition ?? (legacyStepPt ? { x: legacyStepPt.x, y: legacyStepPt.y } : null);

  const W = floor?.width ?? 1000;
  const H = floor?.height ?? 620;
  const fullVB = `0 0 ${W} ${H}`;

  const cameraVB = useMemo(() => {
    const fit = (pts: { x: number; y: number }[], pad: number, minW: number, minH: number) => {
      const b = pointsBounds(pts);
      if (!b) return fullVB;
      let vbX = b.minX - pad, vbY = b.minY - pad, vbW = b.maxX - b.minX + 2 * pad, vbH = b.maxY - b.minY + 2 * pad;
      // keep a sensible minimum window so a short leg is not magnified into meaninglessness
      if (vbW < minW) { vbX -= (minW - vbW) / 2; vbW = minW; }
      if (vbH < minH) { vbY -= (minH - vbH) / 2; vbH = minH; }
      vbX = Math.max(0, Math.min(vbX, W - vbW)); vbY = Math.max(0, Math.min(vbY, H - vbH));
      vbW = Math.min(W, vbW); vbH = Math.min(H, vbH);
      if (W / vbW < 1.15 && H / vbH < 1.15) return fullVB;
      return `${r1(vbX)} ${r1(vbY)} ${r1(vbW)} ${r1(vbH)}`;
    };
    if (walking && confirmed != null) {
      // current leg + one point of context either side
      const ctx = [routePolyline[confirmed - 1], routePolyline[confirmed], routePolyline[confirmed + 1], routePolyline[confirmed + 2]]
        .filter((p): p is RoutePolylinePoint => Boolean(p) && floorKey(p.floor) === target);
      return fit(ctx.length ? ctx : floorPts, WALK_PAD, WALK_MIN_W, WALK_MIN_H);
    }
    return fit(floorPts, OVERVIEW_PAD, 120, 90);
  }, [walking, confirmed, routePolyline, floorPts, target, W, H, fullVB]);

  if (!floor) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-xs text-muted-foreground">No map for this floor yet.</p>
      </div>
    );
  }

  const hasImage = !!floor.imageUrl;
  const routeD = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  const stepNumber = confirmed != null ? String(confirmed + 1) : "";

  return (
    <svg viewBox={cameraVB} className="h-full w-full" role="img"
      aria-label={hasImage ? "Indoor mall map" : "Simplified map, not to scale"}
      data-map-mode={walking ? "walking" : "overview"}
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
      {floor.nodes.filter((n) => n.type === "entrance" || n.type === "lift" || n.type === "escalator" || n.type === "stairs" || n.type === "vertical").map((n) => {
        const isEntry = n.type === "entrance";
        const txt = isEntry ? "ENTRY" : n.type === "lift" ? "LIFT" : n.type === "escalator" ? "ESC" : n.type === "stairs" ? "STAIRS" : "LEVEL";
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

      {/* Route */}
      {confirmed != null ? (
        <g data-testid="map-route" aria-hidden>
          {/* COMPLETED: thin, solid, faded */}
          {completedPts.length >= 2 && (
            <polyline data-leg="completed" points={routeD(completedPts)} fill="none" stroke="hsl(190 100% 62% / 0.3)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {/* REMAINING: dashed, medium */}
          {remainingAfterLeg.length >= 2 && (
            <polyline data-leg="remaining" points={routeD(remainingAfterLeg)} fill="none" stroke="hsl(190 100% 62% / 0.55)" strokeWidth="6" strokeDasharray="14 12" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {/* CURRENT LEG: wide, glowing, animated flow */}
          {currentLeg.length === 2 && (
            <>
              <polyline data-leg="current" points={routeD(currentLeg)} fill="none" stroke="hsl(190 100% 50% / 0.2)" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" filter="url(#mmf-route-glow)" />
              <polyline points={routeD(currentLeg)} fill="none" stroke="hsl(190 100% 58% / 0.5)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={routeD(currentLeg)} fill="none" stroke="url(#mmf-route)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
              {motion && (
                <polyline points={routeD(currentLeg)} fill="none" stroke="hsl(0 0% 100% / 0.9)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 42">
                  <animate attributeName="stroke-dashoffset" from="0" to="-44" dur="0.9s" repeatCount="indefinite" />
                </polyline>
              )}
            </>
          )}
        </g>
      ) : (
        <g data-testid="map-route" aria-hidden>
          {completedPts.length >= 2 && (
            <polyline data-leg="completed" points={routeD(completedPts)} fill="none" stroke="hsl(190 100% 50% / 0.22)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {bridge.length >= 2 && (
            <>
              <polyline data-leg="remaining" points={routeD(bridge)} fill="none" stroke="hsl(190 100% 50% / 0.18)" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" filter="url(#mmf-route-glow)" />
              <polyline points={routeD(bridge)} fill="none" stroke="hsl(190 100% 58% / 0.5)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={routeD(bridge)} fill="none" stroke="url(#mmf-route)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              {motion && (
                <polyline points={routeD(bridge)} fill="none" stroke="hsl(0 0% 100% / 0.9)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 42">
                  <animate attributeName="stroke-dashoffset" from="0" to="-44" dur="0.9s" repeatCount="indefinite" />
                </polyline>
              )}
            </>
          )}
        </g>
      )}

      {/* Pins */}
      {startOnFloor && <StartPin x={startOnFloor.x} y={startOnFloor.y} />}
      {destOnFloor && <DestinationPin x={destOnFloor.x} y={destOnFloor.y} label={destName} motion={motion} />}
      {confirmed != null && confirmedOnFloor && confirmed > 0 && <ConfirmedMarker x={confirmedOnFloor.x} y={confirmedOnFloor.y} />}
      {confirmed != null && targetOnFloor && targetPt !== lastPt && targetPt?.nodeId !== lastPt?.nodeId && <StepTargetMarker x={targetOnFloor.x} y={targetOnFloor.y} label={stepNumber} />}
      {confirmed == null && legacyPos && (markerStyle === "step"
        ? <StepTargetMarker x={legacyPos.x} y={legacyPos.y} label={String((currentStepIndex ?? 0) + 1)} />
        : <PositionMarker x={legacyPos.x} y={legacyPos.y} animate={motion} />)}

      {/* Honest caption + floor (drawn in full-viewport coords) */}
      <text x={20} y={H - 16} textAnchor="start" fontSize="16" fontFamily="Inter, system-ui, sans-serif" fontWeight="600"
        fill={hasImage ? "hsl(240 10% 44%)" : "hsl(190 30% 46%)"}>
        {hasImage ? CAPTION_LIVE : CAPTION_SCHEMATIC}
      </text>
      <text x={W - 20} y={H - 16} textAnchor="end" fontSize="15" fontFamily="Inter, system-ui, sans-serif" fill="hsl(240 8% 40%)">
        {floorplan.mallName} · {floorChip(floor.label)}{isDemo ? " · demo" : ""}
      </text>
    </svg>
  );
}
