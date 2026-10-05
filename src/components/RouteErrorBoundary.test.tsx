/** Recovery boundary (Sprint 8): a failed lazy route never blanks the screen; Retry re-mounts; offline is named. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RouteErrorBoundary from "./RouteErrorBoundary";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Boom({ when }: { when: { fail: boolean } }) { if (when.fail) throw new Error("Failed to fetch dynamically imported module: /assets/NavigateScreen.js"); return <p data-testid="ok">loaded</p>; }

describe("RouteErrorBoundary", () => {
  it("shows an honest message with Retry and Return, and recovers on retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
    const when = { fail: true };
    render(<RouteErrorBoundary><Boom when={when} /></RouteErrorBoundary>);
    expect(screen.getByTestId("route-error")).toHaveTextContent("MallMind couldn’t load this venue yet.");
    expect(screen.getByTestId("route-error-reason")).toHaveTextContent("didn’t download");
    expect(screen.getByTestId("route-error-home")).toHaveAttribute("href", "/");
    when.fail = false;
    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(screen.getByTestId("ok")).toHaveTextContent("loaded");
  });
  it("names the offline case without inventing fallback content", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<RouteErrorBoundary><Boom when={{ fail: true }} /></RouteErrorBoundary>);
    expect(screen.getByTestId("route-error-reason")).toHaveTextContent("You’re offline and this part of MallMind isn’t saved on this phone yet.");
    expect(screen.queryByTestId("pilot-steps")).toBeNull();
    spy.mockRestore();
  });
});
