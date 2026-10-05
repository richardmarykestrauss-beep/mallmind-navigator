import { useEffect, useState } from "react";
import { applyUpdate, isUpdateReady, onUpdateReady } from "@/lib/serviceWorker";

/**
 * "A new version is ready": shown only when a NEW service worker is waiting. The visitor chooses when
 * to reload — a walk in progress is never interrupted (the session is remembered and restored).
 */
export default function UpdateReadyBanner() {
  const [ready, setReady] = useState(isUpdateReady());
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-[min(100%-2rem,420px)] rounded-xl border bg-card px-3 py-2 text-sm shadow-lg" role="status" data-testid="update-ready">
      <div className="flex items-center justify-between gap-3">
        <span>A new MallMind version is ready.</span>
        <button type="button" onClick={applyUpdate} className="min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Reload</button>
      </div>
    </div>
  );
}
