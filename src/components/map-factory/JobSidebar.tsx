import React from "react";
import { Loader2, RefreshCw, Plus } from "lucide-react";
import { type MapFactoryJob } from "@/lib/mapFactoryClient";

interface JobSidebarProps {
  jobs: MapFactoryJob[];
  loading: boolean;
  error: string | null;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onRefresh: () => void;
  onNewJob: () => void;
  showNewJobForm: boolean;
  newJobForm: React.ReactNode;
  statusDot: (status: MapFactoryJob["status"]) => string;
  statusColor: (status: MapFactoryJob["status"]) => string;
}

export function JobSidebar({
  jobs,
  loading,
  error,
  selectedJobId,
  onSelectJob,
  onRefresh,
  onNewJob,
  showNewJobForm,
  newJobForm,
  statusDot,
  statusColor,
}: JobSidebarProps) {
  return (
    <div className="w-64 flex-shrink-0 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Jobs</h2>
        <div className="flex items-center gap-1">
          <button onClick={onRefresh} disabled={loading} className="p-1 rounded hover:bg-muted">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
          <button
            onClick={onNewJob}
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" /> New
          </button>
        </div>
      </div>

      {showNewJobForm && newJobForm}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-col gap-1 overflow-y-auto flex-1">
        {jobs.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground italic text-center py-4">No jobs yet. Create one above.</p>
        )}
        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => onSelectJob(j.id)}
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
  );
}
