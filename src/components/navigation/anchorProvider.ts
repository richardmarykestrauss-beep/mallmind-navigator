/**
 * anchorProvider.ts — the AnchorProvider contract: how MallMind learns WHERE a visitor starts.
 *
 * Every provider resolves its own input into the same trusted anchor through ONE gate
 * (`validateAnchor`): the mall must have a bundled dataset, the anchor must be a node of THAT
 * mall, and the node must be permitted as a start. Nothing else can place a visitor anywhere.
 *
 * Implemented here:
 *   • manual — the visitor picks a start point in the UI.
 *   • qr     — the visitor scanned a MallMind QR code (a physical encoding of the canonical
 *              /navigate?mall=&start= deep link, see wayfindingAnchor.ts). Also used for deep-link
 *              re-entry: scanning a second code mid-route re-anchors the same session.
 *
 * Reserved seams (types only, deliberately NOT implemented): native, wifi_rtt, uwb, apple_indoor.
 * `anchorProviderFor()` returns null for them so callers fail safely instead of pretending.
 *
 * No live positioning, no simulated position, no fake blue dot.
 */

import { getWayfindingMall, startOptions, type PilotAnchor, type PilotAnchorSource } from "./mallDatasets";

export type AnchorSource = PilotAnchorSource;

/** Sources a provider exists for today. "url" is a typed/opened deep link without the QR marker. */
export const IMPLEMENTED_ANCHOR_SOURCES: readonly AnchorSource[] = ["manual", "qr", "url"];
/** Sources kept in the type for future positioning providers. None is built. */
export const FUTURE_ANCHOR_SOURCES: readonly AnchorSource[] = ["native", "wifi_rtt", "uwb", "apple_indoor"];

/** A start position MallMind is allowed to trust: validated against the registry, never guessed. */
export interface TrustedAnchor {
  mallId: string;
  anchorId: string;
  label: string;
  source: AnchorSource;
  /** When the anchor was resolved (ms since epoch); useful for "how stale is this start?". */
  resolvedAt: number;
  /** Evidence state of the anchor itself: always registry-validated today. */
  evidence: "registry";
}

export type AnchorFailureCode = "malformed" | "unknown_mall" | "unknown_anchor" | "not_a_start" | "unsupported";

export type AnchorResolution =
  | { status: "ok"; anchor: TrustedAnchor }
  | { status: "failed"; code: AnchorFailureCode; mallId: string | null; reason: string };

export interface AnchorProvider<Input> {
  source: AnchorSource;
  resolve(input: Input, now?: number): AnchorResolution;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export const ANCHOR_REASONS = {
  malformed: "That code isn’t a MallMind location code.",
  noMall: "The link did not say which mall you are in.",
  unknownMall: "This link is for a mall MallMind does not have a map for yet.",
  notAStart: "That starting point is not on this mall's map. Please choose where you are.",
  unsupported: "That way of finding your position isn’t available yet. Please choose where you are.",
} as const;

/**
 * THE trust gate. Pure: (mallId, anchorId, source) → trusted anchor or a coded, human-readable
 * failure. Unknown mall, unknown node, node of another mall, or a node that is not a start all
 * fail safely.
 */
export function validateAnchor(mallId: string, anchorId: string, source: AnchorSource, now: number = Date.now()): AnchorResolution {
  const mall = mallId.trim();
  const id = anchorId.trim();
  if (!mall) return { status: "failed", code: "malformed", mallId: null, reason: ANCHOR_REASONS.noMall };
  const graph = ID_PATTERN.test(mall) ? getWayfindingMall(mall) : null;
  if (!graph) return { status: "failed", code: "unknown_mall", mallId: null, reason: ANCHOR_REASONS.unknownMall };
  if (!id || !ID_PATTERN.test(id) || !graph.nodes.some((n) => n.id === id)) {
    return { status: "failed", code: "unknown_anchor", mallId: mall, reason: ANCHOR_REASONS.notAStart };
  }
  const start = startOptions(graph).find((s) => s.id === id);
  if (!start) return { status: "failed", code: "not_a_start", mallId: mall, reason: ANCHOR_REASONS.notAStart };
  return { status: "ok", anchor: { mallId: mall, anchorId: id, label: start.label, source, resolvedAt: now, evidence: "registry" } };
}

/** The visitor chose a start point in the UI. */
export const manualAnchorProvider: AnchorProvider<{ mallId: string; anchorId: string }> = {
  source: "manual",
  resolve: ({ mallId, anchorId }, now) => validateAnchor(mallId, anchorId, "manual", now),
};

const DEEP_LINK_PATHS = new Set(["/navigate", "/pilot"]);

/**
 * Extract the query string from scanned QR text. Accepts ONLY a MallMind deep link: an absolute
 * http(s) URL or a site-relative path whose pathname is /navigate or /pilot. Anything else
 * (other schemes, other paths, free text) is malformed — never a redirect target.
 */
export function deepLinkSearchFromQrText(text: string): string | null {
  const raw = text.trim();
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = raw.startsWith("/") ? new URL(raw, "https://mallmind.invalid") : new URL(raw);
  } catch {
    return null;
  }
  if (!raw.startsWith("/") && url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!DEEP_LINK_PATHS.has(url.pathname.replace(/\/+$/, "") || "/")) return null;
  return url.search;
}

/**
 * The visitor scanned a MallMind QR code. Input is the raw scanned text; the payload must be a
 * MallMind deep link carrying `mall` and `start`. The resolved anchor is `qr`-sourced.
 */
export const qrAnchorProvider: AnchorProvider<string> = {
  source: "qr",
  resolve: (text, now) => {
    const search = deepLinkSearchFromQrText(text);
    if (search === null) return { status: "failed", code: "malformed", mallId: null, reason: ANCHOR_REASONS.malformed };
    const params = new URLSearchParams(search);
    return validateAnchor(params.get("mall") ?? "", params.get("start") ?? "", "qr", now);
  },
};

/** Provider lookup by source; null for reserved sources so callers must handle "not built". */
export function anchorProviderFor(source: AnchorSource): AnchorProvider<never> | null {
  if (source === "manual") return manualAnchorProvider as AnchorProvider<never>;
  if (source === "qr") return qrAnchorProvider as AnchorProvider<never>;
  return null;
}

/** The route/session consume the lighter `PilotAnchor`; only `nodeId` drives routing. */
export function toPilotAnchor(a: TrustedAnchor): PilotAnchor {
  return { nodeId: a.anchorId, label: a.label, source: a.source };
}
