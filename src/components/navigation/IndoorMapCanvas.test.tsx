import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import IndoorMapCanvas from "./IndoorMapCanvas";
import { buildRoutePolyline, type FloorplanModel } from "./floorplanModel";
import { MALL_REDS_GAME_FLOORPLAN, buildDemoRoutePolyline } from "./demoFloorplan";

afterEach(cleanup);

const ROUTE_STEPS = [
  { node_id: "n1", floor: "G", x_coordinate: 10, y_coordinate: 50 },
  { node_id: "n2", floor: "G", x_coordinate: 55, y_coordinate: 40 },
  { node_id: "n3", floor: "G", x_coordinate: 85, y_coordinate: 30 },
];

const WITH_IMAGE: FloorplanModel = {
  mallId: "m1",
  mallName: "Test Mall",
  floors: [{
    id: "Ground Floor", label: "Ground Floor", imageUrl: "data:image/svg+xml,<svg/>",
    width: 1000, height: 620,
    nodes: [{ id: "n1", name: "Entrance", floor: "Ground Floor", type: "entrance", position: { x: 100, y: 300 } }],
    edges: [], stores: [],
  }],
};

describe("IndoorMapCanvas (floorplan engine)", () => {
  it("renders an honest generated schematic when the floor has no image", () => {
    const { container } = render(
      <IndoorMapCanvas
        floorplan={MALL_REDS_GAME_FLOORPLAN}
        activeFloor="Ground Floor"
        routePolyline={buildDemoRoutePolyline()}
        completedStepIndices={new Set()}
        currentStepIndex={0}
        isDemo
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toMatch(/schematic floorplan generated from mallmind route graph/i);
    expect(container.textContent).toMatch(/Schematic floorplan generated from MallMind route graph/i);
    expect(container.querySelector("polyline")).not.toBeNull(); // route geometry drawn
    expect(container.textContent).toMatch(/Game/);              // destination store labelled
    expect(container.textContent).toMatch(/demo/i);             // clearly labelled demo
  });

  it("draws the floorplan image + honest 'not live GPS' caption when a floor image exists", () => {
    const { container } = render(
      <IndoorMapCanvas
        floorplan={WITH_IMAGE}
        activeFloor="Ground Floor"
        routePolyline={buildRoutePolyline(ROUTE_STEPS)}
        completedStepIndices={new Set()}
        currentStepIndex={0}
        simulatedPosition={{ x: 300, y: 250 }}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toMatch(/indoor mall map/i);
    expect(container.querySelector("image")).not.toBeNull();
    expect(container.textContent).toMatch(/not live GPS/i);
  });

  it("uses the active floor's real dimensions for the viewBox", () => {
    const { container } = render(
      <IndoorMapCanvas
        floorplan={WITH_IMAGE}
        activeFloor="Ground Floor"
        routePolyline={[]}
        completedStepIndices={new Set()}
        currentStepIndex={0}
      />,
    );
    // No route → full-floor viewBox of 1000×620.
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 1000 620");
  });
});
