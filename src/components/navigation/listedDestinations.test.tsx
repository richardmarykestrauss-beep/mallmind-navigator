/**
 * Listed-but-unmapped tenants (Sprint 8): the visitor can find a known store even when MallMind
 * has no verified route to it. The experience says so honestly; no route is attempted.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import WayfindingPilot from "./WayfindingPilot";

afterEach(() => { cleanup(); localStorage.clear(); });
const uiMode = () => screen.getByTestId("wayfinding-pilot").getAttribute("data-ui-mode");

describe("Garden Route Mall — identity known, route not yet mapped", () => {
  it("search shows Dis-Chem as listed, route not yet mapped; selecting it never builds a route", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "dis-chem" } });
    const list = screen.getByTestId("pilot-suggestions");
    expect(within(list).getByTestId("pilot-result-unmapped")).toHaveTextContent("Listed, route not yet mapped");
    fireEvent.click(within(list).getByRole("button", { name: /Dis-Chem/ }));
    expect(uiMode()).toBe("unroutable");
    expect(screen.getByTestId("pilot-not-mapped")).toHaveTextContent("Dis-Chem is listed at Garden Route Mall, but MallMind does not yet have a verified route to this store.");
    expect(screen.getByTestId("pilot-dest-unit")).toHaveTextContent("122/123");
    expect(screen.queryByTestId("pilot-steps")).toBeNull();
    expect(screen.queryByTestId("pilot-start-navigation")).toBeNull();
    // Visitor copy never exposes internal evidence vocabulary.
    expect(screen.getByTestId("wayfinding-pilot").textContent).not.toMatch(/corridor_arrival|source-backed|arrival_node|unknown evidence/i);
    fireEvent.click(screen.getByTestId("pilot-change-destination"));
    expect(uiMode()).toBe("search");
  });

  it("a category search finds routable and listed tenants; 'shampoo' is phrased as 'you may find'", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "pharmacy" } });
    const items = within(screen.getByTestId("pilot-suggestions")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/Clicks/); expect(items[1]).toMatch(/Dis-Chem.*Listed, route not yet mapped/);
    expect(screen.queryByTestId("pilot-category-hint")).toBeNull();
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "shampoo" } });
    expect(screen.getByTestId("pilot-category-hint")).toHaveTextContent("You may find shampoo at these places. MallMind doesn’t know stock or prices.");
    fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" }); // first result = Clicks (routable)
    expect(uiMode()).toBe("overview");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
  });

  it("the three mapped routes are untouched: Woolworths, Clicks and Pick n Pay still route from Entrance 4", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    for (const [name, steps] of [["Woolworths", 3], ["Clicks", 8], ["Pick n Pay", 9]] as const) {
      fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: name } });
      fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" });
      expect(uiMode()).toBe("overview");
      expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")).toHaveLength(steps);
      fireEvent.click(screen.getByTestId("pilot-change-destination"));
    }
  });
});
