/** Recovery boundary (Sprint 8): a failed lazy route never blanks the screen; Retry reloads a failed chunk (React.lazy remembers the failure) and re-mounts anything else; offline is named. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RouteErrorBoundary from "./RouteErrorBoundary";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Boom({ when, message = "Failed to fetch dynamically imported module: /assets/NavigateScreen.js" }: { when: { fail: boolean }; message?: string }) { if (when.fail) throw new Error(message); return <p data-testid="ok">loaded</p>; }

describe("RouteErrorBoundary", () => {
  it("shows an honest message with Retry and Return; Retry on a chunk failure reloads (lazy remembers the failure)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();
    render(<RouteErrorBoundary reload={reload}><Boom when={{ fail: true }} /></RouteErrorBoundary>);
    expect(screen.getByTestId("route-error")).toHaveTextContent("MallMind couldn’t load this venue yet.");
    expect(screen.getByTestId("route-error-reason")).toHaveTextContent("didn’t download");
    expect(screen.getByTestId("route-error-home")).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("re-mounts on Retry for any other render error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();
    const when = { fail: true };
    render(<RouteErrorBoundary reload={reload}><Boom when={when} message="boom" /></RouteErrorBoundary>);
    expect(screen.getByTestId("route-error-reason")).toHaveTextContent("Something went wrong");
    when.fail = false;
    fireEvent.click(screen.getByTestId("route-error-retry"));
    expect(reload).not.toHaveBeenCalled();
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
