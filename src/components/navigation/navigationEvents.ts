/**
 * navigationEvents.ts — the analytics SEAM for navigation sessions (not an analytics platform).
 *
 * The wayfinding component emits lightweight, PII-free events through an injected sink; the
 * screens wire the sink to the existing best-effort `trackEvent` (src/lib/analytics.ts). Nothing
 * in navigation ever waits on, or fails because of, event recording.
 */

export type NavigationEventName =
  | "navigation_session_started"
  | "navigation_step_advanced"
  | "navigation_step_back"
  | "navigation_reanchored"
  | "navigation_arrived"
  | "navigation_failed";

export interface NavigationEvent {
  name: NavigationEventName;
  mallId: string;
  detail: Record<string, string | number | boolean | null>;
}

export type NavigationEventSink = (event: NavigationEvent) => void;

/** Wrap a sink so a throwing consumer can never break navigation. */
export function safeSink(sink: NavigationEventSink | undefined): NavigationEventSink {
  return (event) => { try { sink?.(event); } catch { /* best-effort */ } };
}
