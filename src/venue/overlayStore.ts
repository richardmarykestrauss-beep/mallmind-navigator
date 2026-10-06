/**
 * overlayStore.ts — where the RUNTIME gets a venue's operational overlay from.
 *
 * Sprint 8 ships the seam only: an in-memory, per-venue store with subscriptions, fed by a
 * clearly labelled DEMO fixture (see src/navigation/demoOverlays.ts). A real feed (an operator
 * action, a published overlay document) plugs in here without touching the pack, the router or the
 * experience. Nothing here ever writes to a Venue Pack.
 */

import type { OperationalOverlay } from "./overlay";

const overlays = new Map<string, OperationalOverlay>();
const listeners = new Set<() => void>();
let version = 0;

export function getVenueOverlay(venueId: string): OperationalOverlay | null { return overlays.get(venueId) ?? null; }
export function setVenueOverlay(overlay: OperationalOverlay): void { overlays.set(overlay.venue_id, overlay); bump(); }
export function clearVenueOverlay(venueId: string): void { if (overlays.delete(venueId)) bump(); }
export function clearAllOverlays(): void { overlays.clear(); bump(); }
/** Monotonic version for `useSyncExternalStore`. */
export function overlayVersion(): number { return version; }
export function subscribeOverlays(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function bump() { version++; for (const l of listeners) { try { l(); } catch { /* listeners never break the store */ } } }
