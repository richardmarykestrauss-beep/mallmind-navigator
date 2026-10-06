/**
 * Operational overlay (Sprint 8): temporary truth applied on top of a Venue Pack, never into it.
 * Activation windows, connector / edge / destination / anchor / amenity effects, and byte-for-byte
 * restoration when the overlay is removed. Rerouting is proven on the synthetic two-level venue.
 */
import { describe, it, expect } from "vitest";
import twoLevel from "./fixtures/two-level-test-centre.venue.json";
import alpha from "./fixtures/test-mall-alpha.venue.json";
import type { VenuePack } from "./contract";
import { loadVenuePack } from "./load";
import { buildRoute } from "./route";
import { applyOverlay, activeEntries, overlayReasonFor, type OperationalOverlay, type OverlayEntry } from "./overlay";
import { searchableDestinations } from "./search";
import { createOperationalLog, appendOperationalChange, overlayFromLog, currentState, OperationalLogError } from "./operationalLog";

const tl = loadVenuePack(twoLevel as unknown as VenuePack);
const al = loadVenuePack(alpha as unknown as VenuePack);
const actor = { id: "ops-1", kind: "operator" as const, display: "Centre operations" };
const entry = (venue_id: string, target_type: OverlayEntry["target_type"], target_id: string, extra: Partial<OverlayEntry> = {}): OverlayEntry =>
  ({ id: `${target_type}-${target_id}`, venue_id, target_type, target_id, state: "unavailable", reason: `${target_id} unavailable`, starts_at: null, expires_at: null, actor, created_at: "2026-10-05T08:00:00Z", ...extra });
const overlay = (venue_id: string, ...entries: OverlayEntry[]): OperationalOverlay => ({ venue_id, entries });
const path = (v: typeof tl, from: string, to: string) => { const r = buildRoute(v, from, to); return r.found ? r.steps.map((s) => s.node_id) : null; };

describe("activation", () => {
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  it("an entry is active only inside [starts_at, expires_at); malformed timestamps never activate", () => {
    const o = overlay("two-level-test-centre",
      entry("two-level-test-centre", "connector", "tl-esc-up", { id: "a", starts_at: "2026-10-05T10:00:00Z", expires_at: "2026-10-05T13:00:00Z" }),
      entry("two-level-test-centre", "connector", "tl-lift", { id: "b", starts_at: "2026-10-05T13:00:00Z", expires_at: null }),
      entry("two-level-test-centre", "connector", "tl-stairs", { id: "c", starts_at: null, expires_at: "2026-10-05T11:00:00Z" }),
      entry("two-level-test-centre", "connector", "tl-stairs", { id: "d", starts_at: "not a date", expires_at: null }),
    );
    expect(activeEntries(o, NOW).map((e) => e.id)).toEqual(["a"]);
    expect(activeEntries(o, Date.parse("2026-10-05T13:00:00Z")).map((e) => e.id)).toEqual(["b"]); // a expired exactly at 13:00, b starts
    expect(activeEntries(o, Date.parse("2026-10-05T10:30:00Z")).map((e) => e.id)).toEqual(["a", "c"]);
  });
  it("an overlay for another venue, or with no active entry, returns the SAME venue object", () => {
    expect(applyOverlay(tl, overlay("somewhere-else", entry("somewhere-else", "connector", "tl-lift")))).toBe(tl);
    expect(applyOverlay(tl, overlay("two-level-test-centre", entry("two-level-test-centre", "connector", "tl-lift", { expires_at: "2000-01-01T00:00:00Z" })))).toBe(tl);
    expect(applyOverlay(tl, null)).toBe(tl);
  });
});

describe("routing effects on the synthetic two-level venue", () => {
  const base = path(tl, "tl-entrance", "tl-bookshop")!;
  it("closing the up escalator reroutes via the stairs (next-cheapest policy cost); closing the stairs too uses the lift; closing all three is honestly unroutable", () => {
    expect(base).toContain("tl-l-esc-up");
    const noEsc = applyOverlay(tl, overlay("two-level-test-centre", entry("two-level-test-centre", "connector", "tl-esc-up")));
    expect(path(noEsc, "tl-entrance", "tl-bookshop")).toContain("tl-l-stairs");
    expect(noEsc.connectorById.get("tl-esc-up")?.availability).toBe("closed");
    const noEscNoStairs = applyOverlay(tl, overlay("two-level-test-centre", entry("two-level-test-centre", "connector", "tl-esc-up"), entry("two-level-test-centre", "connector", "tl-stairs")));
    expect(path(noEscNoStairs, "tl-entrance", "tl-bookshop")).toContain("tl-l-lift");
    const nothing = applyOverlay(tl, overlay("two-level-test-centre", entry("two-level-test-centre", "connector", "tl-esc-up"), entry("two-level-test-centre", "connector", "tl-lift"), entry("two-level-test-centre", "connector", "tl-stairs")));
    expect(nothing.edges.filter((e) => e.floor_change).map((e) => e.connector_id)).toEqual(["tl-esc-down"]); // only the down-only escalator remains (useless going up)
    const r = buildRoute(nothing, "tl-entrance", "tl-bookshop"); expect(r.fallback).toBe(true); expect(r.steps).toEqual([]); // honestly unroutable
  });
  it("closing a corridor edge removes it from the graph and the route goes around it", () => {
    const closed = applyOverlay(tl, overlay("two-level-test-centre", entry("two-level-test-centre", "edge", "tl-e-j1-lift")));
    expect(closed.overlay?.removedEdgeIds).toEqual(["tl-e-j1-lift"]);
    expect(closed.edges.some((e) => e.id === "tl-e-j1-lift")).toBe(false);
    expect(path(closed, "tl-entrance", "tl-bookshop")).not.toContain("tl-l-lift");
  });
  it("removing the overlay restores the original route byte for byte and leaves the pack untouched", () => {
    const before = JSON.stringify(buildRoute(tl, "tl-entrance", "tl-bookshop"));
    const closed = applyOverlay(tl, overlay("two-level-test-centre", entry("two-level-test-centre", "connector", "tl-esc-up")));
    expect(JSON.stringify(buildRoute(closed, "tl-entrance", "tl-bookshop"))).not.toBe(before);
    const restored = applyOverlay(tl, overlay("two-level-test-centre"));
    expect(restored).toBe(tl);
    expect(JSON.stringify(buildRoute(restored, "tl-entrance", "tl-bookshop"))).toBe(before);
    expect(tl.edges.length).toBe(loadVenuePack(twoLevel as unknown as VenuePack).edges.length);
    expect(tl.overlay).toBeUndefined();
    expect(JSON.stringify(tl.pack)).toBe(JSON.stringify(twoLevel));
  });
});

describe("destination, amenity and anchor effects (Test Mall Alpha)", () => {
  it("an unavailable destination stays searchable but is flagged; its route is still computable by the router (the session refuses it)", () => {
    const v = applyOverlay(al, overlay("test-mall-alpha", entry("test-mall-alpha", "destination", "alpha-pharmacy", { reason: "Closed for stocktake" })));
    const d = searchableDestinations(v).find((x) => x.id === "alpha-pharmacy")!;
    expect(d.unavailable).toBe(true); expect(d.routable).toBe(true);
    expect(searchableDestinations(al).find((x) => x.id === "alpha-pharmacy")!.unavailable).toBeUndefined(); // base untouched
    expect(overlayReasonFor(v, "destination", "alpha-pharmacy")).toBe("Closed for stocktake");
  });
  it("an unavailable amenity is flagged; an unavailable anchor is no longer a start; all starts unavailable → none", () => {
    const v = applyOverlay(al, overlay("test-mall-alpha", entry("test-mall-alpha", "amenity", "alpha-toilets-amenity"), entry("test-mall-alpha", "anchor", "alpha-north")));
    expect(searchableDestinations(v).find((x) => x.id === "alpha-toilets-amenity")!.unavailable).toBe(true);
    expect(v.startAnchors.map((a) => a.id)).toEqual(["alpha-east"]);
    const none = applyOverlay(al, overlay("test-mall-alpha", entry("test-mall-alpha", "anchor", "alpha-north"), entry("test-mall-alpha", "anchor", "alpha-east")));
    expect(none.startAnchors).toEqual([]);
  });
});

describe("operational log (append-only; separate from factory evidence)", () => {
  it("records actor, time, reason, previous and new state, expiry and supersession; refuses stale or duplicate writes", () => {
    let log = createOperationalLog("test-mall-alpha");
    log = appendOperationalChange(log, { id: "c1", venue_id: "test-mall-alpha", at: "2026-10-05T08:00:00Z", actor, reason: "Lift fault", target_type: "connector", target_id: "lift-a", new_state: "unavailable", expires_at: "2026-10-05T18:00:00Z" });
    expect(log.entries[0]).toMatchObject({ previous_state: "available", new_state: "unavailable", supersedes: null });
    expect(() => appendOperationalChange(log, { id: "c1", venue_id: "test-mall-alpha", at: "2026-10-05T09:00:00Z", actor, reason: "x", target_type: "connector", target_id: "lift-a", new_state: "available", expires_at: null })).toThrow(OperationalLogError);
    expect(() => appendOperationalChange(log, { id: "c2", venue_id: "test-mall-alpha", at: "2026-10-05T09:00:00Z", actor, reason: "x", target_type: "connector", target_id: "lift-a", new_state: "unavailable", expires_at: null })).toThrow(/already "unavailable"/);
    expect(() => appendOperationalChange(log, { id: "c3", venue_id: "test-mall-alpha", at: "2026-10-05T09:00:00Z", actor, reason: "x", target_type: "connector", target_id: "lift-a", previous_state: "available", new_state: "available", expires_at: null })).toThrow(/stale/);
    expect(() => appendOperationalChange(log, { id: "c4", venue_id: "other", at: "2026-10-05T09:00:00Z", actor, reason: "x", target_type: "connector", target_id: "lift-a", new_state: "available", expires_at: null })).toThrow(/venue/);
    expect(overlayFromLog(log).entries.map((e) => [e.target_id, e.reason, e.expires_at])).toEqual([["lift-a", "Lift fault", "2026-10-05T18:00:00Z"]]);
    log = appendOperationalChange(log, { id: "c5", venue_id: "test-mall-alpha", at: "2026-10-05T12:00:00Z", actor, reason: "Repaired", target_type: "connector", target_id: "lift-a", new_state: "available", expires_at: null });
    expect(log.entries[1]).toMatchObject({ previous_state: "unavailable", supersedes: "c1" });
    expect(currentState(log, "connector", "lift-a").state).toBe("available");
    expect(overlayFromLog(log).entries).toEqual([]);
    expect(log.entries).toHaveLength(2); // nothing deleted
  });
});
