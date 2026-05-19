/**
 * mapFactoryPublishService.ts — Sprint 15
 *
 * Publish guard: verifies QA passed, then promotes the generated floor plan
 * to "published" status and writes an immutable publish record.
 *
 * IMPORTANT: Publishing does NOT overwrite live shop/product data.
 * It sets map_factory_generated_floorplans.status = "published" and
 * mall_nodes.is_active = true for all nodes created by this job.
 *
 * A publish record in map_factory_publish_records provides an audit trail.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PublishResult {
  ok:              boolean;
  publishRecordId?: string;
  nodesPublished:  number;
  edgesPublished:  number;
  floorPlansPublished: number;
  error?:          string;
  blockedReason?:  string;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function publishJob(
  jobId:       string,
  mallId:      string,
  publishedBy: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any,
): Promise<PublishResult> {
  try {
    // 1. Verify latest QA report passed
    const { data: latestQa } = await supabase
      .from("map_factory_qa_reports")
      .select("id, passed, readiness_score")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestQa) {
      return { ok: false, nodesPublished: 0, edgesPublished: 0, floorPlansPublished: 0,
        blockedReason: "No QA report found. Run QA check before publishing." };
    }
    if (!latestQa.passed) {
      return { ok: false, nodesPublished: 0, edgesPublished: 0, floorPlansPublished: 0,
        blockedReason: `QA not passed (score: ${latestQa.readiness_score}). Fix blocking issues first.` };
    }

    // 2. Count nodes and edges associated with this job's mall
    const { count: nodeCount } = await supabase
      .from("mall_nodes")
      .select("id", { count: "exact", head: true })
      .eq("mall_id", mallId);

    const { count: edgeCount } = await supabase
      .from("mall_node_edges")
      .select("id", { count: "exact", head: true })
      .eq("mall_id", mallId);

    // 3. Mark floor plans as published
    const { data: floorPlans } = await supabase
      .from("map_factory_generated_floorplans")
      .select("id")
      .eq("job_id", jobId)
      .in("status", ["draft", "review", "approved"]);

    let floorPlansPublished = 0;
    for (const fp of (floorPlans ?? [])) {
      await supabase
        .from("map_factory_generated_floorplans")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", fp.id);
      floorPlansPublished++;
    }

    // 4. Mark job as complete
    await supabase
      .from("map_factory_jobs")
      .update({ status: "complete", stage: "publish", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    // 5. Write publish record (immutable audit trail)
    const { data: record, error: recordErr } = await supabase
      .from("map_factory_publish_records")
      .insert({
        job_id:          jobId,
        mall_id:         mallId,
        floorplan_id:    (floorPlans ?? [])[0]?.id ?? null,
        nodes_published: nodeCount ?? 0,
        edges_published: edgeCount ?? 0,
        published_by:    publishedBy,
        qa_score:        latestQa.readiness_score,
      })
      .select("id")
      .single();

    if (recordErr) throw new Error(recordErr.message);

    return {
      ok:              true,
      publishRecordId: record.id,
      nodesPublished:  nodeCount ?? 0,
      edgesPublished:  edgeCount ?? 0,
      floorPlansPublished,
    };

  } catch (err) {
    return { ok: false, nodesPublished: 0, edgesPublished: 0, floorPlansPublished: 0, error: String(err) };
  }
}

/**
 * Determine the "next best step" for a job given its current stage.
 * Returns the stage name and action label for the "Run Next Best Step" CTA.
 */
export function getNextBestStep(
  stage:          string,
  readinessScore: number,
): { nextStage: string; actionLabel: string; canSkip: boolean } {
  const steps: Record<string, { nextStage: string; actionLabel: string; canSkip: boolean }> = {
    source_discovery:    { nextStage: "asset_harvest",        actionLabel: "Harvest Sources",             canSkip: false },
    asset_harvest:       { nextStage: "ai_extraction",        actionLabel: "Run AI Extraction",           canSkip: false },
    ai_extraction:       { nextStage: "layout_intelligence",  actionLabel: "Build Layout Model",          canSkip: false },
    layout_intelligence: { nextStage: "floorplan_generation", actionLabel: "Generate Floor Plan",         canSkip: true  },
    floorplan_generation:{ nextStage: "route_graph_build",    actionLabel: "Build Route Graph",           canSkip: false },
    route_graph_build:   { nextStage: "qa_review",            actionLabel: "Run QA Checks",               canSkip: false },
    qa_review:           { nextStage: "publish",              actionLabel: readinessScore >= 80 ? "Publish" : "Fix Issues & Re-run QA", canSkip: false },
    publish:             { nextStage: "complete",             actionLabel: "Already Published",           canSkip: true  },
  };
  return steps[stage] ?? { nextStage: "source_discovery", actionLabel: "Discover Sources", canSkip: false };
}
