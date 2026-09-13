/**
 * diff.ts — change report between two Venue Packs (or a new pack against nothing).
 *
 * Pure and deterministic. Reports what a reviewer needs before publishing a revision: nodes
 * added / removed / moved / renamed / re-tiered, edges added / removed / measured / re-worded /
 * re-wired, destinations and their arrival or identity upgrades, anchors, amenities, floors, and
 * venue-level evidence changes. Coordinates are compared exactly (no tolerance is invented).
 */

import type { VenuePack } from "../contract";
import type { PackDiff } from "./types";

const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id).sort();
const only = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));

export function diffVenuePacks(from: VenuePack | null, to: VenuePack): PackDiff {
  const d: PackDiff = {
    from: from ? { id: from.venue.id, pack_version: from.venue.pack_version } : null,
    to: { id: to.venue.id, pack_version: to.venue.pack_version },
    floors: { added: [], removed: [], relabelled: [] },
    nodes: { added: [], removed: [], moved: [], renamed: [], evidence_changed: [], floor_changed: [] },
    edges: { added: [], removed: [], measured: [], unmeasured: [], instruction_changed: [], topology_changed: [] },
    destinations: { added: [], removed: [], arrival_changed: [], identity_changed: [], renamed: [] },
    anchors: { added: [], removed: [], changed: [] },
    amenities: { added: [], removed: [], changed: [] },
    venue: { evidence_changed: [], unit_changed: null, policies_changed: false },
    summary: [],
  };
  const base: VenuePack = from ?? { ...to, floors: [], graph: { ...to.graph, nodes: [], edges: [] }, destinations: [], anchors: [], amenities: [] };

  // floors
  const fA = ids(base.floors), fB = ids(to.floors);
  d.floors.added = only(fB, fA); d.floors.removed = only(fA, fB);
  for (const f of to.floors) { const o = base.floors.find((x) => x.id === f.id); if (o && o.label !== f.label) d.floors.relabelled.push(f.id); }

  // nodes
  const nA = new Map(base.graph.nodes.map((n) => [n.id, n])), nB = new Map(to.graph.nodes.map((n) => [n.id, n]));
  d.nodes.added = only([...nB.keys()].sort(), [...nA.keys()]); d.nodes.removed = only([...nA.keys()].sort(), [...nB.keys()]);
  for (const [id, n] of [...nB].sort()) {
    const o = nA.get(id); if (!o) continue;
    if (o.x_percent !== n.x_percent || o.y_percent !== n.y_percent) d.nodes.moved.push({ id, from: [o.x_percent, o.y_percent], to: [n.x_percent, n.y_percent] });
    if (o.name !== n.name) d.nodes.renamed.push(id);
    if (o.evidence.geometry !== n.evidence.geometry) d.nodes.evidence_changed.push({ id, from: o.evidence.geometry, to: n.evidence.geometry });
    if (o.floor !== n.floor) d.nodes.floor_changed.push(id);
  }

  // edges
  const eA = new Map(base.graph.edges.map((e) => [e.id, e])), eB = new Map(to.graph.edges.map((e) => [e.id, e]));
  d.edges.added = only([...eB.keys()].sort(), [...eA.keys()]); d.edges.removed = only([...eA.keys()].sort(), [...eB.keys()]);
  for (const [id, e] of [...eB].sort()) {
    const o = eA.get(id); if (!o) continue;
    const mA = o.evidence.measurement === "measured", mB = e.evidence.measurement === "measured";
    if (!mA && mB) d.edges.measured.push({ id, distance_m: e.distance_m as number });
    else if (mA && mB && o.distance_m !== e.distance_m) d.edges.measured.push({ id, distance_m: e.distance_m as number });
    if (mA && !mB) d.edges.unmeasured.push(id);
    if ((o.instructions?.forward ?? null) !== (e.instructions?.forward ?? null)) d.edges.instruction_changed.push({ id, direction: "forward" });
    if ((o.instructions?.reverse ?? null) !== (e.instructions?.reverse ?? null)) d.edges.instruction_changed.push({ id, direction: "reverse" });
    if (o.from !== e.from || o.to !== e.to || (o.bidirectional ?? true) !== (e.bidirectional ?? true) || (o.floor_change ?? false) !== (e.floor_change ?? false)) d.edges.topology_changed.push(id);
  }

  // destinations
  const dA = new Map(base.destinations.map((x) => [x.id, x])), dB = new Map(to.destinations.map((x) => [x.id, x]));
  d.destinations.added = only([...dB.keys()].sort(), [...dA.keys()]); d.destinations.removed = only([...dA.keys()].sort(), [...dB.keys()]);
  for (const [id, x] of [...dB].sort()) {
    const o = dA.get(id); if (!o) continue;
    if (o.evidence.arrival !== x.evidence.arrival) d.destinations.arrival_changed.push({ id, from: o.evidence.arrival, to: x.evidence.arrival });
    if (o.evidence.identity !== x.evidence.identity) d.destinations.identity_changed.push({ id, from: o.evidence.identity, to: x.evidence.identity });
    if (o.name !== x.name || o.arrival_node !== x.arrival_node) d.destinations.renamed.push(id);
  }

  // anchors / amenities
  const aA = new Map(base.anchors.map((x) => [x.id, x])), aB = new Map(to.anchors.map((x) => [x.id, x]));
  d.anchors.added = only([...aB.keys()].sort(), [...aA.keys()]); d.anchors.removed = only([...aA.keys()].sort(), [...aB.keys()]);
  for (const [id, x] of [...aB].sort()) { const o = aA.get(id); if (o && JSON.stringify(o) !== JSON.stringify(x)) d.anchors.changed.push(id); }
  const mA2 = new Map(base.amenities.map((x) => [x.id, x])), mB2 = new Map(to.amenities.map((x) => [x.id, x]));
  d.amenities.added = only([...mB2.keys()].sort(), [...mA2.keys()]); d.amenities.removed = only([...mA2.keys()].sort(), [...mB2.keys()]);
  for (const [id, x] of [...mB2].sort()) { const o = mA2.get(id); if (o && JSON.stringify(o) !== JSON.stringify(x)) d.amenities.changed.push(id); }

  // venue
  if (from) {
    for (const k of ["geometry", "measurement", "field_verification", "accessibility"] as const) if (from.venue.evidence[k] !== to.venue.evidence[k]) d.venue.evidence_changed.push({ concern: k, from: from.venue.evidence[k], to: to.venue.evidence[k] });
    if (from.graph.distance_unit !== to.graph.distance_unit) d.venue.unit_changed = { from: from.graph.distance_unit, to: to.graph.distance_unit };
    d.venue.policies_changed = JSON.stringify(from.policies) !== JSON.stringify(to.policies);
  }

  const s = d.summary;
  s.push(from ? `${to.venue.id}: v${from.venue.pack_version} → v${to.venue.pack_version}` : `${to.venue.id}: new pack v${to.venue.pack_version}`);
  const line = (label: string, n: number) => { if (n) s.push(`${label}: ${n}`); };
  line("floors added", d.floors.added.length); line("floors removed", d.floors.removed.length); line("floors relabelled", d.floors.relabelled.length);
  line("nodes added", d.nodes.added.length); line("nodes removed", d.nodes.removed.length); line("nodes moved", d.nodes.moved.length); line("nodes renamed", d.nodes.renamed.length); line("node evidence changed", d.nodes.evidence_changed.length); line("nodes changed floor", d.nodes.floor_changed.length);
  line("edges added", d.edges.added.length); line("edges removed", d.edges.removed.length); line("edges measured", d.edges.measured.length); line("edges lost measurement", d.edges.unmeasured.length); line("instructions changed", d.edges.instruction_changed.length); line("edges re-wired", d.edges.topology_changed.length);
  line("destinations added", d.destinations.added.length); line("destinations removed", d.destinations.removed.length); line("arrival evidence changed", d.destinations.arrival_changed.length); line("identity evidence changed", d.destinations.identity_changed.length); line("destinations renamed/re-pointed", d.destinations.renamed.length);
  line("anchors added", d.anchors.added.length); line("anchors removed", d.anchors.removed.length); line("anchors changed", d.anchors.changed.length);
  line("amenities added", d.amenities.added.length); line("amenities removed", d.amenities.removed.length); line("amenities changed", d.amenities.changed.length);
  for (const e of d.venue.evidence_changed) s.push(`venue ${e.concern}: ${e.from} → ${e.to}`);
  if (d.venue.unit_changed) s.push(`distance unit: ${d.venue.unit_changed.from} → ${d.venue.unit_changed.to}`);
  if (d.venue.policies_changed) s.push("policies changed");
  if (s.length === 1) s.push("no changes");
  return d;
}

export function formatDiff(d: PackDiff): string {
  const out: string[] = [...d.summary];
  const list = (label: string, xs: string[]) => { if (xs.length) out.push(`  ${label}: ${xs.join(", ")}`); };
  list("nodes added", d.nodes.added); list("nodes removed", d.nodes.removed);
  for (const m of d.nodes.moved) out.push(`  node moved ${m.id}: (${m.from[0]}, ${m.from[1]}) → (${m.to[0]}, ${m.to[1]})`);
  for (const e of d.nodes.evidence_changed) out.push(`  node evidence ${e.id}: ${e.from} → ${e.to}`);
  list("edges added", d.edges.added); list("edges removed", d.edges.removed);
  for (const m of d.edges.measured) out.push(`  edge measured ${m.id}: ${m.distance_m} m`);
  for (const i of d.edges.instruction_changed) out.push(`  instruction ${i.direction} changed on ${i.id}`);
  list("edges re-wired", d.edges.topology_changed);
  list("destinations added", d.destinations.added); list("destinations removed", d.destinations.removed);
  for (const a of d.destinations.arrival_changed) out.push(`  arrival ${a.id}: ${a.from} → ${a.to}`);
  for (const a of d.destinations.identity_changed) out.push(`  identity ${a.id}: ${a.from} → ${a.to}`);
  list("anchors added", d.anchors.added); list("anchors removed", d.anchors.removed); list("anchors changed", d.anchors.changed);
  list("amenities added", d.amenities.added); list("amenities removed", d.amenities.removed); list("amenities changed", d.amenities.changed);
  list("floors added", d.floors.added); list("floors removed", d.floors.removed); list("floors relabelled", d.floors.relabelled);
  return out.join("\n");
}
