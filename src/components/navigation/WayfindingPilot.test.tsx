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
