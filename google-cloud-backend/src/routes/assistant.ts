import { Router, Request, Response } from "express";
import { z } from "zod";
import { runAssistant } from "../services/geminiService.js";

const router = Router();

const messageSchema = z.object({
  role:    z.enum(["user", "assistant"]),
  content: z.string(),
});

const schema = z.object({
  messages:        z.array(messageSchema).min(1),
  mall_id:         z.string().optional().nullable(),
  mall_name:       z.string().optional().nullable(),
  session_id:      z.string().optional().nullable(),
  user_id:         z.string().optional().nullable(),
  current_floor:   z.string().optional().nullable(),
  shopping_intent: z.string().optional().nullable(),
  budget:          z.number().optional().nullable(),
});

/**
 * POST /assistant
 * Body: { messages, mall_id?, mall_name?, session_id?, user_id?,
 *         current_floor?, shopping_intent?, budget? }
 *
 * Runs Gemini 2.0 Flash with function calling.
 * Tools available: recommend_products, check_store_hours,
 *                  save_shopping_intent, build_route
 *
 * Response:
 *   { message, products, route_steps, route_id, build_route,
 *     route_shop_ids, route_summary }
 *
 * Requires GEMINI_API_KEY to be set in environment.
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { messages, ...ctx } = parsed.data;

  try {
    const result = await runAssistant(
      messages as { role: "user" | "assistant"; content: string }[],
      ctx
    );
    res.json(result);
  } catch (err) {
    console.error("[assistant]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
