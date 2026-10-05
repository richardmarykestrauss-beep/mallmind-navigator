/**
 * pilotSession.ts — the EPHEMERAL visit identifier for privacy-light navigation analytics.
 *
 * A random id per visit, kept in sessionStorage (one browser tab, gone when the tab closes) and
 * capped at the navigation session TTL (2 h). It is never derived from an account, a device, an
 * advertising identifier or a cookie, never shared across malls, and never used to join visits.
 * Its only job is to let the QR → search → route funnel of ONE visit be reconstructed.
 */

export const PILOT_SESSION_KEY = "mallmind.pilot.session.v1";
/** Lifetime of a visit identifier (matches the navigation session TTL). */
export const PILOT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

interface Stored { id: string; startedAt: number }

function randomId(): string {
  try { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID(); } catch { /* fall through */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The current visit id, minted on first use and rotated after the TTL. Storage failures yield a per-call id (events still carry one). */
export function pilotSessionId(now: number = Date.now()): string {
  try {
    const raw = sessionStorage.getItem(PILOT_SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      if (typeof s.id === "string" && typeof s.startedAt === "number" && now - s.startedAt < PILOT_SESSION_TTL_MS && now >= s.startedAt) return s.id;
    }
    const fresh: Stored = { id: randomId(), startedAt: now };
    sessionStorage.setItem(PILOT_SESSION_KEY, JSON.stringify(fresh));
    return fresh.id;
  } catch {
    return randomId();
  }
}

export function resetPilotSession(): void { try { sessionStorage.removeItem(PILOT_SESSION_KEY); } catch { /* ignore */ } }
