import React from "react";
import { Loader2, CheckCircle2, Clock, ChevronRight } from "lucide-react";
import { type MapFactoryJob, type MapFactoryStage } from "@/lib/mapFactoryClient";

interface Stage {
  id: MapFactoryStage;
  label: string;
  icon: React.ReactNode;
}

interface PipelineStagesProps {
  stages: readonly Stage[];
  job: MapFactoryJob;
  actionBusy: string | null;
  onRunStage: (stageId: MapFactoryStage) => void;
  stageIndexMap: Record<string, number>;
}

export function PipelineStages({
  stages,
  job,
  actionBusy,
  onRunStage,
  stageIndexMap,
}: PipelineStagesProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-semibold">Pipeline Stages</h3>
      </div>
      <div className="divide-y divide-border">
        {stages.map((s, i) => {
          const jobStageIdx   = stageIndexMap[job.stage] ?? 0;
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
                onClick={() => onRunStage(s.id)}
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
  );
}
