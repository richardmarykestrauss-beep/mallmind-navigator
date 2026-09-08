/**
 * navigationSessionStore.ts — tiny persistence so a navigation session survives DEEP-LINK RE-ENTRY.
 *
 * When a visitor mid-route scans a second MallMind QR code with the phone camera, the OS opens the
 * deep link as a fresh page load. To honour "preserve destination, replace trusted start", the
 * current destination (and whether the visitor was already walking) is remembered locally for a
 * short time and restored when the next deep link for the SAME mall arrives.
 *
 * Only ids and a status are stored — no position, no history, no personal data. Everything is
 * best-effort: storage may be missing or throw, and the session works without it.
 */

import type { NavigationSession, NavigationStatus } from "./navigationSession";

export const SESSION_STORE_KEY = "mallmind.navigation.session.v1";
/** How long a remembered destination stays valid (a visit, not a lifetime). */
export const SESSION_STORE_TTL_MS = 2 * 60 * 60 * 1000;

export interface PersistedNavigationSession {
  mallId: string;
  anchorNodeId: string;
  anchorLabel: string;
  destinationId: string;
  status: NavigationStatus;
  savedAt: number;
}

const RESTORABLE: ReadonlySet<NavigationStatus> = new Set(["route_ready", "navigating", "arrived", "unroutable"]);

export function persistNavigationSession(s: NavigationSession, now: number = Date.now()): void {
  try {
    if (!s.destination || !RESTORABLE.has(s.status)) { localStorage.removeItem(SESSION_STORE_KEY); return; }
    const record: PersistedNavigationSession = {
      mallId: s.mallId, anchorNodeId: s.anchor.nodeId, anchorLabel: s.anchor.label,
      destinationId: s.destination.id, status: s.status, savedAt: now,
    };
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(record));
  } catch { /* storage unavailable — the session still works */ }
}

/** The remembered session for this mall, if any and still fresh; otherwise null. */
export function loadPersistedNavigationSession(mallId: string, now: number = Date.now()): PersistedNavigationSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<PersistedNavigationSession>;
    if (r.mallId !== mallId || typeof r.destinationId !== "string" || typeof r.anchorNodeId !== "string") return null;
    if (typeof r.savedAt !== "number" || now - r.savedAt > SESSION_STORE_TTL_MS || now < r.savedAt) return null;
    if (!RESTORABLE.has(r.status as NavigationStatus)) return null;
    return r as PersistedNavigationSession;
  } catch {
    return null;
  }
}

export function clearPersistedNavigationSession(): void {
  try { localStorage.removeItem(SESSION_STORE_KEY); } catch { /* ignore */ }
}
