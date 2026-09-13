/**
 * registry.ts — the ONLY place the application learns which venues exist.
 *
 * Bundled packs are DATA: every `src/venue/packs/*.venue.json` is picked up by a glob and ordered
 * by `packs/bundle.json` (the first entry is the manual-entry default). Publishing a new venue is a
 * file copy plus one line in bundle.json — `npm run venue:publish -- --bundle` does both; no code
 * changes. Tests and dev harnesses may register more with `registerVenuePack`. Application code
 * asks `getVenuePack(id)` and never branches on a venue id. Unknown ids return null (never throw).
 * Loading is cached, so a pack is validated and indexed once.
 */

import type { VenuePack } from "./contract";
import { loadVenuePack, type LoadedVenue } from "./load";
import { validateVenuePack, type VenueValidation } from "./validate";
import bundle from "./packs/bundle.json";

const packModules = import.meta.glob("./packs/*.venue.json", { eager: true, import: "default" }) as Record<string, unknown>;

function idOf(pack: unknown): string | null {
  const v = (pack as { venue?: { id?: unknown } })?.venue?.id;
  return typeof v === "string" ? v : null;
}

/** Bundled production packs in bundle.json order; files present but not listed are an error (never silently bundled). */
function bundledPacks(): unknown[] {
  const byFile = new Map(Object.entries(packModules).map(([path, mod]) => [path.replace(/^.*\//, ""), mod]));
  const listed = (bundle as { order: string[] }).order;
  const unlisted = [...byFile.keys()].filter((f) => !listed.includes(f));
  if (unlisted.length) throw new Error(`Venue Pack file(s) not listed in packs/bundle.json: ${unlisted.join(", ")}`);
  return listed.map((f) => {
    const mod = byFile.get(f);
    if (!mod) throw new Error(`packs/bundle.json lists "${f}" but no such pack file exists`);
    return mod;
  });
}

const BUNDLED: unknown[] = bundledPacks();
const sources = new Map<string, unknown>();
const loaded = new Map<string, LoadedVenue>();

for (const p of BUNDLED) {
  const id = idOf(p);
  if (!id) throw new Error("bundled Venue Pack without venue.id");
  if (sources.has(id)) throw new Error(`bundled Venue Pack id "${id}" registered twice`);
  sources.set(id, p);
}

export { validateVenuePack };
export type { VenueValidation };

export interface VenueSummary {
  id: string;
  name: string;
  shortName: string;
  packVersion: number;
  evidence: LoadedVenue["evidence"];
  deployment: VenuePack["venue"]["deployment"];
  metric: boolean;
  distanceUnit: LoadedVenue["distanceUnit"];
}

/** All registered venues in registry order. */
export function listVenuePacks(): VenueSummary[] {
  return [...sources.keys()].map((id) => {
    const v = getVenuePack(id) as LoadedVenue;
    return { id: v.id, name: v.name, shortName: v.shortName, packVersion: v.pack.venue.pack_version, evidence: v.evidence, deployment: v.pack.venue.deployment, metric: v.metric, distanceUnit: v.distanceUnit };
  });
}

/** Ids of the bundled (production) packs. */
export function bundledVenueIds(): string[] { return BUNDLED.map((p) => idOf(p) as string); }

/** The venue used when nothing selects one (manual entry): the first bundled pack — data order, not code. */
export function defaultVenueId(): string { return bundledVenueIds()[0]; }

/** Load (validated, cached) a venue by id; null for unknown ids — never throws for unknown ids. */
export function getVenuePack(id: string): LoadedVenue | null {
  const source = sources.get(id);
  if (!source) return null;
  let v = loaded.get(id);
  if (!v) { v = loadVenuePack(source); loaded.set(id, v); }
  return v;
}

/**
 * Register an additional pack (test fixtures, dev harnesses, future imports). The pack is validated
 * first; an invalid pack is rejected with every issue and nothing is registered.
 */
export function registerVenuePack(pack: unknown, opts: { replace?: boolean } = {}): LoadedVenue {
  const v = validateVenuePack(pack);
  if (v.status !== "ok") throw new Error(`registerVenuePack: invalid pack\n${v.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  const id = v.pack.venue.id;
  if (sources.has(id) && !opts.replace) throw new Error(`registerVenuePack: "${id}" is already registered`);
  sources.set(id, v.pack);
  loaded.delete(id);
  return getVenuePack(id) as LoadedVenue;
}

/** Remove a registered pack (tests). Bundled packs cannot be removed. */
export function unregisterVenuePack(id: string): boolean {
  if (bundledVenueIds().includes(id)) return false;
  loaded.delete(id);
  return sources.delete(id);
}

/** Anchors a printed QR may encode, derived from the packs (qr_eligible), never from a hand-kept list. */
export function qrEligibleAnchors(): Array<{ venueId: string; venueName: string; anchorId: string; label: string; evidence: LoadedVenue["evidence"] }> {
  return listVenuePacks().flatMap((s) => {
    const v = getVenuePack(s.id) as LoadedVenue;
    return v.anchors.filter((a) => a.qr_eligible === true && a.start_permitted).map((a) => ({ venueId: v.id, venueName: v.name, anchorId: a.id, label: a.label, evidence: v.evidence }));
  });
}
