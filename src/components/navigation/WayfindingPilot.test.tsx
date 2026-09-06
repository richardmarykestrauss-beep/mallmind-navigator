import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import WayfindingPilot from "./WayfindingPilot";
import { anchorFromStart } from "./mallRedsPilotGraph";

afterEach(cleanup);

describe("WayfindingPilot — shopper wayfinding loop", () => {
  it("opens destination-first with search and every routable tenant/amenity", () => {
    render(<WayfindingPilot embedded />);
    expect(screen.getByLabelText("Where do you want to go?")).toBeInTheDocument();
    const list = screen.getByTestId("pilot-suggestions");
    for (const name of ["Clicks", "Game", "Dis-Chem", "Pick n Pay", "Woolworths", "Toilets", "Lifts", "Food Court"]) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    // default start is a manual anchor with a human label
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Starting from Main Entrance");
  });

  it("search-as-you-type filters, choosing a destination shows summary + steps + honest status line", () => {
    render(<WayfindingPilot embedded />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "cli" } });
    const list = screen.getByTestId("pilot-suggestions");
    expect(within(list).queryByText("Game")).toBeNull();
    fireEvent.click(within(list).getByText("Clicks"));

    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent("distance");
    const steps = screen.getByTestId("pilot-steps");
    expect(within(steps).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(within(steps).getByText(/arrived at Clicks/)).toBeInTheDocument();
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("position is not tracked");
    // no simulated position marker / walk controls exist anywhere in this experience
    expect(screen.queryByText(/Start walk/i)).toBeNull();
    expect(screen.queryByText(/Simulating/i)).toBeNull();
  });

  it("changing the start re-routes instantly (rerouting stand-in)", () => {
    render(<WayfindingPilot embedded />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Clicks"));
    const before = screen.getByTestId("pilot-summary").textContent;
    fireEvent.change(screen.getByTestId("pilot-start-select"), { target: { value: "info-desk" } });
    expect(screen.getByTestId("pilot-summary").textContent).not.toBe(before);
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")[0]).toHaveTextContent("Information Desk");
  });

  it("a URL/QR anchor preselects the start in the SAME model and is labelled honestly", () => {
    render(<WayfindingPilot embedded initialAnchor={anchorFromStart("entrance-2", "url")} />);
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 2");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("from your link");
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Game"));
    expect((screen.getByTestId("pilot-start-select") as HTMLSelectElement).value).toBe("entrance-2");
    expect(screen.getByTestId("pilot-anchor-source")).toHaveTextContent("from your link");
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")[0]).toHaveTextContent("Entrance 2");
    // manual selection still overrides a link anchor
    fireEvent.change(screen.getByTestId("pilot-start-select"), { target: { value: "entrance-main" } });
    expect(screen.queryByTestId("pilot-anchor-source")).toBeNull();
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")[0]).toHaveTextContent("Main Entrance");
  });

  it("an invalid link anchor shows a notice and falls back to manual start (no fabricated position)", () => {
    render(<WayfindingPilot embedded anchorNotice="That starting point is not on the map. Please choose where you are." />);
    expect(screen.getByTestId("pilot-anchor-notice")).toHaveTextContent("not on the map");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Main Entrance");
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Toilets"));
    expect(screen.getByTestId("pilot-summary")).toBeInTheDocument();
  });

  it("step-by-step mode walks the instruction list with Previous/Next", () => {
    render(<WayfindingPilot embedded />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Game"));
    fireEvent.click(screen.getByTestId("pilot-stepmode-toggle"));
    const mode = screen.getByTestId("pilot-stepmode");
    expect(mode).toHaveTextContent("Step 1 of");
    fireEvent.click(within(mode).getByText("Next"));
    expect(mode).toHaveTextContent("Step 2 of");
    fireEvent.click(within(mode).getByText("Previous"));
    expect(mode).toHaveTextContent("Step 1 of");
  });

  it("no-result state and the optional assistant escape hatch", () => {
    const open = vi.fn();
    render(<WayfindingPilot embedded onOpenAssistant={open} />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "lacoste" } });
    expect(screen.getByTestId("pilot-no-result")).toHaveTextContent("No match");
    fireEvent.click(screen.getByText(/Ask the assistant/));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("standalone mount renders its own header; embedded mount does not", () => {
    render(<WayfindingPilot />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Wayfinding");
    cleanup();
    render(<WayfindingPilot embedded />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("WayfindingPilot — unscaled source-backed dataset (Menlyn Park)", () => {
  it("routes Entrance 13 → Clicks with topology only: NO metres, NO minutes, honest status", () => {
    render(<WayfindingPilot embedded mallId="menlyn-park" />);
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-mall-id", "menlyn-park");
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-metric", "false");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 13");
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Clicks"));
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
    expect(screen.queryByTestId("pilot-summary")).toBeNull();
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent(/2\s*legs/);
    expect(screen.getByTestId("pilot-distance-unmeasured")).toHaveTextContent("Distance not yet measured");
    const view = screen.getByTestId("pilot-route-view").textContent ?? "";
    // no digit followed by "m"/"min" anywhere in the route view (no word-boundary trick: tiles concatenate)
    expect(view).not.toMatch(/\d\s?m/i);
    expect(view).not.toMatch(/verified route|official MallMind map/i);
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("Source-backed route preview. Distance not yet measured.");
    const steps = within(screen.getByTestId("pilot-steps")).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveTextContent("Clicks is on your right");
    expect(screen.getByTestId("pilot-disclaimer")).toHaveTextContent("not yet walked on site");
    expect(screen.getByTestId("pilot-disclaimer")).toHaveTextContent("Not an official Menlyn Park deployment");
  });

  it("the metric Mall@Reds pilot still shows metres and minutes", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Clicks"));
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/\d+ m/);
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/\d+ min/);
    expect(screen.queryByTestId("pilot-summary-unscaled")).toBeNull();
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-metric", "true");
  });

  it("an unknown mall id renders a safe 'no map' notice, never a fabricated map", () => {
    render(<WayfindingPilot embedded mallId="sandton-city" />);
    expect(screen.getByTestId("pilot-no-map")).toBeInTheDocument();
    expect(screen.queryByTestId("pilot-finder")).toBeNull();
  });
});

describe("WayfindingPilot — Garden Route Mall (source-backed, unscaled, awaiting field verification)", () => {
  it("Entrance 4 → Pick n Pay renders topology only with the Garden Route status wording", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-mall-id", "garden-route-mall");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 4");
    const list = screen.getByTestId("pilot-suggestions");
    for (const name of ["Woolworths", "Clicks", "Pick n Pay"]) expect(within(list).getByText(name)).toBeInTheDocument();
    fireEvent.click(within(list).getByText("Pick n Pay"));
    expect(screen.queryByTestId("pilot-summary")).toBeNull();
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent(/8\s*legs/);
    expect(screen.getByTestId("pilot-distance-unmeasured")).toHaveTextContent("Distance not yet measured");
    const view = screen.getByTestId("pilot-route-view").textContent ?? "";
    expect(view).not.toMatch(/\d\s?m/i);
    expect(view).not.toMatch(/verified route|official MallMind map/i);
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("Source-backed route preview. Distance not yet measured. Your position is not tracked.");
    expect(screen.getByTestId("pilot-disclaimer")).toHaveTextContent("Not an official Garden Route Mall deployment");
    expect(screen.getByTestId("pilot-disclaimer")).toHaveTextContent("not yet walked on site");
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")).toHaveLength(9);
  });

  it("Entrance 4 → Woolworths is the short route", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Woolworths"));
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent(/2\s*legs/);
  });
});
