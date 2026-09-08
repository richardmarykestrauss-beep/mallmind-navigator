/**
 * retailCsvImportService.ts — Sprint 20A.9
 *
 * Backend glue for POST /admin/retail-observations/import-csv. Validates the
 * request (zod), runs the PURE intake (retailCsvIntake), validates mall/shop
 * references, and stages via the atomic stage_retail_csv_import RPC. Returns a
 * { httpStatus, payload } pair so it can be unit-tested with a mocked Supabase
 * client (the route just supplies auth + sends the response).
 *
 * CSV is intake evidence only: this path never publishes to products and never
 * verifies. Raw CSV is never logged or echoed; DB internals are never leaked.
 *
 * Not pure (Supabase I/O) — lives in services/, not services/retail/.
 */

import { z } from "zod";
import { getSupabaseClient } from "../lib/supabase";
import { intakeRetailCsv, sha256Hex } from "./retail/index";

type Supa = ReturnType<typeof getSupabaseClient>;

const ImportSourceSchema = z.object({
  source_type: z.enum([
    "manual", "csv", "affiliate_feed", "flyer",
    "retailer_submission", "user_submission", "partner_feed",
  ]),
  name: z.string().trim().min(1).max(200),
  retailer_name: z.string().trim().max(200).optional(),
  legal_status: z.enum([
    "manual_fact_entry", "licensed_feed", "retailer_supplied",
    "user_supplied", "partner_licensed", "reference_only", "needs_legal_review",
  ]),
  base_trust: z.number().min(0).max(1),
  license_note: z.string().max(1000).optional(),
  attribution_required: z.boolean().optional(),
  shop_id: z.string().uuid().optional(),
});

export const ImportRequestSchema = z.object({
  mode: z.enum(["dry_run", "apply"]),
  file_name: z.string().trim().min(1).max(255),
  csv_text: z.string().min(1).max(900_000), // below the 1 MB JSON body limit
  source: ImportSourceSchema,
});

/** Cap returned per-row detail (avoid huge / over-sharing responses). */
export const MAX_RETURNED_ROWS = 200;

export interface ImportServiceResult {
  httpStatus: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

/**
 * Validate, preview (dry_run) or stage (apply) a retail CSV import.
 * Caller has already authenticated the admin.
 */
export async function runCsvImport(
  supabase: Supa,
  adminUserId: string,
  adminEmail: string | null,
  body: unknown
): Promise<ImportServiceResult> {
  const parsed = ImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      httpStatus: 400,
      payload: {
        ok: false,
        error: "Invalid request body",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  }
  const { mode, file_name, csv_text, source } = parsed.data;

  const fileSha = sha256Hex(csv_text); // never log/echo raw CSV
  const result = intakeRetailCsv(csv_text);

  if (!result.ok) {
    return { httpStatus: 400, payload: { ok: false, mode, file_name, file_sha256: fileSha, error: result.structural_error } };
  }

  const rowsTruncated = result.rows.length > MAX_RETURNED_ROWS;
  const rowSummary = result.rows.slice(0, MAX_RETURNED_ROWS).map((r) => ({
    row_number: r.row_number, status: r.status, observation_hash: r.observation_hash,
    duplicate_in_file: r.duplicate_in_file, warnings: r.warnings, blockers: r.blockers,
  }));

  // ── dry_run: NO writes ──────────────────────────────────────────────────
  if (mode === "dry_run") {
    return {
      httpStatus: 200,
      payload: {
        ok: true, mode: "dry_run", file_name, file_sha256: fileSha,
        total_rows: result.total_rows, valid_rows: result.valid_rows,
        blocked_rows: result.blocked_rows, duplicate_rows_in_file: result.duplicate_rows_in_file,
        category_counts: result.category_counts, warnings: result.warnings,
        rows_truncated: rowsTruncated, rows: rowSummary,
      },
    };
  }

  // ── apply ───────────────────────────────────────────────────────────────
  if (result.valid_rows === 0 || result.candidates.length === 0) {
    return {
      httpStatus: 400,
      payload: {
        ok: false, mode: "apply",
        error: "No stageable rows (all rows are blocked or duplicates).",
        total_rows: result.total_rows, blocked_rows: result.blocked_rows,
        duplicate_rows_in_file: result.duplicate_rows_in_file,
      },
    };
  }

  const mallIds = [...new Set(result.candidates.map((c) => c.mall_id))];
  if (mallIds.length !== 1) {
    return { httpStatus: 400, payload: { ok: false, mode: "apply", error: "All rows must belong to a single mall for one import.", mall_ids: mallIds } };
  }
  const mallId = mallIds[0];
  const shopIds = [...new Set(result.candidates.map((c) => c.shop_id))];

  // Validate mall + shop references against the DB.
  const { data: mallRow, error: mallErr } = await supabase
    .from("malls").select("id").eq("id", mallId).maybeSingle();
  if (mallErr) {
    console.error("[import-csv apply] mall lookup failed:", mallErr);
    return { httpStatus: 500, payload: { ok: false, error: "Could not validate the mall reference." } };
  }
  if (!mallRow) {
    return { httpStatus: 400, payload: { ok: false, error: `Unknown mall_id: ${mallId}` } };
  }

  const { data: shopRows, error: shopErr } = await supabase
    .from("shops").select("id, mall_id").in("id", shopIds);
  if (shopErr) {
    console.error("[import-csv apply] shop lookup failed:", shopErr);
    return { httpStatus: 500, payload: { ok: false, error: "Could not validate shop references." } };
  }
  const foundShops = new Map((shopRows ?? []).map((s: { id: string; mall_id: string }) => [String(s.id), s]));
  const unknownShops = shopIds.filter((id) => !foundShops.has(id));
  if (unknownShops.length) {
    return { httpStatus: 400, payload: { ok: false, error: "Unknown shop_id(s).", unknown_shop_ids: unknownShops } };
  }
  const wrongMallShops = shopIds.filter((id) => String(foundShops.get(id)?.mall_id) !== mallId);
  if (wrongMallShops.length) {
    return { httpStatus: 400, payload: { ok: false, error: "shop_id(s) do not belong to the mall.", shop_ids: wrongMallShops } };
  }

  // Atomic staging via RPC.
  const { data: rpcData, error: rpcErr } = await supabase.rpc("stage_retail_csv_import", {
    p_admin_id: adminUserId,
    p_source: { ...source, mall_id: mallId },
    p_snapshot: {
      content_sha256: fileSha, ref_label: file_name,
      captured_by: adminEmail ?? adminUserId,
      notes: "CSV intake via /admin/retail-observations/import-csv",
    },
    p_batch: { source_file: file_name, total_rows: result.total_rows },
    p_observations: result.candidates,
  });

  if (rpcErr) {
    console.error("[import-csv apply] stage RPC error:", rpcErr); // internal only
    const code = (rpcErr as { code?: string }).code ?? "";
    const msg = rpcErr.message ?? "";
    const migrationMissing =
      code === "PGRST202" ||
      /could not find the function\s+public\.stage_retail_csv_import/i.test(msg) ||
      /function\s+public\.stage_retail_csv_import[^]*does not exist/i.test(msg);
    if (migrationMissing) {
      return { httpStatus: 503, payload: { ok: false, error: "CSV staging is temporarily unavailable (pending a database update)." } };
    }
    return { httpStatus: 500, payload: { ok: false, error: "Failed to stage the import." } };
  }

  const out = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { source_id?: string; snapshot_id?: string; batch_id?: string; staged_rows?: number; skipped_existing?: number; reused_source?: boolean; reused_snapshot?: boolean }
    | null;

  return {
    httpStatus: 200,
    payload: {
      ok: true, mode: "apply",
      source_id: out?.source_id ?? null, snapshot_id: out?.snapshot_id ?? null, batch_id: out?.batch_id ?? null,
      total_rows: result.total_rows, valid_rows: result.valid_rows,
      staged_rows: out?.staged_rows ?? 0, skipped_existing_hashes: out?.skipped_existing ?? 0,
      blocked_rows: result.blocked_rows,
      reused_source: out?.reused_source ?? false, reused_snapshot: out?.reused_snapshot ?? false,
      review_status: "pending",
      next_step: "Review staged observations before publication.",
    },
  };
}
