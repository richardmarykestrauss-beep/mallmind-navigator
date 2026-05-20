/**
 * Mall Route Graph Staging Service — Sprint 12C
 *
 * Converts accepted staged store locations into route graph node candidates.
 * Does not write to DB — returns structures for the caller to persist.
 *
 * Future sprints will add:
 *   - Spatial edge-weight estimation from x_percent/y_percent positions
 *   - Floor-change edge generation (lifts, escalators, stairs)
 *   - Entrance node seeding from mall layout templates
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RouteNodeType =
  | "shop"
  | "entrance"
  | "lift"
  | "escalator"
  | "toilet"
  | "parking"
  | "food_court"
  | "info_desk";

export interface RouteNodeCandidate {
  staged_location_id?: string;
  node_type:           RouteNodeType;
  label:               string;
  floor_label?:        string;
  x_percent?:          number;
  y_percent?:          number;
}

export interface RouteEdgeCandidate {
  from_label:     string;
  to_label:       string;
  edge_type:      "walkway" | "escalator" | "lift" | "stairs";
  weight_seconds: number;
  floor_change:   boolean;
}

export interface StageRouteGraphResult {
  mall_id:          string;
  node_candidates:  RouteNodeCandidate[];
  edge_candidates:  RouteEdgeCandidate[];
  warnings:         string[];
  note:             string;
}

// ── Node type inference ───────────────────────────────────────────────────────

function inferNodeType(category: string | undefined): RouteNodeType {
  const cat = (category ?? "").toLowerCase();
  if (/food|restaurant|cafe|eat|dining|fast.?food/.test(cat)) return "food_court";
  return "shop";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build route node candidates from a list of accepted staged store locations.
 * Caller fetches and passes the store data; this service is stateless.
 */
export function buildRouteNodeCandidates(
  locations: Array<{
    id:           string;
    shop_name?:   string;
    floor_label?: string;
    x_percent?:   number | null;
    y_percent?:   number | null;
    category?:    string;
  }>,
  mallId: string,
): StageRouteGraphResult {
  const warnings:  string[] = [];
  const nodes:     RouteNodeCandidate[] = [];

  for (const loc of locations) {
    if (!loc.shop_name?.trim()) {
      warnings.push(`Location ${loc.id} has no shop_name — skipped`);
      continue;
    }

    nodes.push({
      staged_location_id: loc.id,
      node_type:          inferNodeType(loc.category),
      label:              loc.shop_name.trim(),
      floor_label:        loc.floor_label ?? undefined,
      x_percent:          loc.x_percent   ?? undefined,
      y_percent:          loc.y_percent   ?? undefined,
    });
  }

  if (nodes.length === 0) {
    warnings.push("No valid locations to convert to route nodes");
  }

  // Sprint 12C: edges are not auto-generated yet —
  // will be added in a future sprint once x_percent/y_percent data is populated.
  const edges: RouteEdgeCandidate[] = [];

  return {
    mall_id:         mallId,
    node_candidates: nodes,
    edge_candidates: edges,
    warnings,
    note: "Route graph nodes are staged only — require admin review before use in navigation",
  };
}
