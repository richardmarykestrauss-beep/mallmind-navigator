/**
 * operationalLog.ts — APPEND-ONLY operational audit model (the seam, not a workflow).
 *
 * Factory evidence answers "what is the physical world?" and is reviewed fact by fact.
 * The operational log answers "what is temporarily happening in that world?": who said a lift
 * is out, when, why, until when, and what the previous state was. The two are never merged.
 *
 * Pure functions over plain JSON. Persistence (a table, a file) is a later concern; the shape is
 * what matters: every change records actor, timestamp, reason, previous and new state, expiry, and
 * the entry it supersedes. Nothing is ever deleted or edited in place.
 */

import type { OverlayActor, OverlayEntry, OverlayTargetType, OperationalOverlay } from "./overlay";

export type OperationalState = "available" | "unavailable";

export interface OperationalLogEntry {
  id: string;
  venue_id: string;
  at: string;
  actor: OverlayActor;
  reason: string;
  target_type: OverlayTargetType;
  target_id: string;
  previous_state: OperationalState;
  new_state: OperationalState;
  /** When the new state lapses on its own (null = until changed again). */
  expires_at: string | null;
  /** The log entry this one replaces (a reopening supersedes the closure it ends). */
  supersedes: string | null;
  simulated?: boolean;
}

export interface OperationalLog {
  venue_id: string;
  entries: OperationalLogEntry[];
}

export class OperationalLogError extends Error {}

export function createOperationalLog(venueId: string): OperationalLog { return { venue_id: venueId, entries: [] }; }

/** Current state of one target as the log stands (the latest entry for it wins; expiry is not evaluated here). */
export function currentState(log: OperationalLog, targetType: OverlayTargetType, targetId: string): { state: OperationalState; entry: OperationalLogEntry | null } {
  for (let i = log.entries.length - 1; i >= 0; i--) {
    const e = log.entries[i];
    if (e.target_type === targetType && e.target_id === targetId) return { state: e.new_state, entry: e };
  }
  return { state: "available", entry: null };
}

/**
 * Append a change. Refuses: a foreign venue, a duplicate id, a `previous_state` that does not match
 * the log (a stale write), a change to the same state, or a non-chronological timestamp.
 */
export function appendOperationalChange(log: OperationalLog, change: Omit<OperationalLogEntry, "previous_state" | "supersedes"> & { previous_state?: OperationalState }): OperationalLog {
  if (change.venue_id !== log.venue_id) throw new OperationalLogError(`entry is for venue "${change.venue_id}", log is for "${log.venue_id}"`);
  if (log.entries.some((e) => e.id === change.id)) throw new OperationalLogError(`duplicate operational entry id "${change.id}"`);
  if (!change.reason.trim()) throw new OperationalLogError("an operational change needs a reason");
  const last = log.entries[log.entries.length - 1];
  if (last && Date.parse(change.at) < Date.parse(last.at)) throw new OperationalLogError("operational entries must be appended in time order");
  const cur = currentState(log, change.target_type, change.target_id);
  if (change.previous_state !== undefined && change.previous_state !== cur.state) throw new OperationalLogError(`stale change: ${change.target_type} ${change.target_id} is "${cur.state}", not "${change.previous_state}"`);
  if (cur.state === change.new_state) throw new OperationalLogError(`${change.target_type} ${change.target_id} is already "${cur.state}"`);
  const entry: OperationalLogEntry = { ...change, previous_state: cur.state, supersedes: cur.entry?.id ?? null };
  return { ...log, entries: [...log.entries, entry] };
}

/** Derive the overlay (what is currently unavailable) from the log. Pure; expiry evaluated by `applyOverlay`. */
export function overlayFromLog(log: OperationalLog): OperationalOverlay {
  const latest = new Map<string, OperationalLogEntry>();
  for (const e of log.entries) latest.set(`${e.target_type}:${e.target_id}`, e);
  const entries: OverlayEntry[] = [];
  for (const e of latest.values()) {
    if (e.new_state !== "unavailable") continue;
    entries.push({ id: e.id, venue_id: e.venue_id, target_type: e.target_type, target_id: e.target_id, state: "unavailable", reason: e.reason, starts_at: e.at, expires_at: e.expires_at, actor: e.actor, created_at: e.at, ...(e.simulated ? { simulated: true } : {}) });
  }
  return { venue_id: log.venue_id, entries };
}
