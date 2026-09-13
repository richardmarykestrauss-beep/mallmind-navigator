/**
 * THE ZERO-CODE MALL TEST.
 *
 * Test Mall Alpha exists ONLY because its Venue Pack is registered in `beforeAll`. Nothing in the
 * application (screens, router, session, routing algorithm, destination search, anchor providers)
 * knows its name. The final test proves that by grepping the source tree.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerVenuePack, unregisterVenuePack, getVenuePack } from "./registry";
import fixture from "./fixtures/test-mall-alpha.venue.json";
import WayfindingPilot from "@/components/navigation/WayfindingPilot";
import { parseWayfindingAnchor, qrLinkFor } from "@/components/navigation/wayfindingAnchor";
import { qrAnchorProvider, manualAnchorProvider } from "@/components/navigation/anchorProvider";
import { createNavigationSession, navigationReducer, currentStep, sessionSteps } from "@/components/navigation/navigationSession";
import { anchorFor, searchPois, startOptions, defaultAnchor } from "@/components/navigation/mallDatasets";

const ID = "test-mall-alpha";

beforeAll(() => { registerVenuePack(fixture); });
afterAll(() => { unregisterVenuePack(ID); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe("Test Mall Alpha — a venue that exists only as data", () => {
  it("QR deep link → anchor → destination search → route → navigate → re-anchor → arrive (pure session)", () => {
    const v = getVenuePack(ID)!;
    // QR / deep link (anchor id, via=qr) resolves through the generic gate
    const link = parseWayfindingAnchor(qrLinkFor(ID, "alpha-north").split("?")[1]);
    expect(link.status).toBe("ok");
    if (link.status !== "ok") return;
    expect(link.anchor).toMatchObject({ nodeId: "alpha-entrance-north", label: "North Entrance", source: "qr", anchorId: "alpha-north" });
    expect(qrAnchorProvider.resolve(`https://example.test${qrLinkFor(ID, "alpha-east")}`).status).toBe("ok");
    expect(manualAnchorProvider.resolve({ mallId: ID, anchorId: "alpha-atm-spot" })).toMatchObject({ status: "failed", code: "not_a_start" });
    expect(startOptions(v).map((s) => s.id)).toEqual(["alpha-north", "alpha-east"]);
    expect(defaultAnchor(v)).toMatchObject({ anchorId: "alpha-east", nodeId: "alpha-entrance-east" }); // policy default

    // destination search (aliases, amenities)
    expect(searchPois(v, "books").map((p) => p.id)).toEqual(["alpha-bookshop"]);
    expect(searchPois(v, "restroom").map((p) => p.id)).toEqual(["alpha-toilets-amenity"]);
    const bookshop = searchPois(v, "bookshop")[0];

    // session journey
    let s = createNavigationSession(ID, link.anchor);
    s = navigationReducer(v, s, { type: "select_destination", destination: bookshop });
    expect(s.status).toBe("route_ready");
    expect(s.route!.metric).toBe(true);          // measured legs only
    expect(s.route!.total_distance_meters).toBe(39);
    s = navigationReducer(v, s, { type: "start_navigation" });
    expect(currentStep(s)!.instruction).toBe("Walk straight in from the North Entrance to the first junction.");
    s = navigationReducer(v, s, { type: "next_step" });
    expect(currentStep(s)!.instruction).toBe("Turn right at the junction; the Bookshop is at the end of the side aisle.");
    // re-anchor at the East Entrance: destination kept, route recalculated (now through an unmeasured leg → no metres)
    s = navigationReducer(v, s, { type: "reanchor", anchor: anchorFor(v, "alpha-east", "qr") });
    expect(s.destination!.id).toBe("alpha-bookshop");
    expect(s.status).toBe("navigating");
    expect(s.stepIndex).toBe(0);
    expect(s.route!.metric).toBe(false);
    expect(s.route!.total_distance_meters).toBeNull();
    expect(sessionSteps(s).map((x) => x.node_id)).toEqual(["alpha-junction-b", "alpha-junction-a", "alpha-arrival-bookshop", "alpha-arrival-bookshop"]);
    while (s.status === "navigating") s = navigationReducer(v, s, { type: "next_step" });
    expect(s.status).toBe("arrived");
    expect(currentStep(s)!.instruction).toBe("You’ve reached Bookshop."); // verified public door in the pack
  });

  it("the shared screen renders and walks Test Mall Alpha with no venue-specific props beyond its id", () => {
    render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "alpha-north", "qr")} />);
    expect(screen.getByTestId("wayfinding-pilot")).toHaveAttribute("data-mall-id", ID);
    expect(screen.getByTestId("pilot-anchor-summary")).toHaveTextContent(/North Entrance/);
    const list = screen.getByTestId("pilot-suggestions");
    for (const name of ["Bookshop", "Pharmacy", "Cafe", "Toilets"]) expect(within(list).getByText(name)).toBeInTheDocument();
    expect(within(list).queryByText("ATM")).toBeNull(); // non-routable amenity never offered
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "chemist" } });
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Pharmacy"));
    expect(screen.getByTestId("pilot-route-claim")).toHaveTextContent("Source-backed route");
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent(/Upper Mall/); // floor label from the pack
    expect(screen.queryByTestId("pilot-summary")).toBeNull();                              // unmeasured leg → no metres
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 4"); // north → A → B → pharmacy + arrival
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Floor Upper Mall");
    fireEvent.click(screen.getByTestId("pilot-reanchor"));
    fireEvent.click(within(screen.getByTestId("pilot-reanchor-panel")).getByRole("button", { name: /East Entrance/ }));
    expect(screen.getByTestId("pilot-route-updated")).toHaveTextContent("now starting from East Entrance");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Pharmacy");
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("wayfinding-pilot")).toHaveAttribute("data-session-status", "arrived");
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached the mapped arrival point for Pharmacy.");
    const text = screen.getByTestId("pilot-navigation").textContent ?? "";
    expect(text).not.toMatch(/\d\s?m\b/i);
    expect(text).not.toMatch(/Ground Floor|Level 1/);
  });

  it("a measured route shows metres on the screen; an unknown venue id still fails safely", () => {
    render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "alpha-north")} />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Bookshop"));
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/39 m/);
    cleanup();
    render(<WayfindingPilot embedded mallId="test-mall-beta" />);
    expect(screen.getByTestId("pilot-no-map")).toBeInTheDocument();
  });

  it("navigation is backend-independent: with every network call failing, the whole journey still works", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("Load failed")));
    try {
      render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "alpha-east", "qr")} />);
      fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Cafe"));
      fireEvent.click(screen.getByTestId("pilot-start-navigation"));
      fireEvent.click(screen.getByTestId("pilot-next"));
      fireEvent.click(screen.getByTestId("pilot-next"));
      expect(screen.getByTestId("wayfinding-pilot")).toHaveAttribute("data-session-status", "arrived");
      expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("mapped arrival point for Cafe");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("PROOF: no application source mentions Test Mall Alpha — it exists only as a registered fixture", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|json|mjs)$/.test(entry)) continue;
        if (full.includes("/fixtures/") || /\.test\.(ts|tsx)$/.test(entry)) continue;
        const text = readFileSync(full, "utf8");
        if (/test-mall-alpha|Test Mall Alpha|alpha-entrance|alpha-bookshop|alpha-north/i.test(text)) hits.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "scripts"));
    expect(hits).toEqual([]);
  });
});
