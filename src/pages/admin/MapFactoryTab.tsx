/**
 * MapFactoryTab.tsx — Sprint 16
 *
 * Admin workspace for the Map Factory autonomous mall cartography engine.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, RefreshCw, CheckCircle2,
  Map, Cpu,
  BarChart3, Upload, Share2, Search,
  GitMerge,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  listMapFactoryJobs,
  getMapFactoryJob,
  createMapFactoryJob,
  discoverSources,
  harvestSources,
  extractAssets,
  buildLayoutModel,
  generateFloorPlan,
  buildRouteGraph,
  runQaChecks,
  publishJob,
  runNextStep,
  repairNodeFloors,
  testProviders,
  type MapFactoryJob,
  type MapFactoryJobDetail,
  type MapFactoryStage,
  type MapFactoryProviderTestResult,
} from "@/lib/mapFactoryClient";

import { StageTracker } from "@/components/map-factory/StageTracker";
import { QaChecksTable } from "@/components/map-factory/QaChecksTable";
import { JobSidebar } from "@/components/map-factory/JobSidebar";
import { JobDetailHeader } from "@/components/map-factory/JobDetailHeader";
import { ProviderStatusPanel } from "@/components/map-factory/ProviderStatusPanel";
import { PipelineStages } from "@/components/map-factory/PipelineStages";

interface Props {
  token: string | undefined;
}

const STAGES = [
  { id: "source_discovery",    label: "Source Discovery",    icon: <Search   className="h-3.5 w-3.5" /> },
  { id: "asset_harvest",       label: "Asset Harvest",       icon: <Upload   className="h-3.5 w-3.5" /> },
  { id: "ai_extraction",       label: "AI Extraction",       icon: <Cpu      className="h-3.5 w-3.5" /> },
  { id: "layout_intelligence", label: "Layout Intelligence", icon: <GitMerge className="h-3.5 w-3.5" /> },
  { id: "floorplan_generation",label: "Floor Plan Gen",      icon: <Map      className="h-3.5 w-3.5" /> },
  { id: "route_graph_build",   label: "Route Graph",         icon: <Share2   className="h-3.5 w-3.5" /> },
  { id: "qa_review",           label: "QA Review",           icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "publish",             label: "Publish",             icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
] as const;

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.id, i])
);

function statusColor(status: MapFactoryJob["status"]) {
  return status === "complete" ? "text-emerald-600"
       : status === "running"  ? "text-blue-600"
       : status === "failed"   ? "text-red-600"
       : status === "paused"   ? "text-amber-600"
       :                         "text-muted-foreground";
}

function statusDot(status: MapFactoryJob["status"]) {
  return status === "complete" ? "bg-emerald-500"
       : status === "running"  ? "bg-blue-500 animate-pulse"
       : status === "failed"   ? "bg-red-500"
       : status === "paused"   ? "bg-amber-500"
       :                         "bg-muted-foreground";
}

function stageProgress(stage: string): number {
  const idx = STAGE_INDEX[stage] ?? 0;
  return Math.round(((idx + 1) / STAGES.length) * 100);
}

function qaColor(score: number) {
  return score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";
}

export default function MapFactoryTab({ token }: Props) {
  const [malls, setMalls]           = useState<Array<{ id: string; name: string }>>([]);
  const [jobs, setJobs]             = useState<MapFactoryJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError]   = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<MapFactoryJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState<string | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [newMallId, setNewMallId]   = useState("");
  const [newNotes, setNewNotes]     = useState("");
  const [creating, setCreating]     = useState(false);
  const [createErr, setCreateErr]   = useState<string | null>(null);
  const [actionBusy, setActionBusy]   = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg]     = useState<string | null>(null);
  const [stageFloor, setStageFloor]   = useState("Level 5");
  const [providerStatus, setProviderStatus]     = useState<MapFactoryProviderTestResult | null>(null);
  const [providerLoading, setProviderLoading]   = useState(false);
  const [providerError, setProviderError]       = useState<string | null>(null);

  useEffect(() => {
    supabase.from("malls").select("id, name").order("name").then(({ data }) => {
      if (data) setMalls(data);
    });
  }, []);

  const loadJobs = useCallback(async () => {
    if (!token) return;
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await listMapFactoryJobs(token);
      setJobs(res.jobs);
    } catch (e) {
      setJobsError(String(e));
    } finally {
      setJobsLoading(false);
    }
  }, [token]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const loadDetail = useCallback(async (jobId: string) => {
    if (!token) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await getMapFactoryJob(jobId, token);
      setDetail(res as MapFactoryJobDetail);
    } catch (e) {
      setDetailError(String(e));
    } finally {
      setDetailLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (selectedJobId) loadDetail(selectedJobId);
    else setDetail(null);
  }, [selectedJobId, loadDetail]);

  async function handleCreateJob() {
    if (!token || !newMallId) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await createMapFactoryJob(newMallId, newNotes || undefined, token);
      setJobs((prev) => [res.job, ...prev]);
      setSelectedJobId(res.job.id);
      setShowNewJob(false);
      setNewNotes("");
    } catch (e) {
      setCreateErr(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleTestProviders() {
    if (!token || !selectedJobId) return;
    setProviderLoading(true);
    setProviderError(null);
    try {
      const res = await testProviders(selectedJobId, token);
      setProviderStatus(res);
    } catch (e) {
      setProviderError(String(e));
    } finally {
      setProviderLoading(false);
    }
  }

  async function handleRepairFloors() {
    if (!token || !selectedJobId) return;
    setActionBusy("repair-floors");
    setActionError(null);
    setActionMsg(null);
    try {
      const r = await repairNodeFloors(selectedJobId, token, stageFloor || undefined);
      setActionMsg(
        `Floor repair: ${r.repaired} node(s) updated to "${r.floor_label}", `
        + `${r.protected_nodes} protected (geodirectory/admin), ${r.skipped} already correct`
      );
      if (selectedJobId) await loadDetail(selectedJobId);
      await loadJobs();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleNextStep() {
    if (!token || !selectedJobId) return;
    setActionBusy("next-step");
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await runNextStep(selectedJobId, token, stageFloor || undefined);
      setActionMsg(`Stage completed → ${res.next_stage}`);
      if (selectedJobId) await loadDetail(selectedJobId);
      await loadJobs();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleStageAction(stageId: MapFactoryStage) {
    if (!token || !selectedJobId) return;
    setActionBusy(stageId);
    setActionError(null);
    setActionMsg(null);

    try {
      let msg = "";
      switch (stageId) {
        case "source_discovery": {
          const r = await discoverSources(selectedJobId, token);
          msg = `Discovered ${r.sources_discovered} sources`;
          break;
        }
        case "asset_harvest": {
          const r = await harvestSources(selectedJobId, token);
          msg = `Harvested ${r.harvested}, skipped ${r.skipped}, failed ${r.failed}`;
          break;
        }
        case "ai_extraction": {
          const r = await extractAssets(selectedJobId, token);
          msg = `Extracted ${r.extracted}/${r.total} assets`;
          break;
        }
        case "layout_intelligence": {
          const r = await buildLayoutModel(selectedJobId, stageFloor || undefined, token);
          msg = `Merged ${r.mergedCount} anchors, ${r.conflictCount} conflicts, coverage ${r.coverageScore}%`;
          break;
        }
        case "floorplan_generation": {
          const r = await generateFloorPlan(selectedJobId, stageFloor, token);
          msg = `Floor plan generated — ID ${r.floorPlanId}`;
          break;
        }
        case "route_graph_build": {
          const r = await buildRouteGraph(selectedJobId, stageFloor || undefined, token);
          const typeSummary = Object.entries(r.node_type_counts ?? {})
            .map(([t, n]) => `${n} ${t}`)
            .join(", ");
          msg = `+${r.created_nodes} new, ${r.repaired_floor_nodes} repaired, ${r.updated_nodes} updated, ${r.skipped_nodes} skipped`
            + ` | edges +${r.created_edges} (${r.skipped_edges ?? 0} dupes)`
            + (typeSummary ? ` — types: ${typeSummary}` : "")
            + (r.floors_processed?.length ? ` — floors: ${r.floors_processed.join(", ")}` : "");
          if (r.validation_issues?.length) msg += ` ⚠ ${r.validation_issues.length} issue(s)`;
          break;
        }
        case "qa_review": {
          const r = await runQaChecks(selectedJobId, token);
          msg = `QA score ${r.readinessScore} — ${r.passed ? "PASSED ✓" : "FAILED ✗"} (${r.blockingIssues} blocking, ${r.warnings} warnings)`;
          break;
        }
        case "publish": {
          const r = await publishJob(selectedJobId, token);
          msg = `Published — ${r.nodesPublished} nodes, ${r.edgesPublished} edges, ${r.floorPlansPublished} floor plan(s)`;
          break;
        }
      }
      setActionMsg(msg);
      if (selectedJobId) await loadDetail(selectedJobId);
      await loadJobs();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(null);
    }
  }

  const job    = detail?.job ?? null;
  const nextStep = detail?.next_step ?? null;
  const latestQa = detail?.latest_qa ?? null;

  return (
    <div className="flex gap-4 h-full min-h-0">
      <JobSidebar
        jobs={jobs}
        loading={jobsLoading}
        error={jobsError}
        selectedJobId={selectedJobId}
        onSelectJob={setSelectedJobId}
        onRefresh={loadJobs}
        onNewJob={() => setShowNewJob((v) => !v)}
        showNewJobForm={showNewJob}
        statusDot={statusDot}
        statusColor={statusColor}
        newJobForm={
          <div className="rounded-lg border border-border bg-muted/30 p-2 flex flex-col gap-1.5 text-xs">
            <p className="font-medium">New Map Factory Job</p>
            <select
              value={newMallId}
              onChange={(e) => setNewMallId(e.target.value)}
              className="border border-input rounded px-1.5 py-1 text-xs bg-background w-full"
            >
              <option value="">Select mall…</option>
              {malls.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="border border-input rounded px-1.5 py-1 text-xs bg-background w-full"
            />
            {createErr && <p className="text-red-600">{createErr}</p>}
            <div className="flex gap-1">
              <button
                onClick={handleCreateJob}
                disabled={creating || !newMallId}
                className="flex-1 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Create Job
              </button>
              <button onClick={() => setShowNewJob(false)} className="px-2 py-1 rounded border border-border text-xs hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        }
      />

      <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
        {!selectedJobId && (
          <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground gap-2">
            <Map className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a job from the sidebar, or create a new one.</p>
          </div>
        )}

        {selectedJobId && detailLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading job…
          </div>
        )}

        {detailError && (
          <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
            {detailError}
          </div>
        )}

        {job && !detailLoading && (
          <>
            <JobDetailHeader
              job={job}
              mallName={(detail as unknown as { job: MapFactoryJob & { malls?: { name: string } } }).job.malls?.name ?? "Unknown Mall"}
              nextStep={nextStep}
              actionBusy={actionBusy}
              onNextStep={handleNextStep}
              onRefresh={() => { if (job) loadDetail(job.id); loadJobs(); }}
              loading={detailLoading}
              statusDot={statusDot}
            />

            {actionMsg && (
              <div className="rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                <span>{actionMsg}</span>
                <button onClick={() => setActionMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}
            {actionError && (
              <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
                <span>{actionError}</span>
                <button onClick={() => setActionError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-card p-3">
              <StageTracker currentStage={job.stage} jobStatus={job.status} stages={STAGES} />
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${stageProgress(job.stage)}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{stageProgress(job.stage)}%</span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Sources",     value: (detail?.sources.length ?? 0) },
                { label: "Assets",      value: (detail?.assets.length ?? 0) },
                { label: "Extractions", value: (detail?.extractions.length ?? 0) },
                { label: "QA Score",    value: job.readiness_score > 0 ? `${job.readiness_score}` : "—",
                  color: job.readiness_score > 0 ? qaColor(job.readiness_score) : "text-muted-foreground" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-card p-2 text-center">
                  <p className={`text-lg font-bold ${(s as { color?: string }).color ?? ""}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            <ProviderStatusPanel
              status={providerStatus}
              loading={providerLoading}
              error={providerError}
              onTest={handleTestProviders}
              disabled={!selectedJobId}
            />

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium whitespace-nowrap">Floor label:</label>
              <input
                value={stageFloor}
                onChange={(e) => setStageFloor(e.target.value)}
                placeholder="e.g. Level 5"
                className="border border-input rounded px-2 py-1 text-xs bg-background flex-1 max-w-[180px]"
              />
              <span className="text-xs text-muted-foreground">(used for floorplan gen + route graph)</span>
              <button
                onClick={handleRepairFloors}
                disabled={!!actionBusy || !selectedJobId}
                title="Update stale floor labels (null/G/L1/L2) on Map Factory-generated nodes to the current floor label"
                className="flex items-center gap-1 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-40"
              >
                {actionBusy === "repair-floors"
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
                Repair Floors
              </button>
            </div>

            <PipelineStages
              stages={STAGES}
              job={job}
              actionBusy={actionBusy}
              onRunStage={handleStageAction}
              stageIndexMap={STAGE_INDEX}
            />

            {latestQa && (
              <div className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <h3 className="text-xs font-semibold flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Latest QA Report
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${qaColor(latestQa.readiness_score)}`}>
                      {latestQa.readiness_score}/100
                    </span>
                    {latestQa.passed
                      ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium">PASS</span>
                      : <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium">FAIL</span>}
                  </div>
                </div>
                <div className="p-3">
                  {latestQa.blocking_issues > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 mb-2">
                      <BarChart3 className="h-3.5 w-3.5" />
                      {latestQa.blocking_issues} blocking issue(s) — must be resolved before publishing
                    </div>
                  )}
                  {latestQa.checks && <QaChecksTable checks={latestQa.checks} />}
                </div>
              </div>
            )}

            {(detail?.floor_plans.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border bg-card">
                <div className="p-3 border-b border-border">
                  <h3 className="text-xs font-semibold flex items-center gap-2">
                    <Map className="h-3.5 w-3.5" /> Generated Floor Plans
                  </h3>
                </div>
                <div className="p-2 flex flex-wrap gap-2">
                  {detail!.floor_plans.map((fp) => (
                    <div key={fp.id} className="rounded border border-border p-2 text-xs">
                      <p className="font-medium">{fp.floor_label}</p>
                      <p className="text-muted-foreground">v{fp.version} · {fp.status}</p>
                      <p className="text-muted-foreground">{new Date(fp.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {job.notes && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <span className="font-medium">Notes:</span> {job.notes}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
