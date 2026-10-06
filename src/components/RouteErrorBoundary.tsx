import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; /** Test seam: how a chunk failure is retried (default: a page reload). */ reload?: () => void }
interface State { error: Error | null; attempt: number }

/**
 * The visitor-facing recovery boundary around every lazy route. A chunk that cannot load (offline
 * and not yet saved on this phone, or a stale deploy) no longer leaves a blank screen: it says what
 * happened honestly and offers Retry / Return. No fallback data is ever shown.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };
  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { try { console.warn("[MallMind] route failed to load", error.message, info.componentStack); } catch { /* ignore */ } }
  /**
   * React.lazy remembers a failed import for the life of the page, so remounting alone cannot
   * recover a chunk that did not download: for those, Retry reloads the page (the remembered
   * session restores; the shell comes from the service worker when offline). Other errors remount.
   */
  retry = () => {
    const { error } = this.state;
    if (error && /import|chunk|fetch|load/i.test(error.message)) { (this.props.reload ?? (() => window.location.reload()))(); return; }
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };
  render() {
    const { error, attempt } = this.state;
    if (!error) return <div key={attempt}>{this.props.children}</div>;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const chunk = /import|chunk|fetch|load/i.test(error.message);
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center" role="alert" data-testid="route-error">
        <h1 className="text-lg font-semibold">MallMind couldn’t load this venue yet.</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground" data-testid="route-error-reason">
          {offline
            ? "You’re offline and this part of MallMind isn’t saved on this phone yet. Connect once, then it works offline."
            : chunk
              ? "Part of MallMind didn’t download. Check your connection and try again."
              : "Something went wrong while opening this screen."}
        </p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={this.retry} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="route-error-retry">Retry</button>
          <a href="/" className="min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium" data-testid="route-error-home">Return</a>
        </div>
      </div>
    );
  }
}
