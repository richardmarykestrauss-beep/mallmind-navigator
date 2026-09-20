/**
 * NavigateScreen (Sprint 7): ONE navigation runtime for every source of intent.
 *   • an assistant hand-off (`/navigate?mall=&to=&src=assistant`) lands on the same route overview
 *     a manual search produces — the assistant chose the destination, the Venue Pack router chose
 *     the corridors;
 *   • the runtime never talks to a backend: with fetch failing (assistant down, backend down after
 *     a session was created) search, routing and walking still work;
 *   • an unknown destination id or an unknown venue never invents a route;
 *   • the stop list is a separate, non-spatial checklist with no map and no step semantics.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import NavigateScreen from "./NavigateScreen";
import { ShoppingSessionProvider } from "@/context/ShoppingSessionContext";
import { getVenuePack } from "@/venue/registry";
import { searchableDestinations } from "@/venue/search";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null, refreshProfile: async () => {} }) }));
vi.mock("@/components/BottomNav", () => ({ default: () => <nav data-testid="bottom-nav" /> }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const garden = getVenuePack("garden-route-mall")!;
const clicksId = searchableDestinations(garden).find((d) => d.name === "Clicks")!.id;
const uiMode = () => screen.getByTestId("wayfinding-pilot").getAttribute("data-ui-mode");

function mount(path: string) {
  return render(
    <ShoppingSessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/navigate" element={<NavigateScreen />} /><Route path="*" element={<div data-testid="elsewhere" />} /></Routes>
      </MemoryRouter>
    </ShoppingSessionProvider>,
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  // Every network call fails: the assistant is down and the backend is unreachable.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("network down")));
});
afterEach(() => { cleanup(); fetchSpy.mockRestore(); localStorage.clear(); sessionStorage.clear(); });

describe("assistant hand-off lands in the shared runtime", () => {
  it("shows the route overview for the destination the assistant resolved, built by the Venue Pack router", () => {
    mount(`/navigate?mall=garden-route-mall&to=${clicksId}&src=assistant`);
    expect(uiMode()).toBe("overview");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
    // The same steps a manual search yields (deterministic router; same start anchor).
    const handoff = within(screen.getByTestId("pilot-steps")).getAllByRole("listitem").map((s) => s.textContent);
    cleanup(); localStorage.clear();
    mount("/navigate?mall=garden-route-mall");
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "Clicks" } });
    fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" });
    expect(within(screen.getByTestId("pilot-steps")).getAllByRole("listitem").map((s) => s.textContent)).toEqual(handoff);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an unknown destination id from a link never invents a route: the visitor lands on search", () => {
    mount("/navigate?mall=garden-route-mall&to=banana-kingdom&src=assistant");
    expect(uiMode()).toBe("search");
    expect(screen.queryByTestId("pilot-dest-name")).toBeNull();
  });

  it("an unknown venue in a link shows the honest no-map state, never a fallback venue", () => {
    mount("/navigate?mall=banana-kingdom&to=x");
    expect(uiMode()).toBe("no-venue");
    expect(screen.getByTestId("pilot-no-map")).toBeInTheDocument();
  });
});

describe("backend independence", () => {
  it("with every network call failing, manual search, routing and walking still work end to end", () => {
    mount("/navigate?mall=garden-route-mall");
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "Woolworths" } });
    fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" });
    expect(uiMode()).toBe("overview");
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    expect(uiMode()).toBe("walking");
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("wayfinding-pilot").getAttribute("data-session-status")).toBe("navigating");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a session created before the backend went away keeps working after a reload", () => {
    mount("/navigate?mall=garden-route-mall");
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "Pick n Pay" } });
    fireEvent.keyDown(screen.getByTestId("pilot-search"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    cleanup(); // "reload" — the remembered session restores from local storage, no network involved
    mount("/navigate?mall=garden-route-mall");
    expect(uiMode()).toBe("walking");
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Pick n Pay");
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the stop list is not a route", () => {
  it("renders a checklist with no map, no steps, no distances, and hands a stop to the runtime only as a destination", () => {
    sessionStorage.setItem("mm_mall", JSON.stringify({ id: "db-uuid", name: "Garden Route Mall" }));
    sessionStorage.setItem("mm_stops", JSON.stringify([{ id: "s1", name: "Clicks", floor: null, unit_number: null, category: "Pharmacy" }, { id: "s2", name: "Banana Kingdom", floor: null, unit_number: null }]));
    mount("/navigate");
    expect(screen.getByTestId("stop-list")).toBeInTheDocument();
    expect(screen.getByTestId("stop-list-note")).toHaveTextContent(/not a route: no map, no distances, no walking directions/);
    expect(screen.queryByTestId("map-route")).toBeNull();
    expect(screen.queryByTestId("wayfinding-pilot")).toBeNull();
    expect(screen.getByTestId("stop-list").textContent).not.toMatch(/\bm\b|min|step \d/i);
    // "Guide me" resolves the shop by name against the Venue Pack and enters the runtime as an intent.
    const guides = screen.getAllByTestId("stop-list-guide");
    fireEvent.click(guides[0]);
    expect(screen.getByTestId("wayfinding-pilot")).toBeInTheDocument();
    expect(screen.getByTestId("pilot-dest-name")).toHaveTextContent("Clicks");
  });
});
