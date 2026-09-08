/**
 * canonicalStagingMapper — Sprint 3A.3.
 *
 * Maps a validated fabric OfferDraft into the EXACT argument list of the migration-040
 * `stage_retail_feed_observation` RPC. Pure + deterministic; no I/O, no network, no DB.
 *
 * Doctrine enforced here:
 *  - Never assign or upgrade rights (rights live in the source registry; the RPC re-checks).
 *  - Never assert branch/in-store availability from retailer presence. `availability_scope`
 *    is only 'online' for online scopes, otherwise 'unknown'; branch intent is expressed via
 *    `price_scope='branch_specific'`, which forces the RPC to demand an approved mapping.
 *  - Never fabricate a price/scope. Unknown optional facts stay null/unknown, never guessed.
 *  - The DB RPC (md5 observation_hash + unique-pending index) stays the identity/replay
 *    authority; the tuple built here is ADVISORY (for pre-checks/telemetry) only.
 */

import type { OfferDraft } from "@/lib/fabric/types";

/** The exact 040 RPC argument object (keys match the SQL parameter names). */
export interface StageRetailFeedObservationArgs {
  p_actor: string;
  p_source_id: string;
  p_source_product_id: string | null;
  p_retailer_sku: string | null;
  p_gtin: string | null;
  p_barcode: string | null;
  p_product_name: string;
  p_brand: string | null;
  p_pack_size: string | null;
  p_category: string | null;
  p_currency: string;
  p_current_price_cents: number;
  p_original_price_cents: number | null;
  p_promotion_indicator: boolean;
  p_price_condition: string | null;
  p_price_condition_label: string | null;
  p_price_scope: string;
  p_availability_scope: string;
  p_branch_external_id: string | null;
  p_external_branch_name: string | null;
  p_stock_status: string;
  p_observed_at: string;
  p_source_url: string | null;
  p_source_row_number: number | null;
  p_source_file_name: string | null;
  p_parse_warnings: unknown;
  p_intake_job_id: string | null;
  p_intake_draft_ref: string | null;
}

export interface StageMappingContext {
  actorId: string;
  intakeJobId: string;
  draftRef: string;
  sourceFileName?: string | null;
  sourceRowNumber?: number | null;
}

/** Decimal-safe rand→integer-cents (OfferDraft.price is in major units). */
export function toCents(major: number): number {
  return Math.round((major + Number.EPSILON) * 100);
}

/** Normalize any ISO timestamp to UTC ISO-8601 SECOND precision: `YYYY-MM-DDThh:mm:ssZ`.
 *  Matches the RPC's `to_char(... at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`. */
export function normalizeObservedAtUtcSeconds(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid observed_at: ${iso}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** GeographicScope → price_scope enum (migration 036). Ambiguous scopes stay honest. */
export function priceScopeFromGeographic(scope: string): string {
  switch (scope) {
    case "branch": return "branch_specific";
    case "online_only":
    case "national": return "online_national";
    case "province": return "online_regional";
    case "mall":            // no mall-level price scope exists in the schema — do not fabricate
    case "unknown":
    default: return "unknown";
  }
}

/** AvailabilityStatus → stock_status enum (migration 026). "inferred" is never asserted as stock. */
export function stockStatusFromAvailability(status: string): string {
  switch (status) {
    case "known_available": return "in_stock";
    case "unavailable": return "out_of_stock";
    case "inferred":
    case "unknown":
    default: return "unknown";
  }
}

/** availability_scope enum (migration 036). Never 'branch_confirmed' from retailer presence. */
export function availabilityScopeFromGeographic(scope: string): string {
  return scope === "online_only" || scope === "national" ? "online" : "unknown";
}

/** The ADVISORY canonical identity tuple (same field order/normalization the RPC hashes). */
export function canonicalIdentityTuple(args: StageRetailFeedObservationArgs): string[] {
  return [
    args.p_source_id,
    args.p_source_product_id ?? args.p_retailer_sku ?? args.p_gtin ?? args.p_barcode ?? "",
    normalizeObservedAtUtcSeconds(args.p_observed_at),
    args.p_price_scope ?? "unknown",
    args.p_branch_external_id ?? "",
    String(args.p_current_price_cents),
  ];
}

/** Map one validated OfferDraft → the 040 RPC arguments. */
export function offerDraftToStageArgs(draft: OfferDraft, ctx: StageMappingContext): StageRetailFeedObservationArgs {
  return {
    p_actor: ctx.actorId,
    p_source_id: draft.sourceId,
    p_source_product_id: null,                     // fabric drafts carry sku/gtin, not a source product id
    p_retailer_sku: draft.retailerSku ?? null,
    p_gtin: draft.gtin ?? null,
    p_barcode: null,
    p_product_name: draft.productTitle,
    p_brand: draft.brand ?? null,
    p_pack_size: null,                             // not present on OfferDraft — never guessed
    p_category: draft.category ?? null,
    p_currency: draft.currency,
    p_current_price_cents: toCents(draft.price),
    p_original_price_cents: draft.originalPrice == null ? null : toCents(draft.originalPrice),
    p_promotion_indicator: draft.promoText != null && draft.promoText !== "",
    p_price_condition: null,                        // OfferDraft has no price_condition — do not guess
    p_price_condition_label: draft.promoText ?? null,
    p_price_scope: priceScopeFromGeographic(draft.geographicScope),
    p_availability_scope: availabilityScopeFromGeographic(draft.geographicScope),
    p_branch_external_id: null,                     // OfferDraft has no external branch code
    p_external_branch_name: null,
    p_stock_status: stockStatusFromAvailability(draft.availabilityStatus),
    p_observed_at: normalizeObservedAtUtcSeconds(draft.observedAt),
    p_source_url: null,
    p_source_row_number: ctx.sourceRowNumber ?? null,
    p_source_file_name: ctx.sourceFileName ?? null,
    p_parse_warnings: draft.warnings && draft.warnings.length ? draft.warnings : null,
    p_intake_job_id: ctx.intakeJobId,
    p_intake_draft_ref: ctx.draftRef,
  };
}
