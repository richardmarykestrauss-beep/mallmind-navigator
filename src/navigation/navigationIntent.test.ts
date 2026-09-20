/**
 * Navigation intent (Sprint 7): the AI may decide WHAT destination the visitor means; it never
 * decides WHERE to walk. Resolution runs against the venue's own vocabulary and fails safely.
 */
import { describe, it, expect } from "vitest";
import { resolveNavigationIntent, intentForDestination, findVenueForMall, navigationIntentLink, parseNavigationIntentLink } from "./navigationIntent";
import { getVenuePack } from "@/venue/registry";
import { loadVenuePack } from "@/venue/load";
import alpha from "@/venue/fixtures/test-mall-alpha.venue.json";
import type { VenuePack } from "@/venue/contract";

const gardenRoute = getVenuePack("garden-route-mall")!;
const menlyn = getVenuePack("menlyn-park")!;
const mallReds = getVenuePack("mallreds-pilot")!;

/** Test Mall Alpha with two banks so "the bank" is genuinely ambiguous. Synthetic; never a real venue. */
function twoBankVenue() {
  const p = JSON.parse(JSON.stringify(alpha)) as VenuePack;
  const ref = p.destinations[0];
  p.destinations.push(
    { ...ref, id: "alpha-bank-north", name: "First Bank", kind: "service", aliases: ["bank"], unit: null },
    { ...ref, id: "alpha-bank-south", name: "Second Bank", kind: "service", aliases: ["bank"], unit: null, arrival_node: p.destinations[1].arrival_node },
  );
  return loadVenuePack(p);
}

describe("resolveNavigationIntent", () => {
  it("resolves a store the assistant named, by exact name, whatever the visitor's phrasing produced", () => {
    // The backend extracts the destination phrase ("Take me to Clicks" → "Clicks"); resolution is name/alias based.
    expect(resolveNavigationIntent(menlyn, "Clicks", "assistant")).toEqual({ status: "resolved", intent: { type: "navigate", venue_id: "menlyn-park", destination_id: expect.any(String), resolved_label: "Clicks", resolution_source: "assistant" } });
    expect(resolveNavigationIntent(gardenRoute, "Woolworths", "assistant")).toMatchObject({ status: "resolved", intent: { resolved_label: "Woolworths", venue_id: "garden-route-mall" } });
    expect(resolveNavigationIntent(gardenRoute, "woolworths ", "assistant")).toMatchObject({ status: "resolved" });
  });

  it("resolves a routable amenity by its kind words (\"toilets\")", () => {
    const r = resolveNavigationIntent(mallReds, "toilets", "assistant");
    expect(r).toMatchObject({ status: "resolved", intent: { resolved_label: "Toilets", resolution_source: "assistant" } });
  });

  it("offers candidates when the phrase matches several destinations, never guessing", () => {
    const v = twoBankVenue();
    const r = resolveNavigationIntent(v, "bank", "assistant");
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["First Bank", "Second Bank"]);
    expect(r.candidates.every((c) => intentForDestination(v, c.id, "assistant"))).toBe(true);
  });

  it("fails safely on an unknown destination (no invented place, no route)", () => {
    expect(resolveNavigationIntent(gardenRoute, "Banana Kingdom", "assistant")).toEqual({ status: "unknown", venue_id: "garden-route-mall", query: "Banana Kingdom" });
    expect(resolveNavigationIntent(gardenRoute, "   ", "assistant")).toMatchObject({ status: "unknown" });
    expect(intentForDestination(gardenRoute, "not-a-destination", "link")).toBeNull();
  });

  it("carries no geometry: an intent is only a venue id and a destination id", () => {
    const r = resolveNavigationIntent(gardenRoute, "Pick n Pay", "search");
    expect(r.status === "resolved" ? Object.keys(r.intent).sort() : []).toEqual(["destination_id", "resolution_source", "resolved_label", "type", "venue_id"]);
  });
});

describe("venue lookup for the directory mall", () => {
  it("maps a directory mall name to its Venue Pack without a database id; unknown malls give null", () => {
    expect(findVenueForMall("Garden Route Mall")?.id).toBe("garden-route-mall");
    expect(findVenueForMall("  menlyn park ")?.id).toBe("menlyn-park");
    expect(findVenueForMall("Banana Kingdom Mall")).toBeNull();
    expect(findVenueForMall(null)).toBeNull();
  });
});

describe("intent hand-off link", () => {
  it("round-trips through /navigate?mall=&to=&src= and rejects malformed ids", () => {
    const r = resolveNavigationIntent(gardenRoute, "Clicks", "assistant");
    if (r.status !== "resolved") throw new Error("expected resolved");
    const link = navigationIntentLink(r.intent);
    expect(link).toMatch(/^\/navigate\?mall=garden-route-mall&to=[a-z0-9_-]+&src=assistant$/);
    expect(parseNavigationIntentLink(link.slice("/navigate".length))).toEqual({ venueId: "garden-route-mall", destinationId: r.intent.destination_id, source: "assistant" });
    expect(parseNavigationIntentLink("?mall=garden-route-mall")).toBeNull();
    expect(parseNavigationIntentLink("?mall=garden-route-mall&to=%3Cscript%3E")).toBeNull();
    expect(parseNavigationIntentLink("?mall=garden-route-mall&to=x&src=evil")?.source).toBe("link");
  });
});
