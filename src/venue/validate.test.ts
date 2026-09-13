import { describe, it, expect } from "vitest";
import { validateVenuePack, formatVenueIssues } from "./validate";
import { loadVenuePack } from "./load";
import fixture from "./fixtures/test-mall-alpha.venue.json";
import mallReds from "./packs/mallreds-pilot.venue.json";
import menlyn from "./packs/menlyn-park.venue.json";
import gardenRoute from "./packs/garden-route-mall.venue.json";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Pack = typeof fixture;

function errorsOf(pack: unknown): string[] {
  const v = validateVenuePack(pack);
  return v.status === "ok" ? [] : v.errors.map((e) => `${e.path}: ${e.message}`);
}
function expectIssue(pack: unknown, pathPart: string, messagePart: RegExp | string) {
  const v = validateVenuePack(pack);
  expect(v.status).toBe("failed");
  if (v.status === "ok") return;
  const hit = v.errors.find((e) => e.path.includes(pathPart) && (typeof messagePart === "string" ? e.message.includes(messagePart) : messagePart.test(e.message)));
  expect(hit, `expected an issue at ${pathPart} matching ${messagePart}; got:\n${formatVenueIssues(v.errors)}`).toBeTruthy();
}

describe("Venue Pack validator — schema and version", () => {
  it("accepts the Test Mall Alpha fixture and every bundled production pack", () => {
    for (const p of [fixture, mallReds, menlyn, gardenRoute]) expect(errorsOf(p)).toEqual([]);
  });

  it("rejects non-objects and unsupported schema versions with one intelligible error (no guessing)", () => {
    expect(errorsOf(null)).toEqual(["$: a Venue Pack must be a JSON object"]);
    expect(errorsOf("x")).toEqual(["$: a Venue Pack must be a JSON object"]);
    const v2 = clone(fixture) as Record<string, unknown>; v2.schema_version = 2;
    expect(errorsOf(v2)).toEqual(["$.schema_version: unsupported schema_version 2; this build understands 1"]);
    const none = clone(fixture) as Record<string, unknown>; delete none.schema_version;
    expect(errorsOf(none)[0]).toMatch(/unsupported schema_version undefined/);
  });

  it("loadVenuePack throws listing every issue rather than repairing the pack", () => {
    const bad = clone(fixture); bad.graph.edges[0].from = "nope"; bad.destinations[0].arrival_node = "nope";
    expect(() => loadVenuePack(bad)).toThrow(/edges\[0\]\.from[\s\S]*destinations\[0\]\.arrival_node/);
  });
});

describe("Venue Pack validator — references and ids", () => {
  it("duplicate ids are reported where they occur (nodes, edges, destinations, anchors, amenities, floors)", () => {
    const p = clone(fixture);
    p.graph.nodes.push(clone(p.graph.nodes[0]));
    p.graph.edges.push(clone(p.graph.edges[0]));
    p.destinations.push(clone(p.destinations[0]));
    p.anchors.push(clone(p.anchors[0]));
    p.amenities.push(clone(p.amenities[0]));
    p.floors.push({ ...clone(p.floors[0]), order: 1 });
    expectIssue(p, "$.graph.nodes[9].id", /duplicate node id "alpha-entrance-north"/);
    expectIssue(p, "$.graph.edges[8].id", /duplicate edge id "e-north-a"/);
    expectIssue(p, "$.destinations[3].id", /duplicate destination id/);
    expectIssue(p, "$.anchors[3].id", /duplicate anchor id/);
    expectIssue(p, "$.amenities[2].id", /duplicate amenity id/);
    expectIssue(p, "$.floors[1].id", /duplicate floor id "UM"/);
  });

  it("an edge referencing an unknown node, or itself, is rejected", () => {
    const p = clone(fixture); p.graph.edges[1].to = "ghost";
    expectIssue(p, "$.graph.edges[1].to", /unknown node "ghost"/);
    const q = clone(fixture); q.graph.edges[1].to = q.graph.edges[1].from;
    expectIssue(q, "$.graph.edges[1]", /cannot connect a node to itself/);
  });

  it("a destination whose arrival node does not exist is rejected; so is a broken destination id", () => {
    const p = clone(fixture); p.destinations[1].arrival_node = "missing";
    expectIssue(p, "$.destinations[1].arrival_node", /unknown node "missing"/);
    const q = clone(fixture); (q.destinations[1] as { id: unknown }).id = "Bad Id!";
    expectIssue(q, "$.destinations[1].id", /must be an id matching/);
  });

  it("an anchor on an unknown node, a QR-eligible anchor that is not a start, and a pack with no start anchor are rejected", () => {
    const p = clone(fixture); p.anchors[0].node = "missing";
    expectIssue(p, "$.anchors[0].node", /unknown node "missing"/);
    const q = clone(fixture); q.anchors[2].qr_eligible = true;
    expectIssue(q, "$.anchors[2].qr_eligible", /must be start_permitted/);
    const r = clone(fixture); r.anchors.forEach((a) => { a.start_permitted = false; a.qr_eligible = false; }); delete (r.policies.start as { default_anchor?: string }).default_anchor;
    expectIssue(r, "$.anchors", /at least one anchor must be start_permitted/);
  });

  it("a node on an undeclared floor, a missing floor, or a floor-crossing edge without floor_change is rejected", () => {
    const p = clone(fixture); p.graph.nodes[0].floor = "G";
    expectIssue(p, "$.graph.nodes[0].floor", /undeclared floor "G"; declared: UM/);
    const q = clone(fixture); (q.graph.nodes[0] as { floor?: string }).floor = "";
    expectIssue(q, "$.graph.nodes[0].floor", /floor is required on every node \(no implicit ground floor\)/);
    const r = clone(fixture); r.floors.push({ id: "P1", label: "Parking 1", order: -1, aliases: [], plan_image: null }); r.graph.nodes[1].floor = "P1";
    expectIssue(r, "$.graph.edges[5].floor_change", /connects floors "UM" and "P1" so it must declare floor_change: true/);
  });

  it("the default start anchor must exist and be start_permitted; policy keys are closed", () => {
    const p = clone(fixture); p.policies.start.default_anchor = "alpha-atm-spot";
    expectIssue(p, "$.policies.start.default_anchor", /not start_permitted/);
    const q = clone(fixture); (q.policies as Record<string, unknown>).scripts = { onArrive: "alert(1)" };
    expectIssue(q, "$.policies", /unknown policy keys scripts/);
  });
});

describe("Venue Pack validator — metric truth and evidence vocabulary", () => {
  it('a "m" pack requires distance_m > 0 and measurement "measured" on every edge', () => {
    const p = clone(mallReds); delete (p.graph.edges[0] as { distance_m?: number }).distance_m;
    expectIssue(p, "$.graph.edges[0].distance_m", /required \(> 0\) on every edge of a "m" pack/);
    const q = clone(mallReds); q.graph.edges[0].evidence.measurement = "unmeasured";
    expectIssue(q, "$.graph.edges[0].evidence.measurement", /every edge must be "measured"/);
  });

  it('a "px" pack requires length_px and forbids metres on unmeasured edges (no px→m conversion)', () => {
    const p = clone(menlyn); delete (p.graph.edges[0] as { length_px?: number }).length_px;
    expectIssue(p, "$.graph.edges[0].length_px", /required \(> 0\) on every edge of a "px" pack/);
    const q = clone(menlyn); (q.graph.edges[0] as { distance_m?: number }).distance_m = 30;
    expectIssue(q, "$.graph.edges[0].distance_m", /cannot carry metres \(no px→m conversion without evidence\)/);
    const r = clone(fixture); delete (r.graph.edges[0] as { distance_m?: number }).distance_m; // measured but no metres
    expectIssue(r, "$.graph.edges[0].distance_m", /measurement is "measured" must carry distance_m/);
    const s = clone(fixture); (s.graph.edges[0] as { distance_m?: number }).distance_m = 0;
    expectIssue(s, "$.graph.edges[0].distance_m", /must be ≥/);
  });

  it("an unknown distance unit or evidence value is rejected with the allowed vocabulary", () => {
    const p = clone(fixture); (p.graph as { distance_unit: string }).distance_unit = "ft";
    expectIssue(p, "$.graph.distance_unit", /unknown value "ft"; expected one of m \| px/);
    const q = clone(fixture); (q.graph.nodes[0].evidence as { geometry: string }).geometry = "verified";
    expectIssue(q, "$.graph.nodes[0].evidence.geometry", /expected one of schematic \| source-backed \| field-verified/);
    const r = clone(fixture); (r.destinations[0].evidence as { arrival: string }).arrival = "door";
    expectIssue(r, "$.destinations[0].evidence.arrival", /unknown \| corridor_arrival \| verified_public_door/);
    const s = clone(fixture); (s.venue.evidence as { field_verification: string }).field_verification = "yes";
    expectIssue(s, "$.venue.evidence.field_verification", /not-started \| pending \| partial \| verified/);
  });

  it("evidence is never a single boolean: a pack that says verified: true is rejected as missing the evidence object", () => {
    const p = clone(fixture) as unknown as { venue: { evidence: unknown } };
    p.venue.evidence = true;
    expectIssue(p, "$.venue.evidence", /required object is missing/);
  });
});

describe("Venue Pack validator — directed instructions, plan images, and data trust", () => {
  it("a one-way edge cannot carry a reverse instruction; instruction keys are closed", () => {
    const p = clone(fixture); p.graph.edges[6].instructions = { forward: "x", reverse: "y" };
    expectIssue(p, "$.graph.edges[6].instructions.reverse", /one-way edge cannot carry a reverse instruction/);
    const q = clone(fixture); (q.graph.edges[0].instructions as Record<string, string>).template = "{{name}}";
    expectIssue(q, "$.graph.edges[0].instructions", /unknown keys template/);
  });

  it("text fields must be plain text: markup, control characters and template braces are rejected", () => {
    const p = clone(fixture); p.destinations[0].name = "<img src=x onerror=alert(1)>";
    expectIssue(p, "$.destinations[0].name", /plain text/);
    const q = clone(fixture); q.graph.edges[0].instructions!.forward = "Go to ${window.location}";
    expectIssue(q, "$.graph.edges[0].instructions.forward", /plain text/);
    const r = clone(fixture); r.venue.name = "Alpha";
    expectIssue(r, "$.venue.name", /plain text/);
  });

  it("a plan image must match the 1000:620 plane aspect; a node coordinate must stay within 0..100", () => {
    const p = clone(fixture); p.floors[0].plan_image = { url: "/plans/um.png", width_px: 1000, height_px: 1000, evidence: "source-backed" } as never;
    expectIssue(p, "$.floors[0].plan_image", /deviates more than 2%/);
    const ok = clone(fixture); ok.floors[0].plan_image = { url: "/plans/um.png", width_px: 2000, height_px: 1240, evidence: "source-backed" } as never;
    expect(errorsOf(ok)).toEqual([]);
    expect(loadVenuePack(ok).floorImages).toEqual({ UM: "/plans/um.png" });
    const q = clone(fixture); q.graph.nodes[0].x_percent = 120;
    expectIssue(q, "$.graph.nodes[0].x_percent", /must be ≤ 100/);
  });

  it("every issue carries a JSON path and a human message", () => {
    const p = clone(fixture) as unknown as Record<string, unknown>; delete p.floors; delete p.policies;
    const v = validateVenuePack(p);
    expect(v.status).toBe("failed");
    if (v.status === "failed") {
      expect(v.errors.every((e) => e.path.startsWith("$") && e.message.length > 8)).toBe(true);
      expect(v.errors.map((e) => e.path)).toContain("$.floors");
      expect(v.errors.map((e) => e.path)).toContain("$.policies");
    }
  });
});
