/**
 * Deterministic evidence-lifecycle state machine.
 *
 * DISCOVERED → CAPTURED → EXTRACTED → NORMALIZED → VALIDATED → CONFLICT_CHECKED
 * → REVIEWED → APPROVED → PUBLISHED → STALE / WITHDRAWN.
 *
 * Any state may fall to `failed`. `published` may later become `stale` or
 * `withdrawn`. Illegal transitions are rejected — nothing skips review on the way
 * to `approved`/`published`.
 */

import type { AdapterLifecycleState } from "./types";

/** The canonical forward order (excluding terminal/branch states). */
export const LIFECYCLE_ORDER: AdapterLifecycleState[] = [
  "discovered", "captured", "extracted", "normalized", "validated",
  "conflict_checked", "reviewed", "approved", "published",
];

const TRANSITIONS: Record<AdapterLifecycleState, AdapterLifecycleState[]> = {
  discovered: ["captured", "failed", "withdrawn"],
  captured: ["extracted", "failed", "withdrawn"],
  extracted: ["normalized", "failed", "withdrawn"],
  normalized: ["validated", "failed", "withdrawn"],
  validated: ["conflict_checked", "failed", "withdrawn"],
  conflict_checked: ["reviewed", "failed", "withdrawn"],
  reviewed: ["approved", "withdrawn", "failed"],
  approved: ["published", "withdrawn", "failed"],
  published: ["stale", "withdrawn"],
  stale: ["withdrawn"],
  withdrawn: [],
  failed: [],
};

/** True when `to` is a legal successor of `from`. */
export function canTransition(from: AdapterLifecycleState, to: AdapterLifecycleState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Legal next states from `from`. */
export function nextStates(from: AdapterLifecycleState): AdapterLifecycleState[] {
  return TRANSITIONS[from] ?? [];
}

export class LifecycleTransitionError extends Error {
  constructor(public from: AdapterLifecycleState, public to: AdapterLifecycleState) {
    super(`Illegal lifecycle transition: ${from} → ${to}`);
    this.name = "LifecycleTransitionError";
  }
}

/** Returns `to` if legal, otherwise throws. Use to guard state changes. */
export function transition(from: AdapterLifecycleState, to: AdapterLifecycleState): AdapterLifecycleState {
  if (!canTransition(from, to)) throw new LifecycleTransitionError(from, to);
  return to;
}

/** A state is terminal when nothing can follow it. */
export function isTerminal(state: AdapterLifecycleState): boolean {
  return (TRANSITIONS[state]?.length ?? 0) === 0;
}
