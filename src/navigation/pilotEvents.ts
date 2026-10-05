/**
 * pilotEvents.ts — the privacy-light pilot telemetry seam.
 *
 * What a pilot needs to measure: demand (what visitors look for), friction (where they stop) and the
 * QR funnel. What it must never need: who the visitor is. Every event carries the venue id, a
 * per-visit random session id, a client timestamp and a small, classified detail. No account id, no
 * device id, no position history, no raw search text (a normalised classification instead).
 *
 * `navigation_arrived_confirmed` means the visitor CONFIRMED the final step. It is not physical
 * arrival and it is never footfall.
 */

import { trackEvent, type AppEventType } from "@/lib/analytics";
import { pilotSessionId } from "./pilotSession";
import type { NavigationEvent } from "@/components/navigation/navigationEvents";

export type PilotEventName =
  | "venue_opened"
  | "qr_landing"
  | "qr_anchor_valid"
  | "qr_anchor_invalid"
  | "destination_search"
  | "destination_search_no_result"
  | "destination_selected"
  | "route_overview_opened"
  | "navigation_session_started"
  | "navigation_step_advanced"
  | "navigation_step_back"
  | "navigation_reanchored"
  | "navigation_unroutable"
  | "navigation_arrived_confirmed"
  | "navigation_restarted"
  | "location_update_opened"
  | "navigation_failed"
  | "navigation_intent";

export type PilotDetail = Record<string, string | number | boolean | null>;

export interface PilotEvent {
  name: PilotEventName;
  venue_id: string;
  session_id: string;
  /** Client clock, ISO 8601. Server insert time may differ; funnel ordering uses this. */
  ts: string;
  detail: PilotDetail;
}

/** Keys that must never appear in a pilot event detail (defence in depth; tests assert it). */
export const FORBIDDEN_DETAIL_KEYS: readonly string[] = ["user_id", "userId", "email", "phone", "lat", "lng", "latitude", "longitude", "device_id", "advertising_id", "query", "query_text"];

export function buildPilotEvent(name: PilotEventName, venueId: string, detail: PilotDetail = {}, now: number = Date.now()): PilotEvent {
  const clean: PilotDetail = {};
  for (const [k, v] of Object.entries(detail)) if (!FORBIDDEN_DETAIL_KEYS.includes(k) && v !== undefined) clean[k] = v;
  return { name, venue_id: venueId, session_id: pilotSessionId(now), ts: new Date(now).toISOString(), detail: clean };
}

export type PilotEventSink = (event: PilotEvent) => void;

/** Default sink: best-effort insert into app_events with NO user id. Never throws. */
export const defaultPilotSink: PilotEventSink = (e) => {
  try {
    trackEvent(e.name as AppEventType, { userId: null, mallId: e.venue_id, mallName: null, metadata: { session_id: e.session_id, ts: e.ts, ...e.detail } });
  } catch { /* analytics never breaks navigation */ }
};

/** Emit one pilot event through a sink (default: app_events). */
export function emitPilotEvent(name: PilotEventName, venueId: string, detail: PilotDetail = {}, sink: PilotEventSink = defaultPilotSink, now: number = Date.now()): PilotEvent {
  const ev = buildPilotEvent(name, venueId, detail, now);
  try { sink(ev); } catch { /* best-effort */ }
  return ev;
}

/** Adapt the navigation component's event seam to pilot events (adds session id + timestamp, strips nothing else). */
export function pilotSinkForNavigation(sink: PilotEventSink = defaultPilotSink): (e: NavigationEvent) => void {
  return (e) => { emitPilotEvent(e.name as PilotEventName, e.mallId, e.detail, sink); };
}
