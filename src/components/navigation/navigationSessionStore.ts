/**
 * navigationSessionStore.ts — tiny local persistence so a navigation session survives a page
 * reload (a refresh, the phone camera opening a second MallMind QR code, browser back/forward).
 *
 * What is stored: venue id, the trusted start (anchor id + node + label + how it was obtained),
 * the destination id, the session status and the step the visitor last confirmed. Nothing else —
 * no position, no history, no personal data. Records expire after a short TTL (a visit, not a
 * lifetime) and are validated against the venue on restore; anything that no longer resolves is
 * ignored silently and a fresh session starts. Everything is best-effort: storage may be missing
 * or throw, and the session works without it.
 */

import type { NavigationSession, NavigationStatus } from "./navigationSession";
import type { PilotAnchorSource } from "./mallDatasets";

export const SESSION_STORE_KEY = "mallmind.navigation.session.v2";
/** How long a remembered session stays valid (a visit, not a lifetime). */
export const SESSION_STORE_TTL_MS = 2 * 60 * 60 * 1000;

export interface PersistedNavigationSession {
  mallId: string;
  anchorNodeId: string;
  anchorId: string | null;
  anchorLabel: string;
  anchorSource: PilotAnchorSource;
  destinationId: string;
  status: NavigationStatus;
  /** Index of the step the visitor last confirmed (0 = first step). */
  stepIndex: number;
  savedAt: number;
}

const RESTORABLE: ReadonlySet<NavigationStatus> = new Set(["route_ready", "navigating", "arrived", "unroutable"]);
const SOURCES: ReadonlySet<string> = new Set(["manual", "url", "qr", "native", "wifi_rtt", "uwb", "apple_indoor"]);

export function persistNavigationSession(s: NavigationSession, now: number = Date.now()): void {
  try {
    if (!s.destination || !RESTORABLE.has(s.status)) { localStorage.removeItem(SESSION_STORE_KEY); return; }
    const record: PersistedNavigationSession = {
      mallId: s.mallId, anchorNodeId: s.anchor.nodeId, anchorId: s.anchor.anchorId ?? null, anchorLabel: s.anchor.label, anchorSource: s.anchor.source,
      destinationId: s.destination.id, status: s.status, stepIndex: s.stepIndex, savedAt: now,
    };
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(record));
  } catch { /* storage unavailable — the session still works */ }
}

/** The remembered session for this venue, if any and still fresh and well-formed; otherwise null. */
export function loadPersistedNavigationSession(mallId: string, now: number = Date.now()): PersistedNavigationSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<PersistedNavigationSession>;
    if (r.mallId !== mallId || typeof r.destinationId !== "string" || typeof r.anchorNodeId !== "string" || typeof r.anchorLabel !== "string") return null;
    if (typeof r.savedAt !== "number" || now - r.savedAt > SESSION_STORE_TTL_MS || now < r.savedAt) return null;
    if (!RESTORABLE.has(r.status as NavigationStatus)) return null;
    if (typeof r.anchorSource !== "string" || !SOURCES.has(r.anchorSource)) return null;
    const stepIndex = typeof r.stepIndex === "number" && Number.isInteger(r.stepIndex) && r.stepIndex >= 0 ? r.stepIndex : 0;
    return { ...(r as PersistedNavigationSession), anchorId: typeof r.anchorId === "string" ? r.anchorId : null, stepIndex };
  } catch {
    return null;
  }
}

export function clearPersistedNavigationSession(): void {
  try { localStorage.removeItem(SESSION_STORE_KEY); } catch { /* ignore */ }
}
