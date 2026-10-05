/**
 * Operational overlay in the experience (Sprint 8): a DEMO / SIMULATED state is visibly labelled,
 * an unavailable destination is listed but never routed, closing the only start leaves an honest
 * "no starting point" state, and lifting the overlay restores the original route exactly.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import WayfindingPilot from "./WayfindingPilot";
import { DEMO_OVERLAYS } from "@/navigation/demoOverlays";
import { setVenueOverlay, clearVenueOverlay, clearAllOverlays } from "@/venue/overlayStore";

afterEach(() => { cleanup(); localStorage.clear(); clearAllOverlays(); });
const uiMode = () => screen.getByTestId("wayfinding-pilot").getAttribute("data-ui-mode");
const stepsText = () => within(screen.getByTestId("pilot-steps")).getAllByRole("listitem").map((li) => li.textContent);

describe("Garden Route Mall — simulated operational state", () => {
  it("applies a labelled DEMO closure to a live route, makes the destination honestly unavailable, and restores the exact route when lifted", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "Clicks" } });
    fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" });
    expect(uiMode()).toBe("overview");
    const original = stepsText();
    expect(screen.queryByTestId("pilot-overlay-banner")).toBeNull();

    act(() => setVenueOverlay(DEMO_OVERLAYS["grm-clicks-unavailable"]));
    const banner = screen.getByTestId("pilot-overlay-banner");
    expect(banner).toHaveAttribute("data-simulated", "true");
    expect(banner).toHaveTextContent("DEMO / SIMULATED operational state");
    expect(banner).toHaveTextContent("Not a real Garden Route Mall condition");
    expect(uiMode()).toBe("unroutable");
    expect(screen.getByTestId("pilot-unavailable")).toHaveTextContent("Clicks is temporarily unavailable.");
    expect(screen.queryByTestId("pilot-start-navigation")).toBeNull();

    act(() => clearVenueOverlay("garden-route-mall"));
    expect(screen.queryByTestId("pilot-overlay-banner")).toBeNull();
    expect(uiMode()).toBe("overview");
    expect(stepsText()).toEqual(original);
  });

  it("search still lists the unavailable store, marked, and the router is never asked for it", () => {
    setVenueOverlay(DEMO_OVERLAYS["grm-clicks-unavailable"]);
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "clicks" } });
    expect(screen.getByTestId("pilot-result-unavailable")).toHaveTextContent("Temporarily unavailable");
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByRole("button", { name: /Clicks/ }));
    expect(screen.getByTestId("wayfinding-pilot").getAttribute("data-session-status")).toBe("unroutable");
    expect(screen.queryByTestId("pilot-steps")).toBeNull();
  });

  it("closing the only start anchor gives an honest no-starting-point state instead of an invented start", () => {
    setVenueOverlay(DEMO_OVERLAYS["grm-entrance-4-unavailable"]);
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    expect(uiMode()).toBe("no-start");
    expect(screen.getByTestId("pilot-no-start")).toHaveTextContent("No MallMind starting point is available at Garden Route Mall right now.");
    expect(screen.getByTestId("pilot-overlay-banner")).toHaveAttribute("data-simulated", "true");
    expect(screen.queryByTestId("pilot-search")).toBeNull();
    act(() => clearVenueOverlay("garden-route-mall"));
    expect(uiMode()).toBe("search");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 4");
  });
});
