/** Persisted session safety (Sprint 8): bound to venue AND pack revision; a changed pack never restores a stale step. */
import { describe, it, expect, beforeEach } from "vitest";
import { persistNavigationSession, loadPersistedNavigationSession, SESSION_STORE_KEY } from "./navigationSessionStore";
import { createNavigationSession, navigationReducer } from "./navigationSession";
import { getWayfindingMall, defaultAnchor, pointsOfInterest } from "./mallDatasets";

beforeEach(() => localStorage.clear());
const g = getWayfindingMall("garden-route-mall")!;

describe("pack-version binding", () => {
  it("stores the pack version and reports packChanged when the venue's pack moved on", () => {
    let s = createNavigationSession(g.id, defaultAnchor(g)!);
    s = navigationReducer(g, s, { type: "select_destination", destination: pointsOfInterest(g).find((p) => p.name === "Pick n Pay")! });
    s = navigationReducer(g, s, { type: "start_navigation" });
    s = navigationReducer(g, s, { type: "next_step" }); s = navigationReducer(g, s, { type: "next_step" });
    persistNavigationSession(s, 1_000, 2);
    expect(JSON.parse(localStorage.getItem(SESSION_STORE_KEY)!)).toMatchObject({ packVersion: 2, stepIndex: 2, status: "navigating" });
    expect(loadPersistedNavigationSession(g.id, 2_000, 2)).toMatchObject({ packChanged: false, stepIndex: 2 });
    expect(loadPersistedNavigationSession(g.id, 2_000, 3)).toMatchObject({ packChanged: true, destinationId: "grm-picknpay-41" });
    // A record from before the field existed is treated as changed when a current version is given.
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(SESSION_STORE_KEY)!), packVersion: undefined }));
    expect(loadPersistedNavigationSession(g.id, 2_000, 2)?.packChanged).toBe(true);
    expect(loadPersistedNavigationSession(g.id, 2_000)?.packChanged).toBe(false); // no version to compare → not flagged
  });
});
