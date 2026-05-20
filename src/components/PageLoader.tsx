import { Sparkles } from "lucide-react";

/**
 * PageLoader
 *
 * Full-screen fallback shown while a lazy-loaded page chunk is downloading.
 * Replaces the `fallback={null}` (blank screen) on the root Suspense boundary.
 * Keeps the app background colour so there is no white flash.
 */
export default function PageLoader() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
      {/* Animated logo mark */}
      <div className="relative flex h-14 w-14 items-center justify-center">
        <div className="absolute h-14 w-14 rounded-full bg-primary/10 blur-lg animate-pulse" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary border border-primary/30">
          <Sparkles className="h-5 w-5 text-primary-foreground" />
        </div>
      </div>

      {/* Spinner ring */}
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />

      <p className="text-xs text-muted-foreground tracking-wide">Loading…</p>
    </div>
  );
}
