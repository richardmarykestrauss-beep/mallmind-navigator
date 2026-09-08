/**
 * routeNodeCoordinateService.ts — Sprint 12D.2
 *
 * Pure validation utilities for the route-node-coordinate endpoint.
 * No DB access, no HTTP — fully testable in the harness.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CoordinateValidation {
  valid:   boolean;
  error?:  string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const COORD_MIN = 0;
export const COORD_MAX = 100;

// ── Pure validator ────────────────────────────────────────────────────────────

/**
 * Validate route_node_id, x_percent, y_percent from a raw POST body.
 *
 * Rules:
 *   - route_node_id must be a non-empty string
 *   - x_percent and y_percent must be finite numbers in [0, 100]
 *
 * Pure function — no side-effects, no DB reads.
 */
export function validateRouteNodeCoordinate(
  routeNodeId: unknown,
  x:           unknown,
  y:           unknown,
): CoordinateValidation {
  if (
    !routeNodeId ||
    typeof routeNodeId !== "string" ||
    !routeNodeId.trim()
  ) {
    return { valid: false, error: "route_node_id is required" };
  }

  if (typeof x !== "number" || !isFinite(x)) {
    return { valid: false, error: "x_percent must be a finite number" };
  }

  if (typeof y !== "number" || !isFinite(y)) {
    return { valid: false, error: "y_percent must be a finite number" };
  }

  if (x < COORD_MIN || x > COORD_MAX) {
    return {
      valid: false,
      error: `x_percent must be between ${COORD_MIN} and ${COORD_MAX} (got ${x})`,
    };
  }

  if (y < COORD_MIN || y > COORD_MAX) {
    return {
      valid: false,
      error: `y_percent must be between ${COORD_MIN} and ${COORD_MAX} (got ${y})`,
    };
  }

  return { valid: true };
}
