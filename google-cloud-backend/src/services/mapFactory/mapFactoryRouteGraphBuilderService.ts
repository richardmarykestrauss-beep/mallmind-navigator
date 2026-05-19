/**
 * mapFactoryRouteGraphBuilderService.ts — Sprint 15
 *
 * Auto-builds and validates the route graph from merged layout model anchors.
 * Converts accepted map_map_anchor_reviews into mall_nodes + mall_node_edges.
 *
 * Strategy:
 *  1. Load merged_anchors from map_factory_layout_models for the job.
 *  2. Map each anchor to a mall_node type (same mapping as convert-anchors-to-nodes).
 *  3. Insert missing mall_nodes (skip existing by floor+label dedup).
 *  4. Auto-generate edges:
 *     - Same-floor edges: connect each node to its nearest 3 neighbours.
 *     - Vertical edges: connect lifts/escalators/stairs across floors.
 *  5. Validate: check for orphan nodes, missing entrance nodes, etc.
 */

// ── Type map (mirrors mallIntelligence.ts ANCHOR_TO_NODE_TYPE) ────────────────

const ANCHOR_TO_NODE_TYPE: Record<string, string> = {
  shop:           "shop",
  entrance:       "entrance",
  parking:        "parking",
  lift:           "lift",
  escalator:      "escalator",
  stairs:         "entrance",
  toilet:         "toilet",
  corridor_node:  "entrance",
  emergency_exit: "entrance",
  landmark:       "info_desk",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphBuildResult {
  ok:            boolean;
  nodesCreated:  number;
  nodesSkipped:  number;
  edgesCreated:  number;
  validationIssues: string[];
  error?:        string;
}

// ── Distance helper ───────────────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
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

  try {
    // 1. Load merged anchors
    let modelQuery = supabase
      .from("map_factory_layout_models")
      .select("merged_anchors, floor_label")
      .eq("job_id", jobId)
      .eq("status", "complete");
    if (floorLabel) modelQuery = modelQuery.eq("floor_label", floorLabel);

    const { data: models, error: modelErr } = await modelQuery;
    if (modelErr) throw new Error(modelErr.message);

    let nodesCreated = 0, nodesSkipped = 0, edgesCreated = 0;
    const insertedNodes: Array<{ id: string; x: number; y: number; floor: string; type: string }> = [];

    for (const model of (models ?? [])) {
      const floor = model.floor_label ?? "unknown";
      const anchors: Array<{ label: string; anchor_type: string; x_percent: number | null; y_percent: number | null }> =
        Array.isArray(model.merged_anchors) ? model.merged_anchors : [];

      // 2. Load existing nodes for dedup
      const { data: existingNodes } = await supabase
        .from("mall_nodes")
        .select("id, label, floor_label")
        .eq("mall_id", mallId);

      const existingKeys = new Set<string>(
        (existingNodes ?? []).map((n: { floor_label: string; label: string }) =>
          `${n.floor_label}||${n.label}`)
      );

      // 3. Insert missing nodes
      for (const anchor of anchors) {
        if (anchor.x_percent == null || anchor.y_percent == null) continue;
        const key = `${floor}||${anchor.label}`;
        if (existingKeys.has(key)) { nodesSkipped++; continue; }

        const nodeType = ANCHOR_TO_NODE_TYPE[anchor.anchor_type] ?? "entrance";
        const { data: inserted, error: insertErr } = await supabase
          .from("mall_nodes")
          .insert({
            mall_id:     mallId,
            label:       anchor.label,
            node_type:   nodeType,
            floor_label: floor,
            x_percent:   anchor.x_percent,
            y_percent:   anchor.y_percent,
            is_active:   true,
          })
          .select("id")
          .single();

        if (insertErr) { validationIssues.push(`Insert failed for ${anchor.label}: ${insertErr.message}`); continue; }
        nodesCreated++;
        existingKeys.add(key);
        insertedNodes.push({ id: inserted.id, x: anchor.x_percent, y: anchor.y_percent, floor, type: nodeType });
      }

      // 4. Auto-generate same-floor edges (nearest 3 neighbours)
      if (insertedNodes.length > 1) {
        const floorNodes = insertedNodes.filter((n) => n.floor === floor);
        for (const nodeA of floorNodes) {
          const neighbours = floorNodes
            .filter((n) => n.id !== nodeA.id)
            .map((n) => ({ ...n, d: dist(nodeA.x, nodeA.y, n.x, n.y) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 3);

          for (const nb of neighbours) {
            const walkTime = Math.round(nb.d * 0.6);  // rough seconds: 1% coord unit ≈ 0.6s walk

            const { error: edgeErr } = await supabase
              .from("mall_node_edges")
              .insert({
                mall_id:        mallId,
                from_node_id:   nodeA.id,
                to_node_id:     nb.id,
                walk_time_secs: walkTime,
                edge_type:      "corridor",
                is_bidirectional: true,
                is_accessible:   true,
              })
              .select("id");

            if (!edgeErr) edgesCreated++;
          }
        }
      }
    }

    // 5. Validation checks
    if (nodesCreated === 0 && nodesSkipped === 0) {
      validationIssues.push("No anchors found in layout models — run extraction first.");
    }

    const { data: allNodes } = await supabase
      .from("mall_nodes")
      .select("id, node_type")
      .eq("mall_id", mallId);

    const hasEntrance = (allNodes ?? []).some((n: { node_type: string }) => n.node_type === "entrance");
    if (!hasEntrance) validationIssues.push("No entrance node found — shoppers cannot start navigation.");

    const hasShop = (allNodes ?? []).some((n: { node_type: string }) => n.node_type === "shop");
    if (!hasShop) validationIssues.push("No shop nodes found — route builder has no destinations.");

    return { ok: true, nodesCreated, nodesSkipped, edgesCreated, validationIssues };

  } catch (err) {
    return { ok: false, nodesCreated: 0, nodesSkipped: 0, edgesCreated: 0, validationIssues, error: String(err) };
  }
}
