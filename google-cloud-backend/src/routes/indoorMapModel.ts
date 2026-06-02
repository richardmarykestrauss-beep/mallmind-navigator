import { Router, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  "";

function getIndoorMapSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase backend env vars for indoor-map-model");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}


type IndoorMapNode = {
  id: string;
  name: string;
  type: string;
  floor: string | null;
  x_coordinate: number | null;
  y_coordinate: number | null;
  linked_shop_id?: string | null;
  source?: string | null;
};


type IndoorFloorPlanRow = {
  id: string;
  floor_label: string | null;
  svg_output: string | null;
  layout_json: unknown;
  status: string | null;
  created_at: string | null;
};

type IndoorMapEdge = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  distance_meters: number | null;
  instruction: string | null;
  floor_change: boolean | null;
};

function normalizeFloor(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^g$/i.test(raw)) return "Ground Floor";
  if (/^ground$/i.test(raw)) return "Ground Floor";
  if (/^ground floor$/i.test(raw)) return "Ground Floor";

  const level = raw.match(/^l(?:evel)?\s*(\d+)$/i);
  if (level) return `Level ${level[1]}`;

  return raw;
}

function uniqueFloors(nodes: IndoorMapNode[]): string[] {
  const seen = new Set<string>();

  for (const node of nodes) {
    const floor = normalizeFloor(node.floor);
    if (floor) seen.add(floor);
  }

  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * GET /indoor-map-model?mall_id=<uuid>&floor=<optional>
 *
 * Backend-owned adapter for indoor map rendering.
 * Keeps frontend from querying raw mall_nodes/mall_edges directly.
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getIndoorMapSupabase();
    const mallId = typeof req.query.mall_id === "string" ? req.query.mall_id.trim() : "";
    const requestedFloor = normalizeFloor(req.query.floor);

    if (!mallId) {
      res.status(400).json({
        ok: false,
        error: "mall_id is required",
      });
      return;
    }

    const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }, { data: floorPlanRows, error: floorPlanError }] =
      await Promise.all([
        supabase
          .from("mall_nodes")
          .select("id, name, type, floor, x_coordinate, y_coordinate, linked_shop_id, source")
          .eq("mall_id", mallId),

        supabase
          .from("mall_edges")
          .select("id, from_node_id, to_node_id, distance_meters, instruction, floor_change")
          .eq("mall_id", mallId),

        supabase
          .from("map_factory_generated_floorplans")
          .select("id, floor_label, svg_output, layout_json, status, created_at")
          .eq("mall_id", mallId)
          .in("status", ["published", "approved"])
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

    if (nodeError) {
      res.status(500).json({
        ok: false,
        error: "Failed to load mall_nodes",
        detail: nodeError.message,
      });
      return;
    }

    if (edgeError) {
      res.status(500).json({
        ok: false,
        error: "Failed to load mall_edges",
        detail: edgeError.message,
      });
      return;
    }

    if (floorPlanError) {
      // Non-blocking. Map can still render nodes/edges.
      console.warn("[indoor-map-model] floorplan load warning:", floorPlanError.message);
    }

    const nodes = ((nodeRows ?? []) as IndoorMapNode[]).map((node) => ({
      ...node,
      floor: normalizeFloor(node.floor),
    }));

    const edges = (edgeRows ?? []) as IndoorMapEdge[];
    const floors = uniqueFloors(nodes);
    const activeFloor = requestedFloor ?? floors[0] ?? null;

    const floorNodeIds = new Set(
      nodes
        .filter((node) => !activeFloor || normalizeFloor(node.floor) === activeFloor)
        .map((node) => node.id),
    );

    const filteredNodes = activeFloor
      ? nodes.filter((node) => normalizeFloor(node.floor) === activeFloor)
      : nodes;

    const filteredEdges = activeFloor
      ? edges.filter((edge) => floorNodeIds.has(edge.from_node_id) && floorNodeIds.has(edge.to_node_id))
      : edges;

    const matchingFloorPlan =
      ((floorPlanRows ?? []) as IndoorFloorPlanRow[]).find((fp: IndoorFloorPlanRow) => normalizeFloor(fp.floor_label) === activeFloor) ??
      ((floorPlanRows ?? []) as IndoorFloorPlanRow[])[0] ??
      null;

    res.json({
      ok: true,
      model: {
        mall_id: mallId,
        active_floor: activeFloor,
        floors,
        nodes: filteredNodes,
        edges: filteredEdges,
        floorplan: matchingFloorPlan
          ? {
              id: matchingFloorPlan.id,
              floor_label: matchingFloorPlan.floor_label,
              svg_output: matchingFloorPlan.svg_output,
              layout_json: matchingFloorPlan.layout_json,
              status: matchingFloorPlan.status,
              created_at: matchingFloorPlan.created_at,
            }
          : null,
        source: "backend_map_graph",
        reality_label: "2.5D schematic · Map Factory · published/approved floorplans only",
        counts: {
          all_nodes: nodes.length,
          all_edges: edges.length,
          floor_nodes: filteredNodes.length,
          floor_edges: filteredEdges.length,
          floorplans: floorPlanRows?.length ?? 0,
        },
      },
    });
  } catch (err) {
    console.error("[indoor-map-model] Unexpected error:", err);

    res.status(500).json({
      ok: false,
      error: "Unexpected indoor map model error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
