import { Router, Request, Response } from "express";
import { z } from "zod";
import { detectActiveMall } from "../services/mallService.js";

const router = Router();

const schema = z.object({
  lat:     z.number({ required_error: "lat is required" }),
  lng:     z.number({ required_error: "lng is required" }),
  user_id: z.string().optional().nullable(),
});

/**
 * POST /detect-active-mall
 * Body: { lat: number, lng: number, user_id?: string }
 *
 * Finds the nearest mall using Haversine over malls.lat/lng.
 * Creates or resumes an active shopping_session for logged-in users.
 *
 * Response:
 *   { mall, session_id, distance_km, within_radius }
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { lat, lng, user_id } = parsed.data;

  try {
    const result = await detectActiveMall(lat, lng, user_id ?? null);
    res.json(result);
  } catch (err) {
    console.error("[detect-active-mall]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
