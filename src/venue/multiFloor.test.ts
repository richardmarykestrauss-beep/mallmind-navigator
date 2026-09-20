/**
 * Multi-floor foundation (Sprint 7): connectors expand into direction-aware edges, closed
 * connectors vanish, routing COST is separate from displayed DISTANCE, preferences exclude rather
 * than penalise, metrics never fabricate connector distance or time, and steps carry connector
 * context. All on the synthetic Two Level Test Centre — no real venue has multi-floor data.
 */
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/two-level-test-centre.venue.json";
import { validateVenuePack, formatVenueIssues } from "./validate";
import { loadVenuePack, expandConnectors } from "./load";
import { buildRoute, DEFAULT_CONNECTOR_COST } from "./route";
import type { VenuePack } from "./contract";

const pack = fixture as unknown as VenuePack;
const clone = (): VenuePack => JSON.parse(JSON.stringify(pack));
const v = loadVenuePack(pack);
const stepsOf = (r: ReturnType<typeof buildRoute>) => r.steps.map((s) => s.node_id);
const viaOf = (r: ReturnType<typeof buildRoute>) => r.steps.filter((s) => s.via).map((s) => s.via!);
const errs = (p: unknown) => { const r = validateVenuePack(p); return r.status === "failed" ? formatVenueIssues(r.errors) : ""; };

describe("connector expansion", () => {
  it("expands each open connector into direction-aware edges with no horizontal length; closed connectors expand to nothing", () => {
    const edges = expandConnectors(pack);
    const byConn = (id: string) => edges.filter((e) => e.connector_id === id);
    expect(byConn("tl-lift")).toMatchObject([{ from_node_id: "tl-l-lift", to_node_id: "tl-u-lift", bidirectional: true, vertical_kind: "lift", floor_change: true, weight: null, distance_meters: null, traversal_seconds: 40, step_free: "unknown" }]);
    expect(byConn("tl-stairs")).toMatchObject([{ from_node_id: "tl-l-stairs", to_node_id: "tl-u-stairs", bidirectional: true, step_free: "field_verified_no", traversal_seconds: null }]);
    expect(byConn("tl-esc-up")).toMatchObject([{ from_node_id: "tl-l-esc-up", to_node_id: "tl-u-esc-up", bidirectional: false }]);
    expect(byConn("tl-esc-down")).toMatchObject([{ from_node_id: "tl-u-esc-down", to_node_id: "tl-l-esc-down", bidirectional: false }]);
    expect(byConn("tl-service-lift")).toEqual([]);
    expect(v.edges.filter((e) => e.floor_change)).toHaveLength(4);
    expect(v.connectorById.get("tl-service-lift")?.availability).toBe("closed");
  });

  it("a three-floor lift needs one declaration, not three hand-written pairs, and is deterministic regardless of landing order", () => {
    const p = clone();
    p.floors.push({ id: "TM", label: "Top Mall", order: 2, plan_image: null });
    p.graph.nodes.push({ id: "tl-t-lift", name: "Main lift (top)", kind: "vertical", floor: "TM", x_percent: 45, y_percent: 32, evidence: { geometry: "source-backed" } });
    const lift = p.connectors!.find((k) => k.id === "tl-lift")!;
    lift.landings = [{ floor: "TM", node: "tl-t-lift" }, { floor: "LM", node: "tl-l-lift" }, { floor: "UM", node: "tl-u-lift" }];
    const a = expandConnectors(p).filter((e) => e.connector_id === "tl-lift").map((e) => e.id);
    lift.landings.reverse();
    const b = expandConnectors(p).filter((e) => e.connector_id === "tl-lift").map((e) => e.id);
    expect(a).toEqual(["tl-lift__tl-l-lift__tl-u-lift", "tl-lift__tl-l-lift__tl-t-lift", "tl-lift__tl-u-lift__tl-t-lift"]);
    expect(b).toEqual(a);
    expect(errs(p)).toBe("");
  });
});

describe("routing across floors", () => {
  it("Entrance → Upper Bookshop routes through a connector; the step carries connector context; distance is horizontal only", () => {
    const r = buildRoute(v, "tl-entrance", "tl-bookshop");
    expect(r.found && !r.fallback).toBe(true);
    // default policy: escalator (20) beats stairs (25) and lift (30): j1 → lift → up escalator → upper junction
    expect(stepsOf(r)).toEqual(["tl-l-j1", "tl-l-lift", "tl-l-esc-up", "tl-u-esc-up", "tl-u-j1", "tl-u-bookshop-arrival", "tl-u-bookshop-arrival"]);
    expect(viaOf(r)).toEqual([{ connector_id: "tl-esc-up", kind: "escalator", from_floor: "LM", to_floor: "UM", traversal_seconds: null }]);
    const ride = r.steps.find((s) => s.via)!;
    expect(ride.instruction).toBe("Take the escalator up to Upper Mall.");
    expect(ride.distance_meters).toBeNull();          // a connector never carries walking metres
    expect(ride.floor).toBe("UM");
    expect(r.metric).toBe(true);
    expect(r.total_distance_meters).toBe(80);         // 20 + 15 + 15 + 15 + 15, nothing for the ride
    expect(r.connector_count).toBe(1);
    expect(r.unmeasured_connectors).toBe(1);
    expect(r.estimated_minutes).toBeNull();           // escalator time not measured → no minutes invented
  });

  it("the closed service lift is never routed even though it would be the shortest path", () => {
    const r = buildRoute(v, "tl-entrance", "tl-bookshop");
    expect(stepsOf(r)).not.toContain("tl-l-svc");
    const p = clone();
    p.connectors!.find((k) => k.id === "tl-service-lift")!.availability = "open";
    const open = buildRoute(loadVenuePack(p), "tl-entrance", "tl-bookshop");
    expect(stepsOf(open)).toContain("tl-l-svc");
    expect(open.total_distance_meters).toBe(37);
  });

  it("an up-only escalator is used going up and never going down; the down escalator the other way; stairs both ways", () => {
    const down = buildRoute(v, "tl-u-j1", "tl-cafe");
    expect(stepsOf(down)).toEqual(["tl-u-esc-down", "tl-l-esc-down", "tl-l-j2", "tl-l-cafe-arrival", "tl-l-cafe-arrival"]);
    expect(viaOf(down)[0]).toMatchObject({ connector_id: "tl-esc-down", kind: "escalator", from_floor: "UM", to_floor: "LM" });
    expect(down.steps.find((s) => s.via)!.instruction).toBe("Take the escalator down to Lower Mall.");
    expect(stepsOf(down)).not.toContain("tl-u-esc-up");
    const noEsc = clone();
    noEsc.connectors = noEsc.connectors!.filter((k) => k.kind !== "escalator");
    const g = loadVenuePack(noEsc);
    expect(viaOf(buildRoute(g, "tl-u-j1", "tl-cafe"))[0]).toMatchObject({ connector_id: "tl-stairs", from_floor: "UM", to_floor: "LM" });
    expect(viaOf(buildRoute(g, "tl-entrance", "tl-bookshop"))[0]).toMatchObject({ connector_id: "tl-stairs", from_floor: "LM", to_floor: "UM" });
  });

  it("routing COST chooses the path by policy while displayed DISTANCE stays physical", () => {
    const cheapStairs = clone();
    cheapStairs.policies.routing = { connector_cost: { stairs: 1, escalator: 500, lift: 500 } };
    const s = buildRoute(loadVenuePack(cheapStairs), "tl-entrance", "tl-bookshop");
    expect(viaOf(s)[0].connector_id).toBe("tl-stairs");
    expect(s.total_distance_meters).toBe(80);
    const cheapLift = clone();
    cheapLift.policies.routing = { connector_cost: { lift: 1, escalator: 500, stairs: 500 } };
    const l = buildRoute(loadVenuePack(cheapLift), "tl-entrance", "tl-bookshop");
    expect(viaOf(l)[0].connector_id).toBe("tl-lift");
    expect(l.total_distance_meters).toBe(95);         // longer walk, chosen by cost; 95 is metres walked, not cost
    expect(l.estimated_minutes).toBe(Math.max(1, Math.round(95 / 72 + 40 / 60))); // measured ride time contributes
    expect(l.unmeasured_connectors).toBe(0);
    expect(DEFAULT_CONNECTOR_COST.m.lift).toBeGreaterThan(0);
  });

  it("step_free EXCLUDES stairs, escalators and field_verified_no connectors rather than penalising them; unknown lifts stay allowed", () => {
    const r = buildRoute(v, "tl-entrance", "tl-bookshop", { preference: "step_free" });
    expect(viaOf(r)[0].connector_id).toBe("tl-lift");
    const noLift = clone();
    noLift.connectors = noLift.connectors!.filter((k) => k.id !== "tl-lift");
    const blocked = buildRoute(loadVenuePack(noLift), "tl-entrance", "tl-bookshop", { preference: "step_free" });
    expect(blocked.fallback).toBe(true);              // no step-free path → unroutable, never "via the stairs anyway"
    const liftNo = clone();
    liftNo.connectors!.find((k) => k.id === "tl-lift")!.accessibility = { step_free: "field_verified_no" };
    expect(buildRoute(loadVenuePack(liftNo), "tl-entrance", "tl-bookshop", { preference: "step_free" }).fallback).toBe(true);
    const fewest = buildRoute(v, "tl-entrance", "tl-bookshop", { preference: "fewest_changes" });
    expect(fewest.connector_count).toBe(1);
  });

  it("existing single-floor packs are untouched by the cost model (no connectors → identical routes)", () => {
    expect(expandConnectors({ ...pack, connectors: undefined })).toEqual([]);
  });
});

describe("validator rules for connectors and vertical edges", () => {
  it("rejects unknown nodes, wrong floor/node pairs, duplicate floors, bad kinds/directions/availability, too few landings, fake distances and unmeasured ride times", () => {
    const bad = clone();
    bad.connectors!.push(
      { id: "k-unknown-node", kind: "lift", landings: [{ floor: "LM", node: "nope" }, { floor: "UM", node: "tl-u-lift" }], direction: "both", availability: "open", evidence: { geometry: "source-backed" } },
      { id: "k-wrong-floor", kind: "lift", landings: [{ floor: "UM", node: "tl-l-lift" }, { floor: "LM", node: "tl-u-lift" }], direction: "both", availability: "open", evidence: { geometry: "source-backed" } },
      { id: "k-dup-floor", kind: "stairs", landings: [{ floor: "LM", node: "tl-l-stairs" }, { floor: "LM", node: "tl-l-lift" }], direction: "both", availability: "open", evidence: { geometry: "source-backed" } },
      { id: "k-one-landing", kind: "ramp", landings: [{ floor: "LM", node: "tl-l-lift" }], direction: "both", availability: "open", evidence: { geometry: "source-backed" } },
      { id: "k-not-vertical", kind: "lift", landings: [{ floor: "LM", node: "tl-l-j1" }, { floor: "UM", node: "tl-u-lift" }], direction: "both", availability: "open", evidence: { geometry: "source-backed" } },
      { id: "k-time-no-evidence", kind: "lift", landings: [{ floor: "LM", node: "tl-l-lift" }, { floor: "UM", node: "tl-u-lift" }], direction: "both", availability: "open", evidence: { geometry: "source-backed" }, traversal_seconds: 30 },
      // @ts-expect-error unsupported vocabulary on purpose
      { id: "k-bad-vocab", kind: "travelator", landings: [{ floor: "LM", node: "tl-l-lift" }, { floor: "UM", node: "tl-u-lift" }], direction: "sideways", availability: "maybe", evidence: { geometry: "source-backed" }, accessibility: { step_free: "yes" } },
    );
    bad.graph.edges.push(
      { id: "e-fake-lift-metres", from: "tl-l-lift", to: "tl-u-lift", floor_change: true, vertical_kind: "lift", distance_m: 1, evidence: { geometry: "source-backed", measurement: "measured" } },
      { id: "e-no-kind", from: "tl-l-stairs", to: "tl-u-stairs", floor_change: true, evidence: { geometry: "source-backed", measurement: "unmeasured" } },
      { id: "e-missing-connector", from: "tl-l-stairs", to: "tl-u-stairs", floor_change: true, vertical_kind: "stairs", connector_id: "ghost", evidence: { geometry: "source-backed", measurement: "unmeasured" } },
    );
    const text = errs(bad);
    for (const m of ["unknown node \"nope\"", "is on floor \"LM\", not \"UM\"", "appears twice", "at least two landings", "must be of kind \"vertical\"", "no invented ride or wait times", "unknown value \"travelator\"", "unknown value \"sideways\"", "unknown value \"maybe\"", "unknown value \"yes\"", "metres here would be fabricated", "must say what carries the visitor", "connector_id \"ghost\""]) {
      expect(text, m).toContain(m);
    }
  });

  it("a hand-written vertical edge without any length is valid; the fixture itself is valid; old packs need no change", () => {
    const p = clone();
    p.connectors = [];
    p.graph.edges.push({ id: "e-hand-lift", from: "tl-l-lift", to: "tl-u-lift", floor_change: true, vertical_kind: "lift", evidence: { geometry: "source-backed", measurement: "unmeasured" } });
    expect(errs(p)).toBe("");
    expect(errs(pack)).toBe("");
    const legacy = clone();
    delete legacy.connectors;
    delete legacy.policies.routing;
    expect(errs(legacy)).toBe("");
  });
});
