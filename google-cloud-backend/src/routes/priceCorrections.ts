import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { publishApprovedObservation } from "../services/retailObservationPublisher.js";
import { buildUserCorrectionObservationDraft, assessSourceEligibility } from "../services/retail/index.js";

const router = Router();

// ── Allowed source types ──────────────────────────────────────────────────────
const ALLOWED_SOURCE_TYPES = new Set([
  "in_store_seen",
  "retailer_website",
  "catalogue",
  "user_memory",
  "other",
]);

// ── Allowed review actions ────────────────────────────────────────────────────
type ReviewAction = "approve" | "reject" | "needs_verification";
const ALLOWED_ACTIONS = new Set<ReviewAction>(["approve", "reject", "needs_verification"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** Verifies bearer token and checks is_admin. Returns admin user or null. */
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

/** Flatten Supabase nested join into flat report object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenReport(row: any) {
  return {
    id:                row.id,
    created_at:        row.created_at,
    updated_at:        row.updated_at,
    user_id:           row.user_id ?? null,
    mall_id:           row.mall_id ?? null,
    product_id:        row.product_id,
    shop_id:           row.shop_id ?? null,
    current_price:     row.current_price ?? null,
    reported_price:    row.reported_price ?? null,
    user_note:         row.user_note ?? null,
    source_type:       row.source_type ?? null,
    status:            row.status,
    admin_note:        row.admin_note ?? null,
    reviewed_by:       row.reviewed_by ?? null,
    reviewed_at:       row.reviewed_at ?? null,
    confidence_score:  row.confidence_score ?? null,
    metadata:          row.metadata ?? {},
    // Joined fields
    product_name:          row.products?.name ?? null,
    product_current_price: row.products?.price ?? null,
    shop_name:             row.shops?.name ?? null,
  };
}

// ── Part 2: POST /price-corrections/report ────────────────────────────────────

router.post("/report", async (req: Request, res: Response) => {
  const supabase = getSupabaseClient();

  try {
    const {
      product_id,
      shop_id,
      mall_id,
      current_price,
      reported_price,
      user_note,
      source_type,
      metadata = {},
    } = req.body as {
      product_id?: string;
      shop_id?: string | null;
      mall_id?: string | null;
      current_price?: number | null;
      reported_price?: number | null;
      user_note?: string | null;
      source_type?: string | null;
      metadata?: Record<string, unknown>;
    };

    // ── Validation ────────────────────────────────────────────────────────────
    if (!product_id) {
      return res.status(400).json({ error: "product_id is required" });
    }

    // Validate reported_price is positive if provided
    if (reported_price != null) {
      const price = Number(reported_price);
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({ error: "reported_price must be a positive number" });
      }
    }

    // Validate user_note length
    if (user_note && user_note.length > 500) {
      return res.status(400).json({ error: "user_note must be 500 characters or fewer" });
    }

    // Validate source_type
    const safeSourceType =
      source_type && ALLOWED_SOURCE_TYPES.has(source_type) ? source_type : "other";

    // Verify product exists
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, price")
      .eq("id", product_id)
      .maybeSingle();

    if (productError || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // ── Optional auth ─────────────────────────────────────────────────────────
    let user_id: string | null = null;
    const token = getBearerToken(req);
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user?.id) user_id = data.user.id;
    }

    // ── Insert report ─────────────────────────────────────────────────────────
    const { data: report, error: insertError } = await supabase
      .from("price_correction_reports")
      .insert({
        user_id,
        mall_id:        mall_id ?? null,
        product_id,
        shop_id:        shop_id ?? null,
        current_price:  current_price ?? null,
        reported_price: reported_price ?? null,
        user_note:      user_note?.trim() ?? null,
        source_type:    safeSourceType,
        status:         "pending",
        metadata:       metadata && typeof metadata === "object" ? metadata : {},
      })
      .select("id")
      .single();

    if (insertError || !report) {
      console.error("[price-corrections/report] insert error:", insertError?.message);
      return res.status(500).json({ error: "Failed to submit report" });
    }

    // ── Fire-and-forget analytics event ──────────────────────────────────────
    void supabase.from("analytics_events").insert({
      user_id,
      mall_id:     mall_id ?? null,
      product_id,
      shop_id:     shop_id ?? null,
      event_type:  "price_correction_reported",
      event_source: "frontend",
      metadata: {
        report_id:           report.id,
        source_type:         safeSourceType,
        product_name:        (metadata.product_name as string) ?? product.name,
        reported_price:      reported_price ?? null,
        current_price:       current_price ?? null,
        data_quality_status: (metadata.data_quality_status as string) ?? null,
      },
    });

    return res.json({ ok: true, report_id: report.id });
  } catch (error) {
    console.error("[price-corrections/report]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Part 3a: GET /price-corrections/admin ─────────────────────────────────────

router.get("/admin", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabaseClient();

  try {
    const [pendingResult, recentResult] = await Promise.all([
      supabase
        .from("price_correction_reports")
        .select("*, products(name, price), shops(name)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("price_correction_reports")
        .select("*, products(name, price), shops(name)")
        .in("status", ["approved", "rejected", "needs_verification"])
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

    if (pendingResult.error) console.warn("[price-corrections/admin]", pendingResult.error.message);
    if (recentResult.error) console.warn("[price-corrections/admin]", recentResult.error.message);

    return res.json({
      pending: (pendingResult.data ?? []).map(flattenReport),
      recent:  (recentResult.data  ?? []).map(flattenReport),
    });
  } catch (error) {
    console.error("[price-corrections/admin]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Part 3b: POST /price-corrections/admin/:id/review ─────────────────────────

router.post("/admin/:id/review", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase   = getSupabaseClient();
  const reportId   = req.params.id;
  const adminId    = admin.user.id;
  const adminEmail = admin.user.email ?? admin.profile.full_name ?? adminId;
  const now        = new Date().toISOString();

  try {
    const {
      action,
      approved_price,
      admin_note,
      observation_id,
      source_id,
    } = req.body as {
      action?: string;
      approved_price?: number;
      admin_note?: string;
      observation_id?: string;
      source_id?: string;
    };

    // Validate action
    if (!action || !ALLOWED_ACTIONS.has(action as ReviewAction)) {
      return res.status(400).json({
        error: "action must be one of: approve, reject, needs_verification",
      });
    }

    // Load report
    const { data: report, error: reportError } = await supabase
      .from("price_correction_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();

    if (reportError || !report) {
      return res.status(404).json({ error: "Report not found" });
    }

    // ── APPROVE ───────────────────────────────────────────────────────────────
    // A bare approval must NEVER manufacture an evidence-free verified price.
    // Two safe outcomes only:
    //   A) observation_id supplied → publish that approved, evidence-backed
    //      observation through the shared verification policy + atomic RPC.
    //   B) otherwise → STAGE a pending, user-submitted observation (requires a
    //      source_id) for evidence review. The product is left untouched.
    if (action === "approve") {
      const metadata = (report.metadata && typeof report.metadata === "object")
        ? report.metadata as Record<string, unknown>
        : {};

      // ── Path A: publish an approved evidence-backed observation ────────────
      if (observation_id) {
        const result = await publishApprovedObservation(
          supabase, observation_id, adminId, adminEmail, now
        );

        if (!result.ok) {
          return res.status(result.httpStatus).json({
            ok: false, action: "approve",
            error: result.error, blockers: result.blockers, warnings: result.warnings,
          });
        }

        await supabase
          .from("price_correction_reports")
          .update({
            status:      "approved",
            reviewed_by: adminId,
            reviewed_at: now,
            admin_note:  admin_note?.trim() ?? null,
            updated_at:  now,
            metadata: { ...metadata,
              published_observation_id: observation_id,
              published_product_id: result.published_product_id },
          })
          .eq("id", reportId);

        await supabase.from("admin_audit_log").insert({
          admin_id:   adminId,
          action:     "price_correction_published_observation",
          table_name: "products",
          row_id:     result.published_product_id,
          old_values: { report_id: reportId },
          new_values: { observation_id, published_product_id: result.published_product_id, action: result.action },
        });

        return res.json({
          ok: true, action: "approved",
          published_product_id: result.published_product_id,
          warnings: result.warnings ?? [],
        });
      }

      // ── Path B: stage a pending user-submitted observation ─────────────────
      if (!source_id) {
        return res.status(400).json({
          error: "Approval can no longer publish a verified price directly.",
          guidance:
            "Supply observation_id (an approved, evidence-backed observation) to " +
            "publish a verified price, or source_id to stage this correction as a " +
            "pending observation for evidence review. A user report alone never " +
            "creates a verified price.",
        });
      }

      const stagedPrice = Number(approved_price ?? report.reported_price);
      if (isNaN(stagedPrice) || stagedPrice <= 0) {
        return res.status(400).json({ error: "A positive price is required to stage an observation" });
      }

      // Pre-validate the supplied source BEFORE inserting, so an invalid or
      // ineligible source returns a precise 404/400 — never a generic FK 500.
      const { data: srcRow, error: srcErr } = await supabase
        .from("retail_data_sources")
        .select("id, is_active, legal_status")
        .eq("id", source_id)
        .maybeSingle();

      if (srcErr) {
        console.error("[price-corrections approve/stage] source lookup failed:", srcErr.message);
        return res.status(500).json({ error: "Could not validate the data source" });
      }

      const sourceCheck = assessSourceEligibility(srcRow);
      if (!sourceCheck.found) {
        return res.status(404).json({ error: "source_id not found" });
      }
      if (sourceCheck.blockers.length > 0) {
        // Inactive / legally ineligible source → clear 400, no DB internals.
        return res.status(400).json({
          error: "Source is not eligible to stage observations.",
          reasons: sourceCheck.blockers,
        });
      }

      // Confidence/method/trust come from policy — never a hard-coded score.
      const draft = buildUserCorrectionObservationDraft(report.source_type);

      const { data: prod } = await supabase
        .from("products")
        .select("name")
        .eq("id", report.product_id)
        .maybeSingle();
      const productName = prod?.name ?? "User-reported product";

      const { data: staged, error: stageErr } = await supabase
        .from("retail_price_observations")
        .insert({
          source_id,
          mall_id:             report.mall_id ?? null,
          shop_id:             report.shop_id ?? null,
          product_id:          report.product_id ?? null,
          product_name:        productName,
          price:               stagedPrice,
          observed_at:         now,
          trust_state:         draft.trust_state,
          verification_method: draft.verification_method,
          confidence:          draft.confidence,
          review_status:       "pending",
          review_note:         `Staged from price_correction_report ${reportId}`,
        })
        .select("id")
        .single();

      if (stageErr || !staged) {
        console.error("[price-corrections approve/stage]", stageErr?.message);
        return res.status(500).json({ error: "Failed to stage observation for review" });
      }

      await supabase
        .from("price_correction_reports")
        .update({
          status:           "approved",
          reviewed_by:      adminId,
          reviewed_at:      now,
          admin_note:       admin_note?.trim() ?? null,
          confidence_score: Math.round(draft.confidence * 100), // from source policy, not 85
          updated_at:       now,
          metadata: { ...metadata, staged_observation_id: staged.id },
        })
        .eq("id", reportId);

      await supabase.from("admin_audit_log").insert({
        admin_id:   adminId,
        action:     "price_correction_staged_observation",
        table_name: "retail_price_observations",
        row_id:     staged.id,
        old_values: { report_id: reportId, status: report.status },
        new_values: { staged_observation_id: staged.id, trust_state: draft.trust_state, confidence: draft.confidence },
      });

      void supabase.from("analytics_events").insert({
        user_id:      adminId,
        product_id:   report.product_id,
        shop_id:      report.shop_id ?? null,
        event_type:   "price_correction_staged_observation",
        event_source: "admin",
        metadata:     { report_id: reportId, staged_observation_id: staged.id },
      });

      return res.json({
        ok: true, action: "staged_for_review",
        staged_observation_id: staged.id,
        note: "Correction staged as a pending user-submitted observation. It will not " +
          "affect the shopper-facing price until reviewed and verified with evidence.",
      });
    }

    // ── REJECT ────────────────────────────────────────────────────────────────
    if (action === "reject") {
      await supabase
        .from("price_correction_reports")
        .update({
          status:      "rejected",
          reviewed_by: adminId,
          reviewed_at: now,
          admin_note:  admin_note?.trim() ?? null,
          updated_at:  now,
        })
        .eq("id", reportId);

      await supabase.from("admin_audit_log").insert({
        admin_id:   adminId,
        action:     "price_correction_rejected",
        table_name: "price_correction_reports",
        row_id:     reportId,
        old_values: { status: report.status },
        new_values: { status: "rejected", admin_note: admin_note ?? null },
      });

      void supabase.from("analytics_events").insert({
        user_id:     adminId,
        product_id:  report.product_id,
        event_type:  "price_correction_rejected",
        event_source: "admin",
        metadata:    { report_id: reportId },
      });

      return res.json({ ok: true, action: "rejected" });
    }

    // ── NEEDS VERIFICATION ────────────────────────────────────────────────────
    if (action === "needs_verification") {
      // Mark report
      await supabase
        .from("price_correction_reports")
        .update({
          status:      "needs_verification",
          reviewed_by: adminId,
          reviewed_at: now,
          admin_note:  admin_note?.trim() ?? null,
          updated_at:  now,
        })
        .eq("id", reportId);

      // Optionally flag product as needing review (safe — already a supported status)
      await supabase
        .from("products")
        .update({ data_quality_status: "needs_review" })
        .eq("id", report.product_id)
        .neq("data_quality_status", "manually_verified")  // never downgrade a verified product
        .neq("data_quality_status", "live_feed");

      await supabase.from("admin_audit_log").insert({
        admin_id:   adminId,
        action:     "price_correction_needs_verification",
        table_name: "price_correction_reports",
        row_id:     reportId,
        old_values: { status: report.status },
        new_values: { status: "needs_verification", admin_note: admin_note ?? null },
      });

      void supabase.from("analytics_events").insert({
        user_id:     adminId,
        product_id:  report.product_id,
        event_type:  "price_correction_needs_verification",
        event_source: "admin",
        metadata:    { report_id: reportId },
      });

      return res.json({ ok: true, action: "needs_verification" });
    }

    return res.status(400).json({ error: "Unhandled action" });
  } catch (error) {
    console.error("[price-corrections/admin/:id/review]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
