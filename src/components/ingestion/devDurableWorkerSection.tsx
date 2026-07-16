/**
 * Sprint 2E — "Dev durable worker" panel (Data Command Center).
 *
 * The other durable panels drive the in-memory reference store in the browser.
 * THIS panel is a window onto the real dev Cloud Run worker: real Postgres, real
 * Cloud Storage, real leases.
 *
 * The browser holds no service-role key and cannot reach the worker directly (it is
 * deployed private). Everything here goes through /admin/intake/* on the API
 * service, which re-checks profiles.is_admin server-side.
 *
 * Until the worker is deployed and VITE_GOOGLE_BACKEND_URL is set, this renders an
 * explicit "not configured" state with its controls disabled — an honest empty
 * state, not a dead button. Running a job STAGES drafts for review; approval and
 * publication remain separate human gates.
 */

import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, Play, Pause, Square, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToneBadge } from "@/components/ingestion/badges";
import { supabase } from "@/lib/supabaseClient";
import {
  durableWorkerClient, isDurableWorkerConfigured, DurableWorkerError,
  type DurableWorkerStatus,
} from "@/lib/fabric/intake/durable/durableWorkerClient";
import type { DurableJobRow } from "@/lib/fabric/intake/durable/durableTypes";

export const DEV_WORKER_SECTIONS = [{ id: "durable-dev-worker", label: "Dev durable worker" }] as const;

/** The signed-in user's token — never a service-role key. */
const getToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

const FIXTURE_LABEL = "Generated fixture — no retailer data";

export function DevDurableWorkerPanel() {
  const configured = isDurableWorkerConfigured();
  const [status, setStatus] = useState<DurableWorkerStatus | null>(null);
  const [jobs, setJobs] = useState<DurableJobRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    setBusy(true); setError(null);
    try {
      const s = await durableWorkerClient.status(getToken);
      setStatus(s);
      if (s.configured && s.reachable) {
        const { jobs: rows } = await durableWorkerClient.listJobs(getToken);
        setJobs(rows ?? []);
      }
    } catch (err) {
      // Surface the real reason (not configured / not admin / unreachable) rather
      // than an empty table that looks like "no jobs".
      setError(err instanceof DurableWorkerError ? err.message : "Could not load durable jobs.");
    } finally {
      setBusy(false);
    }
  }, [configured]);

  useEffect(() => { void load(); }, [load]);

  const act = async (jobId: string, action: "run" | "pause" | "resume" | "cancel") => {
    setBusy(true); setError(null);
    try {
      await durableWorkerClient[action](jobId, getToken);
      await load();
    } catch (err) {
      setError(err instanceof DurableWorkerError ? err.message : `Could not ${action} this job.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="durable-dev-worker" className="scroll-mt-4 border-border/70 bg-surface/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cloud className="h-4 w-4" /> Dev durable worker
          <ToneBadge tone={configured && status?.reachable ? "verified" : "muted"}>
            {!configured ? "Not configured" : status?.reachable ? "Connected" : "Unreachable"}
          </ToneBadge>
          <ToneBadge tone="info">{FIXTURE_LABEL}</ToneBadge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 p-4 pt-0">
        {!configured && (
          <p className="rounded-md border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
            Durable mode is not configured for this environment. It needs the dev Cloud Run worker
            deployed and <code>VITE_GOOGLE_BACKEND_URL</code> set. Until then the panels above run the
            in-memory reference store, which is Postgres-faithful but not durable.
          </p>
        )}

        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{error}</p>
        )}

        {configured && status?.reachable && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            Fixture-only mode: <strong>{status.worker?.fixtureOnlyMode === false ? "OFF" : "ON"}</strong>. The worker
            refuses any job or object not marked as a generated fixture. No service-role key reaches this browser.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" disabled={!configured || busy} onClick={() => void load()}>
            <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Job</th><th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Rows</th><th className="px-2 py-2">Staged</th>
                <th className="px-2 py-2">Retries</th><th className="px-2 py-2">Controls</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                  {configured ? "No durable jobs yet. Upload a generated fixture and create a job to see it here." : "Durable mode unavailable."}
                </td></tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border/40">
                  <td className="px-2 py-2 font-mono text-[10px]">{job.id.slice(0, 8)}</td>
                  <td className="px-2 py-2"><ToneBadge tone={job.status === "failed" ? "danger" : job.status === "needs_review" ? "warning" : "info"}>{job.status.replace(/_/g, " ")}</ToneBadge></td>
                  <td className="px-2 py-2">{job.processedRows}{job.estimatedRows ? ` / ${job.estimatedRows}` : ""}</td>
                  <td className="px-2 py-2">{job.stagedDrafts}</td>
                  <td className="px-2 py-2">{job.retryCount}/{job.maxRetries}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <Button variant="glass" size="sm" disabled={busy} onClick={() => void act(job.id, "run")} title="Stage drafts for review — never publishes"><Play className="h-3 w-3" /></Button>
                      <Button variant="glass" size="sm" disabled={busy} onClick={() => void act(job.id, job.pausedAt ? "resume" : "pause")}><Pause className="h-3 w-3" /></Button>
                      <Button variant="glass" size="sm" disabled={busy} onClick={() => void act(job.id, "cancel")}><Square className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Running a job streams a generated fixture from Cloud Storage and stages drafts for review.
          It never approves and never publishes.
        </p>
      </CardContent>
    </Card>
  );
}
