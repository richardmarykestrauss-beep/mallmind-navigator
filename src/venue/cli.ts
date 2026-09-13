/**
 * cli.ts — `npm run validate:venues`: validate every bundled production Venue Pack and print a
 * truthful summary. Exit code 1 on any issue. Bundled by scripts/venue/validate-venues.mjs.
 */

import { bundledVenueIds, getVenuePack, validateVenuePack } from "./registry";
import { formatVenueIssues } from "./validate";
import { buildRoute } from "./route";
import { searchableDestinations } from "./search";

export function runValidateVenues(log: (line: string) => void = console.log): number {
  let failures = 0;
  for (const id of bundledVenueIds()) {
    let venue;
    try {
      venue = getVenuePack(id);
    } catch (err) {
      failures++;
      log(`✗ ${id}\n${(err as Error).message}`);
      continue;
    }
    if (!venue) { failures++; log(`✗ ${id}: not registered`); continue; }
    const v = validateVenuePack(venue.pack);
    if (v.status !== "ok") { failures++; log(`✗ ${id}\n${formatVenueIssues(v.errors)}`); continue; }
    // Routability smoke: every searchable destination reachable from every start anchor.
    const dests = searchableDestinations(venue);
    let unreachable = 0;
    for (const a of venue.startAnchors) for (const d of dests) {
      if (d.arrivalNode === a.node) continue; // an anchor that is also a destination: nothing to route
      const r = buildRoute(venue, a.node, d.id);
      if (!(r.found && !r.fallback)) unreachable++;
    }
    const ev = venue.evidence;
    log(`✓ ${id} — ${venue.name}: ${venue.floors.length} floor(s), ${venue.nodes.length} nodes, ${venue.edges.length} edges, ${venue.destinations.length} destinations, ${venue.amenities.length} amenities, ${venue.startAnchors.length} start anchor(s); unit ${venue.distanceUnit}, metric ${venue.metric}; evidence geometry=${ev.geometry} measurement=${ev.measurement} field_verification=${ev.field_verification}; ${unreachable === 0 ? "all destinations reachable from every start" : `${unreachable} start→destination pair(s) unroutable`}`);
    if (unreachable > 0) failures++;
  }
  log(failures ? `\n${failures} venue pack(s) FAILED` : `\nAll ${bundledVenueIds().length} bundled venue packs are valid`);
  return failures ? 1 : 0;
}
