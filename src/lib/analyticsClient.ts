/**
 * analyticsClient — fire-and-forget backend analytics.
 *
 * Posts structured events to POST /analytics/event on the Google Cloud backend.
 * The backend writes them to the `analytics_events` table using the service role
 * (more secure than the anon-key path used by analytics.ts / app_events).
 *
 * CONTRACT:
 *  - Never throws, never blocks the caller — errors are console.warn only.
 *  - Never include audio, GPS coordinates, health data, payment data,
 *    or personally-identifying information in metadata.
 *
 * This is a parallel system to src/lib/analytics.ts (which writes to app_events
 * via the Supabase anon key). Both systems coexist.
 */

import { supabase } from "./supabaseClient";

const BACKEND_URL = import.meta.env.VITE_GOOGLE_BACKEND_URL as string | undefined;

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnalyticsEventType =
  | "assistant_query_submitted"
  | "assistant_response_received"
  | "product_recommendation_viewed"
  | "route_requested"
  | "route_response_received"
  | "product_search"
  | "product_viewed"
  | "deal_viewed"
  | "route_built"
  | "route_completed"
  | "navigate_there_clicked"
  | "session_start"
  | "shopping_list_to_ai"
  | "parking_saved"
  | "budget_mode_used"
  | "price_alert_set"
  | "price_alert_removed"
  // Feedback + accuracy signals (Sprint 8E)
  | "recommendation_feedback"
  | "price_accuracy_feedback"
  | "route_feedback"
  | "purchase_signal";

export interface AnalyticsEvent {
  event_type: AnalyticsEventType;
  event_source?: string;
  session_id?: string | null;
  mall_id?: string | null;
  query_text?: string | null;
  product_id?: string | null;
  shop_id?: string | null;
  route_id?: string | null;
  /** Non-PII structured data. No audio, GPS coords, health, payment, or identity fields. */
  metadata?: Record<string, unknown>;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Track a single analytics event. Fire-and-forget — always returns void,
 * never rejects, never throws.
 */
export async function trackBackendEvent(event: AnalyticsEvent): Promise<void> {
  if (!BACKEND_URL) {
    // Not configured in this environment — silently skip
    return;
  }

  try {
    // Attach access token if a Supabase session exists (optional)
    let authHeader: Record<string, string> = {};
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token) {
      authHeader = { Authorization: `Bearer ${token}` };
    }

    const response = await fetch(`${BACKEND_URL}/analytics/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      console.warn(
        `[analyticsClient] Non-OK response: ${response.status} for event "${event.event_type}"`
      );
    }
  } catch (err) {
    // Fire-and-forget: never surface tracking errors to the user
    console.warn("[analyticsClient] Failed to track event:", event.event_type, err);
  }
}
