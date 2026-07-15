/**
 * Sprint 2D — Durable Intake dashboard (Data Command Center).
 *
 * Durable Jobs · Job controls · Chunk history · Quarantine · Recovery test.
 * Runs the real durable worker against the in-memory reference store (Postgres-
 * faithful) over a generated recovery fixture. Modes: Local fixture · Durable
 * worker · Production data (disabled). No dead buttons; nothing publishes.
 * "Generated recovery fixture — no retailer data."
 */

import { useMemo, useState } from "react";
import { Server, ShieldAlert, Activity, RefreshCw, Play, Pause, Square, Download, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToneBadge } from "@/components/ingestion/badges";
import type { BadgeTone } from "@/lib/ingestion/labels";
import { relativeAge } from "@/lib/ingestion/freshness";
import type { SourceAccessPolicy } from "@/lib/fabric/types";
import { InMemoryDurableStore } from "@/lib/fabric/intake/durable/inMemoryStore";
import { GcsInputStore, FixtureGcsBackend } from "@/lib/fabric/intake/durable/gcsInputStore";
import { runDurableJob } from "@/lib/fabric/intake/durable/worker";
import { inputHash } from "@/lib/fabric/intake/durable/hashes";
import { scaleRecords } from "@/lib/fabric/intake/scaleFixtures";
import type { DurableJobRow, DurableJobStatus } from "@/lib/fabric/intake/durable/durableTypes";

export const DURABLE_SECTIONS = [
  { id: "durable-jobs", label: "Durable Jobs" },
  { id: "durable-quarantine", label: "Durable Quarantine" },
  { id: "durable-recovery", label: "Recovery Test" },
] as const;

type DurableMode = "local_fixture" | "durable_worker" | "production_disabled";
const MODE_LABEL: Record<DurableMode, string> = { local_fixture: "Local fixture", durable_worker: "Durable worker", production_disabled: "Production data: disabled" };
const BUCKET = "mallmind-intake-dev";
const OBJECT = "intake/recovery.jsonl";
const POLICY: SourceAccessPolicy = { sourceId: "src_bulk", automationStatus: "authorized_feed", allowedModes: ["merchant_feed", "browser_observation", "manual", "catalogue"], requiresHumanReview: true, legalRisk: "low" };
const STATUS_TONE: Record<DurableJobStatus, BadgeTone> = {
  queued: "muted", claimed: "info", validating: "info", processing: "info", paused: "warning",
  needs_review: "warning", completed: "verified", completed_with_errors: "warning", failed: "danger", cancelled: "danger",
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

interface Scene { store: InMemoryDurableStore; backend: FixtureGcsBackend; gcs: GcsInputStore; jobId: string; }

async function jsonlFixture(n: number, nowIso: string): Promise<string> {
  const lines: string[] = [];
  for await (const r of scaleRecords(n, nowIso)) lines.push(JSON.stringify(r));
  return lines.join("\n") + "\n";
}

export function DurableIntakePanels() {
  const [mode, setMode] = useState<DurableMode>("durable_worker");
  const [crashAfter, setCrashAfter] = useState(1);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<string | null>(null);
  const sceneRef = useMemo(() => ({ current: null as Scene | null }), []);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const refresh = () => setTick((t) => t + 1);

  const makeScene = async (jobId: string): Promise<Scene> => {
    const store = new InMemoryDurableStore();
    const backend = new FixtureGcsBackend();
    const content = await jsonlFixture(120, nowIso);
    const ref = backend.seed(BUCKET, OBJECT, content, "application/x-ndjson", "1");
    const gcs = new GcsInputStore(backend, { allowedBuckets: [BUCKET] });
    store.createJob({ id: jobId, sourceId: "src_bulk", inputRef: ref, inputHash: inputHash(content), inputContentType: "application/x-ndjson", mode: "jsonl", requestedBy: "admin", estimatedRows: 120 }, nowIso);
    return { store, backend, gcs, jobId };
  };

  const disabled = mode === "production_disabled" || busy;

  const create = async () => { setBusy(true); sceneRef.current = await makeScene("job_recovery"); setMsg("Created durable fixture job (queued). Generated recovery fixture — no retailer data."); setReconcile(null); setBusy(false); refresh(); };
  const start = async () => {
    if (!sceneRef.current) return; setBusy(true);
    const { store, gcs, jobId } = sceneRef.current;
    const res = await runDurableJob({ store, inputStore: gcs, jobId, workerId: "worker-1", policy: POLICY, nowIso, parseMode: "jsonl", chunkSize: 30 });
    setMsg(`Worker-1 finished: ${res.status.replace(/_/g, " ")} — ${res.job.processedRows} rows, ${res.job.stagedDrafts} staged drafts. Nothing published.`);
    setBusy(false); refresh();
  };
  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!sceneRef.current) return; const { store, jobId } = sceneRef.current;
    if (action === "pause") store.requestPause(jobId, nowIso);
    else if (action === "resume") store.requestResume(jobId, nowIso);
    else store.requestCancel(jobId, nowIso);
    setMsg(`${action} requested via durable API. It takes effect at the next safe chunk boundary.`);
    refresh();
  };

  const runRecovery = async () => {
    setBusy(true); setReconcile(null);
    const scene = await makeScene("job_recovery");
    sceneRef.current = scene;
    const { store, backend, gcs, jobId } = scene;
    // clean reference run for exact reconciliation
    const cleanScene = await makeScene("job_clean");
    const clean = (await runDurableJob({ store: cleanScene.store, inputStore: cleanScene.gcs, jobId: "job_clean", workerId: "w", policy: POLICY, nowIso, parseMode: "jsonl", chunkSize: 30 })).job;
    // 1. worker-1 crashes after the selected chunk
    try {
      await runDurableJob({ store, inputStore: gcs, jobId, workerId: "worker-1", policy: POLICY, nowIso, parseMode: "jsonl", chunkSize: 30, hooks: { onAfterCommit: (i) => { if (i === crashAfter) throw new Error("simulated crash"); } } });
    } catch { /* crashed */ }
    const committedAtCrash = store.listChunks(jobId).length;
    // 2. lease expires; worker-2 reclaims and resumes
    store.expireLease(jobId);
    void backend; // (generation preserved — object unchanged)
    const rec = await runDurableJob({ store, inputStore: gcs, jobId, workerId: "worker-2", policy: POLICY, nowIso, parseMode: "jsonl", chunkSize: 30 });
    const drafts = store.listDrafts(jobId);
    const noDupDrafts = new Set(drafts.map((d) => d.recordHash)).size === drafts.length;
    const countersExact = rec.job.processedRows === clean.processedRows && rec.job.stagedDrafts === clean.stagedDrafts && rec.job.rejectedRows === clean.rejectedRows;
    setReconcile(`Crashed after chunk ${crashAfter} (${committedAtCrash} chunks committed) → worker-2 reclaimed the expired lease and resumed. Final: ${rec.job.processedRows} processed, ${rec.job.stagedDrafts} staged. Reconciliation vs clean run: ${countersExact ? "EXACT ✓" : "MISMATCH ✗"}. No duplicate drafts: ${noDupDrafts ? "✓" : "✗"}. Nothing published.`);
    setMsg("Recovery scenario complete.");
    setBusy(false); refresh();
  };

  const scene = sceneRef.current;
  const job: DurableJobRow | undefined = scene?.store.getJob(scene.jobId);
  const lease = scene?.store.getLease(scene?.jobId ?? "");
  const chunks = scene ? scene.store.listChunks(scene.jobId) : [];
  const quarantine = scene ? scene.store.listQuarantine(scene.jobId) : [];
  void tick;

  const exportQuarantine = () => {
    const report = quarantine.slice(0, 2000).map((q) => ({ index: q.recordIndex, class: q.errorClass, codes: q.errorCodes, retryable: q.retryable, disposition: q.disposition }));
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "durable-quarantine-report.json"; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-1">
        <label className="text-[11px] text-muted-foreground">Mode
          <select className={cn("ml-2 rounded-lg border border-border bg-background/60 px-2 py-1 text-xs")} value={mode} onChange={(e) => setMode(e.target.value as DurableMode)}>
            {(Object.keys(MODE_LABEL) as DurableMode[]).map((m) => <option key={m} value={m} disabled={m === "production_disabled"}>{MODE_LABEL[m]}</option>)}
          </select>
        </label>
        <span className="text-[11px] text-muted-foreground">Generated recovery fixture — no retailer data. Service-role RPCs run server-side only; the browser never holds a service-role key.</span>
      </div>
      {msg && <div className="mx-1 rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-secondary">{msg}</div>}

      {/* Recovery Test (drives the durable views) */}
      <SectionCard id="durable-recovery" icon={<RefreshCw className="h-4 w-4 text-primary" />} title="Recovery Test">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-xs text-muted-foreground">Crash after chunk
            <select className={cn("ml-2 rounded-lg border border-border bg-background/60 px-2 py-1 text-xs")} value={crashAfter} onChange={(e) => setCrashAfter(Number(e.target.value))} disabled={disabled}>
              {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Button variant="neon" size="sm" disabled={disabled} onClick={runRecovery}><RefreshCw className="h-3.5 w-3.5" /> Run crash → reclaim → resume</Button>
        </div>
        {reconcile && <div className="mx-4 mb-4 rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px] text-muted-foreground">{reconcile}</div>}
      </SectionCard>

      {/* Durable Jobs + controls + chunk history */}
      <SectionCard id="durable-jobs" icon={<Server className="h-4 w-4 text-primary" />} title="Durable Jobs" count={job ? 1 : 0}>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <Button variant="glass" size="sm" disabled={disabled} onClick={create}><Boxes className="h-3.5 w-3.5" /> Create fixture job</Button>
          <Button variant="neon" size="sm" disabled={disabled || !job} onClick={start}><Play className="h-3.5 w-3.5" /> Start</Button>
          <Button variant="glass" size="sm" disabled={disabled || !job} onClick={() => control("pause")}><Pause className="h-3.5 w-3.5" /> Pause</Button>
          <Button variant="glass" size="sm" disabled={disabled || !job} onClick={() => control("resume")}><Play className="h-3.5 w-3.5" /> Resume</Button>
          <Button variant="glass" size="sm" disabled={disabled || !job} onClick={() => control("cancel")}><Square className="h-3.5 w-3.5" /> Cancel</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="px-4 py-2">Job</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Lease</th><th className="px-4 py-2">Heartbeat</th>
                <th className="px-4 py-2">Checkpoint</th><th className="px-4 py-2">Processed</th><th className="px-4 py-2">Valid/Rej/Dup/Conf</th><th className="px-4 py-2">Retry</th><th className="px-4 py-2">Input object</th>
              </tr>
            </thead>
            <tbody>
              {!job && <tr><td colSpan={9}><Empty>Create a fixture job or run the recovery test.</Empty></td></tr>}
              {job && (
                <tr className="border-b border-border/40">
                  <td className="px-4 py-2 text-[11px]">{job.id}</td>
                  <td className="px-4 py-2"><ToneBadge tone={STATUS_TONE[job.status]}>{job.status.replace(/_/g, " ")}</ToneBadge></td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{lease ? lease.workerId : "—"}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{lease ? relativeAge(lease.heartbeatAt, nowMs) : "—"}</td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">#{job.currentChunkIndex} @ {job.currentRowOffset}</td>
                  <td className="px-4 py-2">{job.processedRows}</td>
                  <td className="px-4 py-2 text-[11px]">{job.validRows}/{job.rejectedRows}/{job.duplicateRows}/{job.conflictRows}</td>
                  <td className="px-4 py-2">{job.retryCount}/{job.maxRetries}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground" title="object reference — never a signed/public URL">{job.inputRef}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {chunks.length > 0 && (
          <div className="border-t border-border/40 p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Committed chunk history</p>
            <div className="flex flex-wrap gap-1.5">
              {chunks.map((c) => (
                <span key={c.chunkIndex} className="rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={`${c.workerId} @ ${c.committedAt}`}>
                  #{c.chunkIndex} [{c.rowOffsetStart}-{c.rowOffsetEnd}) {c.staged}s/{c.duplicates}d/{c.conflicts}c/{c.rejected}r · {c.workerId}
                </span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Durable Quarantine */}
      <SectionCard id="durable-quarantine" icon={<ShieldAlert className="h-4 w-4 text-red-300" />} title="Durable Quarantine" count={quarantine.length}>
        <div className="flex items-center gap-2 px-4 pt-3">
          <Button variant="glass" size="sm" disabled={quarantine.length === 0} onClick={exportQuarantine}><Download className="h-3.5 w-3.5" /> Export report</Button>
          <span className="text-[11px] text-muted-foreground">Persisted, sanitized, bounded excerpts. Showing first 40.</span>
        </div>
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60"><th className="px-4 py-2">#</th><th className="px-4 py-2">Class</th><th className="px-4 py-2">Codes</th><th className="px-4 py-2">Retryable</th><th className="px-4 py-2">Disposition</th></tr>
            </thead>
            <tbody>
              {quarantine.length === 0 && <tr><td colSpan={5}><Empty>No quarantined records.</Empty></td></tr>}
              {quarantine.slice(0, 40).map((q) => (
                <tr key={q.id} className="border-b border-border/40">
                  <td className="px-4 py-2 text-[11px]">{q.recordIndex}</td>
                  <td className="px-4 py-2"><ToneBadge tone="danger">{q.errorClass}</ToneBadge></td>
                  <td className="px-4 py-2 max-w-[260px] text-[11px] text-muted-foreground">{q.errorCodes.join("; ")}</td>
                  <td className="px-4 py-2 text-xs">{q.retryable ? "yes" : "no"}</td>
                  <td className="px-4 py-2 text-xs">{q.disposition.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="px-1 pb-1"><Activity className="mr-1 inline h-3 w-3 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">Durable path: authorized input → durable ref → job row → worker claim → chunk read → pure engine → atomic chunk commit → durable checkpoint → review queue. No import publishes.</span></div>
    </>
  );
}
