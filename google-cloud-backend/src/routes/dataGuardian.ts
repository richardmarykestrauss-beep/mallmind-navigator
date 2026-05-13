import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import {
  reviewMallDataSubmission,
  type DataGuardianInput,
} from "../services/dataGuardianService.js";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

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

// ── POST /admin/data-guardian/review ─────────────────────────────────────────
//
// Admin-only.
// Runs deterministic trust scoring on a data submission.
// Does NOT write to shops, products, mall_nodes, or any live table.
// Only writes a fire-and-forget audit log entry.

router.post("/review", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const input = req.body as DataGuardianInput;

    // Run deterministic review — pure function, no DB reads
    const result = reviewMallDataSubmission(input);

    // ── Fire-and-forget audit log ──────────────────────────────────────────
    // Logs that this admin ran a guardian review, with outcome metadata.
    // Does NOT update any live data table.
    const supabase = getSupabaseClient();
    void supabase.from("admin_audit_log").insert({
      admin_id:   admin.user.id,
      action:     "data_guardian_review",
      table_name: "data_guardian_reviews",
      row_id:     null,
      old_values: {},
      new_values: {
        input_finding_type:    input.finding_type ?? "unknown",
        input_submitted_by:    input.submitted_by_type ?? "unknown",
        input_source_type:     input.source_type ?? "unknown",
        result_trust_level:    result.trust_level,
        result_confidence:     result.confidence_score,
        result_action:         result.recommended_action,
        must_not_update_live:  result.must_not_update_live_data,
        missing_evidence_count: result.missing_evidence.length,
      },
    });

    return res.json(result);
  } catch (err) {
    console.error("[data-guardian/review]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
