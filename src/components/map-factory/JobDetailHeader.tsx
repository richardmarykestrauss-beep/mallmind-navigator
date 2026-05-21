import React from "react";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { type MapFactoryJob, type MapFactoryNextStep } from "@/lib/mapFactoryClient";

interface JobDetailHeaderProps {
  job: MapFactoryJob;
  mallName: string;
  nextStep: MapFactoryNextStep | null;
  actionBusy: string | null;
  onNextStep: () => void;
  onRefresh: () => void;
  loading: boolean;
  statusDot: (status: MapFactoryJob["status"]) => string;
}

export function JobDetailHeader({
  job,
  mallName,
  nextStep,
  actionBusy,
  onNextStep,
  onRefresh,
  loading,
  statusDot,
}: JobDetailHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDot(job.status)}`} />
          {mallName}
          <span className="text-muted-foreground font-normal text-xs">— {job.stage.replace(/_/g, " ")}</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{job.id}</p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {nextStep && job.status !== "complete" && (
          <button
            onClick={onNextStep}
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
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded-lg border border-border hover:bg-muted"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
