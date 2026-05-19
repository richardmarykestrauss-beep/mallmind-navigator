/**
 * mapFactory.ts — Sprint 15
 *
 * REST routes for the Map Factory autonomous mall cartography pipeline.
 * All routes require an admin bearer token.
 *
 * Mounted at /admin/map-factory in server.ts.
 *
 * Routes:
 *   GET    /admin/map-factory/queue                — list all jobs (optionally filtered by mall_id)
 *   POST   /admin/map-factory/jobs                 — create a new job for a mall
 *   POST   /admin/map-factory/jobs/:jobId/discover-sources  — Stage 1: discover sources
 *   POST   /admin/map-factory/jobs/:jobId/harvest           — Stage 2: harvest all sources
 *   POST   /admin/map-factory/jobs/:jobId/extract           — Stage 3: AI extract all assets
 *   POST   /admin/map-factory/jobs/:jobId/build-layout      — Stage 4: build layout model
 *   POST   /admin/map-factory/jobs/:jobId/generate-floorplan — Stage 5: generate floor plan
 *   POST   /admin/map-factory/jobs/:jobId/build-route-graph  — Stage 6: build route graph
 *   POST   /admin/map-factory/jobs/:jobId/run-qa             — Stage 7: run QA checks
 *   POST   /admin/map-factory/jobs/:jobId/publish            — Stage 8: publish
 *   POST   /admin/map-factory/jobs/:jobId/next-step          — "Run Next Best Step" CTA
 *   GET    /admin/map-factory/jobs/:jobId                    — get single job detail
 */

import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

import { discoverSourcesForMall }   from "../services/mapFactory/mapFactorySourceDiscoveryService.js";
import { harvestAllSourcesForJob }   from "../services/mapFactory/mapFactoryHarvestService.js";
import { extractAllAssetsForJob }    from "../services/mapFactory/mapFactoryExtractionService.js";
import { buildLayoutModel }          from "../services/mapFactory/mapFactoryLayoutIntelligenceService.js";
import { generateFloorPlan }         from "../services/mapFactory/artificialFloorPlanGeneratorService.js";
import { buildRouteGraph, repairNodeFloors } from "../services/mapFactory/mapFactoryRouteGraphBuilderService.js";
import { runQaChecks }               from "../services/mapFactory/mapFactoryQaService.js";
import { publishJob, getNextBestStep } from "../services/mapFactory/mapFactoryPublishService.js";
import { getProviderStatus, getExtractionProviderChain } from "../services/mapFactory/mapFactoryProviderRegistry.js";

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

async function requireAdmin(req: Request, res: Response): Promise<{ userId: string; fullName: string | null } | null> {
  const token = extractToken(req);

  if (!token) {
    if (process.env.NODE_ENV !== "production")
      console.warn("[map-factory auth] FAIL — no bearer token in request");
    res.status(401).json({ error: "Missing bearer token" });
    return null;
  }

  const supabase = getSupabaseClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    if (process.env.NODE_ENV !== "production")
      console.warn("[map-factory auth] FAIL — token invalid or expired:", authErr?.message);
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }

  // Use is_admin boolean — same field as mallIntelligence.ts requireAdmin
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id, is_admin, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[map-factory auth] user=${user.id} profile_found=${!!profile} is_admin=${profile?.is_admin ?? false}`
        + (profileErr ? ` profile_error=${profileErr.message}` : ""),
    );
  }

  if (!profile?.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return { userId: user.id, fullName: (profile as { full_name?: string }).full_name ?? null };
}

// Helper to advance job stage in DB
async function advanceJobStage(
  jobId:    string,
  stage:    string,
  status:   "running" | "paused" | "complete" | "failed",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  await supabase
    .from("map_factory_jobs")
    .update({ stage, status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

// ── GET /queue ────────────────────────────────────────────────────────────────

router.get("/queue", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();

  const mallId = Array.isArray(req.query.mall_id) ? req.query.mall_id[0] : (req.query.mall_id as string | undefined);

  let q = supabase
    .from("map_factory_jobs")
    .select("id, mall_id, status, stage, readiness_score, notes, created_by, created_at, updated_at, malls(name)")
    .order("updated_at", { ascending: false });

  if (mallId) q = q.eq("mall_id", mallId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, jobs: data ?? [] });
});

// ── GET /jobs/:jobId ──────────────────────────────────────────────────────────

router.get("/jobs/:jobId", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job, error: jobErr } = await supabase
    .from("map_factory_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (jobErr || !job) return res.status(404).json({ error: "Job not found" });

  const [sourcesRes, assetsRes, extractionsRes, modelsRes, floorPlansRes, qaRes, publishRes] = await Promise.all([
    supabase.from("map_factory_sources").select("*").eq("job_id", jobId),
    supabase.from("map_factory_assets").select("*").eq("job_id", jobId),
    supabase.from("map_factory_extractions").select("id, floor_label, provider, status, anchors_saved, anchors_skipped, warnings, created_at").eq("job_id", jobId),
    supabase.from("map_factory_layout_models").select("id, floor_label, coverage_score, conflict_count:conflicts", { count: "exact" }).eq("job_id", jobId),
    supabase.from("map_factory_generated_floorplans").select("id, floor_label, version, status, created_at").eq("job_id", jobId),
    supabase.from("map_factory_qa_reports").select("id, readiness_score, passed, blocking_issues, warnings, created_at").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1),
    supabase.from("map_factory_publish_records").select("*").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1),
  ]);

  const nextStep = getNextBestStep(job.stage, job.readiness_score ?? 0);

  res.json({
    ok: true, job,
    sources:     sourcesRes.data ?? [],
    assets:      assetsRes.data ?? [],
    extractions: extractionsRes.data ?? [],
    layout_models: modelsRes.data ?? [],
    floor_plans: floorPlansRes.data ?? [],
    latest_qa:   (qaRes.data ?? [])[0] ?? null,
    latest_publish: (publishRes.data ?? [])[0] ?? null,
    next_step:   nextStep,
  });
});

// ── POST /jobs ────────────────────────────────────────────────────────────────

router.post("/jobs", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();

  const { mall_id, notes } = req.body ?? {};
  if (!mall_id) return res.status(400).json({ error: "mall_id is required" });

  const { data: mall } = await supabase.from("malls").select("id, name").eq("id", mall_id).maybeSingle();
  if (!mall) return res.status(400).json({ error: `Mall ${mall_id} not found` });

  const { data: job, error } = await supabase
    .from("map_factory_jobs")
    .insert({ mall_id, notes: notes ?? null, created_by: auth.userId, status: "pending", stage: "source_discovery" })
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true, job });
});

// ── POST /jobs/:jobId/discover-sources ────────────────────────────────────────

router.post("/jobs/:jobId/discover-sources", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "source_discovery", "running", supabase);

  const discovered = await discoverSourcesForMall(job.mall_id, supabase);

  // Insert sources (skip duplicates by url/asset_id within job)
  let inserted = 0;
  for (const src of discovered) {
    const { error: insertErr } = await supabase.from("map_factory_sources").insert({
      job_id:      jobId,
      mall_id:     job.mall_id,
      source_type: src.source_type,
      url:         src.url,
      asset_id:    src.asset_id,
      title:       src.title,
      confidence:  src.confidence,
      notes:       src.notes,
      status:      "discovered",
    });
    if (!insertErr) inserted++;
  }

  await advanceJobStage(jobId, "asset_harvest", "paused", supabase);
  res.json({ ok: true, sources_discovered: inserted, total_found: discovered.length });
});

// ── POST /jobs/:jobId/harvest ─────────────────────────────────────────────────

router.post("/jobs/:jobId/harvest", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "asset_harvest", "running", supabase);
  const result = await harvestAllSourcesForJob(jobId, job.mall_id, supabase);
  await advanceJobStage(jobId, "ai_extraction", "paused", supabase);

  res.json({ ok: true, ...result });
});

// ── POST /jobs/:jobId/extract ─────────────────────────────────────────────────

router.post("/jobs/:jobId/extract", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "ai_extraction", "running", supabase);
  const result = await extractAllAssetsForJob(jobId, job.mall_id, supabase);
  await advanceJobStage(jobId, "layout_intelligence", "paused", supabase);

  res.json({ ok: true, ...result });
});

// ── POST /jobs/:jobId/build-layout ────────────────────────────────────────────

router.post("/jobs/:jobId/build-layout", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;
  const { floor_label } = req.body ?? {};

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "layout_intelligence", "running", supabase);
  const result = await buildLayoutModel(jobId, job.mall_id, floor_label ?? null, supabase);
  if (result.ok) await advanceJobStage(jobId, "floorplan_generation", "paused", supabase);
  else           await advanceJobStage(jobId, "layout_intelligence", "failed", supabase);

  res.json(result);
});

// ── POST /jobs/:jobId/generate-floorplan ──────────────────────────────────────

router.post("/jobs/:jobId/generate-floorplan", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;
  const { floor_label } = req.body ?? {};
  if (!floor_label) return res.status(400).json({ error: "floor_label is required" });

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "floorplan_generation", "running", supabase);
  const result = await generateFloorPlan(jobId, job.mall_id, floor_label, supabase);
  if (result.ok) await advanceJobStage(jobId, "route_graph_build", "paused", supabase);
  else           await advanceJobStage(jobId, "floorplan_generation", "failed", supabase);

  res.json({ ok: result.ok, floorPlanId: result.floorPlanId, error: result.error });
});

// ── POST /jobs/:jobId/build-route-graph ───────────────────────────────────────

router.post("/jobs/:jobId/build-route-graph", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;
  const { floor_label } = req.body ?? {};

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "route_graph_build", "running", supabase);
  const result = await buildRouteGraph(jobId, job.mall_id, floor_label ?? null, supabase);
  if (result.ok) await advanceJobStage(jobId, "qa_review", "paused", supabase);
  else           await advanceJobStage(jobId, "route_graph_build", "failed", supabase);

  res.json(result);
});

// ── POST /jobs/:jobId/run-qa ──────────────────────────────────────────────────

router.post("/jobs/:jobId/run-qa", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  await advanceJobStage(jobId, "qa_review", "running", supabase);
  const result = await runQaChecks(jobId, job.mall_id, supabase);
  await advanceJobStage(jobId, result.passed ? "publish" : "qa_review", "paused", supabase);

  res.json(result);
});

// ── POST /jobs/:jobId/publish ─────────────────────────────────────────────────

router.post("/jobs/:jobId/publish", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  // full_name already resolved during requireAdmin — no second profile query needed
  const publishedBy = auth.fullName ?? auth.userId;

  await advanceJobStage(jobId, "publish", "running", supabase);
  const result = await publishJob(jobId, job.mall_id, publishedBy, supabase);

  if (!result.ok && result.blockedReason) {
    await advanceJobStage(jobId, "qa_review", "paused", supabase);
    return res.status(422).json({ ok: false, blocked: true, reason: result.blockedReason });
  }
  if (!result.ok) {
    await advanceJobStage(jobId, "publish", "failed", supabase);
    return res.status(500).json({ ok: false, error: result.error });
  }

  res.json(result);
});

// ── POST /jobs/:jobId/repair-node-floors ─────────────────────────────────────
// Dev-safe repair: updates stale floor labels (null/G/L1/L2/unknown) for
// Map Factory-generated nodes to the explicit floor_label from the request body.
// Does NOT touch nodes with source = 'geodirectory', 'admin', or 'manual'.

router.post("/jobs/:jobId/repair-node-floors", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;
  const { floor_label } = req.body ?? {};
  if (!floor_label) return res.status(400).json({ error: "floor_label is required" });

  const { data: job } = await supabase.from("map_factory_jobs").select("id, mall_id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  const result = await repairNodeFloors(job.mall_id, floor_label, supabase);
  if (!result.ok) return res.status(500).json({ ok: false, error: result.error });

  res.json({
    ok:              true,
    repaired:        result.repaired,
    skipped:         result.skipped,
    protected_nodes: result.protected_nodes,
    mall_id:         job.mall_id,
    floor_label,
  });
});

// ── POST /jobs/:jobId/next-step ───────────────────────────────────────────────
// "Run Next Best Step" CTA — determines and executes the next pipeline stage.

router.post("/jobs/:jobId/next-step", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const supabase = getSupabaseClient();
  const jobId = req.params.jobId as string;

  const { data: job } = await supabase.from("map_factory_jobs").select("*").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  const { floor_label } = req.body ?? {};
  const stage = job.stage as string;

  // Delegate to the appropriate stage handler by reusing internal logic
  switch (stage) {
    case "source_discovery": {
      const discovered = await discoverSourcesForMall(job.mall_id, supabase);
      let inserted = 0;
      for (const src of discovered) {
        const { error: insertErr } = await supabase.from("map_factory_sources").insert({
          job_id: jobId, mall_id: job.mall_id, source_type: src.source_type,
          url: src.url, asset_id: src.asset_id, title: src.title, confidence: src.confidence, notes: src.notes, status: "discovered",
        });
        if (!insertErr) inserted++;
      }
      await advanceJobStage(jobId, "asset_harvest", "paused", supabase);
      return res.json({ ok: true, next_stage: "asset_harvest", detail: `Discovered ${inserted} sources` });
    }
    case "asset_harvest": {
      await advanceJobStage(jobId, "asset_harvest", "running", supabase);
      const r = await harvestAllSourcesForJob(jobId, job.mall_id, supabase);
      await advanceJobStage(jobId, "ai_extraction", "paused", supabase);
      return res.json({ ok: true, next_stage: "ai_extraction", detail: r });
    }
    case "ai_extraction": {
      await advanceJobStage(jobId, "ai_extraction", "running", supabase);
      const r = await extractAllAssetsForJob(jobId, job.mall_id, supabase);
      await advanceJobStage(jobId, "layout_intelligence", "paused", supabase);
      return res.json({ ok: true, next_stage: "layout_intelligence", detail: r });
    }
    case "layout_intelligence": {
      await advanceJobStage(jobId, "layout_intelligence", "running", supabase);
      const r = await buildLayoutModel(jobId, job.mall_id, floor_label ?? null, supabase);
      if (r.ok) await advanceJobStage(jobId, "floorplan_generation", "paused", supabase);
      return res.json({ ok: r.ok, next_stage: "floorplan_generation", detail: r });
    }
    case "floorplan_generation": {
      if (!floor_label) return res.status(400).json({ error: "floor_label required for floorplan_generation step" });
      await advanceJobStage(jobId, "floorplan_generation", "running", supabase);
      const r = await generateFloorPlan(jobId, job.mall_id, floor_label, supabase);
      if (r.ok) await advanceJobStage(jobId, "route_graph_build", "paused", supabase);
      return res.json({ ok: r.ok, next_stage: "route_graph_build", detail: { floorPlanId: r.floorPlanId } });
    }
    case "route_graph_build": {
      await advanceJobStage(jobId, "route_graph_build", "running", supabase);
      const r = await buildRouteGraph(jobId, job.mall_id, floor_label ?? null, supabase);
      if (r.ok) await advanceJobStage(jobId, "qa_review", "paused", supabase);
      return res.json({ ok: r.ok, next_stage: "qa_review", detail: r });
    }
    case "qa_review": {
      await advanceJobStage(jobId, "qa_review", "running", supabase);
      const r = await runQaChecks(jobId, job.mall_id, supabase);
      await advanceJobStage(jobId, r.passed ? "publish" : "qa_review", "paused", supabase);
      return res.json({ ok: r.ok, next_stage: r.passed ? "publish" : "qa_review", detail: r });
    }
    case "publish": {
      const publishedBy = auth.fullName ?? auth.userId;
      await advanceJobStage(jobId, "publish", "running", supabase);
      const r = await publishJob(jobId, job.mall_id, publishedBy, supabase);
      return res.json({ ok: r.ok, next_stage: "complete", detail: r });
    }
    default:
      return res.status(400).json({ error: `Unknown stage: ${stage}` });
  }
});

// ── POST /jobs/:jobId/extraction/provider-test ────────────────────────────────
// Returns the configured status of every AI provider.
// Does NOT expose API keys or other secrets.

router.post("/jobs/:jobId/extraction/provider-test", async (req: Request, res: Response) => {
  const auth = await requireAdmin(req, res); if (!auth) return;
  const jobId = req.params.jobId as string;

  const supabase = getSupabaseClient();
  const { data: job } = await supabase.from("map_factory_jobs").select("id").eq("id", jobId).single();
  if (!job) return res.status(404).json({ error: "Job not found" });

  const status        = getProviderStatus();
  const defaultChain  = getExtractionProviderChain();
  const imageChain    = getExtractionProviderChain("image/jpeg");

  res.json({
    ok: true,
    providers: status,
    default_chain:   defaultChain,
    image_chain:     imageChain,
    google_ai_enabled: process.env.MAP_FACTORY_ENABLE_GOOGLE_AI === "true",
    active_provider:   process.env.MAP_FACTORY_AI_PROVIDER ?? "mock",
  });
});

export default router;
