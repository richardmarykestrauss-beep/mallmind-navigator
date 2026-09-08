/**
 * wayfindingAnchor.ts — the URL → mall + start-anchor seam future QR signage will use.
 *
 *   /navigate?mall=mallreds-pilot&start=entrance-main     (mall + start)
 *   /navigate?mall=menlyn-park                            (mall only → that mall's default start)
 *
 * Parsing is strict and fail-safe: the mall must have a bundled dataset, the start must be a node
 * that dataset allows as a start point, and anything else yields `anchor: null` with a
 * human-readable reason so the UI falls back to MANUAL start selection. A URL can never place the
 * shopper at a position the dataset does not know — no fabricated position, ever.
 *
 * The result is the same `PilotAnchor` model manual selection produces; only `source` differs:
 * "url" for a plain link, "qr" when the link carries `via=qr` (what printed QR codes encode).
 * Validation itself lives in anchorProvider.ts (one trust gate for every provider).
 */

import { listWayfindingMalls, getWayfindingMall, type PilotAnchor } from "./mallDatasets";
import { validateAnchor, toPilotAnchor, ANCHOR_REASONS } from "./anchorProvider";

export const MALL_PARAM = "mall";
export const START_PARAM = "start";
/**
 * Optional marker a printed MallMind QR code carries (`via=qr`) so the app can say truthfully
 * "from the QR code you scanned". Any other value is ignored (the anchor is then "url"-sourced).
 */
export const VIA_PARAM = "via";

/** Malls the app currently has a spatial dataset for (id → display name). */
export function knownWayfindingMalls(): Array<{ id: string; name: string }> {
  return listWayfindingMalls().map((m) => ({ id: m.id, name: m.name }));
}

export type WayfindingAnchorParse =
  | { status: "none"; mallId: null; anchor: null; reason: null }
  | { status: "mall"; mallId: string; anchor: null; reason: null }
  | { status: "ok"; mallId: string; anchor: PilotAnchor; reason: null }
  | { status: "invalid"; mallId: string | null; anchor: null; reason: string };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/**
 * Parse `?mall=&start=` from a query string. Pure and deterministic.
 * - No params at all → `none` (ordinary manual flow on the default mall).
 * - Known mall, no start → `mall` (that mall, manual default start).
 * - Known mall + allowed start node → `ok` with a `url`-sourced anchor.
 * - Anything else → `invalid` with a reason (UI shows manual selection).
 */
export function parseWayfindingAnchor(search: string): WayfindingAnchorParse {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawMall = (params.get(MALL_PARAM) ?? "").trim();
  const rawStart = (params.get(START_PARAM) ?? "").trim();
  const source = params.get(VIA_PARAM) === "qr" ? "qr" : "url";

  if (!rawMall && !rawStart) return { status: "none", mallId: null, anchor: null, reason: null };

  if (!rawMall) return { status: "invalid", mallId: null, anchor: null, reason: ANCHOR_REASONS.noMall };
  const graph = ID_PATTERN.test(rawMall) ? getWayfindingMall(rawMall) : null;
  if (!graph) return { status: "invalid", mallId: null, anchor: null, reason: ANCHOR_REASONS.unknownMall };
  if (!rawStart) return { status: "mall", mallId: rawMall, anchor: null, reason: null };

  const resolved = validateAnchor(rawMall, rawStart, source);
  if (resolved.status === "ok") return { status: "ok", mallId: rawMall, anchor: toPilotAnchor(resolved.anchor), reason: null };
  return { status: "invalid", mallId: rawMall, anchor: null, reason: resolved.reason };
}

/** Build the canonical link for a start point. */
export function wayfindingLinkFor(mallId: string, startNodeId: string, path = "/navigate"): string {
  const p = new URLSearchParams({ [MALL_PARAM]: mallId, [START_PARAM]: startNodeId });
  return `${path}?${p.toString()}`;
}

/** The link a printed MallMind QR code at that spot encodes (canonical link + `via=qr`). */
export function qrLinkFor(mallId: string, startNodeId: string, path = "/navigate"): string {
  const p = new URLSearchParams({ [MALL_PARAM]: mallId, [START_PARAM]: startNodeId, [VIA_PARAM]: "qr" });
  return `${path}?${p.toString()}`;
}
