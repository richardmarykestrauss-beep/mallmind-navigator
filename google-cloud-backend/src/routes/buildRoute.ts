import { Router, Request, Response } from "express";
import { z } from "zod";
import { buildRoute } from "../services/routingService.js";

const router = Router();

const schema = z.object({
  session_id:            z.string({ required_error: "session_id is required" }),
  destination_shop_ids:  z.array(z.string()).min(1, "At least one destination_shop_id is required"),
  user_id:               z.string().optional().nullable(),
});

/**
 * POST /build-route
 * Body: { session_id, destination_shop_ids: string[], user_id? }
 *
 * Runs Dijkstra on mall_nodes/mall_edges to build a real step-by-step
 * indoor route. Saves the result to shopping_routes and updates
 * shopping_sessions.active_route_id.
 *
 * Response:
 *   { route_id, steps, total_distance_meters, estimated_minutes, stop_count, fallback }
 *
 * fallback: true means no navigation graph exists — frontend should show
 * a basic store-list instead of step-by-step directions.
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { session_id, destination_shop_ids, user_id } = parsed.data;

  try {
    const result = await buildRoute(session_id, destination_shop_ids, user_id ?? null);
    res.json(result);
  } catch (err) {
    console.error("[build-route]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
