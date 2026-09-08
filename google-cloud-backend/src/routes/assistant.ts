import { Router, Request, Response } from "express";
import { z } from "zod";
import { runAssistant } from "../services/geminiService.js";

const router = Router();

// Payload bounds — every message is forwarded to Gemini, so the request shape
// itself is a cost control (a 1 MB transcript must never reach the model).
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 24_000;

const messageSchema = z.object({
  role:    z.enum(["user", "assistant"]),
  content: z.string().max(MAX_MESSAGE_CHARS, `Each message must be at most ${MAX_MESSAGE_CHARS} characters`),
});

const schema = z.object({
  messages:        z.array(messageSchema).min(1).max(MAX_MESSAGES, `At most ${MAX_MESSAGES} messages per request`)
    .refine((ms) => ms.reduce((n, m) => n + m.content.length, 0) <= MAX_TOTAL_CHARS, {
      message: `Conversation payload must be at most ${MAX_TOTAL_CHARS} characters`,
    }),
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
 * Runs Gemini 2.0 Flash (gemini-2.0-flash-001) with function calling.
 * Tools available: recommend_products, check_store_hours,
 *                  save_shopping_intent, build_route
 *
 * Response:
 *   { message, products, route_steps, route_id, build_route,
 *     route_shop_ids, route_summary }
 *
 * Requires GEMINI_API_KEY to be set in environment.
 *
 * Public-pilot protection: per-IP rate limits are applied in server.ts
 * (burst + hourly) and the payload is bounded by the schema above.
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
