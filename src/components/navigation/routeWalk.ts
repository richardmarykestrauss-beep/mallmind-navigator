/**
 * routeWalk.ts — pure route-walk simulation helper.
 *
 * Drives the simulated current-position marker on the Navigate screen. Given the
 * ordered coordinates of the active route (the existing mall_node x/y/floor values),
 * the elapsed simulation time and a per-segment duration, it returns where the
 * marker should be. It performs NO live positioning — it is a deterministic,
 * time-based interpolation along a fixed set of route nodes.
 *
 * Pure and side-effect free so it can be unit-tested in isolation.
 */

export interface RouteWalkNode {
  x: number;
  y: number;
  floor: string | null;
}

export interface RouteWalkState {
  /** Index of the segment currently being traversed (node i → node i+1). */
  segmentIndex: number;
  /** Interpolation fraction within the current segment, clamped to [0, 1]. */
  t: number;
  /** Floor the marker is currently shown on. */
  floor: string | null;
  /** Interpolated marker position in the route's coordinate space. */
  point: { x: number; y: number };
  /** True once the marker has reached (or passed) the final node. */
  done: boolean;
}

/**
 * Compute the simulated marker state for a route at a given elapsed time.
 *
 * @param nodes  Ordered route nodes with x, y and floor.
 * @param elapsedMs  Time elapsed since the walk started (clamped to >= 0).
 * @param segmentDurationMs  Time the marker spends traversing each segment.
 */
export function computeRouteWalk(
  nodes: RouteWalkNode[],
  elapsedMs: number,
  segmentDurationMs: number,
): RouteWalkState {
  // Empty route — nothing to walk.
  if (nodes.length === 0) {
    return { segmentIndex: 0, t: 0, floor: null, point: { x: 0, y: 0 }, done: true };
  }

  const last = nodes[nodes.length - 1];
  const segmentCount = nodes.length - 1;
  const atFinal: RouteWalkState = {
    segmentIndex: Math.max(0, segmentCount - 1),
    t: segmentCount === 0 ? 0 : 1,
    floor: last.floor,
    point: { x: last.x, y: last.y },
    done: true,
  };

  // Single node, invalid duration, negative time, or past the route end all resolve
  // to "sitting at the final node".
  if (segmentCount === 0 || !(segmentDurationMs > 0)) return atFinal;
  const progress = Math.max(0, elapsedMs) / segmentDurationMs; // progress in segments
  if (progress >= segmentCount) return atFinal;

  const segmentIndex = Math.floor(progress);
  const t = progress - segmentIndex;
  const from = nodes[segmentIndex];
  const to = nodes[segmentIndex + 1];

  // A floor change cannot be interpolated in 2D — snap to the source floor (and its
  // coordinate) for the first half of the segment, then to the destination floor.
  if ((from.floor ?? null) !== (to.floor ?? null)) {
    const end = t >= 0.5;
    return {
      segmentIndex,
      t,
      floor: end ? to.floor : from.floor,
      point: end ? { x: to.x, y: to.y } : { x: from.x, y: from.y },
      done: false,
    };
  }

  // Same-floor segment — linear interpolation between the two coordinates.
  return {
    segmentIndex,
    t,
    floor: from.floor,
    point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    done: false,
  };
}
