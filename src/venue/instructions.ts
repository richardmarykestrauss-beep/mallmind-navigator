/**
 * instructions.ts — directional route instructions.
 *
 * An edge may carry source-backed wording for each direction separately (`forward` = from→to,
 * `reverse` = to→from). A sentence is NEVER reused for the opposite direction. When no text exists
 * for the direction walked, a generic sentence is derived ONLY from what the topology genuinely
 * supports: the kind of the node being reached and its recorded name. No landmarks are invented.
 */

import type { VenueFloor, VerticalKind } from "./contract";
import type { BackendNodeLike, BackendEdgeLike } from "../components/navigation/floorplanModel";

export interface LegContext {
  from: BackendNodeLike;
  to: BackendNodeLike;
  edge: BackendEdgeLike;
  /** true when walking edge.from → edge.to */
  forward: boolean;
  first: boolean;
  floorChange: boolean;
  /** Display label of the floor being reached (pack floors), if known. */
  toFloorLabel?: string;
  /** For a floor change: whether the visitor goes up or down (from floor order), if known. */
  direction?: "up" | "down" | null;
  policy: { generic_fallback: boolean; start_prefix: boolean };
}

const INTERNAL_KINDS = new Set(["corridor", "junction", "vertical"]);

function isInternal(node: BackendNodeLike): boolean {
  if (node.kind) return INTERNAL_KINDS.has(node.kind);
  return node.type === "corridor"; // hosted backend graphs carry no kind
}

const VERTICAL_WORD: Record<VerticalKind, string> = { lift: "the lift", escalator: "the escalator", stairs: "the stairs", ramp: "the ramp" };

/** Directional text if the pack supplies it for the direction walked; null otherwise. */
export function suppliedInstruction(edge: BackendEdgeLike, forward: boolean): string | null {
  const text = forward ? edge.instruction : edge.instruction_reverse;
  const t = typeof text === "string" ? text.trim() : "";
  return t ? t : null;
}

/** Generic, topology-only sentence (no invented landmarks). */
export function genericInstruction(ctx: LegContext): string {
  const { from, to, floorChange } = ctx;
  if (floorChange) {
    const via = ctx.edge.vertical_kind ? `Take ${VERTICAL_WORD[ctx.edge.vertical_kind]}` : "Change floor";
    const dir = ctx.edge.vertical_kind === "escalator" || ctx.edge.vertical_kind === "stairs" ? (ctx.direction === "down" ? " down" : ctx.direction === "up" ? " up" : "") : "";
    return ctx.toFloorLabel ? `${via}${dir} to ${ctx.toFloorLabel}.` : `${via}${dir}.`;
  }
  if (ctx.first) {
    if (isInternal(from)) return "Head off from your starting point.";
    return from.kind === "entrance" ? `Start at ${from.name} and head into the mall.` : `Start at ${from.name}.`;
  }
  if (isInternal(to)) return "Continue along the walkway.";
  return `Walk toward ${to.name}.`;
}

/**
 * The instruction for one leg. Supplied directional text wins; otherwise a generic sentence when
 * the policy allows it; otherwise a neutral "continue" so nothing is invented.
 */
export function instructionFor(ctx: LegContext): string {
  const supplied = suppliedInstruction(ctx.edge, ctx.forward);
  if (supplied) {
    return ctx.first && ctx.policy.start_prefix && !supplied.includes(ctx.from.name) ? `Start at ${ctx.from.name}. ${supplied}` : supplied;
  }
  if (ctx.policy.generic_fallback) return genericInstruction(ctx);
  return ctx.first ? `Start at ${ctx.from.name}.` : "Continue to the next point.";
}

/** Display label for a floor id from the pack's floor list (id itself when unknown). */
export function floorLabelFor(floors: readonly VenueFloor[], floorId: string | null | undefined, display: "label" | "id" = "label"): string {
  if (!floorId) return "";
  const f = floors.find((x) => x.id === floorId || x.aliases?.includes(floorId));
  if (!f) return floorId;
  return display === "id" ? f.id : f.label;
}
