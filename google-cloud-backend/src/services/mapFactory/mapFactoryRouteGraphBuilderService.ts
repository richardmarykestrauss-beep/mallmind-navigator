/**
 * mapFactoryRouteGraphBuilderService.ts — Sprint 15.5
 *
 * Builds the route graph from merged layout model anchors.
 *
 * Sprint 15.5 additions over v15.4:
 *  - isStaleFloor(): detects dev-artifact floors (null / G / L1 / L2 / "unknown")
 *  - isRepairable(): protects geodirectory/admin/manual nodes from auto-repair
 *  - Loads ALL mall nodes up front → three-way dedup:
 *      exactByKey     — correct floor, update type/coords if changed
 *      staleByName    — stale floor + repairable → repair floor + type + coords
 *      protectedByName — stale floor + protected source → skip, no duplicate
 *  - source = 'map_factory' stamped on all created/repaired nodes
 *  - Response uses snake_case field names; adds updated_nodes, repaired_floor_nodes,
 *    floor_counts (per-floor node tally for this run)
 *  - repairNodeFloors() exported for the /repair-node-floors REST endpoint
 */

import { canonicalNodeType } from "./mapFactoryNodeTypeMapper.js";
import { resolveFloorLabel } from "./mapFactoryFloorLabelService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphBuildResult {
  ok:                   boolean;
  created_nodes:        number;
  updated_nodes:        number;
  skipped_nodes:        number;
  repaired_floor_nodes: number;
  created_edges:        number;
  skipped_edges:        number;
  node_type_counts:     Record<string, number>;
  floor_counts:         Record<string, number>;
  floors_processed:     string[];
  validation_issues:    string[];
  error?:               string;
}

export interface RepairFloorsResult {
  ok:              boolean;
  repaired:        number;
  skipped:         number;
  protected_nodes: number;
  error?:          string;
}

type ExistingNode = {
  id:           string;
  name:         string;
  type:         string;
  floor:        string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  source:       string | null;
};

type DbNode = { id: string; name: string; type: string; x: number; y: number };

// ── Floor / repairability helpers ─────────────────────────────────────────────

/**
 * Returns true for floor values that are clearly dev artifacts and safe to
 * replace with an explicit floor label:
 *   null / undefined / "" / "unknown" / short codes (G, L1, L2, B1, …)
 *
 * Well-formed labels like "Level 5", "Ground Floor", "Lower Level" are NOT stale.
 */
export function isStaleFloor(floor: string | null | undefined): boolean {
  if (floor == null) return true;
  const t = floor.trim();
  if (!t || t.toLowerCase() === "unknown") return true;
  // Single letter G (ground)
  if (/^[Gg]$/.test(t)) return true;
  // Short codes: L1–L9, B1–B9, UG, LG, etc.
  if (/^[A-Za-z]{1,2}\d+$/.test(t)) return true;
  return false;
}

/**
 * Returns true if a node's source allows Map Factory to auto-repair it.
 * Protected sources: 'geodirectory', 'admin', 'manual'
 * Safe sources: 'map_factory', null (legacy / unknown origin)
 */
export function isRepairable(node: { source?: string | null }): boolean {
  const s = (node.source ?? "").toLowerCase();
  return s !== "geodirectory" && s !== "admin" && s !== "manual";
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

async function insertEdge(
  mallId:       string,
  a:            DbNode,
  b:            DbNode,
  instruction:  string,
  existingKeys: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:     any,
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

function nearestHub(node: DbNode, hubs: DbNode[]): DbNode | null {
  if (hubs.length === 0) return null;
  return hubs
    .map((h) => ({ ...h, d: dist(node.x, node.y, h.x, h.y) }))
    .sort((a, b) => a.d - b.d)[0];
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function buildRouteGraph(
  jobId:      string,
  mallId:     string,
  floorLabel: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:   any,
): Promise<GraphBuildResult> {
  const validation_issues: string[]            = [];
  const node_type_counts:  Record<string, number> = {};
  const floor_counts:      Record<string, number> = {};
  const floors_processed:  string[]            = [];
  let created_nodes = 0, updated_nodes = 0, skipped_nodes = 0, repaired_floor_nodes = 0;
  let created_edges = 0, skipped_edges = 0;

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

    // ── 3. Load ALL existing nodes for this mall ──────────────────────────────
    // Three-way classification:
    //   exactByKey     — non-stale floor; key = "${floor}||${nameLower}"
    //   staleByName    — stale floor + repairable (safe to repair)
    //   protectedByName — stale floor + NOT repairable (skip, no duplicate)
    const { data: allMallNodes } = await supabase
      .from("mall_nodes")
      .select("id, name, type, floor, x_coordinate, y_coordinate, source")
      .eq("mall_id", mallId);

    const exactByKey     = new Map<string, ExistingNode>();
    const staleByName    = new Map<string, ExistingNode>();
    const protectedByName = new Map<string, ExistingNode>();

    for (const n of (allMallNodes ?? []) as ExistingNode[]) {
      const nameLower = n.name.toLowerCase().trim();
      if (!isStaleFloor(n.floor)) {
        // Well-formed floor: register as exact match
        exactByKey.set(`${n.floor}||${nameLower}`, n);
      } else if (isRepairable(n)) {
        // Stale floor, safe to repair (keep only the first found per name)
        if (!staleByName.has(nameLower)) staleByName.set(nameLower, n);
      } else {
        // Stale floor, protected source — note it so we don't create a duplicate
        if (!protectedByName.has(nameLower)) protectedByName.set(nameLower, n);
      }
    }

    // ── Per-model processing ──────────────────────────────────────────────────
    for (const model of (models ?? [])) {
      // Sprint 15.4: use resolveFloorLabel so nodes inherit the job floor_label
      // when the layout model lacks its own (prevents NULL floor on output).
      const floor = resolveFloorLabel(model.floor_label, floorLabel);
      if (!floors_processed.includes(floor)) floors_processed.push(floor);

      const rawAnchors: Array<{
        label:       string;
        anchor_type: string;
        x_percent:   number | null;
        y_percent:   number | null;
      }> = Array.isArray(model.merged_anchors) ? model.merged_anchors : [];

      // ── 4. Insert / repair / update / skip per anchor ─────────────────────
      for (const anchor of rawAnchors) {
        if (anchor.x_percent == null || anchor.y_percent == null) continue;

        const ntype     = canonicalNodeType(anchor.anchor_type, anchor.label);
        const nameLower = anchor.label.toLowerCase().trim();
        const exactKey  = `${floor}||${nameLower}`;

        if (exactByKey.has(exactKey)) {
          // ── Exact floor match ───────────────────────────────────────────────
          const existing     = exactByKey.get(exactKey)!;
          const typeChanged  = existing.type !== ntype;
          const coordChanged =
            Math.abs((existing.x_coordinate ?? 0) - anchor.x_percent) > 0.5 ||
            Math.abs((existing.y_coordinate ?? 0) - anchor.y_percent) > 0.5;

          if ((typeChanged || coordChanged) && isRepairable(existing)) {
            await supabase.from("mall_nodes")
              .update({ type: ntype, x_coordinate: anchor.x_percent, y_coordinate: anchor.y_percent })
              .eq("id", existing.id);
            updated_nodes++;
            node_type_counts[ntype] = (node_type_counts[ntype] ?? 0) + 1;
          } else {
            skipped_nodes++;
          }
          floor_counts[floor] = (floor_counts[floor] ?? 0) + 1;

        } else if (staleByName.has(nameLower)) {
          // ── Stale floor match: repair floor + type + coords ─────────────────
          const existing = staleByName.get(nameLower)!;
          const { error: repairErr } = await supabase.from("mall_nodes")
            .update({
              floor:        floor,
              type:         ntype,
              x_coordinate: anchor.x_percent,
              y_coordinate: anchor.y_percent,
              source:       "map_factory",
            })
            .eq("id", existing.id);

          if (!repairErr) {
            repaired_floor_nodes++;
            node_type_counts[ntype] = (node_type_counts[ntype] ?? 0) + 1;
            floor_counts[floor]     = (floor_counts[floor] ?? 0) + 1;
            // Promote to exactByKey; remove from stale so future anchors don't re-match
            exactByKey.set(exactKey, {
              ...existing, floor, type: ntype,
              x_coordinate: anchor.x_percent, y_coordinate: anchor.y_percent,
              source: "map_factory",
            });
            staleByName.delete(nameLower);
          } else {
            validation_issues.push(`Repair failed for "${anchor.label}": ${repairErr.message}`);
            skipped_nodes++;
          }

        } else if (protectedByName.has(nameLower)) {
          // ── Protected node: skip to avoid creating a duplicate ──────────────
          skipped_nodes++;
          floor_counts[floor] = (floor_counts[floor] ?? 0) + 1;

        } else {
          // ── No match: insert new node ───────────────────────────────────────
          const { data: inserted, error: insertErr } = await supabase
            .from("mall_nodes")
            .insert({
              mall_id:      mallId,
              name:         anchor.label,
              type:         ntype,
              floor:        floor,
              x_coordinate: anchor.x_percent,
              y_coordinate: anchor.y_percent,
              source:       "map_factory",
            })
            .select("id")
            .single();

          if (insertErr) {
            validation_issues.push(`Insert failed for "${anchor.label}": ${insertErr.message}`);
            continue;
          }

          created_nodes++;
          node_type_counts[ntype] = (node_type_counts[ntype] ?? 0) + 1;
          floor_counts[floor]     = (floor_counts[floor] ?? 0) + 1;
          exactByKey.set(exactKey, {
            id: inserted.id, name: anchor.label, type: ntype, floor,
            x_coordinate: anchor.x_percent, y_coordinate: anchor.y_percent,
            source: "map_factory",
          });
        }
      }

      // ── 5. Load ALL floor nodes for edge building (post-repair) ──────────────
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

      // ── 6. Corridor hub topology ──────────────────────────────────────────────
      const corridorNodes    = floorNodes.filter((n) => n.type === "corridor");
      const nonCorridorNodes = floorNodes.filter((n) => n.type !== "corridor");
      let hubNodes: DbNode[];

      if (corridorNodes.length > 0) {
        // Use real corridor nodes as hubs
        hubNodes = corridorNodes;

        for (const hub of corridorNodes) {
          const nearest = corridorNodes
            .filter((n) => n.id !== hub.id)
            .map((n) => ({ ...n, d: dist(hub.x, hub.y, n.x, n.y) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 2);

          for (const nb of nearest) {
            const res = await insertEdge(mallId, hub, nb, `Corridor — ${floor}`, edgeSet, supabase);
            if (res === "created") created_edges++;
            else if (res === "skipped") skipped_edges++;
          }
        }
      } else {
        // ── Fallback: synthetic corridor spine ─────────────────────────────────
        const spineCount = Math.min(5, Math.max(3, Math.ceil(floorNodes.length / 4)));
        const step = 100 / (spineCount + 1);
        hubNodes = [];

        for (let i = 1; i <= spineCount; i++) {
          const sx        = Math.round(step * i);
          const sy        = 50;
          const spineName = `${floor} Spine Node ${i}`;
          const spineKey  = `${floor}||${spineName.toLowerCase()}`;

          if (exactByKey.has(spineKey)) {
            const existing = exactByKey.get(spineKey)!;
            hubNodes.push({ id: existing.id, name: spineName, type: "corridor", x: sx, y: sy });
            continue;
          }

          const { data: spineRow, error: spineErr } = await supabase
            .from("mall_nodes")
            .insert({
              mall_id:      mallId,
              name:         spineName,
              type:         "corridor",
              floor:        floor,
              x_coordinate: sx,
              y_coordinate: sy,
              source:       "map_factory",
            })
            .select("id")
            .single();

          if (spineErr) {
            validation_issues.push(`Spine node insert failed: ${spineErr.message}`);
            continue;
          }

          created_nodes++;
          node_type_counts["corridor"] = (node_type_counts["corridor"] ?? 0) + 1;
          floor_counts[floor]          = (floor_counts[floor] ?? 0) + 1;
          const spineNode: DbNode      = { id: spineRow.id, name: spineName, type: "corridor", x: sx, y: sy };
          hubNodes.push(spineNode);
          exactByKey.set(spineKey, {
            id: spineRow.id, name: spineName, type: "corridor", floor,
            x_coordinate: sx, y_coordinate: sy, source: "map_factory",
          });
        }

        // Connect spine nodes linearly
        for (let i = 0; i < hubNodes.length - 1; i++) {
          const res = await insertEdge(
            mallId, hubNodes[i], hubNodes[i + 1],
            `Walk along ${floor} corridor`, edgeSet, supabase,
          );
          if (res === "created") created_edges++;
          else if (res === "skipped") skipped_edges++;
        }
      }

      // ── 7. Connect every non-corridor node to its nearest hub ────────────────
      for (const node of nonCorridorNodes) {
        const nearest = nearestHub(node, hubNodes);
        if (!nearest) continue;

        const instruction =
          node.type === "entrance" ? "Walk from entrance to corridor"
          : node.type === "parking" ? "Walk from parking to corridor"
          : node.type === "shop"    ? `Walk to ${node.name}`
          : "Walk to corridor";

        const res = await insertEdge(mallId, node, nearest, instruction, edgeSet, supabase);
        if (res === "created") created_edges++;
        else if (res === "skipped") skipped_edges++;
      }
    }

    // ── 8. Validation ─────────────────────────────────────────────────────────
    const totalProcessed = created_nodes + updated_nodes + skipped_nodes + repaired_floor_nodes;
    if (totalProcessed === 0) {
      validation_issues.push(
        "No anchors found in layout models — run extraction and layout build first." +
        (floorLabel ? ` (floor_label="${floorLabel}")` : ""),
      );
    }

    const { data: allNodes } = await supabase
      .from("mall_nodes")
      .select("id, type")
      .eq("mall_id", mallId);

    if (!(allNodes ?? []).some((n: { type: string }) => n.type === "entrance")) {
      validation_issues.push("No entrance node found — shoppers cannot start navigation.");
    }
    if (!(allNodes ?? []).some((n: { type: string }) => n.type === "shop")) {
      validation_issues.push("No shop nodes found — route builder has no destinations.");
    }

    return {
      ok: true,
      created_nodes, updated_nodes, skipped_nodes, repaired_floor_nodes,
      created_edges, skipped_edges,
      node_type_counts, floor_counts, floors_processed, validation_issues,
    };

  } catch (err) {
    return {
      ok: false,
      created_nodes: 0, updated_nodes: 0, skipped_nodes: 0, repaired_floor_nodes: 0,
      created_edges: 0, skipped_edges: 0,
      node_type_counts: {}, floor_counts: {}, floors_processed, validation_issues,
      error: String(err),
    };
  }
}

// ── repairNodeFloors ──────────────────────────────────────────────────────────

/**
 * Standalone floor repair — scans ALL nodes for a mall and updates stale
 * floor labels to the supplied targetFloorLabel.
 *
 * Only repairs nodes where source IS NULL or source = 'map_factory'.
 * Nodes with source = 'geodirectory', 'admin', or 'manual' are left untouched.
 *
 * Used by the POST /admin/map-factory/jobs/:jobId/repair-node-floors endpoint.
 */
export async function repairNodeFloors(
  mallId:           string,
  targetFloorLabel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:         any,
): Promise<RepairFloorsResult> {
  try {
    const { data: nodes, error: fetchErr } = await supabase
      .from("mall_nodes")
      .select("id, name, floor, source")
      .eq("mall_id", mallId);

    if (fetchErr) throw new Error(fetchErr.message);

    let repaired = 0, skipped = 0, protected_nodes = 0;

    for (const node of (nodes ?? []) as { id: string; name: string; floor: string | null; source: string | null }[]) {
      if (!isStaleFloor(node.floor)) {
        skipped++;
        continue;
      }
      if (!isRepairable(node)) {
        protected_nodes++;
        continue;
      }

      const { error } = await supabase
        .from("mall_nodes")
        .update({ floor: targetFloorLabel, source: "map_factory" })
        .eq("id", node.id);

      if (!error) repaired++;
      else skipped++;
    }

    return { ok: true, repaired, skipped, protected_nodes };
  } catch (err) {
    return { ok: false, repaired: 0, skipped: 0, protected_nodes: 0, error: String(err) };
  }
}
