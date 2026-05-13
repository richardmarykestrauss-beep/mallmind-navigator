import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// ── Allowed values ────────────────────────────────────────────────────────────

const ALLOWED_SOURCE_TYPES = new Set([
  "official_website",
  "retail_directory",
  "public_flyer",
  "manual_survey",
  "press_release",
  "social_media",
  "other",
]);

const ALLOWED_FINDING_TYPES = new Set([
  "shop",
  "product",
  "mall_hours",
  "shop_hours",
  "floor_layout",
  "promotion",
  "other",
]);

type ReviewAction = "approve" | "reject" | "needs_more_info";
const ALLOWED_REVIEW_ACTIONS = new Set<ReviewAction>(["approve", "reject", "needs_more_info"]);

// ── Auth helpers ──────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /admin/mall-data/sources ──────────────────────────────────────────────

router.get("/sources", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase   = getSupabaseClient();
  const mall_id    = req.query.mall_id as string | undefined;
  const activeOnly = req.query.active !== "false"; // default true

  try {
    let query = supabase
      .from("mall_research_sources")
      .select("*, malls(id, name)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (mall_id) query = query.eq("mall_id", mall_id);
    if (activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query;

    if (error) {
      console.error("[mall-data/sources GET]", error.message);
      return res.status(500).json({ error: `Sources query failed: ${error.message}` });
    }

    return res.json({ sources: data ?? [] });
  } catch (err) {
    console.error("[mall-data/sources GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/mall-data/sources ─────────────────────────────────────────────

router.post("/sources", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabaseClient();

  try {
    const {
      mall_id,
      label,
      source_type,
      source_url,
      notes,
    } = req.body as {
      mall_id?:     string;
      label?:       string;
      source_type?: string;
      source_url?:  string | null;
      notes?:       string | null;
    };

    // Validation
    if (!mall_id) {
      return res.status(400).json({ error: "mall_id is required" });
    }
    if (!label?.trim()) {
      return res.status(400).json({ error: "label is required" });
    }

    // Verify mall exists
    const { data: mall, error: mallError } = await supabase
      .from("malls")
      .select("id, name")
      .eq("id", mall_id)
      .maybeSingle();

    if (mallError || !mall) {
      return res.status(404).json({ error: "Mall not found" });
    }

    const safeSourceType =
      source_type && ALLOWED_SOURCE_TYPES.has(source_type) ? source_type : "other";

    const { data: source, error: insertError } = await supabase
      .from("mall_research_sources")
      .insert({
        mall_id,
        label:       label.trim(),
        source_type: safeSourceType,
        source_url:  source_url?.trim() ?? null,
        notes:       notes?.trim() ?? null,
        created_by:  admin.user.id,
        is_active:   true,
      })
      .select("id")
      .single();

    if (insertError || !source) {
      console.error("[mall-data/sources POST]", insertError?.message);
      return res.status(500).json({ error: "Failed to create source" });
    }

    // Audit log (fire-and-forget)
    void supabase.from("admin_audit_log").insert({
      admin_id:   admin.user.id,
      action:     "mall_data_source_created",
      table_name: "mall_research_sources",
      row_id:     source.id,
      old_values: {},
      new_values: { mall_id, label: label.trim(), source_type: safeSourceType },
    });

    return res.status(201).json({ ok: true, source_id: source.id });
  } catch (err) {
    console.error("[mall-data/sources POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Findings
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /admin/mall-data/findings ─────────────────────────────────────────────

router.get("/findings", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase      = getSupabaseClient();
  const source_id     = req.query.source_id as string | undefined;
  const mall_id       = req.query.mall_id   as string | undefined;
  const status        = req.query.status    as string | undefined;
  const finding_type  = req.query.finding_type as string | undefined;

  try {
    let query = supabase
      .from("mall_source_findings")
      .select("*, mall_research_sources(label, source_type, source_url)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (source_id)    query = query.eq("source_id", source_id);
    if (mall_id)      query = query.eq("mall_id", mall_id);
    if (status)       query = query.eq("status", status);
    if (finding_type) query = query.eq("finding_type", finding_type);

    const { data, error } = await query;

    if (error) {
      console.error("[mall-data/findings GET]", error.message);
      return res.status(500).json({ error: `Findings query failed: ${error.message}` });
    }

    return res.json({ findings: data ?? [] });
  } catch (err) {
    console.error("[mall-data/findings GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/mall-data/findings ────────────────────────────────────────────

router.post("/findings", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabaseClient();

  try {
    const {
      source_id,
      mall_id,
      finding_type,
      shop_id,
      product_id,
      data,
      raw_snippet,
      confidence,
    } = req.body as {
      source_id?:    string;
      mall_id?:      string;
      finding_type?: string;
      shop_id?:      string | null;
      product_id?:   string | null;
      data?:         Record<string, unknown>;
      raw_snippet?:  string | null;
      confidence?:   number | null;
    };

    // Validation
    if (!source_id) {
      return res.status(400).json({ error: "source_id is required" });
    }
    if (!mall_id) {
      return res.status(400).json({ error: "mall_id is required" });
    }

    // Verify source exists and belongs to this mall
    const { data: source, error: sourceError } = await supabase
      .from("mall_research_sources")
      .select("id, mall_id, is_active")
      .eq("id", source_id)
      .maybeSingle();

    if (sourceError || !source) {
      return res.status(404).json({ error: "Research source not found" });
    }
    if (source.mall_id !== mall_id) {
      return res.status(400).json({ error: "source_id does not belong to the specified mall_id" });
    }

    const safeFindingType =
      finding_type && ALLOWED_FINDING_TYPES.has(finding_type) ? finding_type : "other";

    // Validate confidence if provided
    let safeConfidence: number | null = null;
    if (confidence != null) {
      const c = Number(confidence);
      if (!isNaN(c) && c >= 0 && c <= 100) safeConfidence = Math.round(c);
    }

    // Validate raw_snippet length
    if (raw_snippet && raw_snippet.length > 2000) {
      return res.status(400).json({ error: "raw_snippet must be 2000 characters or fewer" });
    }

    const { data: finding, error: insertError } = await supabase
      .from("mall_source_findings")
      .insert({
        source_id,
        mall_id,
        finding_type: safeFindingType,
        shop_id:      shop_id    ?? null,
        product_id:   product_id ?? null,
        data:         data && typeof data === "object" ? data : {},
        raw_snippet:  raw_snippet?.trim() ?? null,
        confidence:   safeConfidence,
        status:       "pending",
        created_by:   admin.user.id,
      })
      .select("id")
      .single();

    if (insertError || !finding) {
      console.error("[mall-data/findings POST]", insertError?.message);
      return res.status(500).json({ error: "Failed to create finding" });
    }

    return res.status(201).json({ ok: true, finding_id: finding.id });
  } catch (err) {
    console.error("[mall-data/findings POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/mall-data/findings/:id/review ─────────────────────────────────

router.post("/findings/:id/review", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase  = getSupabaseClient();
  const findingId = req.params.id;
  const adminId   = admin.user.id;
  const now       = new Date().toISOString();

  try {
    const {
      action,
      admin_note,
      confidence,
    } = req.body as {
      action?:     string;
      admin_note?: string | null;
      confidence?: number | null;
    };

    // Validate action
    if (!action || !ALLOWED_REVIEW_ACTIONS.has(action as ReviewAction)) {
      return res.status(400).json({
        error: "action must be one of: approve, reject, needs_more_info",
      });
    }

    // Load finding
    const { data: finding, error: findingError } = await supabase
      .from("mall_source_findings")
      .select("id, status, mall_id, finding_type, data")
      .eq("id", findingId)
      .maybeSingle();

    if (findingError || !finding) {
      return res.status(404).json({ error: "Finding not found" });
    }

    // Validate confidence
    let safeConfidence: number | null = null;
    if (confidence != null) {
      const c = Number(confidence);
      if (!isNaN(c) && c >= 0 && c <= 100) safeConfidence = Math.round(c);
    }

    const newStatus =
      action === "approve"         ? "approved"       :
      action === "reject"          ? "rejected"        :
      /* needs_more_info */          "needs_more_info";

    await supabase
      .from("mall_source_findings")
      .update({
        status:      newStatus,
        reviewed_by: adminId,
        reviewed_at: now,
        admin_note:  admin_note?.trim() ?? null,
        ...(safeConfidence !== null ? { confidence: safeConfidence } : {}),
        updated_at:  now,
      })
      .eq("id", findingId);

    // Audit log (fire-and-forget)
    void supabase.from("admin_audit_log").insert({
      admin_id:   adminId,
      action:     `mall_data_finding_${action}`,
      table_name: "mall_source_findings",
      row_id:     findingId,
      old_values: { status: finding.status },
      new_values: { status: newStatus, admin_note: admin_note ?? null },
    });

    return res.json({ ok: true, action, new_status: newStatus });
  } catch (err) {
    console.error("[mall-data/findings/:id/review]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
