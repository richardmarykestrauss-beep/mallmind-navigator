/**
 * validate.ts — strong, path-addressed validation of a Venue Pack BEFORE Core uses it.
 *
 * Packs are untrusted data inputs (bundled today, imported tomorrow). Nothing is repaired or
 * defaulted silently: every problem is reported with WHAT is wrong and WHERE (a JSON path). An
 * unsupported schema version fails immediately rather than being guessed at.
 */

import {
  VENUE_PACK_SCHEMA_VERSION, VENUE_ID_PATTERN, GEOMETRY_EVIDENCE, IDENTITY_EVIDENCE, ARRIVAL_EVIDENCE, MEASUREMENT_EVIDENCE,
  ACCESSIBILITY_EVIDENCE, FIELD_VERIFICATION_STATES, DEPLOYMENT_STATES, DISTANCE_UNITS, NODE_KINDS, VERTICAL_KINDS,
  DESTINATION_KINDS, ANCHOR_KINDS, AMENITY_KINDS,
  type VenuePack,
} from "./contract";

export interface VenueIssue { path: string; message: string }
export type VenueValidation = { status: "ok"; pack: VenuePack } | { status: "failed"; errors: VenueIssue[] };

/** Plane the percent coordinates map onto; plan images must match this aspect within tolerance. */
export const VENUE_PLANE = { width: 1000, height: 620 } as const;
export const PLAN_IMAGE_ASPECT_TOLERANCE = 0.02;

/** Edge ids are internal (never in a URL/QR), so "a__b" style ids are allowed. */
const EDGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const MAX_TEXT = 300;
const MAX_INSTRUCTION = 400;
/** Plain text only: no markup, no control characters, no template braces. */
const UNSAFE_TEXT = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|\{\{|\}\}|\$\{/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

class Ctx {
  errors: VenueIssue[] = [];
  fail(path: string, message: string) { this.errors.push({ path, message }); }
  text(path: string, v: unknown, required: boolean, max = MAX_TEXT): v is string {
    if (v == null || v === "") { if (required) this.fail(path, "required plain-text string is missing"); return false; }
    if (typeof v !== "string") { this.fail(path, `must be a string (got ${typeof v})`); return false; }
    if (v.length > max) { this.fail(path, `longer than ${max} characters`); return false; }
    if (UNSAFE_TEXT.test(v)) { this.fail(path, "must be plain text (no markup, control characters or template braces)"); return false; }
    return true;
  }
  id(path: string, v: unknown, pattern: RegExp = VENUE_ID_PATTERN): v is string {
    if (typeof v !== "string" || !pattern.test(v)) { this.fail(path, `must be an id matching ${pattern} (got ${JSON.stringify(v)})`); return false; }
    return true;
  }
  oneOf<T extends string>(path: string, v: unknown, allowed: readonly T[], required = true): v is T {
    if (v == null) { if (required) this.fail(path, `required; one of ${allowed.join(" | ")}`); return false; }
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) { this.fail(path, `unknown value ${JSON.stringify(v)}; expected one of ${allowed.join(" | ")}`); return false; }
    return true;
  }
  num(path: string, v: unknown, opts: { min?: number; max?: number; integer?: boolean; required?: boolean } = {}): v is number {
    const required = opts.required ?? true;
    if (v == null) { if (required) this.fail(path, "required number is missing"); return false; }
    if (typeof v !== "number" || !Number.isFinite(v)) { this.fail(path, `must be a finite number (got ${JSON.stringify(v)})`); return false; }
    if (opts.integer && !Number.isInteger(v)) { this.fail(path, `must be an integer (got ${v})`); return false; }
    if (opts.min != null && v < opts.min) { this.fail(path, `must be ≥ ${opts.min} (got ${v})`); return false; }
    if (opts.max != null && v > opts.max) { this.fail(path, `must be ≤ ${opts.max} (got ${v})`); return false; }
    return true;
  }
  bool(path: string, v: unknown, required = true): v is boolean {
    if (v == null) { if (required) this.fail(path, "required boolean is missing"); return false; }
    if (typeof v !== "boolean") { this.fail(path, `must be true or false (got ${JSON.stringify(v)})`); return false; }
    return true;
  }
  array(path: string, v: unknown, required = true): v is unknown[] {
    if (v == null) { if (required) this.fail(path, "required array is missing"); return false; }
    if (!Array.isArray(v)) { this.fail(path, "must be an array"); return false; }
    return true;
  }
  unique(path: string, ids: string[], what: string) {
    const seen = new Set<string>();
    ids.forEach((id, i) => { if (seen.has(id)) this.fail(`${path}[${i}].id`, `duplicate ${what} id "${id}"`); seen.add(id); });
  }
  aliases(path: string, v: unknown) {
    if (v == null) return;
    if (!this.array(path, v)) return;
    v.forEach((a, i) => this.text(`${path}[${i}]`, a, true, 80));
  }
}

/**
 * Validate an unknown value as a Venue Pack. Returns the typed pack on success, else every issue
 * found (not just the first). Pure; never mutates or repairs the input.
 */
export function validateVenuePack(input: unknown): VenueValidation {
  const c = new Ctx();
  if (!isRec(input)) return { status: "failed", errors: [{ path: "$", message: "a Venue Pack must be a JSON object" }] };
  const p = input;

  // ── schema version: unknown/future versions fail safely ─────────────────
  if (p.schema_version !== VENUE_PACK_SCHEMA_VERSION) {
    return { status: "failed", errors: [{ path: "$.schema_version", message: `unsupported schema_version ${JSON.stringify(p.schema_version)}; this build understands ${VENUE_PACK_SCHEMA_VERSION}` }] };
  }

  // ── venue ────────────────────────────────────────────────────────────────
  const venue = isRec(p.venue) ? p.venue : (c.fail("$.venue", "required object is missing"), {} as Rec);
  c.id("$.venue.id", venue.id);
  c.text("$.venue.name", venue.name, true, 120);
  c.num("$.venue.pack_version", venue.pack_version, { min: 1, integer: true });
  c.text("$.venue.revision_note", venue.revision_note, false, 600);
  c.text("$.venue.short_name", venue.short_name, false, 60);
  c.text("$.venue.city", venue.city, false, 80);
  c.text("$.venue.country", venue.country, false, 80);
  if (venue.geo != null) {
    if (!isRec(venue.geo)) c.fail("$.venue.geo", "must be an object { lat, lng }");
    else { c.num("$.venue.geo.lat", venue.geo.lat, { min: -90, max: 90 }); c.num("$.venue.geo.lng", venue.geo.lng, { min: -180, max: 180 }); }
  }
  const dep = isRec(venue.deployment) ? venue.deployment : (c.fail("$.venue.deployment", "required object is missing"), {} as Rec);
  c.oneOf("$.venue.deployment.state", dep.state, DEPLOYMENT_STATES);
  c.bool("$.venue.deployment.official", dep.official);
  c.text("$.venue.deployment.label", dep.label, false, 160);
  const ev = isRec(venue.evidence) ? venue.evidence : (c.fail("$.venue.evidence", "required object is missing"), {} as Rec);
  c.oneOf("$.venue.evidence.geometry", ev.geometry, GEOMETRY_EVIDENCE);
  c.oneOf("$.venue.evidence.measurement", ev.measurement, MEASUREMENT_EVIDENCE);
  c.oneOf("$.venue.evidence.field_verification", ev.field_verification, FIELD_VERIFICATION_STATES);
  c.oneOf("$.venue.evidence.accessibility", ev.accessibility, ACCESSIBILITY_EVIDENCE);
  c.text("$.venue.evidence.note", ev.note, false, 2000);
  c.text("$.venue.notes", venue.notes, false, 2000);
  if (venue.sources != null && c.array("$.venue.sources", venue.sources)) {
    venue.sources.forEach((s, i) => {
      if (!isRec(s)) { c.fail(`$.venue.sources[${i}]`, "must be an object"); return; }
      c.text(`$.venue.sources[${i}].kind`, s.kind, true, 120);
      c.text(`$.venue.sources[${i}].reference`, s.reference, true, 600);
      c.text(`$.venue.sources[${i}].retrieved`, s.retrieved, false, 40);
      c.text(`$.venue.sources[${i}].note`, s.note, false, 600);
    });
  }

  // ── floors ───────────────────────────────────────────────────────────────
  const floorIds = new Set<string>();
  if (c.array("$.floors", p.floors)) {
    if (p.floors.length === 0) c.fail("$.floors", "a venue needs at least one floor");
    const ids: string[] = [];
    p.floors.forEach((f, i) => {
      const path = `$.floors[${i}]`;
      if (!isRec(f)) { c.fail(path, "must be an object"); return; }
      if (typeof f.id === "string" && f.id.trim() && f.id.length <= 32 && !UNSAFE_TEXT.test(f.id)) { ids.push(f.id); floorIds.add(f.id); }
      else c.fail(`${path}.id`, `floor id must be a short plain-text string (got ${JSON.stringify(f.id)})`);
      c.text(`${path}.label`, f.label, true, 80);
      c.num(`${path}.order`, f.order, { integer: true });
      c.aliases(`${path}.aliases`, f.aliases);
      if (f.plan_image != null) {
        if (!isRec(f.plan_image)) c.fail(`${path}.plan_image`, "must be an object or null");
        else {
          const img = f.plan_image;
          c.text(`${path}.plan_image.url`, img.url, true, 600);
          const w = c.num(`${path}.plan_image.width_px`, img.width_px, { min: 1, integer: true });
          const h = c.num(`${path}.plan_image.height_px`, img.height_px, { min: 1, integer: true });
          c.oneOf(`${path}.plan_image.evidence`, img.evidence, GEOMETRY_EVIDENCE);
          if (w && h) {
            const aspect = (img.width_px as number) / (img.height_px as number);
            const target = VENUE_PLANE.width / VENUE_PLANE.height;
            if (Math.abs(aspect - target) / target > PLAN_IMAGE_ASPECT_TOLERANCE) {
              c.fail(`${path}.plan_image`, `aspect ${aspect.toFixed(3)} deviates more than ${PLAN_IMAGE_ASPECT_TOLERANCE * 100}% from the ${VENUE_PLANE.width}:${VENUE_PLANE.height} plane (${target.toFixed(3)}); prepare the image at the plane aspect`);
            }
          }
        }
      }
    });
    const orders = p.floors.map((f) => (isRec(f) ? f.order : undefined));
    if (new Set(orders).size !== orders.length) c.fail("$.floors", "floor order values must be unique");
    c.unique("$.floors", ids, "floor");
  }

  // ── graph ────────────────────────────────────────────────────────────────
  const nodeIds = new Set<string>();
  const nodeKind = new Map<string, string>();
  const nodeFloor = new Map<string, string>();
  const graph = isRec(p.graph) ? p.graph : (c.fail("$.graph", "required object is missing"), {} as Rec);
  const unitOk = c.oneOf("$.graph.distance_unit", graph.distance_unit, DISTANCE_UNITS);
  const unit = unitOk ? (graph.distance_unit as string) : null;
  if (graph.plane != null) {
    if (!isRec(graph.plane) || graph.plane.width !== VENUE_PLANE.width || graph.plane.height !== VENUE_PLANE.height) {
      c.fail("$.graph.plane", `must be { width: ${VENUE_PLANE.width}, height: ${VENUE_PLANE.height} } (the MallMind plane) or omitted`);
    }
  }
  if (c.array("$.graph.nodes", graph.nodes)) {
    if (graph.nodes.length === 0) c.fail("$.graph.nodes", "a graph needs at least one node");
    const ids: string[] = [];
    graph.nodes.forEach((n, i) => {
      const path = `$.graph.nodes[${i}]`;
      if (!isRec(n)) { c.fail(path, "must be an object"); return; }
      if (c.id(`${path}.id`, n.id)) { ids.push(n.id); nodeIds.add(n.id); }
      c.text(`${path}.name`, n.name, true, 120);
      if (c.oneOf(`${path}.kind`, n.kind, NODE_KINDS) && typeof n.id === "string") nodeKind.set(n.id, n.kind);
      if (typeof n.floor !== "string" || !n.floor.trim()) c.fail(`${path}.floor`, "floor is required on every node (no implicit ground floor)");
      else if (!floorIds.has(n.floor)) c.fail(`${path}.floor`, `references undeclared floor "${n.floor}"; declared: ${[...floorIds].join(", ") || "(none)"}`);
      else if (typeof n.id === "string") nodeFloor.set(n.id, n.floor);
      c.num(`${path}.x_percent`, n.x_percent, { min: 0, max: 100 });
      c.num(`${path}.y_percent`, n.y_percent, { min: 0, max: 100 });
      if (!isRec(n.evidence)) c.fail(`${path}.evidence`, "required { geometry } is missing");
      else c.oneOf(`${path}.evidence.geometry`, n.evidence.geometry, GEOMETRY_EVIDENCE);
      c.text(`${path}.source`, n.source, false, 600);
      c.text(`${path}.notes`, n.notes, false, 1200);
      if (n.provenance != null) {
        if (!isRec(n.provenance)) c.fail(`${path}.provenance`, "must be an object of scalars");
        else for (const [k, v] of Object.entries(n.provenance)) {
          if (v !== null && !["string", "number", "boolean"].includes(typeof v)) c.fail(`${path}.provenance.${k}`, "provenance values must be scalars");
          if (typeof v === "string" && (v.length > 600 || UNSAFE_TEXT.test(v))) c.fail(`${path}.provenance.${k}`, "provenance strings must be short plain text");
        }
      }
    });
    c.unique("$.graph.nodes", ids, "node");
  }
  if (c.array("$.graph.edges", graph.edges)) {
    const ids: string[] = [];
    graph.edges.forEach((e, i) => {
      const path = `$.graph.edges[${i}]`;
      if (!isRec(e)) { c.fail(path, "must be an object"); return; }
      if (c.id(`${path}.id`, e.id, EDGE_ID_PATTERN)) ids.push(e.id);
      for (const end of ["from", "to"] as const) {
        if (typeof e[end] !== "string" || !nodeIds.has(e[end] as string)) c.fail(`${path}.${end}`, `references unknown node ${JSON.stringify(e[end])}`);
      }
      if (typeof e.from === "string" && e.from === e.to) c.fail(path, "an edge cannot connect a node to itself");
      c.bool(`${path}.bidirectional`, e.bidirectional, false);
      c.bool(`${path}.floor_change`, e.floor_change, false);
      c.oneOf(`${path}.vertical_kind`, e.vertical_kind, VERTICAL_KINDS, false);
      if (typeof e.from === "string" && typeof e.to === "string" && nodeFloor.has(e.from) && nodeFloor.has(e.to)) {
        const crosses = nodeFloor.get(e.from) !== nodeFloor.get(e.to);
        if (crosses && e.floor_change !== true) c.fail(`${path}.floor_change`, `connects floors "${nodeFloor.get(e.from)}" and "${nodeFloor.get(e.to)}" so it must declare floor_change: true`);
        if (!crosses && e.floor_change === true) c.fail(`${path}.floor_change`, "declares a floor change but both nodes are on the same floor");
      }
      const evd = isRec(e.evidence) ? e.evidence : (c.fail(`${path}.evidence`, "required { geometry, measurement } is missing"), {} as Rec);
      c.oneOf(`${path}.evidence.geometry`, evd.geometry, GEOMETRY_EVIDENCE);
      const measOk = c.oneOf(`${path}.evidence.measurement`, evd.measurement, MEASUREMENT_EVIDENCE);
      const measured = measOk && evd.measurement === "measured";
      const hasM = e.distance_m != null;
      const hasPx = e.length_px != null;
      if (hasM) c.num(`${path}.distance_m`, e.distance_m, { min: Number.EPSILON });
      if (hasPx) c.num(`${path}.length_px`, e.length_px, { min: Number.EPSILON });
      if (unit === "m") {
        if (!hasM) c.fail(`${path}.distance_m`, 'required (> 0) on every edge of a "m" pack');
        if (measOk && !measured) c.fail(`${path}.evidence.measurement`, '"m" packs claim measured metres, so every edge must be "measured"');
      } else if (unit === "px") {
        if (!hasPx) c.fail(`${path}.length_px`, 'required (> 0) on every edge of a "px" pack (pixel length is the shortest-path weight)');
        if (hasM && !measured) c.fail(`${path}.distance_m`, 'an unmeasured edge of a "px" pack cannot carry metres (no px→m conversion without evidence)');
        if (measured && !hasM) c.fail(`${path}.distance_m`, 'an edge whose measurement is "measured" must carry distance_m');
      }
      if (e.instructions != null) {
        if (!isRec(e.instructions)) c.fail(`${path}.instructions`, "must be an object { forward?, reverse? }");
        else {
          for (const dir of ["forward", "reverse"] as const) {
            if (e.instructions[dir] != null) c.text(`${path}.instructions.${dir}`, e.instructions[dir], false, MAX_INSTRUCTION);
          }
          if (e.bidirectional === false && e.instructions.reverse != null) c.fail(`${path}.instructions.reverse`, "a one-way edge cannot carry a reverse instruction");
          const extra = Object.keys(e.instructions).filter((k) => k !== "forward" && k !== "reverse");
          if (extra.length) c.fail(`${path}.instructions`, `unknown keys ${extra.join(", ")}; only forward / reverse are allowed`);
        }
      }
      c.text(`${path}.source`, e.source, false, 600);
      c.text(`${path}.notes`, e.notes, false, 1200);
    });
    c.unique("$.graph.edges", ids, "edge");
  }

  // ── destinations ─────────────────────────────────────────────────────────
  const destIds: string[] = [];
  if (c.array("$.destinations", p.destinations)) {
    p.destinations.forEach((d, i) => {
      const path = `$.destinations[${i}]`;
      if (!isRec(d)) { c.fail(path, "must be an object"); return; }
      if (c.id(`${path}.id`, d.id)) destIds.push(d.id);
      c.text(`${path}.name`, d.name, true, 120);
      c.oneOf(`${path}.kind`, d.kind, DESTINATION_KINDS);
      c.text(`${path}.category`, d.category, false, 80);
      if (typeof d.arrival_node !== "string" || !nodeIds.has(d.arrival_node)) c.fail(`${path}.arrival_node`, `references unknown node ${JSON.stringify(d.arrival_node)}`);
      if (d.unit != null) c.text(`${path}.unit`, d.unit, false, 40);
      c.aliases(`${path}.aliases`, d.aliases);
      const evd = isRec(d.evidence) ? d.evidence : (c.fail(`${path}.evidence`, "required { identity, arrival } is missing"), {} as Rec);
      c.oneOf(`${path}.evidence.identity`, evd.identity, IDENTITY_EVIDENCE);
      c.oneOf(`${path}.evidence.arrival`, evd.arrival, ARRIVAL_EVIDENCE);
      c.text(`${path}.evidence.identity_source`, evd.identity_source, false, 600);
      c.text(`${path}.notes`, d.notes, false, 1200);
    });
    c.unique("$.destinations", destIds, "destination");
  }

  // ── anchors ──────────────────────────────────────────────────────────────
  const anchorIds: string[] = [];
  const startAnchors = new Set<string>();
  if (c.array("$.anchors", p.anchors)) {
    p.anchors.forEach((a, i) => {
      const path = `$.anchors[${i}]`;
      if (!isRec(a)) { c.fail(path, "must be an object"); return; }
      if (c.id(`${path}.id`, a.id)) anchorIds.push(a.id);
      if (typeof a.node !== "string" || !nodeIds.has(a.node)) c.fail(`${path}.node`, `references unknown node ${JSON.stringify(a.node)}`);
      c.text(`${path}.label`, a.label, true, 80);
      c.oneOf(`${path}.kind`, a.kind, ANCHOR_KINDS);
      if (c.bool(`${path}.start_permitted`, a.start_permitted) && a.start_permitted && typeof a.id === "string") startAnchors.add(a.id);
      c.bool(`${path}.qr_eligible`, a.qr_eligible, false);
      if (a.qr_eligible === true && a.start_permitted !== true) c.fail(`${path}.qr_eligible`, "a QR-eligible anchor must be start_permitted");
      if (a.evidence != null) { if (!isRec(a.evidence)) c.fail(`${path}.evidence`, "must be { geometry }"); else c.oneOf(`${path}.evidence.geometry`, a.evidence.geometry, GEOMETRY_EVIDENCE); }
      c.text(`${path}.notes`, a.notes, false, 1200);
    });
    c.unique("$.anchors", anchorIds, "anchor");
    if (startAnchors.size === 0) c.fail("$.anchors", "at least one anchor must be start_permitted, otherwise no route can begin");
  }

  // ── amenities ────────────────────────────────────────────────────────────
  if (c.array("$.amenities", p.amenities)) {
    const ids: string[] = [];
    p.amenities.forEach((m, i) => {
      const path = `$.amenities[${i}]`;
      if (!isRec(m)) { c.fail(path, "must be an object"); return; }
      if (c.id(`${path}.id`, m.id)) ids.push(m.id);
      c.oneOf(`${path}.kind`, m.kind, AMENITY_KINDS);
      c.text(`${path}.name`, m.name, true, 120);
      if (typeof m.node !== "string" || !nodeIds.has(m.node)) c.fail(`${path}.node`, `references unknown node ${JSON.stringify(m.node)}`);
      c.bool(`${path}.routable`, m.routable);
      c.aliases(`${path}.aliases`, m.aliases);
      const evd = isRec(m.evidence) ? m.evidence : (c.fail(`${path}.evidence`, "required { geometry } is missing"), {} as Rec);
      c.oneOf(`${path}.evidence.geometry`, evd.geometry, GEOMETRY_EVIDENCE);
      c.oneOf(`${path}.evidence.accessibility`, evd.accessibility, ACCESSIBILITY_EVIDENCE, false);
      c.text(`${path}.notes`, m.notes, false, 1200);
    });
    c.unique("$.amenities", ids, "amenity");
    // ids must not collide with destination ids (they share the search/destination namespace)
    for (const id of ids) if (destIds.includes(id)) c.fail("$.amenities", `amenity id "${id}" collides with a destination id`);
  }

  // ── policies ─────────────────────────────────────────────────────────────
  const pol = isRec(p.policies) ? p.policies : (c.fail("$.policies", "required object is missing"), {} as Rec);
  const start = isRec(pol.start) ? pol.start : (c.fail("$.policies.start", "required object is missing"), {} as Rec);
  if (start.default_anchor != null) {
    if (typeof start.default_anchor !== "string" || !anchorIds.includes(start.default_anchor)) c.fail("$.policies.start.default_anchor", `references unknown anchor ${JSON.stringify(start.default_anchor)}`);
    else if (!startAnchors.has(start.default_anchor)) c.fail("$.policies.start.default_anchor", `anchor "${start.default_anchor}" is not start_permitted`);
  }
  if (start.allowed_anchor_kinds != null && c.array("$.policies.start.allowed_anchor_kinds", start.allowed_anchor_kinds)) {
    start.allowed_anchor_kinds.forEach((k, i) => c.oneOf(`$.policies.start.allowed_anchor_kinds[${i}]`, k, ANCHOR_KINDS));
  }
  const dests = isRec(pol.destinations) ? pol.destinations : (c.fail("$.policies.destinations", "required object is missing"), {} as Rec);
  if (dests.searchable_kinds != null && c.array("$.policies.destinations.searchable_kinds", dests.searchable_kinds)) {
    dests.searchable_kinds.forEach((k, i) => c.oneOf(`$.policies.destinations.searchable_kinds[${i}]`, k, DESTINATION_KINDS));
  }
  c.bool("$.policies.destinations.include_routable_amenities", dests.include_routable_amenities);
  const floorsPol = isRec(pol.floors) ? pol.floors : (c.fail("$.policies.floors", "required object is missing"), {} as Rec);
  c.oneOf("$.policies.floors.display", floorsPol.display, ["label", "id"] as const);
  const metrics = isRec(pol.metrics) ? pol.metrics : (c.fail("$.policies.metrics", "required object is missing"), {} as Rec);
  c.oneOf("$.policies.metrics.show", metrics.show, ["when-measured", "never"] as const);
  const instr = isRec(pol.instructions) ? pol.instructions : (c.fail("$.policies.instructions", "required object is missing"), {} as Rec);
  c.bool("$.policies.instructions.generic_fallback", instr.generic_fallback);
  c.bool("$.policies.instructions.start_prefix", instr.start_prefix);
  const extraPol = Object.keys(pol).filter((k) => !["start", "destinations", "floors", "metrics", "instructions"].includes(k));
  if (extraPol.length) c.fail("$.policies", `unknown policy keys ${extraPol.join(", ")} (policies are declarative; no custom keys)`);

  if (c.errors.length) return { status: "failed", errors: c.errors };
  return { status: "ok", pack: input as unknown as VenuePack };
}

/** One-line rendering of issues for CLIs and thrown errors. */
export function formatVenueIssues(errors: VenueIssue[]): string {
  return errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
}
