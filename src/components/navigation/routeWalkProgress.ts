/**
 * routeWalkProgress.ts — pure helper that keeps route progress in sync with the
 * simulated walk-through marker on the Navigate screen.
 *
 * The simulation (see routeWalk.ts) moves a marker along the route over time.
 * This module answers the two questions the UI needs to stay coherent while the
 * marker moves automatically:
 *
 *   1. How many route nodes has the marker reached? (reachedNodeCount)
 *   2. Given the steps already completed, which are complete now? (mergeReachedSteps)
 *
 * Everything here is pure and side-effect free so it can be unit-tested in
 * isolation and reused by the component without duplicating the rules.
 */

import type { RouteWalkState } from "./routeWalk";

/**
 * Number of route nodes the simulated marker has reached for a given walk state.
 *
 * The marker starts AT node 0, so reaching node k corresponds to completing
 * step k:
 *   - while traversing segment i (node i → node i+1) it has reached nodes 0..i,
 *     i.e. `segmentIndex + 1` nodes;
 *   - once the walk is `done` it has reached every node.
 *
 * The result is monotonic in walk progress and increases by exactly one per
 * crossed node, so it maps each node crossing to a single completed step (never
 * skipping and never double-counting). Returns 0 for an empty route.
 */
export function reachedNodeCount(walk: RouteWalkState, nodeCount: number): number {
  if (nodeCount <= 0) return 0;
  if (walk.done) return nodeCount;
  return Math.min(nodeCount, walk.segmentIndex + 1);
}

/**
 * Merge the nodes reached by the simulation into the set of completed step
 * indices.
 *
 * Purely additive — a set union of `prev` with { 0 .. reachedCount-1 }. It never
 * removes an index, so progress cannot move backwards, manual "Done" presses are
 * preserved, and re-applying the same (or a smaller) reached count is a no-op, so
 * no node is ever counted twice. Returns the SAME set reference when nothing
 * changed, letting React skip a needless state update / re-render.
 */
export function mergeReachedSteps(prev: Set<number>, reachedCount: number): Set<number> {
  let next: Set<number> | null = null;

  for (let i = 0; i < reachedCount; i++) {
    if (!prev.has(i)) {
      if (!next) next = new Set(prev);
      next.add(i);
    }
  }

  return next ?? prev;
}

/**
 * Completed step indices after accounting for the simulated marker.
 *
 * When the simulation is not engaged (never started, or reset to the route
 * start) the completed set is returned untouched, so manual progress and reset
 * are respected and the marker cannot silently mark steps on its own. When it is
 * engaged, the reached nodes are merged in additively via {@link mergeReachedSteps}.
 */
export function walkCompletedSteps(
  prev: Set<number>,
  reachedCount: number,
  engaged: boolean,
): Set<number> {
  if (!engaged) return prev;
  return mergeReachedSteps(prev, reachedCount);
}
