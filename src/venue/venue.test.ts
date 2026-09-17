import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getVenuePack, listVenuePacks, registerVenuePack, unregisterVenuePack, bundledVenueIds, defaultVenueId } from "./registry";
import { searchDestinations, searchableDestinations, arrivalNodeFor } from "./search";
import { buildRoute } from "./route";
import { instructionFor, genericInstruction, floorLabelFor } from "./instructions";
import { routeEvidenceTier, routeClaim, arrivalWording, arrivalNote, truthCopy } from "./evidence";
import { loadVenuePack } from "./load";
import fixture from "./fixtures/test-mall-alpha.venue.json";
import type { VenuePack } from "./contract";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

beforeAll(() => { registerVenuePack(fixture); });
afterAll(() => { unregisterVenuePack("test-mall-alpha"); });

describe("registry", () => {
  it("bundled venues come from data in registry order; the default is the first bundled pack, not a code constant", () => {
    expect(bundledVenueIds()).toEqual(["mallreds-pilot", "menlyn-park", "garden-route-mall"]);
    expect(defaultVenueId()).toBe(bundledVenueIds()[0]);
    expect(listVenuePacks().map((v) => v.id)).toEqual([...bundledVenueIds(), "test-mall-alpha"]);
  });

  it("unknown venue ids fail safely and loading is cached", () => {
    expect(getVenuePack("nope")).toBeNull();
    expect(getVenuePack("../x")).toBeNull();
    expect(getVenuePack("menlyn-park")).toBe(getVenuePack("menlyn-park"));
  });

  it("registering an invalid pack is rejected with paths and nothing is registered; bundled packs cannot be removed", () => {
    const bad = clone(fixture); bad.venue.id = "broken-alpha"; bad.graph.edges[0].to = "ghost";
    expect(() => registerVenuePack(bad)).toThrow(/\$\.graph\.edges\[0\]\.to/);
    expect(getVenuePack("broken-alpha")).toBeNull();
    expect(() => registerVenuePack(fixture)).toThrow(/already registered/);
    expect(unregisterVenuePack("mallreds-pilot")).toBe(false);
  });
});

describe("destination search — venue-pack-driven, fully local", () => {
  const v = () => getVenuePack("test-mall-alpha")!;

  it("finds destinations by name, alias, unit and category words; amenities by name, alias and kind words", () => {
    expect(searchDestinations(v(), "").map((d) => d.id)).toEqual(["alpha-bookshop", "alpha-pharmacy", "alpha-cafe", "alpha-toilets-amenity"]);
    expect(searchDestinations(v(), "chemist").map((d) => d.id)).toEqual(["alpha-pharmacy"]);
    expect(searchDestinations(v(), "u12").map((d) => d.id)).toEqual(["alpha-bookshop"]);
    expect(searchDestinations(v(), "COFFEE").map((d) => d.id)).toEqual(["alpha-cafe"]);
    expect(searchDestinations(v(), "restroom").map((d) => d.id)).toEqual(["alpha-toilets-amenity"]);
    expect(searchDestinations(v(), "loo").map((d) => d.id)).toEqual(["alpha-toilets-amenity"]);
    expect(searchDestinations(v(), "zzz")).toEqual([]);
  });

  it("a non-routable amenity is never offered, and routing targets resolve to arrival nodes", () => {
    expect(searchDestinations(v(), "atm")).toEqual([]);
    expect(arrivalNodeFor(v(), "alpha-atm-amenity")).toBeNull();
    expect(arrivalNodeFor(v(), "alpha-toilets-amenity")).toBe("alpha-toilets");
    expect(arrivalNodeFor(v(), "alpha-bookshop")).toBe("alpha-arrival-bookshop");
    expect(arrivalNodeFor(v(), "nope")).toBeNull();
  });

  it("policies decide what is searchable (kinds filter, amenities toggle) without any code change", () => {
    const p = clone(fixture) as VenuePack; p.venue.id = "alpha-policy";
    p.policies.destinations = { searchable_kinds: ["store"], include_routable_amenities: false };
    const loaded = loadVenuePack(p);
    expect(searchableDestinations(loaded).map((d) => d.id)).toEqual(["alpha-bookshop", "alpha-pharmacy"]);
  });
});

describe("directional instructions", () => {
  const v = () => getVenuePack("test-mall-alpha")!;

  it("forward and reverse text are separate; the reverse of a leg never reuses the forward sentence", () => {
    const out = buildRoute(v(), "alpha-entrance-north", "alpha-bookshop");
    expect(out.steps[0].instruction).toBe("Walk straight in from the North Entrance to the first junction.");
    const back = buildRoute(v(), "alpha-arrival-bookshop", "alpha-entrance-north");
    // e-a-bookshop has no reverse text → generic from topology; e-north-a has explicit reverse text.
    expect(back.steps[0].instruction).toBe("Start at Bookshop.");
    expect(back.steps[1].instruction).toBe("Head back toward the North Entrance along the main aisle.");
    expect(back.steps.some((s) => s.instruction === "Turn right at the junction; the Bookshop is at the end of the side aisle.")).toBe(false);
  });

  it("generic fallback is topology-only (kinds + recorded names), never an invented landmark", () => {
    const r = buildRoute(v(), "alpha-entrance-east", "alpha-pharmacy");
    expect(r.steps.map((s) => s.instruction)).toEqual([
      "Start at East Entrance and head into the mall.",
      "Walk toward Pharmacy.",
      "You’ve reached the mapped arrival point for Pharmacy.",
    ]);
    const ctx = { from: v().nodeById.get("alpha-junction-a")!, to: v().nodeById.get("alpha-junction-b")!, edge: v().edges[2], forward: true, first: false, floorChange: false, policy: { generic_fallback: true, start_prefix: true } };
    expect(genericInstruction(ctx)).toBe("Continue along the walkway.");
    expect(instructionFor({ ...ctx, policy: { generic_fallback: false, start_prefix: true }, edge: { ...ctx.edge, instruction: null } })).toBe("Continue to the next point.");
  });

  it("a one-way edge is only walked in its direction", () => {
    expect(buildRoute(v(), "alpha-entrance-north", "alpha-toilets-amenity").found).toBe(true);
    const back = buildRoute(v(), "alpha-toilets", "alpha-cafe");
    expect(back.fallback).toBe(true); // toilets → cafe is against the one-way passage and there is no other path
  });

  it("floor labels come from the pack (no invented 'Ground Floor'); unknown ids are shown verbatim", () => {
    expect(floorLabelFor(v().floors, "UM")).toBe("Upper Mall");
    expect(floorLabelFor(v().floors, "Upper")).toBe("Upper Mall");
    expect(floorLabelFor(v().floors, "UM", "id")).toBe("UM");
    expect(floorLabelFor(v().floors, "G")).toBe("G");
    expect(floorLabelFor(v().floors, null)).toBe("");
  });
});

describe("metric truth — measured vs unmeasured legs in the same venue", () => {
  const v = () => getVenuePack("test-mall-alpha")!;

  it("a route over measured legs only is metric with exact metres; one unmeasured leg makes the whole route unscaled", () => {
    const measured = buildRoute(v(), "alpha-entrance-north", "alpha-bookshop");
    expect(measured.metric).toBe(true);
    expect(measured.total_distance_meters).toBe(39);
    expect(measured.estimated_minutes).toBe(1);
    expect(measured.steps.map((s) => s.cumulative_meters)).toEqual([24, 39, 39]);
    const mixed = buildRoute(v(), "alpha-entrance-north", "alpha-pharmacy");
    expect(mixed.metric).toBe(false);
    expect(mixed.total_distance_meters).toBeNull();
    expect(mixed.estimated_minutes).toBeNull();
    expect(mixed.steps.every((s) => s.distance_meters === null && s.cumulative_meters === null)).toBe(true);
    expect(v().metric).toBe(false); // the venue as a whole is unscaled
  });

  it('metrics policy "never" suppresses metric even for a fully measured graph', () => {
    const p = clone(fixture) as VenuePack; p.venue.id = "alpha-never"; p.policies.metrics.show = "never";
    expect(loadVenuePack(p).metric).toBe(false);
  });
});

describe("evidence model — provenance-aware truth, field verification as a data upgrade", () => {
  it("tiers and claims derive from the venue evidence; arrival wording from the destination's own arrival evidence", () => {
    const ev = (geometry: "schematic" | "source-backed" | "field-verified", fv: "not-started" | "pending" | "partial" | "verified") =>
      ({ geometry, measurement: "unmeasured" as const, field_verification: fv, accessibility: "unverified" as const });
    expect(routeEvidenceTier(ev("schematic", "not-started"))).toBe("schematic");
    expect(routeEvidenceTier(ev("source-backed", "pending"))).toBe("source-backed");
    expect(routeEvidenceTier(ev("source-backed", "partial"))).toBe("source-backed");
    expect(routeEvidenceTier(ev("source-backed", "verified"))).toBe("field-verified");
    expect(routeClaim(ev("field-verified", "verified"))).toBe("Verified route");
    expect(arrivalWording("Bookshop", "verified_public_door")).toBe("You’ve reached Bookshop.");
    expect(arrivalWording("Cafe", "unknown")).toBe("You’ve reached the mapped arrival point for Cafe.");
    expect(arrivalWording("Cafe", undefined)).toBe("You’ve reached the mapped arrival point for Cafe.");
    expect(arrivalNote({ name: "Cafe", evidence: { identity: "unverified", arrival: "unknown" } })).toMatch(/not at its entrance/);
  });

  it("upgrading a pack's evidence (the field-verification seam) changes the wording only — routes and steps are identical", () => {
    const before = loadVenuePack({ ...clone(fixture), venue: { ...clone(fixture.venue), id: "alpha-before" } });
    const upgraded = clone(fixture) as VenuePack;
    upgraded.venue.id = "alpha-after";
    upgraded.venue.evidence = { ...upgraded.venue.evidence, geometry: "field-verified", field_verification: "verified", accessibility: "verified" };
    upgraded.destinations[1].evidence = { identity: "field-verified", arrival: "verified_public_door" };
    const after = loadVenuePack(upgraded);
    const a = buildRoute(before, "alpha-entrance-east", "alpha-pharmacy");
    const b = buildRoute(after, "alpha-entrance-east", "alpha-pharmacy");
    expect(b.steps.map((s) => s.node_id)).toEqual(a.steps.map((s) => s.node_id));
    expect(b.steps.slice(0, -1).map((s) => s.instruction)).toEqual(a.steps.slice(0, -1).map((s) => s.instruction));
    expect(a.steps.at(-1)!.instruction).toBe("You’ve reached the mapped arrival point for Pharmacy.");
    expect(b.steps.at(-1)!.instruction).toBe("You’ve reached Pharmacy.");
    expect(routeClaim(before.evidence)).toBe("Mapped route");
    expect(routeClaim(after.evidence)).toBe("Verified route");
    expect(truthCopy(after.pack.venue, after.metric).details).toContain("The accessibility of this route was checked on site.");
    expect(truthCopy(before.pack.venue, before.metric).details).toContain("Route accessibility has not been checked. Not for emergency or evacuation use.");
  });

  it("truth copy for each tier never claims what the evidence lacks", () => {
    const reds = getVenuePack("mallreds-pilot")!;
    expect(truthCopy(reds.pack.venue, reds.metric).statusLine).toBe("Preview route · not yet walked on site");
    const grm = getVenuePack("garden-route-mall")!;
    const c = truthCopy(grm.pack.venue, grm.metric);
    expect(c.statusLine).toBe("Mapped route · not yet walked on site · distance not measured");
    expect(c.details.some((d) => d.startsWith("Not an official Garden Route Mall service."))).toBe(true);
    expect(c.details).toContain("Distances have not been measured yet, so no walking time is shown.");
    expect(c.details.join(" ")).not.toMatch(/source-backed|corridor_arrival|schematic|pilot/i);
  });
});

describe("performance sanity", () => {
  it("a 1,000-destination synthetic pack loads, indexes and searches in well under a second, and loading is done once", () => {
    const p = clone(fixture) as VenuePack;
    p.venue.id = "alpha-big";
    const N = 1000;
    for (let i = 0; i < N; i++) {
      p.graph.nodes.push({ id: `big-arrival-${i}`, name: `Arrival ${i}`, kind: "arrival", floor: "UM", x_percent: (i % 100), y_percent: Math.floor(i / 10) % 100, evidence: { geometry: "source-backed" } });
      p.graph.edges.push({ id: `big-e-${i}`, from: i % 2 ? "alpha-junction-a" : "alpha-junction-b", to: `big-arrival-${i}`, bidirectional: true, floor_change: false, length_px: 50 + (i % 40), evidence: { geometry: "source-backed", measurement: "unmeasured" } });
      p.destinations.push({ id: `big-dest-${i}`, name: `Store ${i}`, kind: "store", arrival_node: `big-arrival-${i}`, aliases: [`Alias ${i}`], evidence: { identity: "source-backed", arrival: "corridor_arrival" } });
    }
    const t0 = performance.now();
    const big = registerVenuePack(p);
    const tLoad = performance.now() - t0;
    const t1 = performance.now();
    for (let k = 0; k < 50; k++) searchDestinations(big, `store ${k * 7}`);
    const tSearch = (performance.now() - t1) / 50;
    const t2 = performance.now();
    const r = buildRoute(big, "alpha-entrance-north", "big-dest-999");
    const tRoute = performance.now() - t2;
    expect(r.found && !r.fallback).toBe(true);
    expect(searchableDestinations(big)).toHaveLength(N + 4);
    expect(getVenuePack("alpha-big")).toBe(big); // cached, no re-processing
    expect(tLoad).toBeLessThan(1000);
    expect(tSearch).toBeLessThan(50);
    expect(tRoute).toBeLessThan(1000);
    unregisterVenuePack("alpha-big");
  });
});
