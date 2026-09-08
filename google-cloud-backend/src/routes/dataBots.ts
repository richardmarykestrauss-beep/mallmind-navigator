import { Router, Request, Response } from "express";
import { getSupabaseClient }            from "../lib/supabase.js";

import { runSourceResearchBot }       from "../services/dataBots/sourceResearchBot.js";
import { runFindingExtractorBot }     from "../services/dataBots/findingExtractorBot.js";
import { runDuplicateDetectionBot }   from "../services/dataBots/duplicateDetectionBot.js";
import { runAdminReviewAssistantBot } from "../services/dataBots/adminReviewAssistantBot.js";
import { runLiveDataApplyPlannerBot } from "../services/dataBots/liveDataApplyPlannerBot.js";

import type { SourceResearchInput }        from "../services/dataBots/sourceResearchBot.js";
import type { FindingExtractorInput }      from "../services/dataBots/findingExtractorBot.js";
import type { DuplicateDetectionInput }    from "../services/dataBots/duplicateDetectionBot.js";
import type { AdminReviewAssistantInput }  from "../services/dataBots/adminReviewAssistantBot.js";
import type { LiveDataApplyPlannerInput }  from "../services/dataBots/liveDataApplyPlannerBot.js";

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

// ── Fire-and-forget audit log helper ─────────────────────────────────────────

function fireAuditLog(
  adminId: string,
  botName: string,
  inputMeta: Record<string, unknown>,
  resultMeta: Record<string, unknown>,
): void {
  const supabase = getSupabaseClient();
  void supabase.from("admin_audit_log").insert({
    admin_id:   adminId,
    action:     `data_bot_run_${botName}`,
    table_name: "data_bots",
    row_id:     null,
    old_values: {},
    new_values: { bot: botName, input: inputMeta, result: resultMeta },
  });
}

// ── POST /admin/data-bots/source-research ─────────────────────────────────────
//
// Classify a source URL/description. Deterministic — no DB reads.

router.post("/source-research", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const input = req.body as SourceResearchInput;
    const result = runSourceResearchBot(input);

    fireAuditLog(admin.user.id, "SourceResearchBot", {
      source_url:  input.source_url ?? null,
      source_name: input.source_name ?? null,
    }, {
      source_category:          result.source_category,
      is_restricted:            result.is_restricted,
      risk_level:               result.risk_level,
      live_data_action_safety:  result.live_data_action_safety,
    });

    return res.json(result);
  } catch (err) {
    console.error("[data-bots/source-research]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/data-bots/extract-finding ─────────────────────────────────────
//
// Parse structured fields from free-form text. Deterministic — no DB reads.

router.post("/extract-finding", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const input = req.body as FindingExtractorInput;
    const result = runFindingExtractorBot(input);

    fireAuditLog(admin.user.id, "FindingExtractorBot", {
      text_length:       (input.raw_text ?? "").length,
      hint_finding_type: input.hint_finding_type ?? null,
    }, {
      total_signals_found:     result.total_signals_found,
      finding_types_detected:  result.finding_types_detected,
      risk_level:              result.risk_level,
    });

    return res.json(result);
  } catch (err) {
    console.error("[data-bots/extract-finding]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/data-bots/detect-duplicates ───────────────────────────────────
//
// Check for existing shops/products that match the submission. Reads Supabase.

router.post("/detect-duplicates", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const input = req.body as DuplicateDetectionInput;
    const result = await runDuplicateDetectionBot(input);

    fireAuditLog(admin.user.id, "DuplicateDetectionBot", {
      finding_type: input.finding_type,
      name:         input.name ?? null,
      mall_id:      input.mall_id ?? null,
    }, {
      duplicates_found:     result.duplicates_found,
      dedup_recommendation: result.dedup_recommendation,
      risk_level:           result.risk_level,
    });

    return res.json(result);
  } catch (err) {
    console.error("[data-bots/detect-duplicates]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/data-bots/review-assistant ────────────────────────────────────
//
// Synthesise outputs from multiple bots into an admin action summary.
// Pure function — accepts pre-run bot results as input.

router.post("/review-assistant", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const input = req.body as AdminReviewAssistantInput;
    const result = runAdminReviewAssistantBot(input);

    fireAuditLog(admin.user.id, "AdminReviewAssistantBot", {
      has_guardian:   !!input.guardian_result,
      has_source:     !!input.source_result,
      has_duplicate:  !!input.duplicate_result,
      has_extractor:  !!input.extractor_result,
    }, {
      overall_risk:         result.overall_risk,
      safe_to_proceed:      result.safe_to_proceed,
      actions_count:        result.recommended_actions.length,
      confidence_score:     result.confidence_score,
    });

    return res.json(result);
  } catch (err) {
    console.error("[data-bots/review-assistant]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/data-bots/plan-apply ─────────────────────────────────────────
//
// Propose a field-level patch plan for a live data update.
// Does NOT write to any live table. Plan only.

router.post("/plan-apply", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const input = req.body as LiveDataApplyPlannerInput;
    const result = runLiveDataApplyPlannerBot(input);

    fireAuditLog(admin.user.id, "LiveDataApplyPlannerBot", {
      finding_type:      input.finding_type,
      trust_level:       input.trust_level,
      confidence_score:  input.confidence_score,
      target_record_id:  input.target_record_id ?? null,
    }, {
      target_table:             result.target_table,
      plan_blocked:             result.plan_blocked,
      proposed_patches_count:   result.proposed_patches.length,
      live_data_action_safety:  result.live_data_action_safety,
    });

    return res.json(result);
  } catch (err) {
    console.error("[data-bots/plan-apply]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
