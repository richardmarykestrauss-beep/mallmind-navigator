/**
 * adminVerifyProduct.ts — Sprint 20A.8B (hardened)
 *
 * A product can no longer be manufactured into a verified state directly from a
 * product_id + method + source name. Verification MUST come from an approved,
 * evidence-backed retail_price_observation, validated by the shared verification
 * policy and published atomically by the publish_verified_observation RPC.
 *
 * The legacy request shape (product_id + price_verification_method) is refused
 * with a clear migration message rather than silently bypassing evidence.
 */

import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { publishApprovedObservation } from "../services/retailObservationPublisher.js";

const router = Router();

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

const LEGACY_MIGRATION_MESSAGE =
  "Direct product verification by product_id + method is no longer supported. " +
  "Create and approve an evidence-backed retail_price_observation, then call " +
  "this endpoint with { observation_id }. Verification is projected from the " +
  "approved observation through the shared verification policy.";

router.post("/verify-product-price", async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization bearer token" });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return res.status(401).json({ error: "Invalid or expired auth token" });
    }
    const user = userData.user;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: `Failed to check admin profile: ${profileError.message}` });
    }
    if (!profile?.is_admin) {
      return res.status(403).json({ error: "Not authorized. Admin access required." });
    }

    const { observation_id, product_id, price_verification_method, verified_by } =
      req.body as {
        observation_id?: string;
        product_id?: string;
        price_verification_method?: string;
        verified_by?: string;
      };

    // ── Reject the legacy evidence-free shape with a migration message ────────
    if (!observation_id) {
      if (product_id || price_verification_method) {
        return res.status(400).json({
          error: "Evidence-backed observation_id is required.",
          migration: LEGACY_MIGRATION_MESSAGE,
        });
      }
      return res.status(400).json({ error: "observation_id is required" });
    }

    const verifiedBy =
      verified_by?.trim() ||
      profile.full_name ||
      profile.username ||
      user.email ||
      user.id;

    // ── Validate via the shared policy + publish atomically via the RPC ──────
    const result = await publishApprovedObservation(
      supabase,
      observation_id,
      user.id,
      verifiedBy,
      new Date().toISOString()
    );

    if (!result.ok) {
      return res.status(result.httpStatus).json({
        verified: false,
        error: result.error,
        blockers: result.blockers,
        warnings: result.warnings,
      });
    }

    return res.json({
      verified: true,
      observation_id,
      published_product_id: result.published_product_id,
      action: result.action,
      projected_quality: result.decision?.projectedQuality,
      projected_verified_at: result.decision?.projectedVerifiedAt,
      projected_valid_until: result.decision?.projectedValidUntil,
      warnings: result.warnings ?? [],
    });
  } catch (error) {
    console.error("[admin verify product]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
