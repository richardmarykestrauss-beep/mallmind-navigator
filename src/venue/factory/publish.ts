/**
 * publish.ts — the publish gate. A draft becomes a publishable pack only when EVERY check passes:
 *   schema valid · all references resolve · no unresolved blocking evidence · metric truth ·
 *   unique venue id (against the bundled packs) · start/destination rules · evidence coherence ·
 *   the app's validator passes · routability from every start anchor · a human approval that
 *   matches the exact draft bytes · pack_version continuity with the base pack.
 * Pure: it reports; the CLI writes.
 */

import type { VenuePack } from "../contract";
import { validateVenuePack } from "../validate";
import { loadVenuePack } from "../load";
import { buildRoute } from "../route";
import { searchableDestinations } from "../search";
import type { EvidenceLedger, IngestionJob, ApprovalState } from "./types";
import type { Issue } from "./validateInputs";

export interface GateContext {
  job: IngestionJob;
  draft: VenuePack;
  draftSha256: string;
  ledger: EvidenceLedger;
  approval: ApprovalState | null;
  /** Venue ids already bundled in the app (from the registry). */
  bundledIds: readonly string[];
  /** The pack this job revises (if any) for version continuity. */
  basePack: VenuePack | null;
  /** Explicitly replacing a bundled venue of the same id. */
  replace: boolean;
}

export type GateResult = { status: "ok"; warnings: string[] } | { status: "failed"; errors: Issue[]; warnings: string[] };

/** Ledger predicates whose unresolved (proposed) facts block publishing: anything the compiler would have used. */
const BLOCKING_PREDICATES = new Set(["floor", "geometry", "edge", "measurement", "instruction_forward", "instruction_reverse", "destination", "arrival", "anchor", "amenity", "field_confirmation", "accessibility"]);

export function publishGate(ctx: GateContext): GateResult {
  const errors: Issue[] = [];
  const warnings: string[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  // 1. schema + references + start/destination rules + evidence vocab: the app's validator
  const v = validateVenuePack(JSON.parse(JSON.stringify(ctx.draft)));
  if (v.status !== "ok") { for (const e of v.errors) fail(`draft ${e.path}`, e.message); return { status: "failed", errors, warnings }; }
  const pack = v.pack;

  // 2. approval must exist, be an approval, and match these exact draft bytes
  if (!ctx.approval) fail("approval", "no human approval recorded (venue:review with decision.action = approve)");
  else if (ctx.approval.decision !== "approve") fail("approval", `job was ${ctx.approval.decision}ed by ${ctx.approval.reviewer}: ${ctx.approval.reason}`);
  else if (ctx.approval.draft_sha256 !== ctx.draftSha256) fail("approval", `the draft changed after approval (approved sha256 ${ctx.approval.draft_sha256.slice(0, 12)}…, current ${ctx.draftSha256.slice(0, 12)}…); review again`);

  // 3. no unresolved blocking evidence
  const proposed = ctx.ledger.facts.filter((f) => f.status === "proposed");
  const blocking = proposed.filter((f) => BLOCKING_PREDICATES.has(f.predicate));
  if (blocking.length) fail("ledger", `${blocking.length} unresolved blocking fact(s): ${blocking.slice(0, 8).map((f) => f.fact_id).join(", ")}${blocking.length > 8 ? ", …" : ""}`);
  for (const f of proposed.filter((f) => !BLOCKING_PREDICATES.has(f.predicate))) warnings.push(`unresolved non-blocking fact ${f.fact_id} (${f.subject} ${f.predicate})`);

  // 4. metric truth (belt and braces beyond the validator)
  for (const e of pack.graph.edges) {
    if (e.evidence.measurement === "measured" && !(typeof e.distance_m === "number" && e.distance_m > 0)) fail(`draft $.graph.edges[${e.id}]`, "measured edge without positive distance_m");
    if (e.evidence.measurement !== "measured" && e.distance_m != null) fail(`draft $.graph.edges[${e.id}]`, "unmeasured edge carries distance_m");
  }
  if (pack.venue.evidence.measurement === "measured" && !pack.graph.edges.every((e) => e.evidence.measurement === "measured")) fail("draft $.venue.evidence.measurement", "venue claims measured but not every edge is");
  if (pack.venue.evidence.geometry === "field-verified" && !pack.graph.nodes.every((n) => n.evidence.geometry === "field-verified")) fail("draft $.venue.evidence.geometry", "venue claims field-verified geometry but some nodes are not");
  for (const d of pack.destinations) if (d.evidence.arrival === "verified_public_door") {
    const ok = ctx.ledger.facts.some((f) => f.status === "accepted" && f.evidence_class === "field_verified" && f.subject === `destination:${d.id}` && f.predicate === "arrival" && f.value === "verified_public_door");
    if (!ok) fail(`draft $.destinations[${d.id}]`, "verified_public_door without an accepted field_verified arrival fact");
  }

  // 5. identity / version rules
  if (pack.venue.id !== ctx.job.venue_id) fail("draft $.venue.id", `must equal the job's venue id "${ctx.job.venue_id}"`);
  if (ctx.bundledIds.includes(pack.venue.id) && !ctx.basePack && !ctx.replace) fail("draft $.venue.id", `"${pack.venue.id}" is already a bundled venue; open the job with --from-pack to revise it, or pass --replace to publish a replacement`);
  if (ctx.basePack) {
    if (ctx.basePack.venue.id !== pack.venue.id) fail("draft $.venue.id", `revises "${ctx.basePack.venue.id}" but is "${pack.venue.id}"`);
    if (pack.venue.pack_version !== ctx.basePack.venue.pack_version + 1) fail("draft $.venue.pack_version", `must be ${ctx.basePack.venue.pack_version + 1} (base is v${ctx.basePack.venue.pack_version}), got ${pack.venue.pack_version}`);
  } else if (pack.venue.pack_version !== ctx.job.pack_version) fail("draft $.venue.pack_version", `must equal the job's pack_version ${ctx.job.pack_version}`);
  if (ctx.job.published_pack_version != null && pack.venue.pack_version <= ctx.job.published_pack_version) fail("draft $.venue.pack_version", `this job already published v${ctx.job.published_pack_version}`);

  // 6. routability from every start anchor (same router the app uses)
  try {
    const loaded = loadVenuePack(pack);
    const dests = searchableDestinations(loaded);
    if (dests.length === 0) fail("draft $.destinations", "nothing to navigate to (no searchable destination)");
    for (const a of loaded.startAnchors) for (const d of dests) {
      if (d.arrivalNode === a.node) continue;
      const r = buildRoute(loaded, a.node, d.id);
      if (!(r.found && !r.fallback)) fail("routability", `no route from start "${a.id}" to "${d.id}"`);
    }
  } catch (err) { fail("draft", `loader rejected the draft: ${(err as Error).message}`); }

  return errors.length ? { status: "failed", errors, warnings } : { status: "ok", warnings };
}
