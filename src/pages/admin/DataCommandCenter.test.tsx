import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DataCommandCenter from "./DataCommandCenter";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules(); try { localStorage.clear(); } catch { /* noop */ } });

describe("Data Command Center import safety", () => {
  // Guards the Sprint 2E regression: CI provides no Supabase URL/key, so any module
  // in the render tree that eagerly builds the browser Supabase client crashes on
  // import ("supabaseUrl is required"). The dev-durable panel must reach the worker
  // only through the authenticated backend proxy, resolving its session lazily at
  // request time. We simulate CI by stubbing the env empty and re-importing the
  // whole module graph fresh (the static import at file top used the real env).
  it("imports and renders with no Supabase frontend env vars", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.stubEnv("VITE_GOOGLE_BACKEND_URL", "");
    const { default: FreshDCC } = await import("./DataCommandCenter");
    expect(() => render(<MemoryRouter><FreshDCC /></MemoryRouter>)).not.toThrow();
  });
});

describe("Data Command Center sections render", () => {
  it("renders every required section incl. the Retail Fabric operational views", () => {
    const { getAllByText, getByText } = render(
      <MemoryRouter><DataCommandCenter /></MemoryRouter>,
    );
    // Existing command-center sections still present (preserved behaviour).
    expect(getAllByText("Source Registry").length).toBeGreaterThan(0);
    expect(getAllByText(/Ingestion Runs/).length).toBeGreaterThan(0);
    // New fabric operational views.
    for (const label of ["Retail Intelligence Fabric", "Adapter Registry", "Source Policies", "Evidence Vault", "Adapter Runs"]) {
      expect(getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    }
    // Sprint 2A bridge + 2B spine + 2C bulk intake + 2D durable worker.
    for (const label of ["Evidence . Offer Bridge", "Extraction Review Queue", "Publication Readiness", "Recommendation Spine", "Bulk Intake Engine", "Intake Jobs", "Quarantine", "Scale Test", "Durable Intake Worker", "Durable Jobs", "Recovery Test"]) {
      expect(getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    }
    // A seeded draft is in the review queue.
    expect(getAllByText(/Hisense 43" A4 FHD Smart TV/).length).toBeGreaterThan(0);
    // The four demo adapters are listed.
    expect(getByText("JSON-LD (fixture)")).toBeTruthy();
    expect(getByText("Catalogue (fixture)")).toBeTruthy();
    // Honest labelling — no live requests.
    expect(getAllByText(/No live source request is performed/).length).toBeGreaterThan(0);
  });
});
