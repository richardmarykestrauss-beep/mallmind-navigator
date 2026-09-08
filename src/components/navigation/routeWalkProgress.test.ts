import { describe, it, expect } from "vitest";
import { computeRouteWalk, type RouteWalkNode } from "./routeWalk";
import {
  reachedNodeCount,
  mergeReachedSteps,
  walkCompletedSteps,
} from "./routeWalkProgress";

const DUR = 1000;

// Four same-floor nodes → three segments. Reaching node k completes step k.
const nodes: RouteWalkNode[] = [
  { x: 0, y: 0, floor: "G" },
  { x: 10, y: 0, floor: "G" },
  { x: 10, y: 10, floor: "G" },
  { x: 20, y: 10, floor: "G" },
];

/** Sorted array view of a completed-step set, for stable assertions. */
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

/** Model the component's per-tick sync: elapsed → walk → merged completed set. */
function sync(prev: Set<number>, elapsedMs: number, engaged = true): Set<number> {
  const walk = computeRouteWalk(nodes, elapsedMs, DUR);
  return walkCompletedSteps(prev, reachedNodeCount(walk, nodes.length), engaged);
}

describe("reachedNodeCount", () => {
  it("counts the marker as having reached node 0 at the very start", () => {
    expect(reachedNodeCount(computeRouteWalk(nodes, 0, DUR), nodes.length)).toBe(1);
  });

  it("advances one node per crossed segment", () => {
    expect(reachedNodeCount(computeRouteWalk(nodes, DUR * 0.5, DUR), nodes.length)).toBe(1);
    expect(reachedNodeCount(computeRouteWalk(nodes, DUR * 1.0, DUR), nodes.length)).toBe(2);
    expect(reachedNodeCount(computeRouteWalk(nodes, DUR * 2.0, DUR), nodes.length)).toBe(3);
  });

  it("reaches every node once the walk is done", () => {
    expect(reachedNodeCount(computeRouteWalk(nodes, DUR * 99, DUR), nodes.length)).toBe(4);
  });

  it("returns 0 for an empty route", () => {
    expect(reachedNodeCount(computeRouteWalk([], 0, DUR), 0)).toBe(0);
  });
});

describe("mergeReachedSteps", () => {
  it("is additive and returns the same reference when nothing changes", () => {
    const prev = new Set([0, 1]);
    expect(mergeReachedSteps(prev, 2)).toBe(prev); // no new nodes → identity
    expect(mergeReachedSteps(prev, 0)).toBe(prev); // never removes
  });

  it("never counts a node twice", () => {
    const once = mergeReachedSteps(new Set<number>(), 3);
    const twice = mergeReachedSteps(once, 3);
    expect(sorted(twice)).toEqual([0, 1, 2]);
    expect(twice.size).toBe(3);
  });
});

describe("walkCompletedSteps — simulation synchronisation", () => {
  it("automatically progresses the checklist as the marker crosses nodes", () => {
    let completed = new Set<number>();

    completed = sync(completed, 0); // at node 0
    expect(sorted(completed)).toEqual([0]);

    completed = sync(completed, DUR); // reached node 1
    expect(sorted(completed)).toEqual([0, 1]);

    completed = sync(completed, DUR * 2); // reached node 2
    expect(sorted(completed)).toEqual([0, 1, 2]);
  });

  it("does not duplicate completion when ticking within the same segment", () => {
    let completed = new Set<number>();
    completed = sync(completed, DUR * 1.1);
    const afterFirst = completed;
    completed = sync(completed, DUR * 1.4); // still on segment 1
    expect(completed).toBe(afterFirst); // identical reference — no state churn
    expect(completed.size).toBe(2);
  });

  it("preserves state across pause and continues on resume", () => {
    let completed = sync(new Set<number>(), DUR * 1.5); // walked into segment 1
    expect(sorted(completed)).toEqual([0, 1]);

    // Pause = elapsed frozen, still engaged. Re-syncing must not change anything.
    const paused = sync(completed, DUR * 1.5);
    expect(paused).toBe(completed);

    // Resume = elapsed advances again.
    completed = sync(completed, DUR * 2.5);
    expect(sorted(completed)).toEqual([0, 1, 2]);
  });

  it("leaves progress at the route start after a reset (disengaged)", () => {
    // After reset the component clears the set and disengages the simulation.
    const reset = sync(new Set<number>(), 0, /* engaged */ false);
    expect(reset.size).toBe(0); // marker back at start, nothing auto-completed
  });

  it("reaches 100% completion when the marker finishes the route", () => {
    const completed = sync(new Set<number>(), DUR * 99);
    expect(sorted(completed)).toEqual([0, 1, 2, 3]);
    expect(completed.size).toBe(nodes.length); // full progress
  });

  it("stays coherent when manual Done runs ahead of the simulation", () => {
    // Marker only just reached node 1, but the user manually completes step 2.
    let completed = sync(new Set<number>(), DUR); // [0, 1]
    completed = mergeReachedSteps(completed, 3); // manual Done on step 2 → [0, 1, 2]
    expect(sorted(completed)).toEqual([0, 1, 2]);

    // The simulation catches up without moving backwards or double-completing.
    completed = sync(completed, DUR * 2); // marker now at node 2
    expect(sorted(completed)).toEqual([0, 1, 2]);

    completed = sync(completed, DUR * 99); // marker finishes
    expect(sorted(completed)).toEqual([0, 1, 2, 3]);
  });
});
