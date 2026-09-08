import { describe, it, expect } from "vitest";
import {
  createNavigationSession, navigationReducer, currentStep, upcomingStep, sessionSteps, isRoutable,
  type NavigationSession, type NavigationAction, type NavigationGraph,
} from "./navigationSession";
import { getWayfindingMall, pointsOfInterest, anchorFor } from "./mallDatasets";
import { routeClaim, routeEvidenceTier, arrivalWording } from "./routeEvidence";
import {
  persistNavigationSession, loadPersistedNavigationSession, clearPersistedNavigationSession, SESSION_STORE_KEY, SESSION_STORE_TTL_MS,
} from "./navigationSessionStore";

const grm = getWayfindingMall("garden-route-mall")!;
const menlyn = getWayfindingMall("menlyn-park")!;
const reds = getWayfindingMall("mallreds-pilot")!;
const poi = (g: typeof grm, name: string) => pointsOfInterest(g).find((p) => p.name === name)!;
const run = (g: NavigationGraph, s: NavigationSession, ...actions: NavigationAction[]) => actions.reduce((acc, a) => navigationReducer(g, acc, a), s);

describe("NavigationSession — the visitor journey as a pure reducer", () => {
  it("session creation: a trusted anchor, no destination, destination_selection", () => {
    const s = createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4", "qr"));
    expect(s).toMatchObject({ mallId: "garden-route-mall", status: "destination_selection", destination: null, route: null, stepIndex: 0, completedSteps: [], routeRevision: 0 });
    expect(s.anchor).toEqual({ nodeId: "grm-entrance-4", label: "Entrance 4", source: "qr" });
  });

  it("selecting a destination calculates the route → route_ready (topology only for an unscaled mall)", () => {
    const s = run(grm, createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4")), { type: "select_destination", destination: poi(grm, "Woolworths") });
    expect(s.status).toBe("route_ready");
    expect(isRoutable(s)).toBe(true);
    expect(sessionSteps(s).map((x) => x.node_id)).toEqual(["grm-walkway-e4", "grm-woolworths-arrival", "grm-woolworths-arrival"]);
    expect(s.route!.metric).toBe(false);
    expect(s.route!.total_distance_meters).toBeNull();
    expect(s.routeRevision).toBe(1);
  });

  it("route start → navigating at step 1; Next advances and records completed steps; the last step is arrival", () => {
    let s = run(grm, createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4")),
      { type: "select_destination", destination: poi(grm, "Pick n Pay") }, { type: "start_navigation" });
    expect(s.status).toBe("navigating");
    expect(s.stepIndex).toBe(0);
    expect(currentStep(s)!.instruction).toMatch(/^Walk straight in from Entrance 4/);
    expect(upcomingStep(s)!.instruction).toMatch(/Turn left onto the main walkway/);
    const total = sessionSteps(s).length; // 8 legs + arrival
    expect(total).toBe(9);
    for (let i = 1; i < total - 1; i++) {
      s = navigationReducer(grm, s, { type: "next_step" });
      expect(s.status).toBe("navigating");
      expect(s.stepIndex).toBe(i);
    }
    expect(s.completedSteps).toEqual([0, 1, 2, 3, 4, 5, 6]);
    s = navigationReducer(grm, s, { type: "next_step" });
    expect(s.status).toBe("arrived");
    expect(s.stepIndex).toBe(total - 1);
    expect(currentStep(s)!.instruction).toBe("You’ve reached the mapped arrival point for Pick n Pay.");
    expect(upcomingStep(s)).toBeNull();
    // Next on arrival is a no-op; nothing overshoots
    expect(navigationReducer(grm, s, { type: "next_step" })).toBe(s);
  });

  it("previous step goes back (and un-arrives); it never goes below step 1", () => {
    let s = run(grm, createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4")),
      { type: "select_destination", destination: poi(grm, "Woolworths") }, { type: "start_navigation" }, { type: "next_step" }, { type: "next_step" });
    expect(s.status).toBe("arrived");
    s = navigationReducer(grm, s, { type: "previous_step" });
    expect(s).toMatchObject({ status: "navigating", stepIndex: 1, completedSteps: [0] });
    s = navigationReducer(grm, s, { type: "previous_step" });
    expect(s).toMatchObject({ status: "navigating", stepIndex: 0, completedSteps: [] });
    expect(navigationReducer(grm, s, { type: "previous_step" })).toBe(s);
  });

  it("start_navigation / next / previous are ignored outside their states (no route → no walking)", () => {
    const idle = createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4"));
    expect(navigationReducer(grm, idle, { type: "start_navigation" })).toBe(idle);
    expect(navigationReducer(grm, idle, { type: "next_step" })).toBe(idle);
    expect(navigationReducer(grm, idle, { type: "previous_step" })).toBe(idle);
    expect(navigationReducer(grm, idle, { type: "restart" })).toBe(idle);
  });

  it("re-anchor mid-route: destination preserved, trusted start replaced, route recalculated, steps reset, still navigating", () => {
    const before = run(reds, createNavigationSession(reds.mallId, anchorFor(reds, "entrance-main")),
      { type: "select_destination", destination: poi(reds, "Clicks") }, { type: "start_navigation" }, { type: "next_step" });
    expect(before.stepIndex).toBe(1);
    const after = navigationReducer(reds, before, { type: "reanchor", anchor: anchorFor(reds, "entrance-2", "qr") });
    expect(after.destination).toEqual(before.destination);
    expect(after.anchor).toEqual({ nodeId: "entrance-2", label: "Entrance 2", source: "qr" });
    expect(after.status).toBe("navigating");
    expect(after.stepIndex).toBe(0);
    expect(after.completedSteps).toEqual([]);
    expect(after.routeRevision).toBe(before.routeRevision + 1);
    expect(sessionSteps(after)[0].instruction).toContain("Entrance 2");
    expect(sessionSteps(after)).not.toEqual(sessionSteps(before));
    expect(after.lastReanchor).toEqual({ from: before.anchor, to: after.anchor, revision: after.routeRevision });
  });

  it("re-anchor before starting keeps route_ready; re-anchor with no destination just moves the start", () => {
    const ready = run(reds, createNavigationSession(reds.mallId, anchorFor(reds, "entrance-main")), { type: "select_destination", destination: poi(reds, "Game") });
    const moved = navigationReducer(reds, ready, { type: "reanchor", anchor: anchorFor(reds, "info-desk") });
    expect(moved.status).toBe("route_ready");
    expect(moved.destination!.name).toBe("Game");
    const idle = navigationReducer(reds, createNavigationSession(reds.mallId, anchorFor(reds, "entrance-main")), { type: "reanchor", anchor: anchorFor(reds, "entrance-2") });
    expect(idle).toMatchObject({ status: "destination_selection", anchor: { nodeId: "entrance-2" }, lastReanchor: null, route: null });
  });

  it("unroutable: a destination without an honest path → unroutable with the engine's reason; re-anchoring can recover", () => {
    const disconnected = { nodes: [...reds.nodes], edges: reds.edges.filter((e) => e.from_node_id !== "entrance-2" && e.to_node_id !== "entrance-2") };
    const s = run(disconnected, createNavigationSession(reds.mallId, anchorFor(reds, "entrance-2")), { type: "select_destination", destination: poi(reds, "Clicks") });
    expect(s.status).toBe("unroutable");
    expect(isRoutable(s)).toBe(false);
    expect(s.route!.message).toMatch(/isn’t connected/);
    expect(navigationReducer(disconnected, s, { type: "start_navigation" })).toBe(s);
    const recovered = navigationReducer(disconnected, s, { type: "reanchor", anchor: anchorFor(reds, "entrance-main") });
    expect(recovered.status).toBe("route_ready");
    expect(recovered.destination!.name).toBe("Clicks");
  });

  it("restart returns to route_ready at step 1; clear_destination returns to destination_selection", () => {
    const walked = run(grm, createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4")),
      { type: "select_destination", destination: poi(grm, "Clicks") }, { type: "start_navigation" }, { type: "next_step" }, { type: "next_step" });
    const restarted = navigationReducer(grm, walked, { type: "restart" });
    expect(restarted).toMatchObject({ status: "route_ready", stepIndex: 0, completedSteps: [], lastReanchor: null });
    expect(restarted.route).toBe(walked.route);
    expect(navigationReducer(grm, walked, { type: "clear_destination" })).toMatchObject({ status: "destination_selection", destination: null, route: null });
  });

  it("evidence never changes how the session behaves — only what is claimed", () => {
    const journeys = [
      { g: reds, start: "entrance-main", dest: "Clicks", tier: "schematic", claim: "Schematic route preview" },
      { g: menlyn, start: "menlyn-lf-entrance-13", dest: "Clicks", tier: "source-backed", claim: "Source-backed route" },
      { g: grm, start: "grm-entrance-4", dest: "Clicks", tier: "source-backed", claim: "Source-backed route" },
    ] as const;
    for (const j of journeys) {
      let s = run(j.g, createNavigationSession(j.g.mallId, anchorFor(j.g, j.start)), { type: "select_destination", destination: poi(j.g, j.dest) }, { type: "start_navigation" });
      expect(s.status).toBe("navigating");
      while (s.status === "navigating") s = navigationReducer(j.g, s, { type: "next_step" });
      expect(s.status).toBe("arrived");
      expect(routeEvidenceTier(j.g)).toBe(j.tier);
      expect(routeClaim(j.g)).toBe(j.claim);
      expect(currentStep(s)!.instruction).toBe("You’ve reached the mapped arrival point for Clicks.");
    }
    expect(routeClaim({ datasetStatus: "source-backed", fieldVerified: true })).toBe("Field-verified route");
    expect(routeClaim({ datasetStatus: "on-site-verified", fieldVerified: false })).toBe("Field-verified route");
    expect(arrivalWording({ name: "Clicks", evidence: "on-site-verified" })).toBe("You’ve reached Clicks.");
    expect(arrivalWording({ name: "Clicks", evidence: "source-backed" })).toBe("You’ve reached the mapped arrival point for Clicks.");
    expect(arrivalWording({ name: "Clicks" })).toBe("You’ve reached the mapped arrival point for Clicks."); // hosted nodes carry no evidence
  });

  it("metric preservation vs unscaled suppression is decided by the route, not the session", () => {
    const metric = run(reds, createNavigationSession(reds.mallId, anchorFor(reds, "entrance-main")), { type: "select_destination", destination: poi(reds, "Clicks") });
    expect(metric.route!.metric).toBe(true);
    expect(metric.route!.total_distance_meters).toBe(66);
    expect(metric.route!.estimated_minutes).toBe(1);
    const unscaled = run(menlyn, createNavigationSession(menlyn.mallId, anchorFor(menlyn, "menlyn-lf-entrance-13")), { type: "select_destination", destination: poi(menlyn, "Clicks") });
    expect(unscaled.route!.metric).toBe(false);
    expect(unscaled.route!.estimated_minutes).toBeNull();
    expect(sessionSteps(unscaled).every((st) => st.distance_meters === null)).toBe(true);
  });
});

describe("navigationSessionStore — remembers the destination for deep-link re-entry only", () => {
  const base = () => run(grm, createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4", "qr")), { type: "select_destination", destination: poi(grm, "Pick n Pay") }, { type: "start_navigation" });

  it("persists ids + status only, and restores within the TTL for the same mall", () => {
    localStorage.clear();
    persistNavigationSession(base(), 1_000);
    const raw = JSON.parse(localStorage.getItem(SESSION_STORE_KEY)!);
    expect(raw).toEqual({ mallId: "garden-route-mall", anchorNodeId: "grm-entrance-4", anchorLabel: "Entrance 4", destinationId: "grm-picknpay-41", status: "navigating", savedAt: 1_000 });
    expect(loadPersistedNavigationSession("garden-route-mall", 2_000)).toEqual(raw);
    expect(loadPersistedNavigationSession("menlyn-park", 2_000)).toBeNull();
    expect(loadPersistedNavigationSession("garden-route-mall", 1_000 + SESSION_STORE_TTL_MS + 1)).toBeNull();
    expect(loadPersistedNavigationSession("garden-route-mall", 500)).toBeNull(); // clock went backwards
  });

  it("a session without a destination clears the record; corrupt records are ignored", () => {
    localStorage.clear();
    persistNavigationSession(base(), 1_000);
    persistNavigationSession(createNavigationSession(grm.mallId, anchorFor(grm, "grm-entrance-4")), 1_001);
    expect(localStorage.getItem(SESSION_STORE_KEY)).toBeNull();
    localStorage.setItem(SESSION_STORE_KEY, "{not json");
    expect(loadPersistedNavigationSession("garden-route-mall")).toBeNull();
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ mallId: "garden-route-mall", destinationId: 5, anchorNodeId: "x", status: "navigating", savedAt: Date.now() }));
    expect(loadPersistedNavigationSession("garden-route-mall")).toBeNull();
    clearPersistedNavigationSession();
    expect(localStorage.getItem(SESSION_STORE_KEY)).toBeNull();
  });
});
