/**
 * Multi-floor foundation in the visitor experience (Sprint 7), on the synthetic Two Level Test
 * Centre registered as data: floor strip in the overview, the map staying on the CONFIRMED floor
 * while a floor-change step is current, the switch after Next, connector markers and wording,
 * time withheld when a ride is unmeasured, and no accessibility claim from a lift's presence.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import WayfindingPilot from "./WayfindingPilot";
import { registerVenuePack, unregisterVenuePack, getVenuePack } from "@/venue/registry";
import { anchorFor } from "./mallDatasets";
import fixture from "@/venue/fixtures/two-level-test-centre.venue.json";

const ID = "two-level-test-centre";
beforeAll(() => { registerVenuePack(fixture); });
afterAll(() => { unregisterVenuePack(ID); });
afterEach(() => { cleanup(); localStorage.clear(); });

const map = () => screen.getByRole("img", { name: /map/i });
const status = () => screen.getByTestId("wayfinding-pilot").getAttribute("data-session-status");
const pick = (name: string) => fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByRole("button", { name: new RegExp(`^${name}`) }));

describe("Two Level Test Centre — floor change as an ordinary, manually confirmed step", () => {
  it("overview shows the floors visited, the connector, walking metres without invented ride time, and no accessibility claim", () => {
    render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "tl-main", "qr")} />);
    pick("Upper Bookshop");
    const strip = screen.getByTestId("pilot-floor-strip");
    expect(strip).toHaveTextContent("Lower Mall (start)");
    expect(strip).toHaveTextContent("escalator");
    expect(strip).toHaveTextContent("Upper Mall (destination)");
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent("80 m");
    expect(screen.getByTestId("pilot-time-unmeasured")).toHaveTextContent("time not measured");
    expect(screen.getByTestId("pilot-summary").textContent).not.toMatch(/\d\s?min/);
    expect(screen.getByTestId("pilot-connector-summary")).toHaveTextContent("Includes 1 floor change. You confirm each one yourself.");
    expect(map()).toHaveAttribute("data-map-mode", "overview");
    expect(screen.getByTestId("wayfinding-pilot").textContent).not.toMatch(/accessible|wheelchair|step-free/i);
    const steps = within(screen.getByTestId("pilot-steps")).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps.some((t) => /Take the escalator up to Upper Mall\./.test(t ?? ""))).toBe(true);
    expect(steps.join(" ")).not.toMatch(/\bLM\b|\bUM\b|tl-/); // floor ids and node ids never reach the visitor
  });

  it("the map stays on the confirmed floor while the floor-change step is current, then switches after Next", () => {
    render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "tl-main", "qr")} />);
    pick("Upper Bookshop");
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    // steps: j1, lift landing, up-escalator landing, [ride], upper junction, bookshop, arrival
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 4 of 7");
    expect(screen.getByTestId("pilot-current-floor")).toHaveTextContent("You are on Lower Mall");
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Take the escalator up to Upper Mall.");
    expect(screen.getByTestId("pilot-floor-change-note")).toHaveTextContent("When you are on Upper Mall, tap Next. The map will switch floors then.");
    expect(screen.getByTestId("pilot-manual-note")).toHaveTextContent("When you are on Upper Mall, tap Next.");
    expect(map().textContent).toMatch(/Lower Mall/);                 // map caption: still the lower floor
    expect(screen.getByTestId("map-connector-marker")).toHaveTextContent("Escalator to Upper Mall");
    expect(screen.queryByTestId("map-step-marker")).toBeNull();      // the connector marks the step, not a numbered target
    fireEvent.click(screen.getByTestId("pilot-next"));               // the visitor confirms being upstairs
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 5 of 7");
    expect(screen.getByTestId("pilot-current-floor")).toHaveTextContent("You are on Upper Mall");
    expect(map().textContent).toMatch(/Upper Mall/);
    expect(screen.queryByTestId("map-connector-marker")).toBeNull();
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("At the top of the escalator, continue to the junction.");
    fireEvent.click(screen.getByTestId("pilot-prev"));               // going back returns the map to the lower floor
    expect(screen.getByTestId("pilot-current-floor")).toHaveTextContent("You are on Lower Mall");
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(status()).toBe("arrived");
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached the mapped arrival point for Upper Bookshop.");
    expect(map().textContent).toMatch(/Upper Mall/);
  });

  it("a lift with measured ride time yields minutes; its mere presence never yields an accessibility claim", () => {
    const pack = JSON.parse(JSON.stringify(fixture));
    pack.venue.id = "two-level-lift-first"; pack.venue.name = "Lift First Centre";
    pack.policies.routing = { connector_cost: { lift: 1, escalator: 500, stairs: 500 } };
    registerVenuePack(pack);
    try {
      render(<WayfindingPilot embedded mallId="two-level-lift-first" />);
      pick("Upper Bookshop");
      expect(screen.getByTestId("pilot-summary")).toHaveTextContent("95 m");
      expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/\d+ min/);
      expect(screen.getByTestId("pilot-floor-strip")).toHaveTextContent("lift");
      expect(screen.getByTestId("wayfinding-pilot").textContent).not.toMatch(/accessible|wheelchair|step-free/i);
      fireEvent.click(screen.getByTestId("pilot-start-navigation"));
      fireEvent.click(screen.getByTestId("pilot-next"));
      fireEvent.click(screen.getByTestId("pilot-next"));
      expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Take the lift to Upper Mall.");
      expect(screen.getByTestId("map-connector-marker")).toHaveTextContent("Lift to Upper Mall");
    } finally { unregisterVenuePack("two-level-lift-first"); }
  });

  it("an initial destination (link or assistant intent) opens the same route overview; an unknown one lands on search", () => {
    render(<WayfindingPilot embedded mallId={ID} initialDestination={{ destinationId: "tl-bookshop", source: "assistant" }} />);
    expect(status()).toBe("route_ready");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Upper Bookshop");
    expect(screen.getByTestId("pilot-from-to")).toHaveTextContent("Main Entrance");
    cleanup(); localStorage.clear();
    render(<WayfindingPilot embedded mallId={ID} initialDestination={{ destinationId: "nope", source: "link" }} />);
    expect(screen.getByTestId("wayfinding-pilot").getAttribute("data-ui-mode")).toBe("search");
  });
});
