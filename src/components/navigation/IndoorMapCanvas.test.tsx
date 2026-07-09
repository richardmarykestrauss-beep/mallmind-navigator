import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import IndoorMapCanvas, { type IndoorMapModel } from "./IndoorMapCanvas";
import type { RouteStep } from "@/context/ShoppingSessionContext";

afterEach(cleanup);

function step(partial: Partial<RouteStep> & { node_id: string; step: number }): RouteStep {
  return {
    step: partial.step,
    instruction: partial.instruction ?? `Step ${partial.step}`,
    node_id: partial.node_id,
    node_name: partial.node_name ?? partial.node_id,
    floor: partial.floor ?? "G",
    distance_meters: partial.distance_meters ?? 20,
    floor_change: partial.floor_change ?? false,
    cumulative_meters: partial.cumulative_meters ?? 20,
    x_coordinate: partial.x_coordinate ?? 50,
    y_coordinate: partial.y_coordinate ?? 50,
  };
}

const ROUTE: RouteStep[] = [
  step({ node_id: "n1", step: 1, instruction: "Start at the entrance", x_coordinate: 10, y_coordinate: 50 }),
  step({ node_id: "n2", step: 2, instruction: "Walk to Woolworths", x_coordinate: 55, y_coordinate: 40 }),
  step({ node_id: "n3", step: 3, instruction: "Arrive at iStore", node_name: "iStore", x_coordinate: 85, y_coordinate: 30 }),
];

const MODEL: IndoorMapModel = {
  nodes: [
    { id: "n1", name: "Entrance", type: "entrance", floor: "G", x_coordinate: 10, y_coordinate: 50 },
    { id: "n2", name: "Woolworths", type: "shop", floor: "G", x_coordinate: 55, y_coordinate: 40 },
    { id: "n3", name: "iStore", type: "shop", floor: "G", x_coordinate: 85, y_coordinate: 30 },
  ],
  edges: [
    { id: "e1", from_node_id: "n1", to_node_id: "n2" },
    { id: "e2", from_node_id: "n2", to_node_id: "n3" },
  ],
  counts: { all_nodes: 3, all_edges: 2 },
  floorplan: null,
};

describe("IndoorMapCanvas", () => {
  it("falls back to a premium schematic route preview when the floorplan/model is missing", () => {
    const { container } = render(
      <IndoorMapCanvas
        mapModel={null}
        activeFloor="G"
        activeRouteSteps={ROUTE}
        completedStepIndices={new Set()}
        currentStepIndex={0}
      />,
    );

    // A real SVG schematic is rendered (not the empty-state text, not a broken box).
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toMatch(/schematic route preview/i);

    // Route path + destination pin are present, and the honesty caption is shown.
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(container.textContent).toMatch(/not live GPS/i);
    expect(container.textContent).toMatch(/iStore/); // destination store labelled
  });

  it("renders the empty state (no broken canvas) when there is neither model nor route", () => {
    const { container } = render(
      <IndoorMapCanvas mapModel={null} activeFloor="G" activeRouteSteps={[]} completedStepIndices={new Set()} currentStepIndex={0} />,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toMatch(/no map data/i);
  });

  it("renders the full map (with honesty caption) when a backend model is present", () => {
    const { container } = render(
      <IndoorMapCanvas
        mapModel={MODEL}
        activeFloor="G"
        activeRouteSteps={ROUTE}
        completedStepIndices={new Set()}
        currentStepIndex={0}
        simulatedPosition={{ x: 30, y: 45 }}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toMatch(/indoor mall map/i);
    // Honesty is preserved on the full canvas too.
    expect(container.textContent).toMatch(/not live GPS/i);
  });
});
