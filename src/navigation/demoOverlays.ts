/**
 * demoOverlays.ts — DEMO / SIMULATED operational states for demonstrations and tests.
 *
 * None of these is a real venue condition. Every entry is `simulated: true`, every actor is the
 * "demo" kind, and the experience renders an unmistakable "DEMO / SIMULATED" label whenever one is
 * applied. They are activated only by an explicit `demo_overlay=<id>` query parameter and cleared
 * with `demo_overlay=none`; nothing applies them on its own.
 */

import type { OperationalOverlay } from "@/venue/overlay";

const DEMO_ACTOR = { id: "demo", kind: "demo" as const, display: "Demonstration (simulated)" };
const CREATED = "2026-10-05T08:00:00Z";

export const DEMO_OVERLAYS: Readonly<Record<string, OperationalOverlay>> = {
  /** Garden Route Mall: Clicks temporarily unavailable (simulated). Search still lists it; no route starts. */
  "grm-clicks-unavailable": {
    venue_id: "garden-route-mall",
    entries: [{ id: "demo-grm-clicks", venue_id: "garden-route-mall", target_type: "destination", target_id: "grm-clicks-37", state: "unavailable", reason: "Simulated: store closed for stocktake", starts_at: null, expires_at: null, actor: DEMO_ACTOR, created_at: CREATED, simulated: true }],
  },
  /** Garden Route Mall: Entrance 4 unavailable (simulated). It is the only start, so no route can begin. */
  "grm-entrance-4-unavailable": {
    venue_id: "garden-route-mall",
    entries: [{ id: "demo-grm-entrance-4", venue_id: "garden-route-mall", target_type: "anchor", target_id: "grm-entrance-4", state: "unavailable", reason: "Simulated: entrance closed for maintenance", starts_at: null, expires_at: null, actor: DEMO_ACTOR, created_at: CREATED, simulated: true }],
  },
};

export const DEMO_OVERLAY_PARAM = "demo_overlay";

export function demoOverlayFromSearch(search: string): { id: string; overlay: OperationalOverlay } | "none" | null {
  const raw = (new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(DEMO_OVERLAY_PARAM) ?? "").trim();
  if (!raw) return null;
  if (raw === "none") return "none";
  const overlay = DEMO_OVERLAYS[raw];
  return overlay ? { id: raw, overlay } : null;
}
