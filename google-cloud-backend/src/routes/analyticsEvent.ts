import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// ── Allowed event types ────────────────────────────────────────────────────────
// Extend this list as new events are added. Unknown types are rejected.
const ALLOWED_EVENT_TYPES = new Set([
  // Assistant events
  "assistant_query_submitted",
  "assistant_response_received",
  "product_recommendation_viewed",
  "route_requested",
  "route_response_received",
  // Search / browse events
  "product_search",
  "product_viewed",
  "deal_viewed",
  // Navigation / session events
  "route_built",
  "route_completed",
  "navigate_there_clicked",
  "session_start",
  // Shopping list events
  "shopping_list_to_ai",
  // Parking events
  "parking_saved",
  // Budget / alert events
  "budget_mode_used",
  "price_alert_set",
  "price_alert_removed",
  // Feedback + accuracy signals (Sprint 8E)
  "recommendation_feedback",
  "price_accuracy_feedback",
  "route_feedback",
  "purchase_signal",
  // Price correction workflow (Sprint 8F)
  "price_correction_reported",
  "price_correction_approved",
  "price_correction_rejected",
  "price_correction_needs_verification",
]);

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

router.post("/event", async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();

    const {
      event_type,
      event_source = "frontend",
      session_id,
      mall_id,
      query_text,
      product_id,
      shop_id,
      route_id,
      metadata = {},
    } = req.body as {
      event_type?: string;
      event_source?: string;
      session_id?: string | null;
      mall_id?: string | null;
      query_text?: string | null;
      product_id?: string | null;
      shop_id?: string | null;
      route_id?: string | null;
      metadata?: Record<string, unknown>;
    };

    // Validate required field
    if (!event_type || typeof event_type !== "string") {
      return res.status(400).json({ error: "event_type is required" });
    }

    if (!ALLOWED_EVENT_TYPES.has(event_type)) {
      return res.status(400).json({
        error: `Unknown event_type: "${event_type}"`,
        allowed: [...ALLOWED_EVENT_TYPES],
      });
    }

    // Optional auth — resolve user_id if bearer token present, but never require it
    let user_id: string | null = null;
    const token = getBearerToken(req);
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user?.id) {
        user_id = data.user.id;
      }
    }

    // Insert — service role bypasses RLS
    const { error: insertError } = await supabase.from("analytics_events").insert({
      user_id,
      session_id: session_id ?? null,
      mall_id: mall_id ?? null,
      event_type,
      event_source: typeof event_source === "string" ? event_source : "frontend",
      query_text: query_text ?? null,
      product_id: product_id ?? null,
      shop_id: shop_id ?? null,
      route_id: route_id ?? null,
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    });

    if (insertError) {
      console.error("[analytics/event] insert error:", insertError.message);
      // Still return ok — analytics must never cause client-visible failures
      return res.json({ ok: true, warn: "insert_failed" });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("[analytics/event] unexpected error:", error);
    // Fire-and-forget contract: always 200 on unexpected errors
    return res.status(200).json({ ok: true, warn: "unexpected_error" });
  }
});

export default router;
