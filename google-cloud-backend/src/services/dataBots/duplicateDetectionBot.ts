/**
 * Duplicate Detection Bot
 *
 * Sprint 9C · MallMind Navigator
 *
 * Reads existing shops and products from Supabase to detect potential
 * duplicates before a new submission is applied to live data.
 *
 * Async — reads Supabase (shops, products). Never writes.
 */

import { getSupabaseClient } from "../../lib/supabase.js";
import type { BotOutputBase } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DuplicateMatchStrength = "exact" | "high" | "medium" | "low" | "none";

export interface DuplicateCandidate {
  match_strength:     DuplicateMatchStrength;
  match_score:        number; // 0–100
  matched_table:      "shops" | "products";
  matched_id:         string;
  matched_name:       string;
  matched_mall_id?:   string;
  matched_floor?:     string;
  matched_unit?:      string;
  overlap_reason:     string;
}

export interface DuplicateDetectionInput {
  finding_type: "shop" | "product" | "price" | "other";
  name?: string;           // Shop name or product name to check
  mall_id?: string;        // Narrow search to a specific mall
  floor?: string;
  unit_number?: string;
  brand?: string;          // Product brand (for product duplicates)
}

export interface DuplicateDetectionResult extends BotOutputBase {
  duplicates_found:     number;
  top_candidate?:       DuplicateCandidate;
  all_candidates:       DuplicateCandidate[];
  dedup_recommendation: "create_new" | "link_to_existing" | "needs_human_review";
}

// ── Name normalisation ────────────────────────────────────────────────────────

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")   // remove punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// ── Word-overlap score (Jaccard-like) ─────────────────────────────────────────

function wordOverlapScore(a: string, b: string): number {
  const wordsA = new Set(normaliseName(a).split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(normaliseName(b).split(" ").filter((w) => w.length > 2));
  if (!wordsA.size || !wordsB.size) return 0;
  let overlap = 0;
  wordsA.forEach((w) => { if (wordsB.has(w)) overlap++; });
  return Math.round((overlap / Math.max(wordsA.size, wordsB.size)) * 100);
}

function matchStrengthFromScore(score: number): DuplicateMatchStrength {
  if (score >= 95) return "exact";
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  if (score >= 25) return "low";
  return "none";
}

// ── Shop duplicate check ──────────────────────────────────────────────────────

async function checkShopDuplicates(input: DuplicateDetectionInput): Promise<DuplicateCandidate[]> {
  if (!input.name) return [];

  const supabase = getSupabaseClient();
  let query = supabase
    .from("shops")
    .select("id, name, mall_id, floor, unit_number");

  if (input.mall_id) query = query.eq("mall_id", input.mall_id);

  const { data, error } = await query.limit(200);
  if (error || !data) return [];

  const inputNorm  = normaliseName(input.name);
  const candidates: DuplicateCandidate[] = [];

  for (const row of data) {
    const rowNorm = normaliseName(row.name ?? "");
    if (!rowNorm) continue;

    let score = wordOverlapScore(input.name, row.name ?? "");

    // Boost for exact match
    if (inputNorm === rowNorm) score = 100;
    // Boost if one contains the other
    else if (inputNorm.includes(rowNorm) || rowNorm.includes(inputNorm)) score = Math.max(score, 80);
    // Boost for same floor + unit
    if (input.floor && row.floor && normaliseName(input.floor) === normaliseName(row.floor)) score = Math.min(score + 5, 100);
    if (input.unit_number && row.unit_number && normaliseName(input.unit_number) === normaliseName(row.unit_number)) score = Math.min(score + 10, 100);

    const strength = matchStrengthFromScore(score);
    if (strength === "none") continue;

    candidates.push({
      match_strength:   strength,
      match_score:      score,
      matched_table:    "shops",
      matched_id:       row.id,
      matched_name:     row.name,
      matched_mall_id:  row.mall_id,
      matched_floor:    row.floor ?? undefined,
      matched_unit:     row.unit_number ?? undefined,
      overlap_reason:   `Name similarity ${score}%${strength === "exact" ? " (exact)" : ""}`,
    });
  }

  return candidates.sort((a, b) => b.match_score - a.match_score);
}

// ── Product duplicate check ───────────────────────────────────────────────────

async function checkProductDuplicates(input: DuplicateDetectionInput): Promise<DuplicateCandidate[]> {
  if (!input.name) return [];

  const supabase = getSupabaseClient();
  let query = supabase
    .from("products")
    .select("id, name, brand, shop_id");

  const { data, error } = await query.limit(500);
  if (error || !data) return [];

  const inputNorm  = normaliseName(input.name);
  const brandNorm  = input.brand ? normaliseName(input.brand) : null;
  const candidates: DuplicateCandidate[] = [];

  for (const row of data) {
    const rowNorm = normaliseName(row.name ?? "");
    if (!rowNorm) continue;

    let score = wordOverlapScore(input.name, row.name ?? "");
    if (inputNorm === rowNorm) score = 100;
    else if (inputNorm.includes(rowNorm) || rowNorm.includes(inputNorm)) score = Math.max(score, 80);

    // Brand match boosts confidence
    if (brandNorm && row.brand) {
      const rowBrandNorm = normaliseName(row.brand);
      if (brandNorm === rowBrandNorm) score = Math.min(score + 10, 100);
    }

    const strength = matchStrengthFromScore(score);
    if (strength === "none") continue;

    candidates.push({
      match_strength:  strength,
      match_score:     score,
      matched_table:   "products",
      matched_id:      row.id,
      matched_name:    row.name,
      overlap_reason:  `Name similarity ${score}%${brandNorm && row.brand ? " + brand" : ""}`,
    });
  }

  return candidates.sort((a, b) => b.match_score - a.match_score);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runDuplicateDetectionBot(
  input: DuplicateDetectionInput
): Promise<DuplicateDetectionResult> {
  const now = new Date().toISOString();

  if (!input.name) {
    return {
      bot_name:                  "DuplicateDetectionBot",
      processed_at:              now,
      risk_level:                "medium",
      recommendation:            "needs_admin_review",
      live_data_action_safety:   "requires_review",
      must_not_update_live_data: true,
      reasoning:                 ["No name provided — cannot check for duplicates."],
      duplicates_found:          0,
      all_candidates:            [],
      dedup_recommendation:      "needs_human_review",
    };
  }

  let candidates: DuplicateCandidate[] = [];

  try {
    if (input.finding_type === "shop") {
      candidates = await checkShopDuplicates(input);
    } else if (input.finding_type === "product" || input.finding_type === "price") {
      candidates = await checkProductDuplicates(input);
    } else {
      // Try both
      const [shops, products] = await Promise.all([
        checkShopDuplicates(input),
        checkProductDuplicates(input),
      ]);
      candidates = [...shops, ...products].sort((a, b) => b.match_score - a.match_score);
    }
  } catch (err) {
    return {
      bot_name:                  "DuplicateDetectionBot",
      processed_at:              now,
      risk_level:                "medium",
      recommendation:            "needs_admin_review",
      live_data_action_safety:   "requires_review",
      must_not_update_live_data: true,
      reasoning:                 [`Database lookup failed: ${(err as Error).message}. Manual review required.`],
      duplicates_found:          0,
      all_candidates:            [],
      dedup_recommendation:      "needs_human_review",
    };
  }

  const top = candidates[0] ?? null;
  const reasoning: string[] = [];
  let recommendation: DuplicateDetectionResult["dedup_recommendation"];

  if (!candidates.length) {
    recommendation = "create_new";
    reasoning.push("No duplicate candidates found in the database.");
    reasoning.push("This appears to be a new entry — safe to proceed with admin review.");
  } else if (top && top.match_strength === "exact") {
    recommendation = "link_to_existing";
    reasoning.push(`Exact duplicate found: "${top.matched_name}" (${top.matched_table}, id: ${top.matched_id}).`);
    reasoning.push("Admin should verify this is the same record before applying any update.");
    reasoning.push("Do NOT create a new record — link the finding to the existing one.");
  } else if (top && (top.match_strength === "high")) {
    recommendation = "link_to_existing";
    reasoning.push(`High-confidence duplicate candidate: "${top.matched_name}" (score: ${top.match_score}%).`);
    reasoning.push("Admin should compare the records carefully before deciding to link or create new.");
  } else {
    recommendation = "needs_human_review";
    reasoning.push(`${candidates.length} low-to-medium confidence candidate(s) found.`);
    reasoning.push("Admin should review the candidates and decide whether to link or create a new record.");
  }

  const riskLevel = recommendation === "link_to_existing" ? "high"
    : candidates.length > 0 ? "medium"
    : "low";

  return {
    bot_name:                  "DuplicateDetectionBot",
    processed_at:              now,
    risk_level:                riskLevel,
    recommendation:            recommendation === "create_new" ? "proceed" : "needs_admin_review",
    live_data_action_safety:   recommendation === "create_new" ? "safe_to_plan" : "requires_review",
    must_not_update_live_data: recommendation !== "create_new",
    reasoning,
    duplicates_found:          candidates.length,
    top_candidate:             top ?? undefined,
    all_candidates:            candidates.slice(0, 10), // cap to 10
    dedup_recommendation:      recommendation,
  };
}
