/**
 * routeEdgeService.ts — Sprint 13.1
 *
 * Pure functions for route graph edge generation and shortest-path routing.
 * No DB access — fully testable in the harness.
 *
 * Edge-weight formula (MVP):
 *   distancePct  = sqrt(dx² + dy²)   where dx/dy are x_percent / y_percent differences
 *   weight_secs  = max(5, round(distancePct * WEIGHT_SECONDS_PER_PERCENT))
 *
 * With WEIGHT_SECONDS_PER_PERCENT = 5:
 *   A 10% distance ≈ 50 s (< 1 min) — typical short walk
 *   A 40% distance ≈ 200 s (≈ 3 min) — cross-wing walk
 *   Tune the constant in a future sprint once real metre data is available.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const WEIGHT_SECONDS_PER_PERCENT = 5;
export const MIN_EDGE_WEIGHT_SECONDS     = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

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
  edge_type:      "walkway";
  weight_seconds: number;
  floor_change:   boolean;
  /** Sorted canonical key for duplicate detection: `${smallerId}:${largerId}`. */
  dedup_key:      string;
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
