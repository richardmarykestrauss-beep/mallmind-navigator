/**
 * mapFactoryRouteGraphBuilderService.ts — Sprint 15.3 (rewrite)
 *
 * Builds the route graph from merged layout model anchors.
 *
 * Fixes from Sprint 15:
 *  - Correct mall_nodes column names: name/type/floor/x_coordinate/y_coordinate
 *  - Correct edge table: mall_edges (not mall_node_edges)
 *  - Edge generation now works on ALL floor nodes (not just newly inserted ones)
 *  - Uses mapFactoryNodeTypeMapper for canonical types
 *  - Corridor hub topology: corridor nodes are connection hubs
 *  - Fallback corridor spine when no corridor nodes exist
 *  - Edge deduplication via in-memory Set
 *  - Extended result: nodeTypeCounts, skippedEdges, floorsProcessed
 */

import { canonicalNodeType } from "./mapFactoryNodeTypeMapper.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphBuildResult {
  ok:              boolean;
  nodesCreated:    number;
  nodesSkipped:    number;
  edgesCreated:    number;
  skippedEdges:    number;
  nodeTypeCounts:  Record<string, number>;
  floorsProcessed: string[];
  validationIssues: string[];
  error?:          string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/** Normalised edge key (smaller id first) for dedup. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

type DbNode = { id: string; name: string; type: string; x: number; y: number };

// ── Insert one edge (with dedup) ──────────────────────────────────────────────

async function insertEdge(
  mallId:          string,
  a:               DbNode,
  b:               DbNode,
  instruction:     string,
  existingKeys:    Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:        any,
): Promise<"created" | "skipped" | "error"> {
  const key = edgeKey(a.id, b.id);
  if (existingKeys.has(key)) return "skipped";

  const { error } = await supabase.from("mall_edges").insert({
    mall_id:         mallId,
    from_node_id:    a.id,
    to_node_id:      b.id,
    distance_meters: Math.max(1, Math.round(dist(a.x, a.y, b.x, b.y) * 5)),
    floor_change:    false,
    instruction,
  });

  if (error) return "error";
  existingKeys.add(key);
  return "created";
}

// ── Nearest hub finder ────────────────────────────────────────────────────────

function nearestHub(node: DbNode, hubs: DbNode[]): DbNode | null {
  if (hubs.length === 0) return null;
  return hubs
    .map((h) => ({ ...h, d: dist(node.x, node.y, h.x, h.y) }))
    .sort((a, b) => a.d - b.d)[0];
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function buildRouteGraph(
  jobId:       string,
  mallId:      string,
  floorLabel:  string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any,
): Promise<GraphBuildResult> {
  const validationIssues: string[] = [];
  const nodeTypeCounts:   Record<string, number> = {};
  const floorsProcessed:  string[] = [];
  let nodesCreated = 0, nodesSkipped = 0, edgesCreated = 0, skippedEdges = 0;

  try {
    // ── 1. Load layout models ─────────────────────────────────────────────────
    let modelQ = supabase
      .from("map_factory_layout_models")
      .select("merged_anchors, floor_label")
      .eq("job_id", jobId)
      .eq("status", "complete");
    if (floorLabel) modelQ = modelQ.eq("floor_label", floorLabel);

    const { data: models, error: modelErr } = await modelQ;
    if (modelErr) throw new Error(modelErr.message);

    // ── 2. Pre-load existing edges for dedup ──────────────────────────────────
    const { data: existingEdges } = await supabase
      .from("mall_edges")
      .select("from_node_id, to_node_id")
      .eq("mall_id", mallId);

    const edgeSet = new Set<string>(
      (existingEdges ?? []).map(
        (e: { from_node_id: string; to_node_id: string }) =>
          edgeKey(e.from_node_id, e.to_node_id),
      ),
    );

    // ── Per-floor processing ──────────────────────────────────────────────────
    for (const model of (models ?? [])) {
      const floor = model.floor_label ?? "unknown";
      if (!floorsProcessed.includes(floor)) floorsProcessed.push(floor);

      const rawAnchors: Array<{
        label:       string;
        anchor_type: string;
        x_percent:   number | null;
        y_percent:   number | null;
      }> = Array.isArray(model.merged_anchors) ? model.merged_anchors : [];

      // ── 3. Load existing nodes for this floor (dedup) ─────────────────────
      const { data: existingFloorNodes } = await supabase
        .from("mall_nodes")
        .select("id, name, type, floor, x_coordinate, y_coordinate")
        .eq("mall_id", mallId)
        .eq("floor", floor);

      const existingNodeKeys = new Set<string>(
        (existingFloorNodes ?? []).map(
          (n: { floor: string; name: string }) => `${n.floor}||${n.name}`,
        ),
      );

      // ── 4. Insert missing nodes ───────────────────────────────────────────
      for (const anchor of rawAnchors) {
        if (anchor.x_percent == null || anchor.y_percent == null) continue;

        const nodeKey = `${floor}||${anchor.label}`;
        if (existingNodeKeys.has(nodeKey)) {
          nodesSkipped++;
          continue;
        }

        const ntype = canonicalNodeType(anchor.anchor_type, anchor.label);

        const { data: inserted, error: insertErr } = await supabase
          .from("mall_nodes")
          .insert({
            mall_id:      mallId,
            name:         anchor.label,      // correct column name
            type:         ntype,             // correct column name
            floor:        floor,             // correct column name
            x_coordinate: anchor.x_percent,  // correct column name
            y_coordinate: anchor.y_percent,  // correct column name
          })
          .select("id")
          .single();

        if (insertErr) {
          validationIssues.push(`Insert failed for "${anchor.label}": ${insertErr.message}`);
          continue;
        }

        nodesCreated++;
        existingNodeKeys.add(nodeKey);
        nodeTypeCounts[ntype] = (nodeTypeCounts[ntype] ?? 0) + 1;
      }

      // ── 5. Load ALL floor nodes (existing + newly inserted) for edges ──────
      const { data: allFloorRows } = await supabase
        .from("mall_nodes")
        .select("id, name, type, x_coordinate, y_coordinate")
        .eq("mall_id", mallId)
        .eq("floor", floor);

      const floorNodes: DbNode[] = (allFloorRows ?? []).map(
        (n: { id: string; name: string; type: string; x_coordinate: number | null; y_coordinate: number | null }) => ({
          id:   n.id,
          name: n.name,
          type: n.type,
          x:    n.x_coordinate ?? 50,
          y:    n.y_coordinate ?? 50,
        }),
      );

      if (floorNodes.length < 2) continue;

      // ── 6. Corridor hub topology ───────────────────────────────────────────
      const corridorNodes = floorNodes.filter((n) => n.type === "corridor");
      const nonCorridorNodes = floorNodes.filter((n) => n.type !== "corridor");

      let hubNodes: DbNode[];

      if (corridorNodes.length > 0) {
        // Use real corridor nodes as hubs
        hubNodes = corridorNodes;

        // Connect corridor hubs to each other (nearest 2)
        for (const hub of corridorNodes) {
          const nearest = corridorNodes
            .filter((n) => n.id !== hub.id)
            .map((n) => ({ ...n, d: dist(hub.x, hub.y, n.x, n.y) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 2);

          for (const nb of nearest) {
            const res = await insertEdge(mallId, hub, nb, `Corridor — ${floor}`, edgeSet, supabase);
            if (res === "created") edgesCreated++;
            else if (res === "skipped") skippedEdges++;
          }
        }
      } else {
        // ── Fallback: synthetic corridor spine ────────────────────────────────
        const spineCount = Math.min(5, Math.max(3, Math.ceil(floorNodes.length / 4)));
        const step = 100 / (spineCount + 1);
        hubNodes = [];

        for (let i = 1; i <= spineCount; i++) {
          const sx = Math.round(step * i);
          const sy = 50;
          const spineName = `${floor} Spine Node ${i}`;

          // Skip if a node with this name already exists on this floor
          if (existingNodeKeys.has(`${floor}||${spineName}`)) continue;

          const { data: spineRow, error: spineErr } = await supabase
            .from("mall_nodes")
            .insert({
              mall_id:      mallId,
              name:         spineName,
              type:         "corridor",
              floor:        floor,
              x_coordinate: sx,
              y_coordinate: sy,
            })
            .select("id")
            .single();

          if (spineErr) {
            validationIssues.push(`Spine node insert failed: ${spineErr.message}`);
            continue;
          }

          nodesCreated++;
          nodeTypeCounts["corridor"] = (nodeTypeCounts["corridor"] ?? 0) + 1;
          existingNodeKeys.add(`${floor}||${spineName}`);
          hubNodes.push({ id: spineRow.id, name: spineName, type: "corridor", x: sx, y: sy });
        }

        // Connect spine nodes linearly
        for (let i = 0; i < hubNodes.length - 1; i++) {
          const res = await insertEdge(
            mallId, hubNodes[i], hubNodes[i + 1],
            `Walk along ${floor} corridor`, edgeSet, supabase,
          );
          if (res === "created") edgesCreated++;
          else if (res === "skipped") skippedEdges++;
        }
      }

      // ── 7. Connect every non-corridor node to its nearest hub ─────────────
      for (const node of nonCorridorNodes) {
        const nearest = nearestHub(node, hubNodes);
        if (!nearest) continue;

        const instruction =
          node.type === "entrance" ? `Walk from entrance to corridor`
          : node.type === "parking" ? `Walk from parking to corridor`
          : node.type === "shop"    ? `Walk to ${node.name}`
          : `Walk to corridor`;

        const res = await insertEdge(mallId, node, nearest, instruction, edgeSet, supabase);
        if (res === "created") edgesCreated++;
        else if (res === "skipped") skippedEdges++;
      }
    }

    // ── 8. Validation ─────────────────────────────────────────────────────────
    if (nodesCreated === 0 && nodesSkipped === 0) {
      validationIssues.push("No anchors found in layout models — run extraction and layout build first.");
    }

    // Use correct column name "type" (not "node_type")
    const { data: allNodes } = await supabase
      .from("mall_nodes")
      .select("id, type")
      .eq("mall_id", mallId);

    const hasEntrance = (allNodes ?? []).some((n: { type: string }) => n.type === "entrance");
    if (!hasEntrance) {
      validationIssues.push("No entrance node found — shoppers cannot start navigation.");
    }

    const hasShop = (allNodes ?? []).some((n: { type: string }) => n.type === "shop");
    if (!hasShop) {
      validationIssues.push("No shop nodes found — route builder has no destinations.");
    }

    return {
      ok: true,
      nodesCreated, nodesSkipped, edgesCreated, skippedEdges,
      nodeTypeCounts, floorsProcessed, validationIssues,
    };

  } catch (err) {
    return {
      ok: false,
      nodesCreated: 0, nodesSkipped: 0, edgesCreated: 0, skippedEdges: 0,
      nodeTypeCounts: {}, floorsProcessed, validationIssues,
      error: String(err),
    };
  }
}
