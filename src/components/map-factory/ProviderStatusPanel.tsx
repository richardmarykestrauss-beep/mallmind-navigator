import React from "react";
import { Loader2, RefreshCw, Cpu } from "lucide-react";
import { type MapFactoryProviderTestResult } from "@/lib/mapFactoryClient";

interface ProviderStatusPanelProps {
  status: MapFactoryProviderTestResult | null;
  loading: boolean;
  error: string | null;
  onTest: () => void;
  disabled: boolean;
}

export function ProviderStatusPanel({
  status,
  loading,
  error,
  onTest,
  disabled,
}: ProviderStatusPanelProps) {
  const PROVIDER_LABELS: Array<{ key: keyof MapFactoryProviderTestResult["providers"]; label: string }> = [
    { key: "mock",                      label: "Mock (always available)" },
    { key: "gemini_vision_extraction",  label: "Gemini Vision Extraction" },
    { key: "google_vision_ocr",         label: "Google Vision OCR" },
    { key: "google_document_ai_layout", label: "Document AI Layout" },
    { key: "gemini_embedding",          label: "Gemini Embedding" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-xs font-semibold flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5" />
          AI Extraction Providers
        </h3>
        <button
          onClick={onTest}
          disabled={loading || disabled}
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
        >
          {loading
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />}
          Check
        </button>
      </div>
      <div className="p-3">
        {error && (
          <p className="text-xs text-red-600 mb-2">{error}</p>
        )}
        {!status && !error && (
          <p className="text-xs text-muted-foreground italic">Click Check to query provider status.</p>
        )}
        {status && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-1">
              <span>Google AI: <span className={status.google_ai_enabled ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{status.google_ai_enabled ? "ENABLED" : "DISABLED"}</span></span>
              <span>Active provider: <span className="font-mono font-medium">{status.active_provider}</span></span>
            </div>
            {PROVIDER_LABELS.map(({ key, label }) => {
              const configured = status.providers[key];
              return (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium
                    ${configured
                      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground"}`}>
                    {configured ? "✓ Ready" : "Not configured"}
                  </span>
                </div>
              );
            })}
            <div className="mt-1 pt-1 border-t border-border text-[10px] text-muted-foreground">
              Chain: <span className="font-mono">{status.image_chain.join(" → ")}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
