/**
 * serviceWorker.ts — registration and the update handshake.
 *
 * Registers EARLY (not on `load`) so the first visit's assets are fetched through the worker and
 * precached. A new version never takes over by itself: when a new worker is installed and a page is
 * already controlled, `onUpdateReady` fires and the UI offers "Reload"; only then do we message the
 * worker to skip waiting and reload on `controllerchange`. A visitor mid-walk is never interrupted.
 */

type Listener = () => void;
const updateListeners = new Set<Listener>();
let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;

export function onUpdateReady(fn: Listener): () => void {
  updateListeners.add(fn);
  if (waitingWorker) fn();
  return () => { updateListeners.delete(fn); };
}

export function isUpdateReady(): boolean { return waitingWorker !== null; }

/** Ask the waiting worker to take over, then reload once it controls the page. */
export function applyUpdate(): void {
  if (!waitingWorker) return;
  reloadRequested = true;
  try { waitingWorker.postMessage({ type: "SKIP_WAITING" }); } catch { /* ignore */ }
}

export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloadRequested) window.location.reload(); });
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) { waitingWorker = w; for (const l of updateListeners) l(); }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; for (const l of updateListeners) l(); }
    track(reg.installing);
    reg.addEventListener("updatefound", () => track(reg.installing));
    // Check for a newer build when the app comes back to the foreground (best-effort).
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => { /* progressive enhancement */ });
}
