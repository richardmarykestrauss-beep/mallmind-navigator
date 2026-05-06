/**
 * Analytics — fire-and-forget event logging.
 * Every call is best-effort: errors are swallowed so the UX is never blocked.
 * Events land in search_events and app_events tables in Supabase.
 */

import { supabase } from "./supabaseClient";

// ── Search events ─────────────────────────────────────────────────────────────

export function trackSearch(
  query: string,
  resultCount: number,
  mallId?: string | number | null,
  mallName?: string | null,
  userId?: string | null
) {
  if (!query.trim()) return;
  supabase
    .from("search_events")
    .insert({
      query: query.trim().toLowerCase(),
      result_count: resultCount,
      mall_id: mallId ? String(mallId) : null,
      mall_name: mallName ?? null,
      user_id: userId ?? null,
    })
    .then(() => {}) // fire and forget
    .catch(() => {});
}

// ── Generic app events ────────────────────────────────────────────────────────

export type AppEventType =
  | "route_built"
  | "route_completed"
  | "ai_conversation"
  | "ai_route_triggered"
  | "budget_mode_used"
  | "price_alert_set"
  | "price_alert_removed"
  | "parking_saved"
  | "shopping_list_created"
  | "shopping_list_to_ai"
  | "deals_viewed"
  | "navigate_there_clicked"
  | "session_start";

export function trackEvent(
  eventType: AppEventType,
  options?: {
    userId?: string | null;
    mallId?: string | number | null;
    mallName?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  supabase
    .from("app_events")
    .insert({
      event_type: eventType,
      user_id: options?.userId ?? null,
      mall_id: options?.mallId ? String(options.mallId) : null,
      mall_name: options?.mallName ?? null,
      metadata: options?.metadata ?? null,
    })
    .then(() => {})
    .catch(() => {});
}
