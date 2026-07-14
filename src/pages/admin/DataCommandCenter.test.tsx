import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DataCommandCenter from "./DataCommandCenter";

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* noop */ } });

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
    // The four demo adapters are listed.
    expect(getByText("JSON-LD (fixture)")).toBeTruthy();
    expect(getByText("Catalogue (fixture)")).toBeTruthy();
    // Honest labelling — no live requests.
    expect(getAllByText(/No live source request is performed/).length).toBeGreaterThan(0);
  });
});
