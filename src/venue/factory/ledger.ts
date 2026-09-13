/**
 * ledger.ts — the evidence ledger: how facts enter, and how ONLY humans move them.
 *
 *   extraction / field import  →  facts with status "proposed"   (never anything else)
 *   review (accept/reject/override/unresolved) → status transitions with a recorded decision
 *
 * Rules: an inference-class fact (ai_inference, manual_inference) is never bulk-accepted; an
 * override never deletes — it marks the old fact `superseded` and appends the replacement with a
 * `supersedes` link; a rejected fact stays in the ledger forever. Pure functions; no I/O, no clock
 * (timestamps come from the review document).
 */

import {
  INFERENCE_CLASSES, type EvidenceLedger, type EvidenceFact, type CandidateExtraction, type CandidatePoint, type ReviewInput, type FieldImport,
  type FactValue, type SourceEntry, type EvidenceClass,
} from "./types";
import type { Issue } from "./validateInputs";
import { VENUE_PLANE } from "../validate";

export type LedgerResult = { status: "ok"; ledger: EvidenceLedger; added: number; changed: number; warnings: string[] } | { status: "failed"; errors: Issue[] };

/** Normalise a candidate point to plane percent, resolving image pixels through the registered image system. */
export function normalizePoint(at: CandidatePoint, sources: ReadonlyMap<string, SourceEntry>): { status: "ok"; x_percent: number; y_percent: number; provenance: Record<string, string | number> } | { status: "failed"; message: string } {
  if ("image" in at) {
    const src = sources.get(at.image);
    if (!src) return { status: "failed", message: `image source "${at.image}" is not in the manifest` };
    if (!src.image) return { status: "failed", message: `source "${at.image}" has no registered image coordinate system` };
    if (at.px_x > src.image.width_px || at.px_y > src.image.height_px) return { status: "failed", message: `pixel (${at.px_x}, ${at.px_y}) lies outside ${src.image.width_px}×${src.image.height_px} of "${at.image}"` };
    const { width_px: w, height_px: h, fit } = src.image;
    const r = (n: number) => Math.round(n * 100) / 100;
    let x = (at.px_x / w) * 100;
    let y = (at.px_y / h) * 100;
    if (fit === "pad-to-plane") {
      // Letterbox the source (centred) inside the 1000:620 plane so its aspect is preserved.
      const plane = VENUE_PLANE.width / VENUE_PLANE.height;
      const aspect = w / h;
      if (aspect < plane) { const fullW = h * plane; x = ((at.px_x + (fullW - w) / 2) / fullW) * 100; }
      else if (aspect > plane) { const fullH = w / plane; y = ((at.px_y + (fullH - h) / 2) / fullH) * 100; }
    }
    return {
      status: "ok",
      x_percent: r(x),
      y_percent: r(y),
      provenance: { source_image: at.image, source_px_x: at.px_x, source_px_y: at.px_y, source_width_px: w, source_height_px: h, source_fit: fit, x_percent_source: r((at.px_x / w) * 100), y_percent_source: r((at.px_y / h) * 100) },
    };
  }
  return { status: "ok", x_percent: at.x_percent, y_percent: at.y_percent, provenance: {} };
}

const scalarOf = (v: unknown): string | number | boolean | null => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null);

/**
 * Turn a validated extraction into proposed facts. Every candidate becomes exactly one fact whose
 * fact_id is the candidate id (so a review addresses candidates directly); free facts get their own
 * ids. Points are normalised here so the ledger holds plane coordinates plus pixel provenance.
 */
export function factsFromExtraction(extraction: CandidateExtraction, proposedBy: string, sources: ReadonlyMap<string, SourceEntry>): { status: "ok"; facts: EvidenceFact[] } | { status: "failed"; errors: Issue[] } {
  const errors: Issue[] = [];
  const facts: EvidenceFact[] = [];
  const base = (c: { id: string; source_id: string; evidence_class: EvidenceClass; confidence: number; manual_review_required: boolean; notes?: string }) => ({
    fact_id: c.id, source_id: c.source_id, evidence_class: c.evidence_class, confidence: c.confidence, status: "proposed" as const,
    proposed_by: proposedBy, manual_review_required: c.manual_review_required || INFERENCE_CLASSES.includes(c.evidence_class), ...(c.notes ? { notes: c.notes } : {}),
  });
  const pt = (path: string, at: CandidatePoint) => { const n = normalizePoint(at, sources); if (n.status === "failed") { errors.push({ path, message: n.message }); return null; } return n; };
  const pts = (path: string, list: CandidatePoint[]) => list.map((p, i) => pt(`${path}[${i}]`, p)).filter((p): p is NonNullable<typeof p> => p !== null).map((p) => ({ x_percent: p.x_percent, y_percent: p.y_percent, ...p.provenance }));

  extraction.floors.forEach((f) => facts.push({ ...base(f), subject: `floor:${f.id}`, predicate: "floor", value: { label: f.label, order: f.order, aliases: (f.aliases ?? []).join("|") } }));
  extraction.nodes.forEach((n, i) => {
    const p = pt(`$.nodes[${i}].at`, n.at); if (!p) return;
    facts.push({ ...base(n), subject: `node:${n.id}`, predicate: "geometry", value: { name: n.name, kind: n.kind, floor: n.floor, x_percent: p.x_percent, y_percent: p.y_percent, ...p.provenance } });
  });
  extraction.unit_polygons.forEach((u, i) => facts.push({ ...base(u), subject: `unit:${u.id}`, predicate: "unit_polygon", value: [{ floor: u.floor, label: u.label ?? null }, ...pts(`$.unit_polygons[${i}].points`, u.points)] }));
  extraction.store_labels.forEach((l, i) => { const p = pt(`$.store_labels[${i}].at`, l.at); if (!p) return; facts.push({ ...base(l), subject: `label:${l.id}`, predicate: "store_label", value: { text: l.text, floor: l.floor, unit: l.unit ?? null, x_percent: p.x_percent, y_percent: p.y_percent, ...p.provenance } }); });
  extraction.corridor_centerlines.forEach((c, i) => facts.push({ ...base(c), subject: `centerline:${c.id}`, predicate: "corridor_centerline", value: [{ floor: c.floor }, ...pts(`$.corridor_centerlines[${i}].points`, c.points)] }));
  extraction.edges.forEach((e) => facts.push({ ...base(e), subject: `edge:${e.id}`, predicate: "edge", value: { from: e.from, to: e.to, bidirectional: e.bidirectional ?? true, floor_change: e.floor_change ?? false, vertical_kind: e.vertical_kind ?? null, length_px: e.length_px ?? null } }));
  extraction.instructions.forEach((s) => facts.push({ ...base(s), subject: `edge:${s.edge}`, predicate: `instruction_${s.direction}`, value: s.text }));
  extraction.destinations.forEach((d) => facts.push({ ...base(d), subject: `destination:${d.id}`, predicate: "destination", value: { name: d.name, kind: d.kind, category: d.category ?? null, arrival_node: d.arrival_node, unit: d.unit ?? null, aliases: (d.aliases ?? []).join("|") } }));
  extraction.anchors.forEach((a) => facts.push({ ...base(a), subject: `anchor:${a.id}`, predicate: "anchor", value: { node: a.node, label: a.label, kind: a.kind, start_permitted: a.start_permitted, qr_eligible: a.qr_eligible ?? a.start_permitted } }));
  extraction.amenities.forEach((a) => facts.push({ ...base(a), subject: `amenity:${a.id}`, predicate: "amenity", value: { kind: a.kind, name: a.name, node: a.node, routable: a.routable, aliases: (a.aliases ?? []).join("|") } }));
  extraction.facts.forEach((f) => facts.push({ ...base(f), subject: f.subject, predicate: f.predicate, value: f.value }));
  return errors.length ? { status: "failed", errors } : { status: "ok", facts };
}

/** Field observations become proposed field_verified facts — the same review gate applies. */
export function factsFromFieldImport(fi: FieldImport, proposedBy: string, sources: ReadonlyMap<string, SourceEntry>): { status: "ok"; facts: EvidenceFact[] } | { status: "failed"; errors: Issue[] } {
  const errors: Issue[] = [];
  const facts: EvidenceFact[] = [];
  const src = sources.get(fi.source_id);
  if (!src) errors.push({ path: "$.source_id", message: `source "${fi.source_id}" is not in the manifest` });
  else if (src.type !== "field_measurement" && src.type !== "field_photo") errors.push({ path: "$.source_id", message: `field data must cite a field_measurement or field_photo source (got ${src.type})` });
  const base = (id: string, notes?: string) => ({ fact_id: id, source_id: fi.source_id, evidence_class: "field_verified" as const, confidence: 1, status: "proposed" as const, proposed_by: proposedBy, manual_review_required: true, ...(notes ? { notes } : {}) });
  fi.measurements.forEach((m) => facts.push({ ...base(m.id, m.notes), subject: `edge:${m.edge}`, predicate: "measurement", value: { distance_m: m.distance_m, method: m.method, observer: fi.observer, observed_at: fi.observed_at } }));
  fi.node_confirmations.forEach((n, i) => {
    let value: FactValue = { observer: fi.observer, observed_at: fi.observed_at };
    if (n.at) { const p = normalizePoint(n.at, sources); if (p.status === "failed") { errors.push({ path: `$.node_confirmations[${i}].at`, message: p.message }); return; } value = { ...value, x_percent: p.x_percent, y_percent: p.y_percent, ...p.provenance }; }
    facts.push({ ...base(n.id, n.notes), subject: `node:${n.node}`, predicate: "field_confirmation", value });
  });
  fi.door_confirmations.forEach((d) => facts.push({ ...base(d.id, d.notes), subject: `destination:${d.destination}`, predicate: "arrival", value: "verified_public_door" }));
  fi.accessibility.forEach((a) => facts.push({ ...base(a.id, a.notes), subject: a.subject, predicate: "accessibility", value: { step_free: a.step_free, observer: fi.observer, observed_at: fi.observed_at } }));
  return errors.length ? { status: "failed", errors } : { status: "ok", facts };
}

/** Append proposed facts. A fact id already present is an error (nothing is overwritten). */
export function appendFacts(ledger: EvidenceLedger, facts: EvidenceFact[]): LedgerResult {
  const errors: Issue[] = [];
  const known = new Set(ledger.facts.map((f) => f.fact_id));
  facts.forEach((f, i) => {
    if (f.status !== "proposed") errors.push({ path: `$[${i}].status`, message: `facts enter the ledger as "proposed" only (got ${f.status})` });
    if (known.has(f.fact_id)) errors.push({ path: `$[${i}].fact_id`, message: `fact "${f.fact_id}" already exists in the ledger; use a review override to replace it` });
    known.add(f.fact_id);
  });
  if (errors.length) return { status: "failed", errors };
  return { status: "ok", ledger: { ...ledger, facts: [...ledger.facts, ...facts] }, added: facts.length, changed: 0, warnings: [] };
}

/** Apply a human review. Every referenced fact must exist and be decidable; nothing is deleted. */
export function applyReview(ledger: EvidenceLedger, review: ReviewInput): LedgerResult {
  const errors: Issue[] = [];
  const warnings: string[] = [];
  const facts = ledger.facts.map((f) => ({ ...f }));
  const byId = new Map(facts.map((f) => [f.fact_id, f]));
  const touched = new Set<string>();
  const decide = (path: string, id: string, action: "accept" | "reject" | "unresolved", reason: string | undefined, nextStatus: EvidenceFact["status"]) => {
    const f = byId.get(id);
    if (!f) { errors.push({ path, message: `unknown fact "${id}"` }); return; }
    if (touched.has(id)) { errors.push({ path, message: `fact "${id}" is decided twice in this review` }); return; }
    if (f.status === "superseded") { errors.push({ path, message: `fact "${id}" was superseded by "${f.superseded_by}"; decide that one` }); return; }
    if (action === "accept" && INFERENCE_CLASSES.includes(f.evidence_class) && !reason) { errors.push({ path, message: `accepting inference fact "${id}" requires a reason` }); return; }
    touched.add(id);
    f.status = nextStatus;
    f.decision = { by: review.reviewer, at: review.reviewed_at, action, reason: reason ?? (action === "accept" ? "accepted as submitted" : "left unresolved") };
  };
  review.accept.forEach((d, i) => decide(`$.accept[${i}]`, d.fact_id, "accept", d.reason, "accepted"));
  review.reject.forEach((d, i) => decide(`$.reject[${i}]`, d.fact_id, "reject", d.reason, "rejected"));
  review.unresolved.forEach((d, i) => decide(`$.unresolved[${i}]`, d.fact_id, "unresolved", d.reason, "proposed"));
  review.override.forEach((o, i) => {
    const path = `$.override[${i}]`;
    const old = byId.get(o.fact_id);
    if (!old) { errors.push({ path, message: `unknown fact "${o.fact_id}"` }); return; }
    if (touched.has(o.fact_id)) { errors.push({ path, message: `fact "${o.fact_id}" is decided twice in this review` }); return; }
    if (old.status === "superseded") { errors.push({ path, message: `fact "${o.fact_id}" was already superseded by "${old.superseded_by}"` }); return; }
    touched.add(o.fact_id);
    const n = (facts.filter((f) => f.supersedes === o.fact_id || f.fact_id.startsWith(`${o.fact_id}~`)).length) + 1;
    const replacement: EvidenceFact = {
      fact_id: `${o.fact_id}~o${n}`, subject: old.subject, predicate: old.predicate, value: o.value,
      source_id: o.source_id ?? old.source_id, evidence_class: o.evidence_class ?? "manual_inference", confidence: 1,
      status: "accepted", proposed_by: "review", manual_review_required: false, supersedes: o.fact_id,
      decision: { by: review.reviewer, at: review.reviewed_at, action: "override", reason: o.reason },
    };
    old.status = "superseded"; old.superseded_by = replacement.fact_id;
    old.decision = { by: review.reviewer, at: review.reviewed_at, action: "override", reason: o.reason };
    facts.push(replacement); byId.set(replacement.fact_id, replacement);
  });
  for (const cls of review.accept_all_of_class ?? []) {
    if (INFERENCE_CLASSES.includes(cls)) { errors.push({ path: "$.accept_all_of_class", message: `"${cls}" cannot be bulk-accepted` }); continue; }
    let n = 0;
    for (const f of facts) if (f.status === "proposed" && f.evidence_class === cls && !touched.has(f.fact_id)) {
      if (f.manual_review_required) { warnings.push(`${f.fact_id} (${cls}) is flagged manual_review_required and was NOT bulk-accepted`); continue; }
      touched.add(f.fact_id); f.status = "accepted"; f.decision = { by: review.reviewer, at: review.reviewed_at, action: "accept", reason: `bulk accept of class ${cls}` }; n++;
    }
    if (n === 0) warnings.push(`accept_all_of_class ${cls}: nothing to accept`);
  }
  if (errors.length) return { status: "failed", errors };
  return { status: "ok", ledger: { ...ledger, facts }, added: review.override.length, changed: touched.size, warnings };
}

export const scalar = scalarOf;

/** Current (non-superseded) facts by subject+predicate, in ledger order. */
export function currentFacts(ledger: EvidenceLedger): EvidenceFact[] { return ledger.facts.filter((f) => f.status !== "superseded"); }

export function ledgerSummary(ledger: EvidenceLedger): Record<EvidenceFact["status"], number> {
  const s = { proposed: 0, accepted: 0, rejected: 0, superseded: 0 };
  for (const f of ledger.facts) s[f.status]++;
  return s;
}
