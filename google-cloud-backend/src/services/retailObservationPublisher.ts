/**
 * retailObservationPublisher.ts — Sprint 20A.8
 *
 * Backend glue that turns an APPROVED evidence-backed retail_price_observation
 * into a verified product projection. It:
 *   1. loads the observation (+ joined source & snapshot),
 *   2. runs the shared deterministic verification policy (good error messages),
 *   3. delegates the actual write to the atomic server-side RPC
 *      `publish_verified_observation` (the authoritative gate — re-validates and
 *      updates product + observation + audit in ONE transaction).
 *
 * This is the only sanctioned path for a product to become newly
 * manually_verified. The routes (adminVerifyProduct, priceCorrections) call it
 * instead of manufacturing verified state themselves.
 *
 * Not pure (Supabase I/O) — deliberately lives in services/, not services/retail/.
 */

import { getSupabaseClient } from "../lib/supabase";
import {
  evaluateObservationVerification,
  buildProductIndex,
  matchObservationToProduct,
  type VerificationDecision,
} from "./retail/index";

type Supa = ReturnType<typeof getSupabaseClient>;

export interface PublishObservationResult {
  ok: boolean;
  httpStatus: number;
  decision?: VerificationDecision;
  published_product_id?: string | null;
  action?: string | null;
  error?: string;
  blockers?: string[];
  warnings?: string[];
}

const OBSERVATION_SELECT =
  "id, mall_id, shop_id, product_id, product_name, brand, model, category, " +
  "price, original_price, is_on_special, special_description, in_stock, " +
  "observed_at, valid_from, valid_to, trust_state, verification_method, confidence, " +
  "review_status, published_product_id, published_at, source_id, snapshot_id, " +
  "retail_data_sources:source_id ( id, source_type, legal_status, is_active, base_trust, name ), " +
  "retail_source_snapshots:snapshot_id ( id, ref_label, content_sha256 )";

/**
 * Validate + atomically publish an approved observation onto a product.
 *
 * @param nowIso  Deterministic "now" passed to the pure policy.
 */
export async function publishApprovedObservation(
  supabase: Supa,
  observationId: string,
  adminId: string,
  verifiedBy: string | null,
  nowIso: string
): Promise<PublishObservationResult> {
  // 1. Load the observation with its source + snapshot.
  const { data: obs, error: obsErr } = await supabase
    .from("retail_price_observations")
    .select(OBSERVATION_SELECT)
    .eq("id", observationId)
    .maybeSingle();

  if (obsErr) {
    // Unexpected DB failure — log internals, return a safe message.
    console.error("[publishApprovedObservation] observation load failed:", obsErr);
    return { ok: false, httpStatus: 500, error: "Could not load the observation." };
  }
  if (!obs) {
    return { ok: false, httpStatus: 404, error: "Observation not found" };
  }

  const o = obs as unknown as Record<string, unknown>;

  // 2. Pre-compute the product match (ambiguity / identity) for a clear answer
  //    BEFORE we touch the RPC. The RPC re-checks this authoritatively.
  const { data: shopProducts } = await supabase
    .from("products")
    .select("id, shop_id, mall_id, name, data_quality_status")
    .eq("shop_id", String(o.shop_id ?? ""))
    .is("deleted_at", null);

  const index = buildProductIndex((shopProducts ?? []) as never);
  const match = matchObservationToProduct(obs as never, index);
  const matchedProduct = match.product as unknown as Record<string, unknown> | null;
  const product = matchedProduct
    ? {
        id: String(matchedProduct.id ?? ""),
        mall_id: (matchedProduct.mall_id as string | null) ?? null,
        shop_id: (matchedProduct.shop_id as string | null) ?? null,
      }
    : null;

  // 3. Deterministic policy pre-check (defence-in-depth + actionable errors).
  const decision = evaluateObservationVerification({
    observation: obs as never,
    source: (o.retail_data_sources as never) ?? null,
    snapshot: (o.retail_source_snapshots as never) ?? null,
    match,
    product,
    nowIso,
  });

  if (!decision.eligible) {
    return {
      ok: false,
      httpStatus: 422,
      decision,
      blockers: decision.blockers,
      warnings: decision.warnings,
      error: "Observation is not eligible for verified publication.",
    };
  }

  // 4. Atomic publish via the server-side RPC (authoritative transaction).
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "publish_verified_observation",
    {
      p_observation_id: observationId,
      p_admin_id: adminId,
      p_verified_by: verifiedBy,
    }
  );

  if (rpcErr) {
    // Always log the full technical error internally.
    console.error("[publishApprovedObservation] RPC error:", rpcErr);

    // ONLY treat a genuinely-missing function/column as "pending migration".
    // PostgREST returns code PGRST202 for an unknown RPC; the schema-cache
    // message names the missing function/column precisely. Any OTHER error
    // (constraint, raised check_violation, connectivity) is a real failure and
    // must NOT be mislabelled as a missing migration.
    const code = (rpcErr as { code?: string }).code ?? "";
    const msg = rpcErr.message ?? "";
    const migrationMissing =
      code === "PGRST202" ||
      /could not find the function\s+public\.publish_verified_observation/i.test(msg) ||
      /function\s+public\.publish_verified_observation[^]*does not exist/i.test(msg) ||
      /column\s+"?price_valid_until"?\s+(?:of relation\s+"?products"?\s+)?does not exist/i.test(msg);

    if (migrationMissing) {
      return {
        ok: false,
        httpStatus: 503,
        decision,
        error: "Verified publication is temporarily unavailable (pending a database update).",
      };
    }

    return {
      ok: false,
      httpStatus: 500,
      decision,
      error: "Publish failed during the verified-publication transaction.",
    };
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { published_product_id?: string; action?: string }
    | null
    | undefined;

  return {
    ok: true,
    httpStatus: 200,
    decision,
    published_product_id: row?.published_product_id ?? null,
    action: row?.action ?? null,
    warnings: decision.warnings,
  };
}
