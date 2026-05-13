/**
 * mallResearchBatches.ts — Sprint 9E/9F
 *
 * REST routes for the Mall Research Batch Workflow.
 * All routes require an admin bearer token.
 *
 * Mounted at /admin/mall-research in server.ts.
 *
 * GUARANTEE: No route in this file writes to shops, products, or mall_nodes.
 * All writes are limited to mall_research_batches and mall_research_batch_items.
 *
 * Sprint 9F adds: one-click bot pipeline routes under
 *   POST /admin/mall-research/items/:itemId/run-<bot>
 *   POST /admin/mall-research/items/:itemId/run-full-pipeline
 */

import { Router, Request, Response } from "express";
import { getSupabaseClient }            from "../lib/supabase.js";

// ── Bot service imports (Sprint 9F) ───────────────────────────────────────────
import { runSourceResearchBot }       from "../services/dataBots/sourceResearchBot.js";
import { runFindingExtractorBot }     from "../services/dataBots/findingExtractorBot.js";
import { runDuplicateDetectionBot }   from "../services/dataBots/duplicateDetectionBot.js";
import { runAdminReviewAssistantBot } from "../services/dataBots/adminReviewAssistantBot.js";
import { reviewMallDataSubmission }   from "../services/dataGuardianService.js";
import type { SourceResearchResult }     from "../services/dataBots/sourceResearchBot.js";
import type { FindingExtractorResult }   from "../services/dataBots/findingExtractorBot.js";
import type { DuplicateDetectionResult } from "../services/dataBots/duplicateDetectionBot.js";
import type { AdminReviewAssistantResult } from "../services/dataBots/adminReviewAssistantBot.js";
import type { DataGuardianResult }       from "../services/dataGuardianService.js";
// Sprint 9G: Data Trust Policy engine
import type { TrustPolicyResult }        from "../services/dataTrustPolicy.js";

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
  action: string,
  newValues: Record<string, unknown>,
): void {
  const supabase = getSupabaseClient();
  void supabase.from("admin_audit_log").insert({
    admin_id:   adminId,
    action,
    table_name: "mall_research_batches",
    row_id:     null,
    old_values: {},
    new_values: newValues,
  });
}

// ── GET /admin/mall-research/batches ──────────────────────────────────────────
//
// List all batches, newest first, with mall name joined.
// Optional query params: ?mall_id=<uuid>&status=<open|in_progress|complete|archived>

router.get("/batches", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from("mall_research_batches")
      .select(
        "id, mall_id, title, description, status, notes, item_count, reviewed_count, " +
        "created_by, created_at, updated_at, " +
        "malls ( name )",
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (req.query.mall_id) {
      query = query.eq("mall_id", req.query.mall_id as string);
    }
    if (req.query.status) {
      query = query.eq("status", req.query.status as string);
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Flatten joined mall name
    const batches = (data ?? []).map((row) => {
      const r     = row as unknown as Record<string, unknown>;
      const malls = r.malls as { name: string } | null;
      return { ...r, mall_name: malls?.name ?? null, malls: undefined };
    });

    return res.json({ batches, total: count ?? 0 });
  } catch (err) {
    console.error("[mall-research/batches GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/mall-research/batches ─────────────────────────────────────────
//
// Create a new research batch for a mall.

router.post("/batches", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { mall_id, title, description, notes } = req.body as {
    mall_id?:     string;
    title?:       string;
    description?: string;
    notes?:       string;
  };

  if (!title?.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("mall_research_batches")
      .insert({
        mall_id:     mall_id ?? null,
        title:       title.trim(),
        description: description?.trim() ?? null,
        notes:       notes?.trim() ?? null,
        created_by:  admin.user.id,
        status:      "open",
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    fireAuditLog(admin.user.id, "mall_research_batch_created", {
      batch_id: data.id,
      mall_id:  mall_id ?? null,
      title:    title.trim(),
    });

    return res.status(201).json(data);
  } catch (err) {
    console.error("[mall-research/batches POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/mall-research/batches/:id ──────────────────────────────────────
//
// Fetch a single batch with all its items, ordered by sequence_number then created_at.

router.get("/batches/:id", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const supabase = getSupabaseClient();
    const { data: batch, error: batchErr } = await supabase
      .from("mall_research_batches")
      .select(
        "id, mall_id, title, description, status, notes, item_count, reviewed_count, " +
        "created_by, created_at, updated_at, " +
        "malls ( name )"
      )
      .eq("id", req.params.id)
      .maybeSingle();

    if (batchErr) return res.status(500).json({ error: batchErr.message });
    if (!batch)   return res.status(404).json({ error: "Batch not found" });

    const { data: items, error: itemsErr } = await supabase
      .from("mall_research_batch_items")
      .select(
        "id, batch_id, sequence_number, finding_type, raw_text, source_url, source_name, " +
        "status, admin_notes, bot_hints_used, extracted_data, " +
        "reviewed_by, reviewed_at, created_at, updated_at"
      )
      .eq("batch_id", req.params.id)
      .order("sequence_number", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    // Flatten mall name
    const batchRow = batch as unknown as Record<string, unknown>;
    const malls    = batchRow.malls as { name: string } | null;

    return res.json({
      ...batchRow,
      mall_name: malls?.name ?? null,
      malls:     undefined,
      items:     items ?? [],
    });
  } catch (err) {
    console.error("[mall-research/batches/:id GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/mall-research/batches/:id/items ───────────────────────────────
//
// Add a new item (finding) to a batch.

router.post("/batches/:id/items", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const {
    finding_type,
    raw_text,
    source_url,
    source_name,
    sequence_number,
  } = req.body as {
    finding_type?:    string;
    raw_text?:        string;
    source_url?:      string;
    source_name?:     string;
    sequence_number?: number;
  };

  if (!raw_text?.trim() && !source_url?.trim()) {
    return res.status(400).json({ error: "At least one of raw_text or source_url is required" });
  }

  try {
    const supabase = getSupabaseClient();

    // Verify batch exists
    const { data: batch, error: batchErr } = await supabase
      .from("mall_research_batches")
      .select("id, status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (batchErr) return res.status(500).json({ error: batchErr.message });
    if (!batch)   return res.status(404).json({ error: "Batch not found" });
    if (batch.status === "archived") {
      return res.status(409).json({ error: "Cannot add items to an archived batch" });
    }

    const { data: item, error: itemErr } = await supabase
      .from("mall_research_batch_items")
      .insert({
        batch_id:        req.params.id,
        finding_type:    finding_type ?? "other",
        raw_text:        raw_text?.trim() ?? null,
        source_url:      source_url?.trim() ?? null,
        source_name:     source_name?.trim() ?? null,
        sequence_number: sequence_number ?? null,
        status:          "pending",
        bot_hints_used:  {},
        extracted_data:  {},
      })
      .select()
      .single();

    if (itemErr) return res.status(500).json({ error: itemErr.message });

    // Increment item_count on the batch (fire-and-forget)
    void supabase
      .from("mall_research_batches")
      .update({ item_count: (batch as { item_count?: number }).item_count ?? 0 + 1 })
      .eq("id", req.params.id);

    fireAuditLog(admin.user.id, "mall_research_batch_item_added", {
      batch_id:     req.params.id,
      item_id:      item.id,
      finding_type: finding_type ?? "other",
    });

    return res.status(201).json(item);
  } catch (err) {
    console.error("[mall-research/batches/:id/items POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /admin/mall-research/batches/:id/items/:itemId ──────────────────────
//
// Review/update an item — set status, admin_notes, extracted_data, bot_hints_used.

router.patch("/batches/:id/items/:itemId", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const {
    status,
    admin_notes,
    extracted_data,
    bot_hints_used,
  } = req.body as {
    status?:         string;
    admin_notes?:    string;
    extracted_data?: Record<string, unknown>;
    bot_hints_used?: Record<string, unknown>;
  };

  const VALID_STATUSES = ["pending", "reviewed", "accepted", "rejected", "flagged"];
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
  }

  try {
    const supabase = getSupabaseClient();

    // Verify item belongs to the specified batch
    const { data: existing, error: fetchErr } = await supabase
      .from("mall_research_batch_items")
      .select("id, batch_id, status")
      .eq("id", req.params.itemId)
      .eq("batch_id", req.params.id)
      .maybeSingle();

    if (fetchErr)   return res.status(500).json({ error: fetchErr.message });
    if (!existing)  return res.status(404).json({ error: "Item not found in this batch" });

    const patch: Record<string, unknown> = {};
    if (status         !== undefined) patch.status         = status;
    if (admin_notes    !== undefined) patch.admin_notes    = admin_notes;
    if (extracted_data !== undefined) patch.extracted_data = extracted_data;
    if (bot_hints_used !== undefined) patch.bot_hints_used = bot_hints_used;

    // Mark reviewed_by + reviewed_at when transitioning to a reviewed state
    const reviewedStatuses = ["reviewed", "accepted", "rejected", "flagged"];
    if (status && reviewedStatuses.includes(status) && existing.status === "pending") {
      patch.reviewed_by = admin.user.id;
      patch.reviewed_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No valid fields provided for update" });
    }

    const { data: updated, error: updateErr } = await supabase
      .from("mall_research_batch_items")
      .update(patch)
      .eq("id", req.params.itemId)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // If newly reviewed, increment reviewed_count on the batch (fire-and-forget)
    if (status && reviewedStatuses.includes(status) && existing.status === "pending") {
      const { data: batchRow } = await supabase
        .from("mall_research_batches")
        .select("reviewed_count")
        .eq("id", req.params.id)
        .maybeSingle();
      if (batchRow) {
        void supabase
          .from("mall_research_batches")
          .update({ reviewed_count: ((batchRow as { reviewed_count: number }).reviewed_count ?? 0) + 1 })
          .eq("id", req.params.id);
      }
    }

    fireAuditLog(admin.user.id, "mall_research_batch_item_reviewed", {
      batch_id: req.params.id,
      item_id:  req.params.itemId,
      status:   status ?? existing.status,
    });

    return res.json(updated);
  } catch (err) {
    console.error("[mall-research/batches/:id/items/:itemId PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /admin/mall-research/batches/:id/status ─────────────────────────────
//
// Update the top-level status of a batch (open → in_progress → complete / archived).

router.patch("/batches/:id/status", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { status } = req.body as { status?: string };
  const VALID = ["open", "in_progress", "complete", "archived"];
  if (!status || !VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("mall_research_batches")
      .update({ status })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: "Batch not found" });

    fireAuditLog(admin.user.id, "mall_research_batch_status_updated", {
      batch_id:   req.params.id,
      new_status: status,
    });

    return res.json(data);
  } catch (err) {
    console.error("[mall-research/batches/:id/status PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Sprint 9F — One-Click Bot Pipeline routes
// POST /admin/mall-research/items/:itemId/run-<bot>
// POST /admin/mall-research/items/:itemId/run-full-pipeline
//
// GUARANTEE: No route below writes to shops, products, or mall_nodes.
// All bot outputs are stored in mall_research_batch_items.bot_hints_used only.
// Item status is NEVER changed automatically.
// ══════════════════════════════════════════════════════════════════════════════

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Fetch a batch item together with its parent batch (for mall_id context). */
async function fetchItemWithBatch(itemId: string): Promise<{
  item: Record<string, unknown>;
  batch: Record<string, unknown> | null;
} | null> {
  const supabase = getSupabaseClient();

  const { data: item, error: itemErr } = await supabase
    .from("mall_research_batch_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (itemErr || !item) return null;

  const itemRow = item as unknown as Record<string, unknown>;
  const batchId = itemRow.batch_id as string | undefined;

  if (!batchId) return { item: itemRow, batch: null };

  const { data: batch } = await supabase
    .from("mall_research_batches")
    .select("id, mall_id, title")
    .eq("id", batchId)
    .maybeSingle();

  return {
    item:  itemRow,
    batch: batch ? (batch as unknown as Record<string, unknown>) : null,
  };
}

/** Merge a bot result into bot_hints_used JSONB, preserving existing keys. */
async function saveBotHint(
  itemId: string,
  key: string,
  result: unknown,
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();

  // Read current bot_hints_used
  const { data: current } = await supabase
    .from("mall_research_batch_items")
    .select("bot_hints_used")
    .eq("id", itemId)
    .maybeSingle();

  const existing = ((current as unknown as Record<string, unknown>)?.bot_hints_used ?? {}) as Record<string, unknown>;

  const merged: Record<string, unknown> = { ...existing, [key]: result };

  await supabase
    .from("mall_research_batch_items")
    .update({ bot_hints_used: merged })
    .eq("id", itemId);

  return merged;
}

/** Merge extracted_data from finding extractor into item.extracted_data. */
async function mergeExtractedData(
  itemId: string,
  newData: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: current } = await supabase
    .from("mall_research_batch_items")
    .select("extracted_data")
    .eq("id", itemId)
    .maybeSingle();

  const existing = ((current as unknown as Record<string, unknown>)?.extracted_data ?? {}) as Record<string, unknown>;
  // Never blindly overwrite — merge with existing keys taking precedence for admin-set fields
  const merged = { ...newData, ...existing, _extractor_ran_at: new Date().toISOString() };

  await supabase
    .from("mall_research_batch_items")
    .update({ extracted_data: merged })
    .eq("id", itemId);
}

// ── Helper: build bot inputs from item + batch ────────────────────────────────

function buildSourceInput(item: Record<string, unknown>) {
  return {
    source_url:         (item.source_url as string | undefined) ?? undefined,
    source_name:        (item.source_name as string | undefined) ?? undefined,
    source_description: (item.raw_text as string | undefined)?.slice(0, 300) ?? undefined,
    submitted_by_type:  "admin" as const,
  };
}

function buildExtractorInput(item: Record<string, unknown>) {
  return {
    raw_text:           ((item.raw_text as string | undefined) ?? ""),
    hint_finding_type:  (item.finding_type as string | undefined) as
      "shop_listing" | "price" | "trading_hours" | "promotion" | "floor_layout" | "product" | "unknown" | undefined,
  };
}

function buildGuardianInput(
  item: Record<string, unknown>,
  batch: Record<string, unknown> | null,
  sourceResult?: SourceResearchResult,
) {
  const extractedData = (item.extracted_data as Record<string, unknown> | undefined) ?? {};
  const hasOfficialSource = sourceResult
    ? ["official_mall_website", "official_retailer_website"].includes(sourceResult.source_category)
    : false;

  return {
    mall_id:                   (batch?.mall_id as string | undefined) ?? undefined,
    finding_type:              (item.finding_type as string | undefined) ?? "other",
    submitted_by_type:         "admin" as const,
    raw_text:                  (item.raw_text as string | undefined) ?? undefined,
    source_url:                (item.source_url as string | undefined) ?? undefined,
    structured_data:           extractedData,
    has_official_source:       hasOfficialSource,
    has_photo:                 false,
    has_receipt:               false,
    has_retailer_confirmation: !!(extractedData.has_retailer_confirmation),
    has_mall_confirmation:     !!(extractedData.has_mall_confirmation),
    has_physical_verification: !!(extractedData.has_physical_verification),
  };
}

function buildDuplicateInput(
  item: Record<string, unknown>,
  batch: Record<string, unknown> | null,
  extractorResult?: FindingExtractorResult,
) {
  // Prefer shop/product name from extractor output fields, else from extracted_data
  let name: string | undefined;
  if (extractorResult?.extracted_findings?.length) {
    const shopField = extractorResult.extracted_findings[0]?.fields
      ?.find((f) => f.field === "shop_name");
    name = shopField?.value;
  }
  if (!name) {
    const ed = (item.extracted_data as Record<string, unknown> | undefined) ?? {};
    name = (ed.name as string | undefined) ?? (ed.shop_name as string | undefined);
  }
  // Fallback: first capitalised word sequence from raw_text
  if (!name && item.raw_text) {
    const m = (item.raw_text as string).match(/^([A-Z][A-Za-z0-9\s&'.]{1,40})/);
    if (m) name = m[1].trim();
  }

  const findingType = (item.finding_type as string | undefined) ?? "other";
  const dupType: "shop" | "product" | "price" | "other" =
    findingType === "shop" || findingType === "product" || findingType === "price"
      ? findingType as "shop" | "product" | "price"
      : "other";

  return {
    finding_type: dupType,
    name,
    mall_id:      (batch?.mall_id as string | undefined) ?? undefined,
  };
}

function buildReviewInput(hints: Record<string, unknown>) {
  // Sprint 9G: pass policy_result from the guardian result if present
  const guardianResult = hints.data_guardian as DataGuardianResult | undefined;
  return {
    guardian_result:  guardianResult ?? undefined,
    source_result:    (hints.source_research as SourceResearchResult | undefined)          ?? undefined,
    duplicate_result: (hints.duplicate_detection as DuplicateDetectionResult | undefined)  ?? undefined,
    extractor_result: (hints.finding_extractor as FindingExtractorResult | undefined)      ?? undefined,
    policy_result:    (hints.policy_result as TrustPolicyResult | undefined)               ?? guardianResult?.policy_result ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-research/items/:itemId/run-source-research
// ─────────────────────────────────────────────────────────────────────────────

router.post("/items/:itemId/run-source-research", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const itemId = req.params.itemId as string;

  try {
    const ctx = await fetchItemWithBatch(itemId);
    if (!ctx) return res.status(404).json({ error: "Item not found" });

    const botInput  = buildSourceInput(ctx.item);
    const botResult = runSourceResearchBot(botInput);
    const hints     = await saveBotHint(itemId, "source_research", botResult);

    fireAuditLog(admin.user.id, "bot_source_research_run", {
      item_id:    itemId,
      risk_level: botResult.risk_level,
    });

    return res.json({ item_id: itemId, source_research: botResult, bot_hints_used: hints });
  } catch (err) {
    console.error("[mall-research/items/run-source-research]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-research/items/:itemId/run-finding-extractor
// ─────────────────────────────────────────────────────────────────────────────

router.post("/items/:itemId/run-finding-extractor", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const itemId = req.params.itemId as string;

  try {
    const ctx = await fetchItemWithBatch(itemId);
    if (!ctx) return res.status(404).json({ error: "Item not found" });

    const botInput  = buildExtractorInput(ctx.item);
    const botResult = runFindingExtractorBot(botInput);
    const hints     = await saveBotHint(itemId, "finding_extractor", botResult);

    // Optionally merge first finding's fields into extracted_data as staging copy
    if (botResult.extracted_findings?.length) {
      const firstFinding = botResult.extracted_findings[0];
      const staged: Record<string, unknown> = {};
      for (const f of firstFinding.fields) {
        staged[f.field] = f.value;
      }
      await mergeExtractedData(itemId, staged);
    }

    fireAuditLog(admin.user.id, "bot_finding_extractor_run", {
      item_id:           itemId,
      signals_found:     botResult.total_signals_found,
      finding_types:     botResult.finding_types_detected,
    });

    return res.json({ item_id: itemId, finding_extractor: botResult, bot_hints_used: hints });
  } catch (err) {
    console.error("[mall-research/items/run-finding-extractor]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-research/items/:itemId/run-data-guardian
// ─────────────────────────────────────────────────────────────────────────────

router.post("/items/:itemId/run-data-guardian", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const itemId = req.params.itemId as string;

  try {
    const ctx = await fetchItemWithBatch(itemId);
    if (!ctx) return res.status(404).json({ error: "Item not found" });

    const existingHints = ((ctx.item.bot_hints_used ?? {}) as Record<string, unknown>);
    const botInput  = buildGuardianInput(
      ctx.item,
      ctx.batch,
      existingHints.source_research as SourceResearchResult | undefined,
    );
    const botResult = reviewMallDataSubmission(botInput);
    let hints       = await saveBotHint(itemId, "data_guardian", botResult);

    // Sprint 9G: save policy_result separately for quick UI access
    if (botResult.policy_result) {
      hints = await saveBotHint(itemId, "policy_result", botResult.policy_result);
    }

    fireAuditLog(admin.user.id, "bot_data_guardian_run", {
      item_id:          itemId,
      trust_level:      botResult.trust_level,
      confidence_score: botResult.confidence_score,
      trust_state:      botResult.policy_result?.trust_state,
    });

    return res.json({ item_id: itemId, data_guardian: botResult, bot_hints_used: hints });
  } catch (err) {
    console.error("[mall-research/items/run-data-guardian]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-research/items/:itemId/run-duplicate-check
// ─────────────────────────────────────────────────────────────────────────────

router.post("/items/:itemId/run-duplicate-check", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const itemId = req.params.itemId as string;

  try {
    const ctx = await fetchItemWithBatch(itemId);
    if (!ctx) return res.status(404).json({ error: "Item not found" });

    const existingHints = ((ctx.item.bot_hints_used ?? {}) as Record<string, unknown>);
    const botInput  = buildDuplicateInput(
      ctx.item,
      ctx.batch,
      existingHints.finding_extractor as FindingExtractorResult | undefined,
    );
    const botResult = await runDuplicateDetectionBot(botInput);
    const hints     = await saveBotHint(itemId, "duplicate_detection", botResult);

    fireAuditLog(admin.user.id, "bot_duplicate_check_run", {
      item_id:          itemId,
      duplicates_found: botResult.duplicates_found,
      recommendation:   botResult.dedup_recommendation,
    });

    return res.json({ item_id: itemId, duplicate_detection: botResult, bot_hints_used: hints });
  } catch (err) {
    console.error("[mall-research/items/run-duplicate-check]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-research/items/:itemId/run-admin-review
// ─────────────────────────────────────────────────────────────────────────────

router.post("/items/:itemId/run-admin-review", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const itemId = req.params.itemId as string;

  try {
    const ctx = await fetchItemWithBatch(itemId);
    if (!ctx) return res.status(404).json({ error: "Item not found" });

    const existingHints = ((ctx.item.bot_hints_used ?? {}) as Record<string, unknown>);
    const botInput  = buildReviewInput(existingHints);
    const botResult = runAdminReviewAssistantBot(botInput);
    const hints     = await saveBotHint(itemId, "admin_review", botResult);

    fireAuditLog(admin.user.id, "bot_admin_review_run", {
      item_id:         itemId,
      overall_risk:    botResult.overall_risk,
      safe_to_proceed: botResult.safe_to_proceed,
      actions_count:   botResult.recommended_actions.length,
    });

    return res.json({ item_id: itemId, admin_review: botResult, bot_hints_used: hints });
  } catch (err) {
    console.error("[mall-research/items/run-admin-review]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/mall-research/items/:itemId/run-full-pipeline
//
// Runs all 5 bots in sequence. Steps that fail are saved as errors;
// pipeline continues unless a critical policy block is hit.
// Item status is NEVER changed automatically.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/items/:itemId/run-full-pipeline", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const itemId = req.params.itemId as string;

  const warnings: string[] = [];
  const stepsCompleted: string[] = [];

  try {
    const ctx = await fetchItemWithBatch(itemId);
    if (!ctx) return res.status(404).json({ error: "Item not found" });

    const supabase   = getSupabaseClient();
    let hints        = ((ctx.item.bot_hints_used ?? {}) as Record<string, unknown>);

    // Helper: read fresh hints from DB
    async function refreshHints(): Promise<Record<string, unknown>> {
      const { data } = await supabase
        .from("mall_research_batch_items")
        .select("bot_hints_used")
        .eq("id", itemId)
        .maybeSingle();
      return ((data as unknown as Record<string, unknown>)?.bot_hints_used ?? {}) as Record<string, unknown>;
    }

    // ── Step 1: Source Research (only if source URL or name present) ──────────
    if (ctx.item.source_url || ctx.item.source_name) {
      try {
        const result = runSourceResearchBot(buildSourceInput(ctx.item));
        hints = await saveBotHint(itemId, "source_research", result);
        stepsCompleted.push("source_research");

        // Hard stop on restricted source
        if (result.is_restricted) {
          warnings.push(`POLICY BLOCK: ${result.restriction_reason ?? "Restricted source"}. Pipeline halted.`);
          hints = await refreshHints();
          await saveBotHint(itemId, "pipeline", {
            last_run_at: new Date().toISOString(),
            steps_completed: stepsCompleted,
            warnings,
            halted_at: "source_research",
          });
          return res.json({
            item_id: itemId,
            steps_completed: stepsCompleted,
            warnings,
            halted_at: "source_research",
            bot_hints_used: await refreshHints(),
          });
        }
      } catch (e) {
        warnings.push(`source_research failed: ${String(e)}`);
        await saveBotHint(itemId, "source_research_error", { error: String(e) });
      }
    }

    // ── Step 2: Finding Extractor ─────────────────────────────────────────────
    let extractorResult: FindingExtractorResult | undefined;
    if (ctx.item.raw_text) {
      try {
        extractorResult = runFindingExtractorBot(buildExtractorInput(ctx.item));
        hints = await saveBotHint(itemId, "finding_extractor", extractorResult);
        stepsCompleted.push("finding_extractor");

        if (extractorResult.extracted_findings?.length) {
          const staged: Record<string, unknown> = {};
          for (const f of extractorResult.extracted_findings[0].fields) {
            staged[f.field] = f.value;
          }
          await mergeExtractedData(itemId, staged);
        }
      } catch (e) {
        warnings.push(`finding_extractor failed: ${String(e)}`);
        await saveBotHint(itemId, "finding_extractor_error", { error: String(e) });
      }
    } else {
      warnings.push("finding_extractor skipped — no raw_text on item");
    }

    // ── Step 3: Data Guardian ─────────────────────────────────────────────────
    try {
      hints = await refreshHints();
      const guardianInput = buildGuardianInput(
        ctx.item,
        ctx.batch,
        hints.source_research as SourceResearchResult | undefined,
      );
      const guardianResult = reviewMallDataSubmission(guardianInput);
      hints = await saveBotHint(itemId, "data_guardian", guardianResult);
      stepsCompleted.push("data_guardian");

      // Sprint 9G: also save the policy_result from guardian separately for quick access
      if (guardianResult.policy_result) {
        hints = await saveBotHint(itemId, "policy_result", guardianResult.policy_result);
        stepsCompleted.push("policy_result");
      }
    } catch (e) {
      warnings.push(`data_guardian failed: ${String(e)}`);
      await saveBotHint(itemId, "data_guardian_error", { error: String(e) });
    }

    // ── Step 4: Duplicate Detection ───────────────────────────────────────────
    try {
      hints = await refreshHints();
      const dupInput = buildDuplicateInput(ctx.item, ctx.batch, extractorResult);
      const dupResult = await runDuplicateDetectionBot(dupInput);
      hints = await saveBotHint(itemId, "duplicate_detection", dupResult);
      stepsCompleted.push("duplicate_detection");
    } catch (e) {
      warnings.push(`duplicate_detection failed: ${String(e)}`);
      await saveBotHint(itemId, "duplicate_detection_error", { error: String(e) });
    }

    // ── Step 5: Admin Review Assistant ────────────────────────────────────────
    try {
      hints = await refreshHints();
      const reviewResult = runAdminReviewAssistantBot(buildReviewInput(hints));
      hints = await saveBotHint(itemId, "admin_review", reviewResult);
      stepsCompleted.push("admin_review");
    } catch (e) {
      warnings.push(`admin_review failed: ${String(e)}`);
      await saveBotHint(itemId, "admin_review_error", { error: String(e) });
    }

    // ── Save pipeline metadata ────────────────────────────────────────────────
    await saveBotHint(itemId, "pipeline", {
      last_run_at:     new Date().toISOString(),
      steps_completed: stepsCompleted,
      warnings,
    });

    fireAuditLog(admin.user.id, "bot_full_pipeline_run", {
      item_id:         itemId,
      steps_completed: stepsCompleted,
      warnings_count:  warnings.length,
    });

    return res.json({
      item_id:         itemId,
      steps_completed: stepsCompleted,
      warnings,
      bot_hints_used:  await refreshHints(),
    });
  } catch (err) {
    console.error("[mall-research/items/run-full-pipeline]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
