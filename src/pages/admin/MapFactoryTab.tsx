/**
 * MapFactoryTab.tsx — Sprint 15
 *
 * Admin workspace for the Map Factory autonomous mall cartography engine.
 * 8-stage workflow with sidebar job list and "Run Next Best Step" CTA.
 *
 * Stages:
 *  1. source_discovery    — classify evidence sources
 *  2. asset_harvest       — fetch/hash/dedup raw assets
 *  3. ai_extraction       — AI anchor + corridor extraction
 *  4. layout_intelligence — merge evidence + conflict resolution
 *  5. floorplan_generation — generate proprietary artificial floor plan
 *  6. route_graph_build   — auto-build route nodes + edges
 *  7. qa_review           — readiness score + QA checks
 *  8. publish             — publish guard + audit trail
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2, Plus, RefreshCw, ChevronRight, CheckCircle2,
  AlertCircle, Clock, Zap, Map, GitMerge, Cpu,
  BarChart3, Upload, Share2, Search,
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
  type MapFactoryJob,
  type MapFactoryJobDetail,
  type MapFactoryQaCheck,
} from "@/lib/mapFactoryClient";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  token: string | undefined;
}

// ── Stage config ──────────────────────────────────────────────────────────────

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

type StageId = typeof STAGES[number]["id"];

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.id, i])
);

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function StageTracker({ currentStage, jobStatus }: { currentStage: string; jobStatus: MapFactoryJob["status"] }) {
  const currentIdx = STAGE_INDEX[currentStage] ?? 0;

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
      {STAGES.map((s, i) => {
        const isDone    = i < currentIdx || jobStatus === "complete";
        const isCurrent = i === currentIdx && jobStatus !== "complete";
        const isFuture  = i > currentIdx;

        return (
          <React.Fragment key={s.id}>
            <div className={`flex flex-col items-center min-w-[60px] ${isFuture ? "opacity-40" : ""}`}>
              <div className={`flex items-center justify-center h-7 w-7 rounded-full border-2 text-xs font-bold transition-colors
                ${isDone    ? "bg-emerald-500 border-emerald-500 text-white"    : ""}
                ${isCurrent ? "bg-blue-500 border-blue-500 text-white"          : ""}
                ${isFuture  ? "bg-background border-border text-muted-foreground" : ""}
              `}>
                {isDone ? "✓" : i + 1}
              </div>
              <span className="text-[9px] text-center leading-tight mt-0.5 max-w-[60px]">{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`flex-1 h-0.5 min-w-[8px] -mt-4 ${i < currentIdx || jobStatus === "complete" ? "bg-emerald-400" : "bg-border"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function QaChecksTable({ checks }: { checks: MapFactoryQaCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="rounded border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">Check</th>
            <th className="text-left px-2 py-1.5 font-medium">Result</th>
            <th className="text-left px-2 py-1.5 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c, i) => (
            <tr key={i} className={`border-t border-border ${!c.passed && c.severity === "blocking" ? "bg-red-50 dark:bg-red-950/20" : !c.passed && c.severity === "warning" ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
              <td className="px-2 py-1.5 font-mono">{c.check_name}</td>
              <td className="px-2 py-1.5">
                {c.passed
                  ? <span className="text-emerald-600 font-medium">✓ Pass</span>
                  : <span className={`font-medium ${c.severity === "blocking" ? "text-red-600" : "text-amber-600"}`}>
                      {c.severity === "blocking" ? "✗ Block" : "⚠ Warn"}
                    </span>
                }
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MapFactoryTab({ token }: Props) {
  // Malls list for "New Job" form
  const [malls, setMalls]           = useState<Array<{ id: string; name: string }>>([]);

  // Job list (sidebar)
  const [jobs, setJobs]             = useState<MapFactoryJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError]   = useState<string | null>(null);

  // Selected job detail (right panel)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail]         = useState<MapFactoryJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]     = useState<string | null>(null);

  // New job form
  const [showNewJob, setShowNewJob] = useState(false);
  const [newMallId, setNewMallId]   = useState("");
  const [newNotes, setNewNotes]     = useState("");
  const [creating, setCreating]     = useState(false);
  const [createErr, setCreateErr]   = useState<string | null>(null);

  // Per-stage action state
  const [actionBusy, setActionBusy]   = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg]     = useState<string | null>(null);

  // Floor label field (used by generate-floorplan + build-route-graph)
  const [stageFloor, setStageFloor]   = useState("Level 5");

  // ── Load malls ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from("malls").select("id, name").order("name").then(({ data }) => {
      if (data) setMalls(data);
    });
  }, []);

  // ── Load job queue ──────────────────────────────────────────────────────────
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

  // ── Load job detail ─────────────────────────────────────────────────────────
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

  // ── Create job ──────────────────────────────────────────────────────────────
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

  // ── Run Next Best Step ──────────────────────────────────────────────────────
  async function handleNextStep() {
    if (!token || !selectedJobId) return;
    setActionBusy("next-step");
    setActionError(null);
    setActionMsg(null);
    try {
      const res = await runNextStep(selectedJobId, token, stageFloor || undefined);
      setActionMsg(`Stage completed → ${res.next_stage}`);
      await loadDetail(selectedJobId);
      await loadJobs();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(null);
    }
  }

  // ── Run specific stage ──────────────────────────────────────────────────────
  async function handleStageAction(stageId: StageId) {
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
          msg = `Nodes +${r.nodesCreated} (${r.nodesSkipped} skipped), edges +${r.edgesCreated}`;
          if (r.validationIssues.length) msg += ` ⚠ ${r.validationIssues.length} issue(s)`;
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
      await loadDetail(selectedJobId);
      await loadJobs();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const job    = detail?.job ?? null;
  const nextStep = detail?.next_step ?? null;
  const latestQa = detail?.latest_qa ?? null;

  return (
    <div className="flex gap-4 h-full min-h-0">

      {/* ── Sidebar: job list ─────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Jobs</h2>
          <div className="flex items-center gap-1">
            <button onClick={loadJobs} disabled={jobsLoading} className="p-1 rounded hover:bg-muted">
              {jobsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </button>
            <button
              onClick={() => setShowNewJob((v) => !v)}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" /> New
            </button>
          </div>
        </div>

        {/* New Job form */}
        {showNewJob && (
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
        )}

        {jobsError && <p className="text-xs text-red-600">{jobsError}</p>}

        {/* Job list */}
        <div className="flex flex-col gap-1 overflow-y-auto flex-1">
          {jobs.length === 0 && !jobsLoading && (
            <p className="text-xs text-muted-foreground italic text-center py-4">No jobs yet. Create one above.</p>
          )}
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJobId(j.id)}
              className={`w-full text-left rounded-lg p-2 border text-xs transition-colors
                ${selectedJobId === j.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${statusDot(j.status)}`} />
                <span className="font-medium truncate">{(j as { malls?: { name: string } }).malls?.name ?? j.mall_id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span className={statusColor(j.status)}>{j.status}</span>
                <span>{j.stage.replace(/_/g, " ")}</span>
              </div>
              {j.readiness_score > 0 && (
                <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${j.readiness_score >= 80 ? "bg-emerald-500" : "bg-amber-400"}`}
                    style={{ width: `${j.readiness_score}%` }} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main panel: job detail ────────────────────────────────────────── */}
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
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDot(job.status)}`} />
                  {(detail as unknown as { job: MapFactoryJob & { malls?: { name: string } } }).job.malls?.name ?? "Unknown Mall"}
                  <span className="text-muted-foreground font-normal text-xs">— {job.stage.replace(/_/g, " ")}</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">{job.id}</p>
              </div>

              {/* Run Next Best Step CTA */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {nextStep && job.status !== "complete" && (
                  <button
                    onClick={handleNextStep}
                    disabled={!!actionBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    {actionBusy === "next-step"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Zap className="h-3.5 w-3.5" />}
                    {nextStep.actionLabel}
                  </button>
                )}
                <button
                  onClick={() => { loadDetail(job.id); loadJobs(); }}
                  disabled={detailLoading}
                  className="p-1.5 rounded-lg border border-border hover:bg-muted"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Action feedback */}
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

            {/* Stage tracker */}
            <div className="rounded-lg border border-border bg-card p-3">
              <StageTracker currentStage={job.stage} jobStatus={job.status} />
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${stageProgress(job.stage)}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{stageProgress(job.stage)}%</span>
              </div>
            </div>

            {/* Stats row */}
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

            {/* Floor label input (used by several stages) */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium whitespace-nowrap">Floor label:</label>
              <input
                value={stageFloor}
                onChange={(e) => setStageFloor(e.target.value)}
                placeholder="e.g. Level 5"
                className="border border-input rounded px-2 py-1 text-xs bg-background flex-1 max-w-[180px]"
              />
              <span className="text-xs text-muted-foreground">(used for floorplan gen + route graph)</span>
            </div>

            {/* Stage actions */}
            <div className="rounded-lg border border-border bg-card">
              <div className="p-3 border-b border-border">
                <h3 className="text-xs font-semibold">Pipeline Stages</h3>
              </div>
              <div className="divide-y divide-border">
                {STAGES.map((s, i) => {
                  const jobStageIdx   = STAGE_INDEX[job.stage] ?? 0;
                  const isDone        = i < jobStageIdx || job.status === "complete";
                  const isCurrent     = i === jobStageIdx && job.status !== "complete";
                  const isReachable   = i <= jobStageIdx + 1;
                  const busy          = actionBusy === s.id;

                  return (
                    <div key={s.id} className={`flex items-center justify-between px-3 py-2 text-xs
                      ${isDone ? "opacity-60" : ""} ${isCurrent ? "bg-primary/5" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className={`${isDone ? "text-emerald-500" : isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                          {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : isCurrent ? <Clock className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {s.icon}
                          <span className={`font-medium ${isCurrent ? "text-primary" : ""}`}>{s.label}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleStageAction(s.id as StageId)}
                        disabled={!isReachable || !!actionBusy}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
                          ${isCurrent   ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
                          ${isDone      ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" : ""}
                          ${!isReachable && !isDone ? "bg-muted text-muted-foreground cursor-not-allowed" : ""}
                          disabled:opacity-50
                        `}
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin inline" /> : isDone ? "Re-run" : "Run"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* QA Report */}
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
                      <AlertCircle className="h-3.5 w-3.5" />
                      {latestQa.blocking_issues} blocking issue(s) — must be resolved before publishing
                    </div>
                  )}
                  {latestQa.checks && <QaChecksTable checks={latestQa.checks} />}
                </div>
              </div>
            )}

            {/* Floor plans */}
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

            {/* Notes */}
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
