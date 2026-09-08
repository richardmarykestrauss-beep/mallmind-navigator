/**
 * shopLocation.ts — honest shopper-facing formatting for a store's physical
 * location fields (floor, entrance).
 *
 * Provenance rule (Sprint 2G): a store's `floor` may be NULL = "not yet
 * verified". The database no longer defaults an unknown floor to 'G'
 * (migration 035), so the UI must never silently present an unknown floor as
 * "Ground Floor" or as the literal string "null". An unknown floor is shown as
 * "Floor not yet verified" (or omitted), never invented.
 *
 * This is DISTINCT from `normalizeFloorLabel()` in
 * components/navigation/floorplanModel.ts, which exists only to bucket a route
 * onto a geometric floor-plane (and defaults blank → "Ground Floor" for the map
 * model). That normalizer is for map geometry, NOT for making a provenance claim
 * about where a real store is. For shopper-facing store location text, use the
 * helpers here.
 */

/** True when a floor value carries no verified information. */
export function isFloorUnknown(floor: string | null | undefined): boolean {
  const raw = (floor ?? "").trim();
  return raw === "" || raw === "?" || raw.toLowerCase() === "unknown";
}

/**
 * Shopper-facing floor label.
 *   known floor (incl. an explicit stored 'G')  → `Floor <value>`
 *   unknown/NULL floor                          → "Floor not yet verified"
 * Never returns "Ground Floor" for an unknown floor, and never prints "null".
 */
export function describeShopFloor(floor: string | null | undefined): string {
  if (isFloorUnknown(floor)) return "Floor not yet verified";
  return `Floor ${(floor as string).trim()}`;
}

/**
 * Phrasing for "enter via …" navigation copy.
 *   'G' (explicit)      → "Ground Floor"
 *   other known floor   → "Floor <value> entrance"
 *   unknown/NULL floor  → "the mall entrance"  (no invented floor)
 */
export function describeEntrance(floor: string | null | undefined): string {
  if (isFloorUnknown(floor)) return "the mall entrance";
  const raw = (floor as string).trim();
  if (raw.toLowerCase() === "g") return "Ground Floor";
  return `Floor ${raw} entrance`;
}
