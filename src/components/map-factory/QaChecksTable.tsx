import React from "react";
import { type MapFactoryQaCheck } from "@/lib/mapFactoryClient";

interface QaChecksTableProps {
  checks: MapFactoryQaCheck[];
}

export function QaChecksTable({ checks }: QaChecksTableProps) {
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
