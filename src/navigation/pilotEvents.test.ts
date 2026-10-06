/**
 * Privacy-light pilot telemetry (Sprint 8): a random per-visit id, no user id, no raw text, a
 * client timestamp on every event, and best-effort delivery that never throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pilotSessionId, resetPilotSession, PILOT_SESSION_KEY, PILOT_SESSION_TTL_MS } from "./pilotSession";

const trackEvent = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));
const { buildPilotEvent, emitPilotEvent, defaultPilotSink, pilotSinkForNavigation, FORBIDDEN_DETAIL_KEYS } = await import("./pilotEvents");

beforeEach(() => { sessionStorage.clear(); trackEvent.mockReset(); });
afterEach(() => resetPilotSession());

describe("visit identifier", () => {
  it("is random, stable within the visit, stored only in sessionStorage, and rotates after the TTL", () => {
    const a = pilotSessionId(1_000);
    expect(a).toMatch(/^[0-9a-f-]{36}$|^s-/);
    expect(pilotSessionId(2_000)).toBe(a);
    expect(localStorage.getItem(PILOT_SESSION_KEY)).toBeNull();
    expect(pilotSessionId(1_000 + PILOT_SESSION_TTL_MS)).not.toBe(a);
    resetPilotSession();
    expect(pilotSessionId(5_000)).not.toBe(a);
  });
});

describe("events", () => {
  it("carry venue, session id and client timestamp; forbidden keys are stripped", () => {
    const T = Date.parse("2026-10-05T10:00:00Z");
    const e = buildPilotEvent("destination_search", "garden-route-mall", { result_count: 2, user_id: "u1", query: "clicks", lat: 1, query_class: "name" } as never, T);
    expect(e).toEqual({ name: "destination_search", venue_id: "garden-route-mall", session_id: pilotSessionId(T), ts: "2026-10-05T10:00:00.000Z", detail: { result_count: 2, query_class: "name" } });
    expect(FORBIDDEN_DETAIL_KEYS).toContain("user_id"); expect(FORBIDDEN_DETAIL_KEYS).toContain("query");
  });
  it("the default sink writes to app_events with NO user id and the session id inside metadata", () => {
    emitPilotEvent("venue_opened", "garden-route-mall", { via: "qr" });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    const [name, opts] = trackEvent.mock.calls[0];
    expect(name).toBe("venue_opened");
    expect(opts.userId).toBeNull();
    expect(opts.mallId).toBe("garden-route-mall");
    expect(opts.metadata).toMatchObject({ via: "qr", session_id: pilotSessionId() });
    expect(typeof opts.metadata.ts).toBe("string");
  });
  it("a throwing sink never propagates; the navigation adapter adds session + timestamp", () => {
    expect(() => emitPilotEvent("venue_opened", "x", {}, () => { throw new Error("boom"); })).not.toThrow();
    const seen: unknown[] = [];
    pilotSinkForNavigation((e) => seen.push(e))({ name: "navigation_arrived_confirmed", mallId: "garden-route-mall", detail: { destination: "grm-clicks-37" } });
    expect(seen[0]).toMatchObject({ name: "navigation_arrived_confirmed", venue_id: "garden-route-mall", detail: { destination: "grm-clicks-37" } });
    expect((seen[0] as { session_id: string }).session_id).toBe(pilotSessionId());
    void defaultPilotSink;
  });
});
