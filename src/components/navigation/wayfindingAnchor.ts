/**
 * wayfindingAnchor.ts — the URL → start-anchor seam future QR signage will use.
 *
 *   /navigate?mall=mallreds-pilot&start=entrance-main
 *
 * A physical QR code at an entrance will simply encode this URL. Parsing is
 * strict and fail-safe: the mall must be one the app has a spatial dataset
 * for, the start must be a node that dataset allows as a start point, and
 * anything else yields `anchor: null` with a human-readable reason so the UI
 * falls back to MANUAL start selection. A URL can never place the shopper at
 * a position the dataset does not know — no fabricated position, ever.
 *
 * The result is the same `PilotAnchor` model manual selection produces; only
 * `source` differs ("url" today; a real scanner will use "qr").
 */

import {
  MALL_REDS_PILOT_MALL_ID, MALL_REDS_PILOT_MALL_NAME, anchorFromStart, pilotStartOptions,
  type PilotAnchor,
} from "./mallRedsPilotGraph";

export const MALL_PARAM = "mall";
export const START_PARAM = "start";

/** Malls the app currently has a spatial dataset for (id → display name). */
export function knownWayfindingMalls(): Array<{ id: string; name: string }> {
  return [{ id: MALL_REDS_PILOT_MALL_ID, name: MALL_REDS_PILOT_MALL_NAME }];
}

export type WayfindingAnchorParse =
  | { status: "none"; mallId: null; anchor: null; reason: null }
  | { status: "ok"; mallId: string; anchor: PilotAnchor; reason: null }
  | { status: "invalid"; mallId: string | null; anchor: null; reason: string };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/**
 * Parse `?mall=&start=` from a query string. Pure and deterministic.
 * - No params at all → `none` (ordinary manual flow).
 * - Known mall + allowed start node → `ok` with a `url`-sourced anchor.
 * - Anything else → `invalid` with a reason (UI shows manual selection).
 */
export function parseWayfindingAnchor(search: string): WayfindingAnchorParse {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawMall = (params.get(MALL_PARAM) ?? "").trim();
  const rawStart = (params.get(START_PARAM) ?? "").trim();

  if (!rawMall && !rawStart) return { status: "none", mallId: null, anchor: null, reason: null };

  if (!rawMall) {
    return { status: "invalid", mallId: null, anchor: null, reason: "The link did not say which mall you are in." };
  }
  if (!ID_PATTERN.test(rawMall) || !knownWayfindingMalls().some((m) => m.id === rawMall)) {
    return { status: "invalid", mallId: null, anchor: null, reason: "This link is for a mall MallMind does not have a map for yet." };
  }
  if (!rawStart) {
    return { status: "invalid", mallId: rawMall, anchor: null, reason: "The link did not include a starting point." };
  }
  if (!ID_PATTERN.test(rawStart) || !pilotStartOptions().some((s) => s.id === rawStart)) {
    return { status: "invalid", mallId: rawMall, anchor: null, reason: "That starting point is not on the map. Please choose where you are." };
  }

  return { status: "ok", mallId: rawMall, anchor: anchorFromStart(rawStart, "url"), reason: null };
}

/** Build the canonical link for a start point — what a QR code at that spot would encode. */
export function wayfindingLinkFor(mallId: string, startNodeId: string, path = "/navigate"): string {
  const p = new URLSearchParams({ [MALL_PARAM]: mallId, [START_PARAM]: startNodeId });
  return `${path}?${p.toString()}`;
}
