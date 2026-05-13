/**
 * mallResearchBatches.ts — Sprint 9E
 *
 * REST routes for the Mall Research Batch Workflow.
 * All routes require an admin bearer token.
 *
 * Mounted at /admin/mall-research in server.ts.
 *
 * GUARANTEE: No route in this file writes to shops, products, or mall_nodes.
 * All writes are limited to mall_research_batches and mall_research_batch_items.
 */

import { Router, Request, Response } from "express";
import { getSupabaseClient }            from "../lib/supabase.js";

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

export default router;
