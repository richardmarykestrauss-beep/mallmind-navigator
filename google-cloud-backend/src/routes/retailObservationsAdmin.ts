import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { buildPublishPlan } from "../services/retail/index.js";

const router = Router();


function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Verifies bearer token and checks profiles.is_admin. Returns admin or null. */
async function requireAdmin(req: Request, res: Response) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization bearer token" });
    return null;
  }

  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired auth token" });
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    res.status(500).json({ error: `Profile lookup failed: ${profileError.message}` });
    return null;
  }

  if (!profile?.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return { user: userData.user, profile };
}


const ALLOWED_REVIEW_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "needs_more_info",
]);

function parseLimit(value: unknown, fallback = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 250);
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * GET /admin/retail-observations/publish-preview
 *
 * Read-only approved observation publish preview.
 * Mirrors the approved-only publisher gate but does not write to products.
 */
router.get("/publish-preview", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabaseClient();

  const mallId = typeof req.query.mall_id === "string"
    ? req.query.mall_id
    : "f4a2c1b3-8d7e-4f6a-9b0c-1d2e3f4a5b6c";
  const limit = parseLimit(req.query.limit, 100);

  try {
    const { data: observations, error: obsError } = await supabase
      .from("retail_price_observations")
      .select(`
        id,
        created_at,
        mall_id,
        shop_id,
        product_id,
        product_name,
        brand,
        model,
        category,
        price,
        original_price,
        trust_state,
        verification_method,
        confidence,
        review_status,
        review_note,
        published_at,
        shops(name, unit_number, floor),
        retail_data_sources(name, source_type, retailer_name, legal_status, base_trust),
        retail_source_snapshots(ref_label, ref_uri, captured_at, notes)
      `)
      .eq("mall_id", mallId)
      .eq("review_status", "approved")
      .is("published_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (obsError) {
      return res.status(500).json({ error: obsError.message });
    }

    const rows = observations ?? [];

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, mall_id, shop_id, name, price, data_quality_status")
      .eq("mall_id", mallId)
      .is("deleted_at", null);

    if (productsError) {
      return res.status(500).json({ error: productsError.message });
    }

    // Shared Retail Intelligence Core planner — same matching/trust/warning
    // logic as the controlled publisher script. No nowIso/verifiedBy: this
    // route is dry-run only and never writes payloads.
    const corePlan = buildPublishPlan(rows as any[], (products ?? []) as any[]);
    const rowById = new Map<string, any>(rows.map((row: any) => [row.id, row]));

    const plan = corePlan.map((item) => {
      const row = rowById.get(item.observation_id) ?? {};

      return {
        observation_id: item.observation_id,
        action: item.action,
        existing_product_id: item.existing_product_id,
        match_strategy: item.match_strategy,
        ambiguous_candidate_ids: item.ambiguous_candidate_ids,
        product_name: item.product_name,
        category: item.category,
        price: item.price,
        original_price: item.original_price,
        shop_name: row.shops?.name ?? null,
        shop_unit_number: row.shops?.unit_number ?? null,
        shop_floor: row.shops?.floor ?? null,
        trust_state: item.trust_state,
        verification_method: item.verification_method,
        confidence: item.confidence,
        review_note: item.review_note,
        projected_product_quality: item.projected_product_quality,
        projected_verified: item.projected_verified,
        projected_verification_method: item.projected_verification_method,
        existing_product_quality: item.existing_product?.data_quality_status ?? null,
        existing_product_price: item.existing_product?.price ?? null,
        source_name: row.retail_data_sources?.name ?? null,
        source_type: row.retail_data_sources?.source_type ?? null,
        snapshot_label: row.retail_source_snapshots?.ref_label ?? null,
        warnings: item.warnings,
      };
    });

    const warningCount = plan.reduce((sum, item) => sum + item.warnings.length, 0);
    const ambiguousCount = plan.filter((item) => item.match_strategy === "ambiguous").length;

    return res.json({
      mall_id: mallId,
      mode: "dry_run_preview",
      publishing_gate: "review_status=approved only",
      publishable_count: plan.length,
      warning_count: warningCount,
      ambiguous_count: ambiguousCount,
      plan,
    });
  } catch (error) {
    console.error("[admin/retail-observations/publish-preview]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/retail-observations
 *
 * Admin review queue for staged retail price observations.
 * Read-only. Requires admin bearer token.
 */
router.get("/", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabaseClient();

  const mallId = typeof req.query.mall_id === "string" ? req.query.mall_id : null;
  const reviewStatus = typeof req.query.review_status === "string" ? req.query.review_status : null;
  const limit = parseLimit(req.query.limit, 100);

  try {
    let query = supabase
      .from("retail_price_observations")
      .select(`
        id,
        created_at,
        updated_at,
        import_batch_id,
        source_id,
        snapshot_id,
        mall_id,
        shop_id,
        product_id,
        product_name,
        brand,
        model,
        category,
        price,
        original_price,
        is_on_special,
        special_description,
        in_stock,
        observed_at,
        valid_from,
        valid_to,
        trust_state,
        verification_method,
        confidence,
        review_status,
        reviewed_by,
        reviewed_at,
        review_note,
        published_product_id,
        published_at,
        observation_hash,
        shops(name, unit_number, floor),
        retail_data_sources(name, source_type, retailer_name, legal_status, base_trust),
        retail_source_snapshots(ref_label, ref_uri, captured_at, notes)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (mallId) query = query.eq("mall_id", mallId);
    if (reviewStatus && reviewStatus !== "all") query = query.eq("review_status", reviewStatus);

    const { data, error } = await query;

    if (error) {
      console.error("[admin/retail-observations] select error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    const rows = data ?? [];
    const counts = rows.reduce<Record<string, number>>((acc, row: any) => {
      const key = row.review_status ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return res.json({ observations: rows, counts });
  } catch (error) {
    console.error("[admin/retail-observations]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /admin/retail-observations/:id/review
 *
 * Review staged retail observation.
 * This does not publish to products. Publishing remains a separate controlled step.
 */
router.post("/:id/review", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabaseClient();
  const observationId = req.params.id;
  const adminEmail = admin.user.email ?? admin.profile.full_name ?? admin.user.id;
  const now = new Date().toISOString();

  try {
    const status = normalizeStatus(req.body?.review_status);
    const note = typeof req.body?.review_note === "string" ? req.body.review_note.trim() : "";

    if (!status || !ALLOWED_REVIEW_STATUSES.has(status)) {
      return res.status(400).json({
        error: "review_status must be one of: pending, approved, rejected, needs_more_info",
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("retail_price_observations")
      .select("*")
      .eq("id", observationId)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }

    if (!existing) {
      return res.status(404).json({ error: "Retail observation not found" });
    }

    if (existing.review_status === "published") {
      return res.status(400).json({
        error: "Published observations cannot be changed from the review queue.",
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("retail_price_observations")
      .update({
        review_status: status,
        reviewed_by: adminEmail,
        reviewed_at: now,
        review_note: note || null,
      })
      .eq("id", observationId)
      .neq("review_status", "published")
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    await supabase.from("admin_audit_log").insert({
      admin_id: admin.user.id,
      action: "retail_observation_reviewed",
      table_name: "retail_price_observations",
      row_id: observationId,
      old_values: {
        review_status: existing.review_status,
        review_note: existing.review_note,
      },
      new_values: {
        review_status: status,
        review_note: note || null,
      },
    });

    return res.json({ ok: true, observation: updated });
  } catch (error) {
    console.error("[admin/retail-observations/:id/review]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
