/**
 * Sprint 2C — Bulk Intake operational dashboard for the Data Command Center.
 *
 * Intake Jobs · Job Detail · Quarantine · Review Batches · Scale Test. Runs the
 * deterministic streaming engine over a GENERATED scale fixture (no retailer
 * data) in bounded sizes; heavy 50k runs are a CLI benchmark, not the browser.
 * No dead buttons; nothing publishes without review + a separate publication gate.
 */

import { useMemo, useState } from "react";
import { Boxes, ListChecks, ShieldAlert, Gauge, Play, Download, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToneBadge } from "@/components/ingestion/badges";
import type { BadgeTone } from "@/lib/ingestion/labels";
import { buildSeedFabric } from "@/lib/fabric/store";
import { buildSeedDatabase } from "@/lib/ingestion/seed";
import type { FabricDatabase, SourceAccessPolicy } from "@/lib/fabric/types";
import type { IngestionDatabase } from "@/lib/ingestion/model";
import { createIntakeJob } from "@/lib/fabric/intake/jobs";
import { processIntakeStream } from "@/lib/fabric/intake/engine";
import { scaleRecords, SCALE_FIXTURE_LABEL } from "@/lib/fabric/intake/scaleFixtures";
import { createReviewBatch, bulkReview } from "@/lib/fabric/intake/reviewBatch";
import { planRetry } from "@/lib/fabric/intake/retry";
import type { IntakeRunResult, IntakeJobStatus, QuarantineRecord } from "@/lib/fabric/intake/types";

export const INTAKE_SECTIONS = [
  { id: "intake-jobs", label: "Intake Jobs" },
  { id: "intake-quarantine", label: "Quarantine" },
  { id: "intake-batches", label: "Review Batches" },
  { id: "intake-scale", label: "Scale Test" },
] as const;

const inputCls = "rounded-lg border border-border bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60";
const RUN_POLICY: SourceAccessPolicy = { sourceId: "src_bulk", automationStatus: "authorized_feed", allowedModes: ["merchant_feed", "manual", "browser_observation", "catalogue"], requiresHumanReview: true, legalRisk: "low" };
const STATUS_TONE: Record<IntakeJobStatus, BadgeTone> = {
  queued: "muted", validating: "info", processing: "info", paused: "warning", needs_review: "warning",
  completed: "verified", completed_with_errors: "warning", failed: "danger", cancelled: "danger",
};

function SectionCard({ id, icon, title, count, children }: { id: string; icon: React.ReactNode; title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4 border-border/70 bg-surface/40">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">{icon} {title}{count != null && <span className="text-muted-foreground">({count})</span>}</CardTitle></CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;

export function IntakePanels() {
  const [size, setSize] = useState(1000);
  const [chunkSize, setChunkSize] = useState(200);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IntakeRunResult | null>(null);
  const [runtimeMs, setRuntimeMs] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineRecord[]>([]);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const run = async () => {
    setRunning(true); setMsg(null); setBatchMsg(null);
    const t0 = performance.now();
    const job = createIntakeJob({ sourceId: "src_bulk", mode: "fixture_load_test", inputRef: "fixture://scale", inputHash: `scale_${size}`, requestedBy: "admin", estimatedRows: size }, nowIso);
    const res = await processIntakeStream({ job, records: scaleRecords(size, nowIso), policy: RUN_POLICY, nowIso, chunkSize, concurrency: 8 });
    const dt = performance.now() - t0;
    setResult(res); setRuntimeMs(dt); setQuarantine(res.state.quarantine);
    setMsg(`${SCALE_FIXTURE_LABEL} Processed ${res.job.processedRows} in ${(dt / 1000).toFixed(2)}s → ${Math.round(size / (dt / 1000))} rows/s. Nothing published.`);
    setRunning(false);
  };

  const job = result?.job ?? null;
  const metrics = result?.state.metrics ?? null;

  const exportQuarantine = () => {
    const report = quarantine.slice(0, 2000).map((q) => ({ index: q.recordIndex, class: q.errorClass, codes: q.errorCodes, retryable: q.retryable, disposition: q.disposition }));
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "intake-quarantine-report.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const rejectPermanently = (id: string) => setQuarantine((qs) => qs.map((q) => (q.id === id ? { ...q, disposition: "permanently_rejected" } : q)));

  const BULK_UI_SAMPLE = 60; // bound the interactive demo; the lib handles any size (see scale tests)
  const bulkApprove = () => {
    if (!result) return;
    // Prefer some conflicted drafts in the sample so "conflicts skipped" is visible.
    const conflicted = result.state.drafts.filter((d) => d.conflictState === "conflict_detected");
    const clean = result.state.drafts.filter((d) => d.conflictState !== "conflict_detected");
    const drafts = [...conflicted.slice(0, 10), ...clean.slice(0, BULK_UI_SAMPLE - Math.min(10, conflicted.length))];
    const base = buildSeedFabric(nowMs);
    const fabric: FabricDatabase = { ...base, drafts, evidence: [...base.evidence, ...result.state.evidence], policies: [...base.policies, RUN_POLICY] };
    const ingestion: IngestionDatabase = buildSeedDatabase(nowMs);
    const { batch } = createReviewBatch(job!.id, drafts.map((d) => d.id), drafts, nowIso);
    const rev = bulkReview(fabric, ingestion, batch, { reviewerId: "admin", decision: "approve", reasoning: "bulk intake review" }, nowIso);
    setBatchMsg(`Sample of ${drafts.length} drafts → ${rev.batch.approvedCount} approved (individual decisions), ${rev.skipped.length} skipped (${rev.skipped.filter((s) => s.blockers.includes("unresolved_conflict")).length} conflicts). Approval never bypassed review. (The engine + lib handle any size — see the scale tests.)`);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-muted-foreground">Bulk intake runs the streaming engine in bounded chunks. {SCALE_FIXTURE_LABEL} Nothing publishes from import.</p>
      </div>

      {/* E — Scale Test (drives the others) */}
      <SectionCard id="intake-scale" icon={<Gauge className="h-4 w-4 text-primary" />} title="Scale Test">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="space-y-1 text-xs text-muted-foreground">Records
            <select className={cn(inputCls, "block w-28")} value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {[100, 1000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">Chunk size
            <select className={cn(inputCls, "block w-24")} value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))}>
              {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Button variant="neon" size="sm" disabled={running} onClick={run}><Play className="h-3.5 w-3.5" /> {running ? "Running…" : "Run scale fixture"}</Button>
          <span className="text-[11px] text-muted-foreground">50,000-record run is a CLI benchmark: <code>INTAKE_BENCH=1 npx vitest run src/lib/fabric/intake/scale.test.ts</code></span>
        </div>
        {msg && <div className="mx-4 mb-4 rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}
        {metrics && (
          <div className="flex flex-wrap gap-2 px-4 pb-4 text-[11px]">
            <ToneBadge tone="verified">{metrics.rowsPerSecond.toLocaleString()} rows/s</ToneBadge>
            <ToneBadge tone="muted">avg chunk {metrics.chunkDurationMsAvg}ms</ToneBadge>
            <ToneBadge tone="muted">checkpoints {metrics.checkpointCount}</ToneBadge>
            <ToneBadge tone="warning">dup {(metrics.duplicateRate * 100).toFixed(1)}%</ToneBadge>
            <ToneBadge tone="danger">conflict {(metrics.conflictRate * 100).toFixed(1)}%</ToneBadge>
            <ToneBadge tone="warning">quarantine {(metrics.quarantineRate * 100).toFixed(1)}%</ToneBadge>
            {metrics.peakHeapBytes != null && <ToneBadge tone="muted">peak heap {(metrics.peakHeapBytes / 1048576).toFixed(0)}MB</ToneBadge>}
          </div>
        )}
      </SectionCard>

      {/* A — Intake Jobs */}
      <SectionCard id="intake-jobs" icon={<Boxes className="h-4 w-4 text-primary" />} title="Intake Jobs" count={job ? 1 : 0}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Job</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Mode</th><th className="px-4 py-2">Processed</th>
                <th className="px-4 py-2">Valid</th><th className="px-4 py-2">Rejected</th><th className="px-4 py-2">Dup</th><th className="px-4 py-2">Conflict</th>
                <th className="px-4 py-2">Drafts/Evidence</th><th className="px-4 py-2">Runtime</th><th className="px-4 py-2">Checkpoint</th>
              </tr>
            </thead>
            <tbody>
              {!job && <tr><td colSpan={11}><Empty>Run a scale fixture to create a job.</Empty></td></tr>}
              {job && (
                <tr className="border-b border-border/40">
                  <td className="px-4 py-2 text-[11px]">{job.id.slice(0, 18)}<span className="block text-muted-foreground">src_bulk</span></td>
                  <td className="px-4 py-2"><ToneBadge tone={STATUS_TONE[job.status]}>{job.status.replace(/_/g, " ")}</ToneBadge></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{job.mode}</td>
                  <td className="px-4 py-2">{job.processedRows.toLocaleString()}</td>
                  <td className="px-4 py-2 text-secondary">{job.validRows.toLocaleString()}</td>
                  <td className="px-4 py-2 text-red-300">{job.rejectedRows.toLocaleString()}</td>
                  <td className="px-4 py-2">{job.duplicateRows.toLocaleString()}</td>
                  <td className="px-4 py-2 text-amber-300">{job.conflictRows.toLocaleString()}</td>
                  <td className="px-4 py-2">{job.stagedDrafts.toLocaleString()} / {job.evidenceCreated.toLocaleString()}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{runtimeMs != null ? `${(runtimeMs / 1000).toFixed(2)}s` : "—"}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">#{job.checkpoint?.chunkIndex ?? 0} @ {job.checkpoint?.rowOffset ?? 0}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {result && (
          <div className="border-t border-border/40 p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Job detail — chunk history (input hash {job?.inputHash}, no raw payload stored)</p>
            <div className="flex flex-wrap gap-1.5">
              {result.state.chunkSummaries.slice(0, 30).map((c) => (
                <span key={c.chunkIndex} className="rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={`chunk ${c.chunkIndex}: ${c.durationMs}ms`}>
                  #{c.chunkIndex}: {c.staged}s/{c.duplicates}d/{c.conflicts}c/{c.rejected}r
                </span>
              ))}
              {result.state.chunkSummaries.length > 30 && <span className="text-[10px] text-muted-foreground">+{result.state.chunkSummaries.length - 30} more</span>}
            </div>
          </div>
        )}
      </SectionCard>

      {/* C — Quarantine */}
      <SectionCard id="intake-quarantine" icon={<ShieldAlert className="h-4 w-4 text-red-300" />} title="Quarantine" count={quarantine.length}>
        <div className="flex items-center gap-2 px-4 pt-3">
          <Button variant="glass" size="sm" disabled={quarantine.length === 0} onClick={exportQuarantine}><Download className="h-3.5 w-3.5" /> Export report</Button>
          <span className="text-[11px] text-muted-foreground">A bad record never fails the whole job. Showing first 50.</span>
        </div>
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60"><th className="px-4 py-2">#</th><th className="px-4 py-2">Class</th><th className="px-4 py-2">Codes</th><th className="px-4 py-2">Retryable</th><th className="px-4 py-2">Disposition</th><th className="px-4 py-2">Action</th></tr>
            </thead>
            <tbody>
              {quarantine.length === 0 && <tr><td colSpan={6}><Empty>No quarantined records.</Empty></td></tr>}
              {quarantine.slice(0, 50).map((q) => (
                <tr key={q.id} className="border-b border-border/40">
                  <td className="px-4 py-2 text-[11px]">{q.recordIndex}</td>
                  <td className="px-4 py-2"><ToneBadge tone="danger">{q.errorClass}</ToneBadge></td>
                  <td className="px-4 py-2 max-w-[240px] text-[11px] text-muted-foreground">{q.errorCodes.join("; ")}</td>
                  <td className="px-4 py-2 text-xs">{q.retryable ? `yes (${planRetry(q).reason})` : "no"}</td>
                  <td className="px-4 py-2 text-xs">{q.disposition.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2">{q.disposition === "quarantined" && <Button variant="glass" size="sm" onClick={() => rejectPermanently(q.id)}>Reject</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* D — Review Batches */}
      <SectionCard id="intake-batches" icon={<ListChecks className="h-4 w-4 text-amber-300" />} title="Review Batches">
        <div className="space-y-2 p-4">
          <p className="text-[11px] text-muted-foreground">Staged drafts: <b className="text-foreground">{result?.state.drafts.length ?? 0}</b>. Bulk approval approves only independently-approvable drafts; conflicts are never hidden, and each draft gets its own auditable decision.</p>
          <Button variant="neon" size="sm" disabled={!result || result.state.drafts.length === 0} onClick={bulkApprove}><CheckCircle2 className="h-3.5 w-3.5" /> Bulk-approve eligible drafts</Button>
          {batchMsg && <div className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{batchMsg}</div>}
        </div>
      </SectionCard>
    </>
  );
}
