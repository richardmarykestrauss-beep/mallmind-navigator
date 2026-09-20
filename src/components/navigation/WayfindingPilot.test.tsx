/**
 * WayfindingPilot — the visitor navigation experience (Sprint 6 product contract).
 * search → route overview → walking (manual Next / Previous) → arrival → next action,
 * plus recovery (Update my location), unroutable, unknown venue, session restore, browser back,
 * backend independence and the venue-agnostic guard.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type React from "react";
import WayfindingPilot from "./WayfindingPilot";
import { anchorFromStart } from "./mallRedsPilotGraph";
import { getWayfindingMall, anchorFor } from "./mallDatasets";
import { registerVenuePack, unregisterVenuePack } from "@/venue/registry";
import { SESSION_STORE_KEY } from "./navigationSessionStore";
import alpha from "@/venue/fixtures/test-mall-alpha.venue.json";

afterEach(() => { cleanup(); localStorage.clear(); });

const suggestion = (name: string) => within(screen.getByTestId("pilot-suggestions")).getByRole("button", { name: new RegExp(`^${name}`) });
const status = () => screen.getByTestId("wayfinding-pilot").getAttribute("data-session-status");
const uiMode = () => screen.getByTestId("wayfinding-pilot").getAttribute("data-ui-mode");

describe("Start location and destination search", () => {
  it("opens on search with the trusted start obvious, every routable place listed with a plain-language kind, no internal terms", () => {
    render(<WayfindingPilot embedded />);
    expect(uiMode()).toBe("search");
    expect(screen.getByLabelText("Where do you want to go?")).toBeInTheDocument();
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Starting from");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Main Entrance");
    expect(screen.getByTestId("pilot-change-start")).toHaveTextContent("Change start");
    const list = screen.getByTestId("pilot-suggestions");
    for (const name of ["Clicks", "Game", "Dis-Chem", "Pick n Pay", "Woolworths", "Toilets", "Lifts", "Food Court"]) expect(suggestion(name)).toBeInTheDocument();
    expect(suggestion("Toilets")).toHaveTextContent("Toilets");
    expect(suggestion("Clicks")).toHaveTextContent("Store");
    const text = screen.getByTestId("pilot-finder").textContent ?? "";
    expect(text).not.toMatch(/anchor|node|graph|dataset|pilot|schematic|source[- ]backed|corridor_arrival/i);
    expect(list.textContent).not.toMatch(/ATM/); // non-routable amenities are never offered
  });

  it("search-as-you-type with aliases; Enter picks the first result; no-results offers a way back", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "lacoste" } });
    expect(screen.getByTestId("pilot-no-result")).toHaveTextContent("No match for “lacoste”");
    fireEvent.click(within(screen.getByTestId("pilot-no-result")).getByRole("button", { name: /Show all places/ }));
    expect(screen.getByTestId("pilot-suggestions")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "wool" } });
    fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" });
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Woolworths");
    expect(uiMode()).toBe("overview");
  });

  it("a QR start says where the location came from in visitor words; an invalid link start shows a notice and falls back to a manual start", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={anchorFor(getWayfindingMall("garden-route-mall")!, "grm-entrance-4", "qr")} />);
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 4");
    expect(screen.getByTestId("pilot-anchor-source")).toHaveTextContent("Location set from MallMind QR");
    cleanup();
    render(<WayfindingPilot embedded anchorNotice="That starting point is not on the map. Please choose where you are." />);
    expect(screen.getByTestId("pilot-anchor-notice")).toHaveTextContent("not on the map");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Main Entrance");
    fireEvent.click(suggestion("Toilets"));
    expect(screen.getByTestId("pilot-summary")).toBeInTheDocument(); // an amenity is a destination like any other
  });

  it("Change start on the search screen opens Update my location and changes the trusted start", () => {
    render(<WayfindingPilot embedded />);
    fireEvent.click(screen.getByTestId("pilot-change-start"));
    const panel = screen.getByTestId("pilot-reanchor-panel");
    expect(panel).toHaveTextContent("Update my location");
    expect(panel).toHaveTextContent("Choose a nearby MallMind location or scan another MallMind QR code.");
    fireEvent.click(within(panel).getByRole("button", { name: /Entrance 2/ }));
    expect(screen.queryByTestId("pilot-reanchor-panel")).toBeNull();
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 2");
  });

  it("an unknown venue is never a dead end: it offers the venues MallMind can guide in (from the registry, not code)", () => {
    render(<WayfindingPilot embedded mallId="sandton-city" />);
    expect(uiMode()).toBe("no-venue");
    expect(screen.getByTestId("pilot-no-map")).toHaveTextContent("doesn’t have a map for this mall yet");
    const choices = within(screen.getByTestId("pilot-venue-choices")).getAllByRole("link");
    expect(choices.length).toBeGreaterThanOrEqual(3);
    expect(choices[0]).toHaveAttribute("href", expect.stringMatching(/^\/navigate\?mall=/));
    expect(screen.queryByTestId("pilot-finder")).toBeNull();
  });
});

describe("Route overview", () => {
  it("shows FROM / TO, the map, step count, floor, plain-language status and a dominant Start navigation; metres only when measured", () => {
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    fireEvent.click(suggestion("Pick n Pay"));
    expect(status()).toBe("route_ready");
    expect(uiMode()).toBe("overview");
    const fromTo = screen.getByTestId("pilot-from-to");
    expect(fromTo).toHaveTextContent("From");
    expect(fromTo).toHaveTextContent("Entrance 4");
    expect(fromTo).toHaveTextContent("To");
    expect(fromTo).toHaveTextContent("Pick n Pay");
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent(/8\s*steps/);
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent("Mall level (single sheet)"); // floor label from the Venue Pack
    expect(screen.getByTestId("pilot-distance-unmeasured")).toHaveTextContent("Distance not yet measured");
    expect(screen.queryByTestId("pilot-summary")).toBeNull();
    expect(screen.getByTestId("pilot-route-claim")).toHaveTextContent("Mapped route");
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("Mapped route · not yet walked on site · distance not measured");
    const view = screen.getByTestId("pilot-route-view").textContent ?? "";
    expect(view).not.toMatch(/\d\s?m\b|\d\s?min|~|estimated/i);
    expect(view).not.toMatch(/source[- ]backed|schematic|corridor_arrival|pilot|dataset|graph/i);
    expect(screen.getByRole("button", { name: /start navigation/i })).toBeInTheDocument();
    expect(screen.getByTestId("pilot-change-destination")).toHaveTextContent("Change destination");
    expect(screen.getByTestId("pilot-reanchor")).toHaveTextContent("Update my location");
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByRole("img", { name: /map/i })).toHaveAttribute("data-map-mode", "overview");
    // Route details discloses the truth in people words
    expect(screen.getByTestId("pilot-disclaimer")).toHaveTextContent("Not an official Garden Route Mall service");
    expect(screen.getByTestId("pilot-disclaimer")).toHaveTextContent("Not yet walked on site");
  });

  it("a measured venue shows distance and walking time, and the schematic tier reads as a Preview route", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(suggestion("Clicks"));
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/\d+ m/);
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/\d+ min/);
    expect(screen.queryByTestId("pilot-summary-unscaled")).toBeNull();
    expect(screen.getByTestId("pilot-route-claim")).toHaveTextContent("Preview route");
    expect(screen.getByTestId("wayfinding-pilot")).toHaveAttribute("data-metric", "true");
  });

  it("changing the start from the overview re-routes and keeps the destination; Change destination returns to search with the start kept", () => {
    render(<WayfindingPilot embedded />);
    fireEvent.click(suggestion("Clicks"));
    const before = screen.getByTestId("pilot-summary").textContent;
    fireEvent.change(screen.getByTestId("pilot-start-select"), { target: { value: "info-desk" } });
    expect(screen.getByTestId("pilot-summary").textContent).not.toBe(before);
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")[0]).toHaveTextContent("Information Desk");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("Route updated");
    fireEvent.click(screen.getByTestId("pilot-change-destination"));
    expect(uiMode()).toBe("search");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Information Desk");
  });
});

describe("Walking mode — manual progression, map/step sync, recovery", () => {
  const grm = () => getWayfindingMall("garden-route-mall")!;
  function walkTo(name: string, props: Partial<React.ComponentProps<typeof WayfindingPilot>> = {}) {
    const utils = render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={anchorFor(grm(), "grm-entrance-4", "qr")} {...props} />);
    fireEvent.click(suggestion(name));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    return utils;
  }

  it("Start navigation opens the focused view: destination, Step 1 of N, dominant instruction, map on the current leg, next preview, Previous/Next", () => {
    walkTo("Pick n Pay");
    expect(status()).toBe("navigating");
    expect(uiMode()).toBe("walking");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Pick n Pay");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 9");
    expect(screen.getByTestId("pilot-step-counter")).not.toHaveTextContent(/Ground|Level 1/); // single-floor venue: no invented floor
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent(/^Walk straight in from Entrance 4/);
    expect(screen.getByTestId("pilot-step-current").tagName).toBe("H2");
    expect(screen.getByTestId("pilot-step-next")).toHaveTextContent("Then: Turn left onto the main walkway");
    expect(screen.getByTestId("pilot-progress")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("pilot-prev")).toBeDisabled();
    expect(screen.getByTestId("pilot-next")).toHaveTextContent("Next");
    expect(screen.getByTestId("pilot-manual-note")).toHaveTextContent("When you reach this point, tap Next. MallMind does not track your movement.");
    // map: walking camera, current leg + numbered target for step 1, no confirmed ring yet
    const map = screen.getByRole("img", { name: /map/i });
    expect(map).toHaveAttribute("data-map-mode", "walking");
    expect(map.querySelector('[data-leg="current"]')).not.toBeNull();
    expect(map.querySelector('[data-leg="remaining"]')).not.toBeNull();
    expect(map.querySelector('[data-leg="completed"]')).toBeNull();
    expect(screen.getByTestId("map-step-marker")).toHaveTextContent("1");
    expect(screen.queryByTestId("map-confirmed-marker")).toBeNull();
    expect(screen.queryByText(/you are here|we detected/i)).toBeNull();
  });

  it("Next advances one step per tap and the map follows the same leg; Previous goes back; the final tap is I’m there", () => {
    walkTo("Pick n Pay");
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of 9");
    expect(screen.getByTestId("pilot-progress")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent(/^Turn left onto the main walkway/);
    const map = screen.getByRole("img", { name: /map/i });
    expect(map.querySelector('[data-leg="completed"]')).not.toBeNull();
    expect(screen.getByTestId("map-step-marker")).toHaveTextContent("2");
    expect(screen.getByTestId("map-confirmed-marker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pilot-prev"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 9");
    expect(screen.getByTestId("map-step-marker")).toHaveTextContent("1");
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 8 of 9");
    expect(screen.getByTestId("pilot-next")).toHaveTextContent("I’m there");
    expect(screen.queryByTestId("map-step-marker")).toBeNull(); // the destination pin marks the last leg's target
    expect(screen.getByTestId("map-destination-pin")).toBeInTheDocument();
  });

  it("arrival at a walkway point is worded honestly and offers real next actions; Not there yet returns to the last step", () => {
    walkTo("Woolworths");
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(status()).toBe("arrived");
    expect(uiMode()).toBe("arrived");
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached the mapped arrival point for Woolworths.");
    expect(screen.getByTestId("pilot-arrival-note")).toHaveTextContent("not at its entrance");
    expect(screen.queryByTestId("pilot-next")).toBeNull();
    expect(screen.getByTestId("pilot-new-destination")).toHaveTextContent("Find another place");
    expect(screen.getByTestId("pilot-navigate-from-here-unavailable")).toHaveTextContent("Your next route will still start from Entrance 4");
    expect(screen.queryByTestId("pilot-navigate-from-here")).toBeNull();
    const text = screen.getByTestId("pilot-navigation").textContent ?? "";
    expect(text).not.toMatch(/\d\s?m\b|\d\s?min|we detected|you have reached|you are here/i);
    fireEvent.click(screen.getByTestId("pilot-prev"));
    expect(status()).toBe("navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of 3");
  });

  it("Restart goes back to step 1 of the same route; Change destination keeps the trusted start; Back returns to the overview with the route kept", () => {
    walkTo("Woolworths");
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-restart"));
    expect(status()).toBe("navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Back to route overview" }));
    expect(uiMode()).toBe("overview");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Woolworths");
    fireEvent.click(screen.getByTestId("pilot-change-destination"));
    expect(uiMode()).toBe("search");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Entrance 4");
  });

  it("Update my location keeps the destination, recalculates from the new trusted start, resets progress and confirms 'Route updated'", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(suggestion("Clicks"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 2 of");
    expect(screen.getByText("Not sure where you are?")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pilot-reanchor"));
    const panel = screen.getByTestId("pilot-reanchor-panel");
    expect(within(panel).getByRole("button", { name: /Main Entrance/ })).toHaveAttribute("aria-current", "location");
    fireEvent.click(within(panel).getByRole("button", { name: /Entrance 2/ }));
    expect(screen.queryByTestId("pilot-reanchor-panel")).toBeNull();
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
    expect(status()).toBe("navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Entrance 2");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("Route updated — now starting from Entrance 2");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("Your steps start again from here");
    expect(screen.getByTestId("pilot-route-updated")).toHaveAttribute("role", "status");
  });

  it("a second QR / deep link arriving mid-route re-anchors in place", () => {
    const reds = getWayfindingMall("mallreds-pilot")!;
    const { rerender } = render(<WayfindingPilot embedded mallId="mallreds-pilot" initialAnchor={anchorFor(reds, "entrance-main", "qr")} />);
    fireEvent.click(suggestion("Game"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    rerender(<WayfindingPilot embedded mallId="mallreds-pilot" initialAnchor={anchorFor(reds, "info-desk", "qr")} />);
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Game");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Information Desk");
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("location set from mallmind qr");
  });

  it("Navigate from here is offered only where the venue lists a start at the arrival point (Information Desk), never for an unverified walkway point", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(suggestion("Information Desk"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    while (status() === "navigating") fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-navigate-from-here")).toHaveTextContent("Navigate from Information Desk");
    fireEvent.click(screen.getByTestId("pilot-navigate-from-here"));
    expect(uiMode()).toBe("search");
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent("Information Desk");
    fireEvent.click(suggestion("Game"));
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem")[0]).toHaveTextContent("Information Desk");
  });

  it("schematic tier arrival reads as the end of a preview route and shows metres per step when measured", () => {
    render(<WayfindingPilot embedded mallId="mallreds-pilot" />);
    fireEvent.click(suggestion("Clicks"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    expect(screen.getByTestId("pilot-step-distance")).toHaveTextContent(/About \d+ m for this step/);
    while (status() === "navigating") fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached the end of this preview route to Clicks.");
    expect(screen.getByTestId("pilot-status-line")).toHaveTextContent("Preview route · not yet walked on site");
  });

  it("browser Back while walking returns to the route overview (route kept), never a blank screen", () => {
    walkTo("Woolworths");
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(window.history.state?.mallmindWalking).toBe(true);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    expect(uiMode()).toBe("overview");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Woolworths");
    expect(screen.getByTestId("pilot-start-navigation")).toBeInTheDocument();
  });
});

describe("Unroutable, restore, backend independence, events", () => {
  it("unroutable is a useful state: honest message, Update my location and Choose another destination; no route, no distance", async () => {
    const engine = await import("@/venue/route");
    const real = engine.buildRoute;
    const spy = vi.spyOn(engine, "buildRoute").mockImplementation((graph, start, dest) =>
      start === "entrance-2"
        ? { found: true, fallback: true, steps: [], metric: false, total_distance_meters: null, estimated_minutes: null, connector_count: 0, unmeasured_connectors: 0, message: "Clicks isn’t connected to this map yet." }
        : real(graph, start, dest));
    try {
      const events: string[] = [];
      render(<WayfindingPilot embedded mallId="mallreds-pilot" initialAnchor={anchorFromStart("entrance-2", "qr")} onEvent={(e) => events.push(e.name)} />);
      fireEvent.click(suggestion("Clicks"));
      expect(status()).toBe("unroutable");
      expect(uiMode()).toBe("unroutable");
      expect(screen.getByRole("alert")).toHaveTextContent("We don’t have a mapped route between these points yet.");
      expect(screen.getByRole("alert").textContent).not.toMatch(/isn’t connected|node|graph/i);
      expect(screen.queryByTestId("pilot-start-navigation")).toBeNull();
      expect(screen.queryByTestId("pilot-steps")).toBeNull();
      expect(screen.queryByRole("img", { name: /map/i })).toBeNull();
      expect(events).toEqual(["destination_selected", "navigation_unroutable"]);
      fireEvent.click(screen.getByTestId("pilot-reanchor"));
      fireEvent.click(within(screen.getByTestId("pilot-reanchor-panel")).getByRole("button", { name: /Main Entrance/ }));
      expect(status()).toBe("route_ready");
      expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
      fireEvent.change(screen.getByTestId("pilot-start-select"), { target: { value: "entrance-2" } });
      expect(status()).toBe("unroutable");
      fireEvent.click(screen.getByTestId("pilot-change-destination"));
      expect(uiMode()).toBe("search");
    } finally {
      spy.mockRestore();
    }
  });

  it("a refresh mid-route restores venue, start, destination, walking state and the confirmed step; a different venue or expiry never inherits it", () => {
    const grm = getWayfindingMall("garden-route-mall")!;
    render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={anchorFor(grm, "grm-entrance-4", "qr")} />);
    fireEvent.click(suggestion("Pick n Pay"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    cleanup(); // refresh
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    expect(status()).toBe("navigating");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Pick n Pay");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 3 of 9");
    cleanup(); // a second QR scan re-anchors the restored session
    render(<WayfindingPilot embedded mallId="garden-route-mall" initialAnchor={anchorFor(grm, "grm-entrance-4", "qr")} />);
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Pick n Pay");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 3 of 9"); // same start → same session, progress kept
    cleanup();
    const raw = JSON.parse(localStorage.getItem(SESSION_STORE_KEY)!);
    render(<WayfindingPilot embedded mallId="menlyn-park" />);
    expect(uiMode()).toBe("search"); // another venue never inherits it
    cleanup();
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ ...raw, savedAt: raw.savedAt - 3 * 60 * 60 * 1000 }));
    render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    expect(uiMode()).toBe("search"); // expired
  });

  it("an invalid remembered session (unknown destination, unknown start, garbage) starts fresh without any error text", () => {
    const fresh = () => { cleanup(); render(<WayfindingPilot embedded mallId="garden-route-mall" />); expect(uiMode()).toBe("search"); expect(document.body.textContent).not.toMatch(/undefined|null|error|invalid/i); };
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ mallId: "garden-route-mall", anchorNodeId: "grm-entrance-4", anchorId: "grm-entrance-4", anchorLabel: "Entrance 4", anchorSource: "qr", destinationId: "grm-nowhere", status: "navigating", stepIndex: 2, savedAt: Date.now() }));
    fresh();
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ mallId: "garden-route-mall", anchorNodeId: "grm-picknpay-arrival", anchorId: null, anchorLabel: "x", anchorSource: "qr", destinationId: "grm-picknpay-41", status: "navigating", stepIndex: 2, savedAt: Date.now() }));
    fresh();
    localStorage.setItem(SESSION_STORE_KEY, "{garbage");
    fresh();
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ mallId: "garden-route-mall", anchorNodeId: "grm-entrance-4", anchorId: "grm-entrance-4", anchorLabel: "Entrance 4", anchorSource: "qr", destinationId: "grm-picknpay-41", status: "navigating", stepIndex: 99, savedAt: Date.now() }));
    cleanup(); render(<WayfindingPilot embedded mallId="garden-route-mall" />);
    expect(status()).toBe("navigating");
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 8 of 9"); // an out-of-range step is clamped to the last walking step
  });

  it("with every network request failing and a throwing analytics sink, the whole journey still works from local data", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("Load failed")));
    const events: string[] = [];
    try {
      render(<WayfindingPilot embedded mallId="garden-route-mall" onEvent={(e) => { events.push(e.name); throw new Error("sink down"); }} />);
      fireEvent.click(suggestion("Pick n Pay"));
      fireEvent.click(screen.getByTestId("pilot-start-navigation"));
      fireEvent.click(screen.getByTestId("pilot-next"));
      fireEvent.click(screen.getByTestId("pilot-prev"));
      fireEvent.click(screen.getByTestId("pilot-reanchor"));
      fireEvent.click(within(screen.getByTestId("pilot-reanchor-panel")).getByRole("button", { name: /Entrance 4/ }));
      while (status() === "navigating") fireEvent.click(screen.getByTestId("pilot-next"));
      expect(status()).toBe("arrived");
      fireEvent.click(screen.getByTestId("pilot-restart"));
      expect(events).toEqual([
        "destination_selected", "route_overview_opened", "navigation_session_started", "navigation_step_advanced", "navigation_step_back",
        "location_update_opened", "navigation_reanchored", ...Array<string>(8).fill("navigation_step_advanced"), "navigation_arrived", "navigation_restarted",
      ]);
    } finally { fetchSpy.mockRestore(); }
  });
});

describe("Synthetic venue and long instructions (no venue-specific code)", () => {
  const LONG = "wf-long-instructions";
  const longPack = JSON.parse(JSON.stringify(alpha)) as typeof alpha;
  longPack.venue.id = LONG; longPack.venue.name = "Long Words Centre";
  longPack.graph.edges[0].instructions = { forward: "Walk straight ahead along the wide main concourse, keeping the row of small kiosks on your left-hand side and the large glass shopfronts on your right, until you reach the first junction where the walkway splits in two directions.", reverse: "Head back." };
  beforeAll(() => { registerVenuePack(longPack); });
  afterAll(() => { unregisterVenuePack(LONG); });

  it("a very long instruction is shown in full, never truncated, and a verified door reads as reached", () => {
    render(<WayfindingPilot embedded mallId={LONG} initialAnchor={anchorFor(getWayfindingMall(LONG)!, "alpha-north", "qr")} />);
    fireEvent.click(suggestion("Bookshop"));
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("until you reach the first junction where the walkway splits in two directions.");
    expect(screen.getByTestId("pilot-step-current").className).not.toMatch(/truncate|line-clamp/);
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached Bookshop.");
    expect(screen.getByTestId("pilot-arrival-note")).toHaveTextContent("This entrance was checked on site.");
  });

  it("GUARD: the shared navigation UI contains no venue ids, and no engineering vocabulary reaches the visitor in any state", () => {
    for (const f of ["src/components/navigation/WayfindingPilot.tsx", "src/components/navigation/IndoorMapCanvas.tsx", "src/pages/NavigateScreen.tsx", "src/venue/evidence.ts"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).not.toMatch(/garden-route|menlyn|mallreds|grm-|test-mall-alpha|factory-test-centre/i);
    }
    const forbidden = /\b(pilot|dataset|graph|node id|anchor provider|corridor_arrival|source[- ]backed|field[- ]verified|schematic)\b/i;
    const check = (state: string) => expect(screen.getByTestId("wayfinding-pilot").textContent ?? "", state).not.toMatch(forbidden);
    render(<WayfindingPilot embedded mallId={LONG} initialAnchor={anchorFor(getWayfindingMall(LONG)!, "alpha-north", "qr")} />);
    check("search");
    fireEvent.click(suggestion("Cafe"));
    check("overview");
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    check("walking");
    fireEvent.click(screen.getByTestId("pilot-reanchor"));
    check("location update");
    fireEvent.click(within(screen.getByTestId("pilot-reanchor-panel")).getByRole("button", { name: /East Entrance/ }));
    while (status() === "navigating") fireEvent.click(screen.getByTestId("pilot-next"));
    check("arrival");
  });
});
