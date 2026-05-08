import { Router, Request, Response } from "express";
import { z } from "zod";
import { recommendProducts } from "../services/productService.js";

const router = Router();

const schema = z.object({
  mall_id:  z.string({ required_error: "mall_id is required" }),
  query:    z.string({ required_error: "query is required" }).min(1),
  budget:   z.number().optional().nullable(),
  category: z.string().optional().nullable(),
});

/**
 * POST /recommend-products
 * Body: { mall_id, query, budget?, category? }
 *
 * Searches products for the given mall, scores and ranks them by:
 * - Special/discount
 * - Cheapest in mall
 * - Budget headroom
 * - Store open now
 *
 * Response:
 *   { recommendations: ScoredProduct[], total_found: number }
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  try {
    const results = await recommendProducts(parsed.data);
    res.json({ recommendations: results, total_found: results.length });
  } catch (err) {
    console.error("[recommend-products]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
