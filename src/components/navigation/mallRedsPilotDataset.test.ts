import { describe, it, expect } from "vitest";
import {
  loadPilotSpatialDataset, validatePilotDataset, type PilotSpatialDataset,
} from "./mallRedsPilotDataset";
import { attachFloorImages, toFloorplanModel } from "./floorplanModel";
import { pilotBuildRoute } from "./pilotRoute";
import {
  MALL_REDS_PILOT_NODES as NODES, MALL_REDS_PILOT_EDGES as EDGES,
  pilotStartOptions, pilotPointsOfInterest, pilotDatasetStatus,
} from "./mallRedsPilotGraph";

describe("Mall@Reds spatial dataset — parse + integrity", () => {
  const loaded = loadPilotSpatialDataset();

  it("1. dataset parses and loads into a derived graph", () => {
    expect(loaded.dataset.asset_id).toBe("mall-reds-pilot-v1");
    expect(loaded.nodes.length).toBeGreaterThan(0);
    expect(loaded.edges.length).toBeGreaterThan(0);
    expect(loaded.mallId).toBe("mallreds-pilot");
    expect(loaded.mallName).toBe("Mall@Reds");
  });

  it("2. all referenced nodes exist (edge endpoints resolve)", () => {
    const ids = new Set(loaded.nodes.map((n) => n.id));
    for (const e of loaded.edges) {
      expect(ids.has(e.from_node_id)).toBe(true);
      expect(ids.has(e.to_node_id)).toBe(true);
    }
  });

  it("3. every edge references two distinct, valid nodes with a positive distance", () => {
    for (const e of loaded.edges) {
      expect(e.from_node_id).not.toBe(e.to_node_id);
      expect(e.distance_meters ?? 0).toBeGreaterThan(0);
    }
    // validator is the authority and must not throw on the bundled dataset
    expect(() => validatePilotDataset(loaded.dataset)).not.toThrow();
  });

  it("4. tenant POIs link to a graph node (linked_shop_id resolves)", () => {
    const shops = loaded.dataset.nodes.filter((n) => n.type === "shop");
    expect(shops.length).toBeGreaterThanOrEqual(5);
    for (const s of shops) {
      expect(s.linked_shop_id).toBeTruthy();
      const routable = pilotBuildRoute(NODES, EDGES, "entrance-main", s.linked_shop_id!);
      expect(routable.found && !routable.fallback).toBe(true);
    }
  });

  it("5. entrance/start anchors link to real graph nodes", () => {
    const nodeIds = new Set(NODES.map((n) => n.id));
    for (const s of pilotStartOptions()) expect(nodeIds.has(s.id)).toBe(true);
    // the derived graph exposes at least the two entrances + the info desk as starts
    const labels = pilotStartOptions().map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(["Main Entrance", "Entrance 2", "Information Desk"]));
  });

  it("6. evidence status remains schematic / unverified (truth lives in the data)", () => {
    expect(loaded.datasetStatus).toBe("schematic");
    expect(loaded.evidenceStatus).toBe("unverified");
    expect(pilotDatasetStatus()).toEqual({ datasetStatus: "schematic", evidenceStatus: "unverified" });
    // NO spatial entity is marked source-backed / on-site-verified yet
    expect(loaded.dataset.nodes.every((n) => n.evidence === "schematic")).toBe(true);
    expect(loaded.dataset.edges.every((e) => e.evidence === "schematic")).toBe(true);
  });

  it("factual tenant identity (Clicks = Shop 45) does NOT upgrade its schematic coordinate", () => {
    const clicks = loaded.dataset.nodes.find((n) => n.node_id === "clicks")!;
    expect(clicks.tenant?.shop_number).toBe("45");
    expect(clicks.tenant?.identity_evidence).toBe("source-backed"); // identity is source-backed…
    expect(clicks.evidence).toBe("schematic");                      // …but the POSITION stays schematic
  });

  it("derived graph is byte-for-byte the same shape the pilot consumed before extraction", () => {
    expect(NODES.length).toBe(16);
    expect(EDGES.length).toBe(15);
    expect(pilotPointsOfInterest().length).toBe(9); // 5 tenants + 4 amenities (incl. Information Desk)
    const clicks = NODES.find((n) => n.id === "clicks")!;
    expect([clicks.x_coordinate, clicks.y_coordinate]).toEqual([35, 80]);
    const entry = EDGES.find((e) => e.id === "e-em-c1")!;
    expect(entry.distance_meters).toBe(22);
  });
});

describe("Mall@Reds spatial dataset — future real-map swap (structural proof)", () => {
  it("a source-backed dataset in the same shape routes through the SAME adapter + engine, unchanged", () => {
    // A hypothetical verified 3-node dataset — Main Entrance → corridor → Clicks — that a real
    // directory board / leasing plan would produce. It flows through the identical adapter and
    // router with NO code change to pilotRoute / MallRedsPilot / IndoorMapCanvas.
    const verified: PilotSpatialDataset = {
      asset_id: "mall-reds-verified-vX",
      dataset_version: "2.0.0",
      dataset_status: "on-site-verified",
      evidence_status: "on-site-verified",
      reality_label: "on-site-verified",
      source_policy: "surveyed on site",
      mall_id: "mallreds",
      mall_name: "Mall@Reds",
      coordinate_system: "percent-based MallMind node coordinates (0..100)",
      viewBox: "0 0 1000 620",
      evidence_levels: ["schematic", "source-backed", "on-site-verified"],
      floors: [{ id: "G", label: "Ground Floor" }],
      nodes: [
        { node_id: "entrance-main", name: "Main Entrance", type: "entrance", floor: "G", x_percent: 8, y_percent: 60, evidence: "on-site-verified" },
        { node_id: "c1", name: "Concourse", type: "corridor", floor: "G", x_percent: 30, y_percent: 55, evidence: "on-site-verified" },
        { node_id: "clicks", name: "Clicks", type: "shop", floor: "G", x_percent: 44, y_percent: 52, linked_shop_id: "clicks", evidence: "on-site-verified", tenant: { shop_number: "45", identity_evidence: "on-site-verified", identity_source: "directory board photo" } },
      ],
      edges: [
        { edge_id: "e1", from: "entrance-main", to: "c1", distance_meters: 18, floor_change: false, evidence: "on-site-verified" },
        { edge_id: "e2", from: "c1", to: "clicks", distance_meters: 11, floor_change: false, evidence: "on-site-verified" },
      ],
    };

    const loaded = loadPilotSpatialDataset(verified);
    expect(loaded.datasetStatus).toBe("on-site-verified");

    const route = pilotBuildRoute(loaded.nodes, loaded.edges, "entrance-main", "clicks");
    expect(route.found && !route.fallback).toBe(true);
    expect(route.total_distance_meters).toBe(29); // 18 + 11, straight from the verified data
    expect(route.steps[route.steps.length - 1].instruction).toContain("arrived at Clicks");
  });

  it("the validator rejects a structurally broken dataset (dangling edge)", () => {
    const broken = {
      ...loadPilotSpatialDataset().dataset,
      edges: [{ edge_id: "bad", from: "entrance-main", to: "does-not-exist", distance_meters: 10, floor_change: false, evidence: "schematic" as const }],
    };
    expect(() => validatePilotDataset(broken)).toThrow(/unknown to-node/);
  });
});

describe("Mall@Reds spatial dataset — plan_image contract (real-route readiness)", () => {
  const base = loadPilotSpatialDataset().dataset;
  const withImage = (img: Partial<NonNullable<PilotSpatialDataset["floors"][number]["plan_image"]>>): PilotSpatialDataset => ({
    ...base,
    floors: base.floors.map((f, i) => (i === 0 ? {
      ...f,
      plan_image: {
        url: "/plans/mallreds-ground.png", width_px: 2000, height_px: 1240,
        evidence: "source-backed", source: "test", licence: "test", ...img,
      },
    } : f)),
  });

  it("the schematic pilot declares NO plan image (nothing is drawn under the graph)", () => {
    expect(base.floors.every((f) => f.plan_image == null)).toBe(true);
    expect(loadPilotSpatialDataset().floorImages).toEqual({});
  });

  it("a floor with a plan image at the 1000:620 plane aspect loads and exposes the image by floor", () => {
    const loaded = loadPilotSpatialDataset(withImage({}));
    expect(loaded.floorImages).toEqual({ G: "/plans/mallreds-ground.png" });
    // graph derived exactly as before — the image is additive
    expect(loaded.nodes.length).toBe(base.nodes.length);
  });

  it("a plan image at the wrong aspect is rejected with an actionable error", () => {
    expect(() => loadPilotSpatialDataset(withImage({ width_px: 1000, height_px: 1000 })))
      .toThrow(/plane aspect/);
    expect(() => loadPilotSpatialDataset(withImage({ url: "" }))).toThrow(/url must be/);
    expect(() => loadPilotSpatialDataset(withImage({ width_px: 0 }))).toThrow(/positive integer/);
    expect(() => loadPilotSpatialDataset(withImage({ evidence: "surveyed-by-vibes" as never }))).toThrow(/unknown evidence/);
  });

  it("a node on an undeclared floor is rejected", () => {
    const bad: PilotSpatialDataset = { ...base, nodes: [...base.nodes, { ...base.nodes[0], node_id: "ghost", floor: "L9" }] };
    expect(() => validatePilotDataset(bad)).toThrow(/unknown floor "L9"/);
  });

  it("attachFloorImages puts the image on the matching floor of the rendered model (no renderer change)", () => {
    const loaded = loadPilotSpatialDataset(withImage({}));
    const model = attachFloorImages(
      toFloorplanModel({ nodes: loaded.nodes, edges: loaded.edges }, { mallId: loaded.mallId, mallName: loaded.mallName }),
      loaded.floorImages,
    );
    const ground = model.floors.find((f) => f.label === "Ground Floor")!;
    expect(ground.imageUrl).toBe("/plans/mallreds-ground.png");
    expect(ground.width).toBe(1000);
    expect(ground.height).toBe(620);
  });
});
