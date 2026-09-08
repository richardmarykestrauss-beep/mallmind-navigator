import React from "react";

interface Stage {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface StageTrackerProps {
  currentStage: string;
  jobStatus: string;
  stages: readonly { id: string; label: string; icon: React.ReactNode }[];
}

export function StageTracker({ currentStage, jobStatus, stages }: StageTrackerProps) {
  const stageIndexMap: Record<string, number> = Object.fromEntries(
    stages.map((s, i) => [s.id, i])
  );
  const currentIdx = stageIndexMap[currentStage] ?? 0;

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
      {stages.map((s, i) => {
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
            {i < stages.length - 1 && (
              <div className={`flex-1 h-0.5 min-w-[8px] -mt-4 ${i < currentIdx || jobStatus === "complete" ? "bg-emerald-400" : "bg-border"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
