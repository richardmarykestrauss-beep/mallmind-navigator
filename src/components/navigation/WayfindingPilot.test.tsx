import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type React from "react";
import WayfindingPilot from "./WayfindingPilot";
import { anchorFromStart } from "./mallRedsPilotGraph";
import { getWayfindingMall, anchorFor } from "./mallDatasets";

afterEach(() => { cleanup(); localStorage.clear(); });

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
    expect(within(steps).getByText(/mapped arrival point for Clicks/)).toBeInTheDocument();
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

  it("Start navigation opens the focused step view; Previous/Next are the visitor's own taps", () => {
    render(<WayfindingPilot embedded />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Game"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    const nav = screen.getByTestId("pilot-navigation");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of");
    expect(screen.getByTestId("pilot-manual-note")).toHaveTextContent("does not track your movement");
    fireEvent.click(within(nav).getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of");
    fireEvent.click(within(nav).getByTestId("pilot-prev"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of");
    expect(screen.queryByText(/we detected/i)).toBeNull();
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

describe("WayfindingPilot — navigation session (scan → search → walk → re-anchor → arrive)", () => {
  const E4 = anchorFor(getWayfindingMall("garden-route-mall")!, "grm-entrance-4", "qr");

  function startTo(name: string, props: Partial<React.ComponentProps<typeof WayfindingPilot>> = {}) {
    const utils = render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={E4} {...props} />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText(name));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    return utils;
  }

  it("QR anchor lands on the finder labelled honestly; route_ready shows the evidence claim and a Start navigation control", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={E4} />);
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent(/Starting from Entrance 4\s*· from the QR code you scanned/);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Woolworths"));
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "route_ready");
    expect(screen.getByTestId("pilot-route-claim")).toHaveTextContent("Source-backed route");
    expect(screen.getByRole("button", { name: /start navigation/i })).toBeInTheDocument();
    expect(screen.getByTestId("pilot-anchor-source")).toHaveTextContent("from the QR code you scanned");
  });

  it("Start → step view → Next through every step → arrival wording respects evidence; no metres or minutes anywhere", () => {
    startTo("Woolworths");
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 3");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Floor Level 1");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent(/^Walk straight in from Entrance 4/);
    expect(screen.getByTestId("pilot-step-next")).toHaveTextContent("Then: Cross the main walkway");
    expect(screen.getByTestId("pilot-prev")).toBeDisabled();
    expect(screen.queryByTestId("pilot-step-distance")).toBeNull();
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of 3");
    expect(screen.getByTestId("pilot-next")).toHaveTextContent("I’m there");
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "arrived");
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached the mapped arrival point for Woolworths.");
    expect(screen.getByTestId("pilot-arrival-note")).toHaveTextContent("not at its door");
    expect(screen.queryByTestId("pilot-next")).toBeNull();
    expect(screen.getByTestId("pilot-new-destination")).toBeInTheDocument();
    const text = screen.getByTestId("pilot-navigation").textContent ?? "";
    expect(text).not.toMatch(/\d\s?m\b/i);
    expect(text).not.toMatch(/\d\s?min/i);
    expect(text).not.toMatch(/we detected|you have reached|you are here/i);
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("Source-backed route preview. Distance not yet measured. Your position is not tracked.");
  });

  it("Previous from arrival returns to the last leg; Restart returns to route_ready; New destination returns to the finder", () => {
    startTo("Woolworths");
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-prev"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of 3");
    fireEvent.click(screen.getByTestId("pilot-restart"));
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "route_ready");
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-new-destination"));
    expect(screen.getByTestId("pilot-finder")).toBeInTheDocument();
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 4");
  });

  it("Update my location (manual re-anchor) keeps the destination, recalculates and announces the update", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Clicks"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of");
    fireEvent.click(screen.getByTestId("pilot-reanchor"));
    const panel = screen.getByTestId("pilot-reanchor-panel");
    expect(panel).toHaveTextContent("Where are you now?");
    expect(within(panel).getByRole("button", { name: /Main Entrance/ })).toHaveAttribute("aria-current", "location");
    fireEvent.click(within(panel).getByRole("button", { name: /Entrance 2/ }));
    expect(screen.queryByTestId("pilot-reanchor-panel")).toBeNull();
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Entrance 2");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("Route updated — now starting from Entrance 2");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("Your steps start again from here");
  });

  it("a second QR / deep link arriving mid-route re-anchors in place: destination preserved, route recalculated", () => {
    const reds = getWayfindingMall("mallreds-pilot")!;
    const first = anchorFor(reds, "entrance-main", "qr");
    const { rerender } = render(<WayfindingPilot embedded mallId="mallreds-pilot" initialAnchor={first} />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Game"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    rerender(<WayfindingPilot embedded mallId="mallreds-pilot" initialAnchor={anchorFor(reds, "info-desk", "qr")} />);
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Game");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Information Desk");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("from the QR code you scanned");
  });

  it("deep-link RE-ENTRY on a fresh page load restores the remembered destination for the same mall only", () => {
    const grm = getWayfindingMall("garden-route-mall")!;
    startTo("Pick n Pay");
    fireEvent.click(screen.getByTestId("pilot-next"));
    cleanup(); // the phone camera opened the second QR → fresh page load
    render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={anchorFor(grm, "grm-entrance-4", "qr")} />);
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Pick n Pay");
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 9");
    cleanup();
    // a different mall's link never inherits it; a manual visit never restores it
    render(<WayfindingPilot embedded mallId="menlyn-park" initialAnchor={anchorFor(getWayfindingMall("menlyn-park")!, "menlyn-lf-entrance-13", "qr")} />);
    expect(screen.getByTestId("pilot-finder")).toBeInTheDocument();
    cleanup();
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    expect(screen.getByTestId("pilot-finder")).toBeInTheDocument();
  });

  it("unroutable destination shows an honest failure with a way out (change start); re-anchoring recovers", async () => {
    const engine = await import("./pilotRoute");
    const real = engine.pilotBuildRoute;
    const spy = vi.spyOn(engine, "pilotBuildRoute").mockImplementation((nodes, edges, start, dest) =>
      start === "entrance-2"
        ? { found: true, fallback: true, steps: [], metric: false, total_distance_meters: null, estimated_minutes: null, message: "Clicks isn’t connected to this map yet." }
        : real(nodes, edges, start, dest));
    try {
      render(<WayfindingPilot embedded mallId="mallreds-pilot" initialAnchor={anchorFromStart("entrance-2", "qr")} />);
      fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Clicks"));
      expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "unroutable");
      expect(screen.getByRole("alert")).toHaveTextContent("Clicks isn’t connected to this map yet.");
      expect(screen.getByRole("alert")).toHaveTextContent("Try another starting point");
      expect(screen.queryByTestId("pilot-start-navigation")).toBeNull();
      expect(screen.queryByTestId("pilot-steps")).toBeNull();
      fireEvent.change(screen.getByTestId("pilot-start-select"), { target: { value: "entrance-main" } });
      expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "route_ready");
      expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
    } finally {
      spy.mockRestore();
    }
  });

  it("measured Mall@Reds keeps metres in the step view; evidence claim is schematic", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Clicks"));
    expect(screen.getByTestId("pilot-route-claim")).toHaveTextContent("Schematic route preview");
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    expect(screen.getByTestId("pilot-step-distance")).toHaveTextContent(/About \d+ m for this step/);
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("Route preview — your position is not tracked.");
  });

  it("emits lightweight session events through the seam and survives a throwing sink", () => {
    const events: string[] = [];
    startTo("Woolworths", { onEvent: (e) => { events.push(e.name); if (e.name === "navigation_arrived") throw new Error("sink down"); } });
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-prev"));
    fireEvent.click(screen.getByTestId("pilot-reanchor"));
    fireEvent.click(within(screen.getByTestId("pilot-reanchor-panel")).getByRole("button", { name: /Entrance 4/ }));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(events).toEqual([
      "navigation_session_started", "navigation_step_advanced", "navigation_step_back", "navigation_reanchored",
      "navigation_step_advanced", "navigation_step_advanced", "navigation_arrived",
    ]);
    expect(screen.getByTestId("mallreds-pilot")).toHaveAttribute("data-session-status", "arrived");
  });
});
