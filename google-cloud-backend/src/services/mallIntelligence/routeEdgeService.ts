/**
 * routeEdgeService.ts — Sprint 13.1 / 13.2
 *
 * Pure functions for route graph edge generation and shortest-path routing.
 * No DB access — fully testable in the harness.
 *
 * Same-floor edge weight (MVP):
 *   distancePct  = sqrt(dx² + dy²)   where dx/dy are x_percent / y_percent differences
 *   weight_secs  = max(5, round(distancePct * WEIGHT_SECONDS_PER_PERCENT))
 *
 * With WEIGHT_SECONDS_PER_PERCENT = 5:
 *   A 10% distance ≈ 50 s (< 1 min) — typical short walk
 *   A 40% distance ≈ 200 s (≈ 3 min) — cross-wing walk
 *
 * Vertical (floor-change) edge weights — Sprint 13.2:
 *   lift:      45 s  (fastest — doors + travel)
 *   escalator: 60 s  (moving stairs, slower transfer)
 *   stairs:    75 s  (slowest — full flight climb)
 *
 * Tune constants in a future sprint once real timing data is available.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const WEIGHT_SECONDS_PER_PERCENT = 5;
export const MIN_EDGE_WEIGHT_SECONDS    = 5;

/** Fixed walk-time (seconds) for a single floor transition by connector type. */
export const VERTICAL_EDGE_WEIGHTS: Readonly<Record<FloorChangeNodeType, number>> = {
  lift:      45,
  escalator: 60,
  stairs:    75,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type FloorChangeNodeType = "lift" | "escalator" | "stairs";
export type EdgeType = "walkway" | FloorChangeNodeType;

export interface PlacedRouteNode {
  id:          string;
  label:       string;
  floor_label: string | null;
  x_percent:   number;
  y_percent:   number;
  node_type:   string;
}

export interface EdgeCandidate {
  from_node_id:   string;
  to_node_id:     string;
  edge_type:      EdgeType;
  weight_seconds: number;
  floor_change:   boolean;
  /** Sorted canonical key for duplicate detection: `${smallerId}:${largerId}`. */
  dedup_key:      string;
}

// ── Floor-change node validation ──────────────────────────────────────────────

export interface FloorChangeNodeInput {
  mall_id:     unknown;
  label:       unknown;
  node_type:   unknown;
  floor_label: unknown;
  x_percent:   unknown;
  y_percent:   unknown;
}

export interface FloorChangeNodeValidation {
  valid:  boolean;
  error?: string;
}

export const FLOOR_CHANGE_NODE_TYPES: readonly FloorChangeNodeType[] = [
  "lift", "escalator", "stairs",
];

/**
 * Pure validation for a floor-change node creation request.
 * Returns { valid: true } or { valid: false, error: "…" }.
 */
export function validateFloorChangeNode(
  input: FloorChangeNodeInput,
): FloorChangeNodeValidation {
  if (!input.mall_id || typeof input.mall_id !== "string" || !input.mall_id.trim()) {
    return { valid: false, error: "mall_id is required" };
  }
  if (!input.label || typeof input.label !== "string" || !input.label.trim()) {
    return { valid: false, error: "label is required" };
  }
  if (
    !input.node_type ||
    typeof input.node_type !== "string" ||
    !(FLOOR_CHANGE_NODE_TYPES as readonly string[]).includes(input.node_type)
  ) {
    return { valid: false, error: `node_type must be one of: ${FLOOR_CHANGE_NODE_TYPES.join(", ")}` };
  }
  if (!input.floor_label || typeof input.floor_label !== "string" || !input.floor_label.trim()) {
    return { valid: false, error: "floor_label is required" };
  }
  if (typeof input.x_percent !== "number" || input.x_percent < 0 || input.x_percent > 100) {
    return { valid: false, error: "x_percent must be a number between 0 and 100" };
  }
  if (typeof input.y_percent !== "number" || input.y_percent < 0 || input.y_percent > 100) {
    return { valid: false, error: "y_percent must be a number between 0 and 100" };
  }
  return { valid: true };
}

export interface GenerateEdgesResult {
  edges:    EdgeCandidate[];
  warnings: string[];
}

export interface RoutePreviewStep {
  node_id:            string;
  label:              string;
  floor_label:        string | null;
  x_percent:          number;
  y_percent:          number;
  cumulative_seconds: number;
}

export interface DijkstraResult {
  path:          RoutePreviewStep[] | null;
  total_seconds: number;
  warning?:      string;
}

// ── Edge generation ───────────────────────────────────────────────────────────

/**
 * Generate walkway edge candidates for every same-floor pair of placed nodes.
 *
 * Rules:
 *   - Both nodes must have x_percent and y_percent (placed).
 *   - Both nodes must share the same non-null floor_label.
 *   - Cross-floor pairs are NOT connected; a warning is emitted instead.
 *   - Each pair produces exactly one edge (canonical id ordering prevents
 *     duplicate dedup_keys when the caller checks against the DB).
 */
export function generateSameFloorEdges(
  nodes: PlacedRouteNode[],
  weightSecondsPerPct = WEIGHT_SECONDS_PER_PERCENT,
): GenerateEdgesResult {
  const warnings: string[] = [];
  const edges: EdgeCandidate[] = [];

  // Separate nodes by floor
  const byFloor = new Map<string, PlacedRouteNode[]>();
  const noFloor: PlacedRouteNode[] = [];

  for (const n of nodes) {
    if (!n.floor_label?.trim()) {
      noFloor.push(n);
    } else {
      const key = n.floor_label.trim();
      if (!byFloor.has(key)) byFloor.set(key, []);
      byFloor.get(key)!.push(n);
    }
  }

  if (noFloor.length > 0) {
    warnings.push(
      `${noFloor.length} node(s) skipped — no floor_label: ` +
      noFloor.map((n) => `"${n.label}"`).join(", "),
    );
  }

  // Warn when multiple floors are present and no floor-change nodes exist
  const floorNames = [...byFloor.keys()];
  if (floorNames.length > 1) {
    const hasFloorChange = nodes.some(
      (n) =>
        n.node_type === "lift" ||
        n.node_type === "escalator" ||
        n.node_type === "stairs",
    );
    if (!hasFloorChange) {
      warnings.push(
        "Cross-floor routing requires lift/escalator/stair nodes. " +
        `Floors present: ${floorNames.join(", ")}. ` +
        "Same-floor edges only were created.",
      );
    }
  }

  // Generate pairwise edges within each floor
  for (const floorNodes of byFloor.values()) {
    for (let i = 0; i < floorNodes.length; i++) {
      for (let j = i + 1; j < floorNodes.length; j++) {
        const a = floorNodes[i];
        const b = floorNodes[j];

        const dx   = a.x_percent - b.x_percent;
        const dy   = a.y_percent - b.y_percent;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const weight = Math.max(
          MIN_EDGE_WEIGHT_SECONDS,
          Math.round(dist * weightSecondsPerPct),
        );

        // Canonical ordering so A→B and B→A share the same key
        const [fromId, toId] =
          a.id < b.id ? [a.id, b.id] : [b.id, a.id];

        edges.push({
          from_node_id:   fromId,
          to_node_id:     toId,
          edge_type:      "walkway",
          weight_seconds: weight,
          floor_change:   false,
          dedup_key:      `${fromId}:${toId}`,
        });
      }
    }
  }

  return { edges, warnings };
}

// ── Vertical edge generation — Sprint 13.2 ───────────────────────────────────

/**
 * Generate vertical (floor-change) edges between floor-change nodes that share
 * the same label AND node_type but sit on different floors.
 *
 * Grouping key: `${node_type}::${label.trim().toLowerCase()}`
 *
 * Rules:
 *   - Only nodes with node_type "lift" | "escalator" | "stairs" are considered.
 *   - Two nodes in the same group on DIFFERENT floors get one vertical edge.
 *   - Same-floor pairs in the same group are skipped (same-floor walkway already connects them).
 *   - Canonical dedup_key prevents duplicates.
 *   - Weight comes from VERTICAL_EDGE_WEIGHTS[node_type].
 */
export function generateVerticalEdges(
  nodes: PlacedRouteNode[],
): GenerateEdgesResult {
  const warnings: string[] = [];
  const edges: EdgeCandidate[] = [];

  const fcNodes = nodes.filter(
    (n) =>
      n.node_type === "lift" ||
      n.node_type === "escalator" ||
      n.node_type === "stairs",
  );

  if (fcNodes.length === 0) return { edges, warnings };

  // Group by connector identity
  const groups = new Map<string, PlacedRouteNode[]>();
  for (const n of fcNodes) {
    const key = `${n.node_type}::${n.label.trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  for (const [, group] of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        // Skip pairs on the same floor — they are already connected by walkway edges
        if (a.floor_label === b.floor_label) continue;

        const nodeType = a.node_type as FloorChangeNodeType;
        const weight   = VERTICAL_EDGE_WEIGHTS[nodeType] ?? 60;

        const [fromId, toId] =
          a.id < b.id ? [a.id, b.id] : [b.id, a.id];

        edges.push({
          from_node_id:   fromId,
          to_node_id:     toId,
          edge_type:      nodeType,
          weight_seconds: weight,
          floor_change:   true,
          dedup_key:      `${fromId}:${toId}`,
        });
      }
    }
  }

  return { edges, warnings };
}

// ── Dijkstra shortest path ────────────────────────────────────────────────────

/**
 * Find the shortest path between two placed route nodes.
 *
 * Edges are treated as UNDIRECTED (walkway edges are bidirectional).
 * Returns null path with a descriptive warning when no path exists.
 */
export function dijkstra(
  nodes: PlacedRouteNode[],
  edges: Array<{ from_node_id: string; to_node_id: string; weight_seconds: number }>,
  fromId: string,
  toId:   string,
): DijkstraResult {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  if (!nodeMap.has(fromId)) {
    return { path: null, total_seconds: 0, warning: `Start node "${fromId}" not found.` };
  }
  if (!nodeMap.has(toId)) {
    return { path: null, total_seconds: 0, warning: `End node "${toId}" not found.` };
  }
  if (fromId === toId) {
    const n = nodeMap.get(fromId)!;
    return {
      path: [{
        node_id:            n.id,
        label:              n.label,
        floor_label:        n.floor_label,
        x_percent:          n.x_percent,
        y_percent:          n.y_percent,
        cumulative_seconds: 0,
      }],
      total_seconds: 0,
    };
  }

  // Build undirected adjacency list
  const adj = new Map<string, Array<{ neighbor: string; weight: number }>>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.from_node_id)?.push({ neighbor: e.to_node_id, weight: e.weight_seconds });
    adj.get(e.to_node_id)?.push({ neighbor: e.from_node_id, weight: e.weight_seconds });
  }

  // Dijkstra (array-based priority — fine for ≤100 nodes)
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const unvisited = new Set<string>(nodes.map((n) => n.id));

  for (const n of nodes) { dist.set(n.id, Infinity); prev.set(n.id, null); }
  dist.set(fromId, 0);

  while (unvisited.size > 0) {
    // Pick the unvisited node with the smallest tentative distance
    let u: string | null = null;
    let minD = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < minD) { minD = d; u = id; }
    }
    if (u === null || minD === Infinity) break; // no reachable unvisited nodes

    unvisited.delete(u);
    if (u === toId) break; // found shortest path to target

    for (const { neighbor, weight } of adj.get(u) ?? []) {
      if (!unvisited.has(neighbor)) continue;
      const alt = (dist.get(u) ?? Infinity) + weight;
      if (alt < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, alt);
        prev.set(neighbor, u);
      }
    }
  }

  if ((dist.get(toId) ?? Infinity) === Infinity) {
    const fromNode = nodeMap.get(fromId)!;
    const toNode   = nodeMap.get(toId)!;
    const crossFloor = fromNode.floor_label !== toNode.floor_label;
    let warning = `No path from "${fromNode.label}" to "${toNode.label}".`;
    if (crossFloor) {
      warning +=
        " Cross-floor routing requires lift/escalator/stair nodes. " +
        `("${fromNode.label}" is on ${fromNode.floor_label ?? "unknown floor"}, ` +
        `"${toNode.label}" is on ${toNode.floor_label ?? "unknown floor"}).`;
    }
    return { path: null, total_seconds: 0, warning };
  }

  // Reconstruct path by walking prev[] backwards
  const pathIds: string[] = [];
  let cur: string | null = toId;
  while (cur !== null) {
    pathIds.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  const path: RoutePreviewStep[] = pathIds.map((id) => {
    const n = nodeMap.get(id)!;
    return {
      node_id:            n.id,
      label:              n.label,
      floor_label:        n.floor_label,
      x_percent:          n.x_percent,
      y_percent:          n.y_percent,
      cumulative_seconds: dist.get(id) ?? 0,
    };
  });

  return { path, total_seconds: dist.get(toId) ?? 0 };
}
