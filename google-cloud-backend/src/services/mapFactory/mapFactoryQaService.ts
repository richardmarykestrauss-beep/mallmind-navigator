/**
 * mapFactoryQaService.ts — Sprint 15
 *
 * QA checks and readiness scoring before a job can be published.
 * Returns a QA report with individual check results and an overall pass/fail.
 *
 * Readiness score (0–100):
 *   ≥ 80 → PASS  (job can be published)
 *   < 80 → FAIL  (blocking issues must be resolved first)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type QaSeverity = "blocking" | "warning" | "info";

export interface QaCheck {
  check_name: string;
  passed:     boolean;
  severity:   QaSeverity;
  detail:     string;
}

export interface QaResult {
  ok:             boolean;
  qaReportId?:    string;
  readinessScore: number;
  passed:         boolean;
  checks:         QaCheck[];
  blockingIssues: number;
  warnings:       number;
  error?:         string;
}

const PASS_THRESHOLD = 80;

// ── Individual check functions ────────────────────────────────────────────────

async function checkHasNodes(mallId: string, supabase: unknown): Promise<QaCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any).from("mall_nodes").select("id", { count: "exact", head: true }).eq("mall_id", mallId);
  return {
    check_name: "has_nodes",
    passed:     (count ?? 0) >= 5,
    severity:   "blocking",
    detail:     `Mall has ${count ?? 0} route node(s). Minimum 5 required for basic navigation.`,
  };
}

async function checkHasEntrance(mallId: string, supabase: unknown): Promise<QaCheck> {
  // mall_nodes.type is the correct column (not node_type)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any).from("mall_nodes").select("id", { count: "exact", head: true }).eq("mall_id", mallId).eq("type", "entrance");
  return {
    check_name: "has_entrance_node",
    passed:     (count ?? 0) >= 1,
    severity:   "blocking",
    detail:     `${count ?? 0} entrance node(s). At least 1 required for route start.`,
  };
}

async function checkHasShops(mallId: string, supabase: unknown): Promise<QaCheck> {
  // mall_nodes.type is the correct column (not node_type)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any).from("mall_nodes").select("id", { count: "exact", head: true }).eq("mall_id", mallId).eq("type", "shop");
  return {
    check_name: "has_shop_nodes",
    passed:     (count ?? 0) >= 3,
    severity:   "blocking",
    detail:     `${count ?? 0} shop node(s). At least 3 required for a useful route graph.`,
  };
}

async function checkHasEdges(mallId: string, supabase: unknown): Promise<QaCheck> {
  // Correct table: mall_edges (not mall_node_edges)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any).from("mall_edges").select("id", { count: "exact", head: true }).eq("mall_id", mallId);
  return {
    check_name: "has_edges",
    passed:     (count ?? 0) >= 2,
    severity:   "warning",
    detail:     `${count ?? 0} route edge(s). At least 2 recommended for connected graph.`,
  };
}

async function checkHasFloorPlan(jobId: string, supabase: unknown): Promise<QaCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from("map_factory_generated_floorplans")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("status", ["draft", "review", "approved"]);
  return {
    check_name: "has_generated_floorplan",
    passed:     (count ?? 0) >= 1,
    severity:   "warning",
    detail:     `${count ?? 0} generated floor plan(s). Recommended for customer-facing UI.`,
  };
}

async function checkNoHighConflicts(jobId: string, supabase: unknown): Promise<QaCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: models } = await (supabase as any)
    .from("map_factory_layout_models")
    .select("conflicts")
    .eq("job_id", jobId);

  let highConflicts = 0;
  for (const m of (models ?? [])) {
    if (Array.isArray(m.conflicts)) {
      highConflicts += (m.conflicts as Array<{ severity: string }>).filter((c) => c.severity === "high").length;
    }
  }

  return {
    check_name: "no_high_severity_conflicts",
    passed:     highConflicts === 0,
    severity:   "warning",
    detail:     `${highConflicts} high-severity coordinate conflict(s) found in layout models.`,
  };
}

async function checkExtractionComplete(jobId: string, supabase: unknown): Promise<QaCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: total } = await (supabase as any).from("map_factory_assets").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: extracted } = await (supabase as any).from("map_factory_extractions").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "complete");
  const pct = total ? Math.round(((extracted ?? 0) / total) * 100) : 0;
  return {
    check_name: "extraction_coverage",
    passed:     pct >= 80,
    severity:   "warning",
    detail:     `${extracted ?? 0}/${total ?? 0} assets extracted (${pct}%). 80% threshold.`,
  };
}

// ── Score calculator ──────────────────────────────────────────────────────────

function computeScore(checks: QaCheck[]): number {
  const blockingWeight = 25;
  const warningWeight  = 10;

  let deductions = 0;
  for (const c of checks) {
    if (!c.passed) {
      deductions += c.severity === "blocking" ? blockingWeight : c.severity === "warning" ? warningWeight : 0;
    }
  }
  return Math.max(0, 100 - deductions);
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runQaChecks(
  jobId:    string,
  mallId:   string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<QaResult> {
  try {
    const checks = await Promise.all([
      checkHasNodes(mallId, supabase),
      checkHasEntrance(mallId, supabase),
      checkHasShops(mallId, supabase),
      checkHasEdges(mallId, supabase),
      checkHasFloorPlan(jobId, supabase),
      checkNoHighConflicts(jobId, supabase),
      checkExtractionComplete(jobId, supabase),
    ]);

    const readinessScore = computeScore(checks);
    const blockingIssues = checks.filter((c) => !c.passed && c.severity === "blocking").length;
    const warnings       = checks.filter((c) => !c.passed && c.severity === "warning").length;
    const passed         = readinessScore >= PASS_THRESHOLD;

    const { data: inserted, error: insertErr } = await supabase
      .from("map_factory_qa_reports")
      .insert({
        job_id:          jobId,
        mall_id:         mallId,
        readiness_score: readinessScore,
        checks,
        blocking_issues: blockingIssues,
        warnings,
        passed,
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    // Update job readiness_score
    await supabase
      .from("map_factory_jobs")
      .update({ readiness_score: readinessScore })
      .eq("id", jobId);

    return { ok: true, qaReportId: inserted.id, readinessScore, passed, checks, blockingIssues, warnings };

  } catch (err) {
    return { ok: false, readinessScore: 0, passed: false, checks: [], blockingIssues: 0, warnings: 0, error: String(err) };
  }
}
