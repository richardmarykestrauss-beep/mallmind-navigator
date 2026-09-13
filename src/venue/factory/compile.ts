/**
 * compile.ts — the DETERMINISTIC compiler: accepted evidence → draft Venue Pack.
 *
 *   • consumes ONLY facts with status "accepted" (proposed, rejected and superseded facts are
 *     invisible to it — but a referenced-yet-unaccepted fact is a hard failure, never a guess);
 *   • no clock, no randomness, no AI: the same ledger + job config always yields byte-identical JSON;
 *   • evidence tiers are DERIVED from evidence classes, never asserted:
 *       field_verified → field-verified · first-party / operator / secondary → source-backed ·
 *       ai_inference / manual_inference → schematic (geometry) / unverified (identity);
 *   • metres appear only from an accepted field_verified measurement; a "m" pack requires one on
 *     EVERY edge, otherwise compilation fails (unsupported distance state);
 *   • a verified door needs an accepted field_verified arrival fact; otherwise corridor_arrival;
 *   • output is the app's Venue Pack contract, validated by the app's validator before it is written.
 */

import type {
  VenuePack, VenueNode, VenueEdge, VenueDestination, VenueAnchor, VenueAmenity, VenueFloor, GeometryEvidence, IdentityEvidence,
  VenueSource, NodeKind, VerticalKind, DestinationKind, AnchorKind, AmenityKind,
} from "../contract";
import { VENUE_PACK_SCHEMA_VERSION } from "../contract";
import { validateVenuePack } from "../validate";
import { VENUE_PLANE } from "../validate";
import type { EvidenceFact, EvidenceLedger, IngestionJob, SourceEntry, EvidenceClass } from "./types";
import type { Issue } from "./validateInputs";

export type CompileResult =
  | { status: "ok"; pack: VenuePack; warnings: string[]; stats: { facts_used: number; facts_ignored: number } }
  | { status: "failed"; errors: Issue[] };

type Rec = Record<string, string | number | boolean | null>;
const rec = (v: unknown): Rec | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null);
const str = (r: Rec, k: string): string | null => (typeof r[k] === "string" ? (r[k] as string) : null);
const num = (r: Rec, k: string): number | null => (typeof r[k] === "number" ? (r[k] as number) : null);
const bool = (r: Rec, k: string, d: boolean): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : d);
const splitAliases = (s: string | null) => (s ? s.split("|").filter(Boolean) : []);

export function geometryTierOf(cls: EvidenceClass): GeometryEvidence {
  if (cls === "field_verified") return "field-verified";
  if (cls === "ai_inference" || cls === "manual_inference") return "schematic";
  return "source-backed";
}
export function identityTierOf(cls: EvidenceClass): IdentityEvidence {
  if (cls === "field_verified") return "field-verified";
  if (cls === "ai_inference" || cls === "manual_inference") return "unverified";
  return "source-backed";
}
const GEOMETRY_RANK: Record<GeometryEvidence, number> = { schematic: 0, "source-backed": 1, "field-verified": 2 };

/** Stable ordering: by id (byte order) so output never depends on ledger insertion order. */
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function compileDraft(job: IngestionJob, ledger: EvidenceLedger, sources: readonly SourceEntry[]): CompileResult {
  const errors: Issue[] = [];
  const warnings: string[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  const all = ledger.facts;
  const accepted = all.filter((f) => f.status === "accepted");
  const statusOf = (subject: string, predicate: string): { fact: EvidenceFact | null; others: EvidenceFact[] } => {
    const matches = all.filter((f) => f.subject === subject && f.predicate === predicate && f.status !== "superseded");
    const acc = matches.filter((f) => f.status === "accepted");
    if (acc.length > 1) fail(`ledger:${subject}`, `${acc.length} accepted "${predicate}" facts conflict (${acc.map((f) => f.fact_id).join(", ")}); reject or override all but one`);
    return { fact: acc[0] ?? null, others: matches.filter((f) => f.status !== "accepted") };
  };
  /** Explain WHY a referenced subject cannot be used. */
  const why = (subject: string, predicate: string): string => {
    const m = all.filter((f) => f.subject === subject && f.predicate === predicate);
    if (m.length === 0) return `unknown ${subject} (no "${predicate}" fact in the ledger)`;
    const s = m.map((f) => f.status);
    if (s.includes("rejected") && !s.includes("proposed")) return `${subject} was REJECTED (${m.filter((f) => f.status === "rejected").map((f) => f.fact_id).join(", ")})`;
    if (s.includes("proposed")) return `${subject} is not yet accepted (proposed: ${m.filter((f) => f.status === "proposed").map((f) => f.fact_id).join(", ")})`;
    return `${subject} has no accepted "${predicate}" fact (${s.join(", ")})`;
  };
  const sourceById = new Map(sources.map((s) => [s.source_id, s]));
  const cite = (f: EvidenceFact) => { const s = sourceById.get(f.source_id); return s ? `${s.title} [${f.source_id}] (${f.evidence_class}, confidence ${f.confidence})` : `[${f.source_id}] (${f.evidence_class}, confidence ${f.confidence})`; };

  // ── floors ────────────────────────────────────────────────────────────────
  const floorFacts = accepted.filter((f) => f.predicate === "floor" && f.subject.startsWith("floor:"));
  const floors: VenueFloor[] = [];
  for (const f of floorFacts) {
    const v = rec(f.value); const id = f.subject.slice("floor:".length);
    if (!v || str(v, "label") == null || num(v, "order") == null) { fail(`ledger:${f.fact_id}`, "floor fact needs label and order"); continue; }
    const aliases = splitAliases(str(v, "aliases"));
    floors.push({ id, label: str(v, "label") as string, order: num(v, "order") as number, ...(aliases.length ? { aliases } : {}), plan_image: null });
  }
  floors.sort((a, b) => a.order - b.order || byId(a, b));
  if (floors.length === 0) fail("$.floors", "no accepted floor facts — a venue needs at least one declared floor");
  const floorIds = new Set(floors.map((f) => f.id));

  // ── nodes ─────────────────────────────────────────────────────────────────
  const nodes: VenueNode[] = [];
  const nodeGeometry = new Map<string, GeometryEvidence>();
  for (const f of accepted.filter((x) => x.predicate === "geometry" && x.subject.startsWith("node:"))) {
    const id = f.subject.slice("node:".length);
    const v = rec(f.value);
    if (statusOf(f.subject, "geometry").fact !== f) continue; // conflict already reported
    if (!v) { fail(`ledger:${f.fact_id}`, "node geometry fact must carry name/kind/floor/x_percent/y_percent"); continue; }
    const name = str(v, "name"), kind = str(v, "kind") as NodeKind | null, floor = str(v, "floor"), x = num(v, "x_percent"), y = num(v, "y_percent");
    if (!name || !kind || !floor || x == null || y == null) { fail(`ledger:${f.fact_id}`, "node geometry fact is missing name/kind/floor/x_percent/y_percent"); continue; }
    if (!floorIds.has(floor)) { fail(`node:${id}`, `references floor "${floor}": ${why(`floor:${floor}`, "floor")}`); continue; }
    let geometry = geometryTierOf(f.evidence_class);
    const provenance: Record<string, string | number | boolean | null> = { fact_id: f.fact_id, evidence_class: f.evidence_class, confidence: f.confidence };
    for (const k of ["source_image", "source_px_x", "source_px_y", "source_width_px", "source_height_px", "source_fit", "x_percent_source", "y_percent_source"]) if (v[k] != null) provenance[k] = v[k];
    // A field confirmation upgrades geometry (and may re-place the node) only when accepted.
    const conf = statusOf(f.subject, "field_confirmation").fact;
    let px = x, py = y;
    if (conf) {
      geometry = "field-verified";
      const cv = rec(conf.value);
      if (cv && num(cv, "x_percent") != null && num(cv, "y_percent") != null) { px = num(cv, "x_percent") as number; py = num(cv, "y_percent") as number; provenance.field_confirmation_moved = true; }
      provenance.field_confirmation = conf.fact_id;
    }
    nodeGeometry.set(id, geometry);
    nodes.push({ id, name, kind, floor, x_percent: px, y_percent: py, evidence: { geometry }, source: cite(f), ...(f.notes ? { notes: f.notes } : {}), provenance });
  }
  nodes.sort(byId);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const needNode = (ctx: string, id: string): VenueNode | null => { const n = nodeById.get(id); if (!n) fail(ctx, `references node "${id}": ${why(`node:${id}`, "geometry")}`); return n ?? null; };

  // ── edges ─────────────────────────────────────────────────────────────────
  const edges: VenueEdge[] = [];
  const unit = job.venue.distance_unit;
  for (const f of accepted.filter((x) => x.predicate === "edge" && x.subject.startsWith("edge:"))) {
    const id = f.subject.slice("edge:".length);
    if (statusOf(f.subject, "edge").fact !== f) continue;
    const v = rec(f.value);
    if (!v || !str(v, "from") || !str(v, "to")) { fail(`ledger:${f.fact_id}`, "edge fact needs from/to"); continue; }
    const a = needNode(`edge:${id}.from`, str(v, "from") as string), b = needNode(`edge:${id}.to`, str(v, "to") as string);
    if (!a || !b) continue;
    const floorChange = bool(v, "floor_change", false);
    if (a.floor !== b.floor && !floorChange) fail(`edge:${id}`, `connects floors "${a.floor}" and "${b.floor}" but is not marked floor_change`);
    const vertical = str(v, "vertical_kind") as VerticalKind | null;
    // Geometry tier = weakest of the edge fact and its two nodes.
    const tiers: GeometryEvidence[] = [geometryTierOf(f.evidence_class), a.evidence.geometry, b.evidence.geometry];
    const geometry = tiers.reduce((w, t) => (GEOMETRY_RANK[t] < GEOMETRY_RANK[w] ? t : w));
    // Metres ONLY from an accepted field_verified measurement.
    const m = statusOf(f.subject, "measurement").fact;
    let distance_m: number | null = null;
    if (m) {
      if (m.evidence_class !== "field_verified") fail(`edge:${id}.measurement`, `accepted measurement ${m.fact_id} is class ${m.evidence_class}; only field_verified measurements may produce metres`);
      else { const mv = rec(m.value); const d = mv ? num(mv, "distance_m") : null; if (d == null || d <= 0) fail(`edge:${id}.measurement`, `measurement ${m.fact_id} carries no positive distance_m`); else distance_m = d; }
    }
    if (unit === "m" && distance_m == null) fail(`edge:${id}`, `job requires distance_unit "m" but this edge has no accepted field measurement (unsupported distance state)`);
    let length_px = num(v, "length_px");
    const notes: string[] = f.notes ? [f.notes] : [];
    if (unit === "px" && length_px == null) {
      length_px = Math.round(Math.hypot((b.x_percent - a.x_percent) * VENUE_PLANE.width / 100, (b.y_percent - a.y_percent) * VENUE_PLANE.height / 100) * 10) / 10;
      if (length_px <= 0) { fail(`edge:${id}`, "zero-length edge (both nodes at the same plane position)"); continue; }
      notes.push("length_px derived from plane coordinates (shortest-path weight only; not a measured length)");
    }
    const fwd = statusOf(f.subject, "instruction_forward").fact, rev = statusOf(f.subject, "instruction_reverse").fact;
    const instructions: { forward?: string; reverse?: string } = {};
    if (fwd && typeof fwd.value === "string") instructions.forward = fwd.value;
    if (rev && typeof rev.value === "string") instructions.reverse = rev.value;
    if (!bool(v, "bidirectional", true) && instructions.reverse) fail(`edge:${id}.instructions.reverse`, "a one-way edge cannot carry a reverse instruction");
    for (const p of ["instruction_forward", "instruction_reverse"]) for (const o of statusOf(f.subject, p).others) if (o.status === "proposed") warnings.push(`edge:${id}: proposed ${p} ${o.fact_id} is not accepted and was left out`);
    edges.push({
      id, from: a.id, to: b.id, bidirectional: bool(v, "bidirectional", true), floor_change: floorChange, ...(vertical ? { vertical_kind: vertical } : {}),
      ...(unit === "px" ? { length_px } : {}), ...(distance_m != null ? { distance_m } : {}),
      evidence: { geometry, measurement: distance_m != null ? "measured" : "unmeasured" },
      ...(Object.keys(instructions).length ? { instructions } : {}), source: cite(f), ...(notes.length ? { notes: notes.join(" · ") } : {}),
    });
  }
  edges.sort(byId);

  // ── destinations ─────────────────────────────────────────────────────────
  const destinations: VenueDestination[] = [];
  for (const f of accepted.filter((x) => x.predicate === "destination" && x.subject.startsWith("destination:"))) {
    const id = f.subject.slice("destination:".length);
    if (statusOf(f.subject, "destination").fact !== f) continue;
    const v = rec(f.value);
    if (!v || !str(v, "name") || !str(v, "kind") || !str(v, "arrival_node")) { fail(`ledger:${f.fact_id}`, "destination fact needs name/kind/arrival_node"); continue; }
    const n = needNode(`destination:${id}.arrival_node`, str(v, "arrival_node") as string);
    if (!n) continue;
    const arrivalFact = statusOf(f.subject, "arrival").fact;
    let arrival: VenueDestination["evidence"]["arrival"] = "corridor_arrival";
    if (arrivalFact) {
      if (arrivalFact.value !== "verified_public_door") fail(`destination:${id}.arrival`, `arrival fact ${arrivalFact.fact_id} has unknown value ${JSON.stringify(arrivalFact.value)}`);
      else if (arrivalFact.evidence_class !== "field_verified") fail(`destination:${id}.arrival`, `a verified door needs a field_verified arrival fact (got ${arrivalFact.evidence_class})`);
      else arrival = "verified_public_door";
    } else if (n.kind === "entrance" || n.kind === "landmark" || n.kind === "amenity" || n.kind === "vertical") arrival = "corridor_arrival";
    const identity = identityTierOf(f.evidence_class);
    const aliases = splitAliases(str(v, "aliases"));
    destinations.push({
      id, name: str(v, "name") as string, kind: str(v, "kind") as DestinationKind, ...(str(v, "category") ? { category: str(v, "category") as string } : {}),
      arrival_node: n.id, unit: str(v, "unit"), ...(aliases.length ? { aliases } : {}),
      evidence: { identity, arrival, identity_source: cite(f) }, ...(f.notes ? { notes: f.notes } : {}),
    });
  }
  destinations.sort(byId);

  // ── anchors ───────────────────────────────────────────────────────────────
  const anchors: VenueAnchor[] = [];
  for (const f of accepted.filter((x) => x.predicate === "anchor" && x.subject.startsWith("anchor:"))) {
    const id = f.subject.slice("anchor:".length);
    if (statusOf(f.subject, "anchor").fact !== f) continue;
    const v = rec(f.value);
    if (!v || !str(v, "node") || !str(v, "label") || !str(v, "kind")) { fail(`ledger:${f.fact_id}`, "anchor fact needs node/label/kind"); continue; }
    const n = needNode(`anchor:${id}.node`, str(v, "node") as string);
    if (!n) continue;
    anchors.push({ id, node: n.id, label: str(v, "label") as string, kind: str(v, "kind") as AnchorKind, start_permitted: bool(v, "start_permitted", false), qr_eligible: bool(v, "qr_eligible", false), evidence: { geometry: n.evidence.geometry }, ...(f.notes ? { notes: f.notes } : {}) });
  }
  anchors.sort(byId);

  // ── amenities ─────────────────────────────────────────────────────────────
  const amenities: VenueAmenity[] = [];
  for (const f of accepted.filter((x) => x.predicate === "amenity" && x.subject.startsWith("amenity:"))) {
    const id = f.subject.slice("amenity:".length);
    if (statusOf(f.subject, "amenity").fact !== f) continue;
    const v = rec(f.value);
    if (!v || !str(v, "node") || !str(v, "name") || !str(v, "kind")) { fail(`ledger:${f.fact_id}`, "amenity fact needs kind/name/node"); continue; }
    const n = needNode(`amenity:${id}.node`, str(v, "node") as string);
    if (!n) continue;
    const acc = statusOf(f.subject, "accessibility").fact;
    const accessibility = acc && acc.evidence_class === "field_verified" ? "verified" : "unverified";
    const aliases = splitAliases(str(v, "aliases"));
    amenities.push({ id, kind: str(v, "kind") as AmenityKind, name: str(v, "name") as string, node: n.id, routable: bool(v, "routable", false), ...(aliases.length ? { aliases } : {}), evidence: { geometry: n.evidence.geometry, accessibility }, ...(f.notes ? { notes: f.notes } : {}) });
  }
  amenities.sort(byId);

  // ── venue headline evidence (derived, never asserted) ─────────────────────
  const geometries = [...nodes.map((n) => n.evidence.geometry), ...edges.map((e) => e.evidence.geometry)];
  const geometry: GeometryEvidence = geometries.length ? geometries.reduce((w, t) => (GEOMETRY_RANK[t] < GEOMETRY_RANK[w] ? t : w)) : "schematic";
  const measurement = edges.length > 0 && edges.every((e) => e.evidence.measurement === "measured") ? "measured" : "unmeasured";
  const fieldFacts = accepted.filter((f) => f.evidence_class === "field_verified");
  const field_verification = fieldFacts.length === 0 ? (job.venue.field_verification_intent ?? "not-started") : geometry === "field-verified" && measurement === "measured" ? "verified" : "partial";
  const venueAcc = statusOf("venue", "accessibility").fact;
  const accessibility = venueAcc && venueAcc.evidence_class === "field_verified" ? "verified" : "unverified";
  const noteFact = statusOf("venue", "note").fact;
  const evidenceNote = noteFact && typeof noteFact.value === "string" ? noteFact.value : `Compiled by the Venue Pack Factory from ${accepted.length} accepted facts (job ${job.job_id}). Geometry tier is the weakest accepted node/edge evidence; metres exist only where a field measurement was accepted.`;

  const packSources: VenueSource[] = [...sources].sort((a, b) => (a.source_id < b.source_id ? -1 : 1)).map((s) => ({
    kind: s.type, reference: s.origin, retrieved: s.acquired_at, note: `${s.title} · ${s.party} · rights ${s.rights.status}: ${s.rights.note}${s.checksum ? ` · sha256 ${s.checksum}` : ""}`,
  }));

  if (errors.length) return { status: "failed", errors };

  const pack: VenuePack = {
    schema_version: VENUE_PACK_SCHEMA_VERSION,
    venue: {
      id: job.venue.id, name: job.venue.name, pack_version: job.pack_version, revision_note: job.revision_note,
      ...(job.venue.short_name ? { short_name: job.venue.short_name } : {}), ...(job.venue.city ? { city: job.venue.city } : {}), ...(job.venue.country ? { country: job.venue.country } : {}),
      deployment: { state: job.venue.deployment.state, official: job.venue.deployment.official, ...(job.venue.deployment.label ? { label: job.venue.deployment.label } : {}) },
      evidence: { geometry, measurement, field_verification, accessibility, note: evidenceNote },
      sources: packSources, ...(job.venue.notes ? { notes: job.venue.notes } : {}),
    },
    floors,
    graph: { distance_unit: unit, plane: { width: VENUE_PLANE.width, height: VENUE_PLANE.height }, nodes, edges },
    destinations, anchors, amenities,
    policies: job.venue.policies,
  };
  // The app's own validator is the last word: a draft the app would reject is not a draft.
  const v = validateVenuePack(JSON.parse(JSON.stringify(pack)));
  if (v.status !== "ok") return { status: "failed", errors: v.errors.map((e) => ({ path: `draft ${e.path}`, message: e.message })) };
  return { status: "ok", pack: v.pack, warnings, stats: { facts_used: accepted.length, facts_ignored: all.length - accepted.length } };
}
