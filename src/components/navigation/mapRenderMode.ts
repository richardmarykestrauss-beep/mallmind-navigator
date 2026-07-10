/**
 * mapRenderMode.ts — pure helpers for the IndoorMapCanvas render decision.
 *
 * Keeps the "which map do we draw?" rule and the schematic-fallback geometry in
 * one deterministically-testable place, so the premium canvas and its tests
 * agree on behaviour:
 *
 *   - "full"      → a backend map model exists (nodes/edges/floorplan graph).
 *   - "schematic" → NO map model, but a route exists → draw a premium schematic
 *                   route preview generated from the route graph (honest fallback,
 *                   never a broken-looking empty box).
 *   - "empty"     → no model and no route.
 */

export type MapRenderMode = "empty" | "schematic" | "full";

export interface MapRenderInput {
  /** True when a backend indoor map model (with node graph) is available. */
  hasMapModel: boolean;
  /** Number of steps in the active route. */
  routeStepCount: number;
}

/** Decide which of the three canvas renderers to use. */
export function selectMapRenderMode({ hasMapModel, routeStepCount }: MapRenderInput): MapRenderMode {
  if (hasMapModel) return "full";
  if (routeStepCount > 0) return "schematic";
  return "empty";
}

export interface SchematicPoint {
  x: number;
  y: number;
}

export interface SchematicLayout {
  width: number;
  height: number;
  marginX: number;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Lay out a route with no floor-plan coordinates as an evenly-spaced path with a
 * gentle serpentine curve, so the schematic preview reads like a real walked
 * route rather than a flat line. Deterministic (no randomness).
 */
export function buildSchematicRoute(stepCount: number, layout: SchematicLayout): SchematicPoint[] {
  const n = Math.max(0, Math.floor(stepCount));
  if (n === 0) return [];
  const spacing = (layout.width - 2 * layout.marginX) / Math.max(n - 1, 1);
  const midY = layout.height / 2;
  const amplitude = Math.min(layout.height * 0.16, 22);
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    return {
      x: round(layout.marginX + i * spacing),
      y: round(midY + (n > 1 ? Math.sin(t * Math.PI * 1.5) * amplitude : 0)),
    };
  });
}
