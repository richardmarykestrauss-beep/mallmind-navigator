/**
 * THE FACTORY TEST CENTRE PROOF.
 *
 * A synthetic venue goes from raw evidence (plan image + directory) through the factory CLI —
 * manifest → extraction → ledger → human review → deterministic compile → approval → publish —
 * and the published pack is then loaded through the ordinary registry and navigated by the
 * ordinary router and screen. A field survey then produces revision 2 with metres and a verified
 * door. No application source knows the venue exists (the last test greps for it).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFactory, type CliEnv } from "./cli";
import { registerVenuePack, unregisterVenuePack, getVenuePack, qrEligibleAnchors } from "../registry";
import { buildRoute } from "../route";
import { searchDestinations } from "../search";
import type { VenuePack } from "../contract";
import WayfindingPilot from "@/components/navigation/WayfindingPilot";
import { anchorFor } from "@/components/navigation/mallDatasets";

const F = join(process.cwd(), "venue-factory/fixtures/factory-test-centre");
const ID = "factory-test-centre";
let root = "";
let log: string[] = [];
let v1: VenuePack;
let v2: VenuePack;
const env = (): CliEnv => ({ root, repoRoot: process.cwd(), log: (l) => log.push(l), now: () => "2026-09-13T12:00:00Z" });
const run = (...argv: string[]) => runFactory(argv, env());
const packOf = (jobId: string, file: string): VenuePack => JSON.parse(readFileSync(join(root, jobId, "published", file), "utf8"));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mallmind-factory-e2e-"));
  const steps: Array<[string, string[]]> = [
    ["new", ["--job", "ftc-v1", "--venue", join(F, "venue.json")]],
    ["sources", ["--job", "ftc-v1", "--manifest", join(F, "sources.json"), "--raw", join(F, "raw")]],
    ["extract", ["--job", "ftc-v1", "--input", join(F, "extraction-manual.json")]],
    ["extract", ["--job", "ftc-v1", "--input", join(F, "extraction-ai.json")]],
    ["review", ["--job", "ftc-v1", "--review", join(F, "review-1-facts.json")]],
    ["compile", ["--job", "ftc-v1"]],
    ["review", ["--job", "ftc-v1", "--review", join(F, "review-2-approve.json")]],
    ["publish", ["--job", "ftc-v1"]],
  ];
  for (const [cmd, args] of steps) { const code = run(cmd, ...args); if (code !== 0) throw new Error(`${cmd} failed:\n${log.join("\n")}`); }
  v1 = packOf("ftc-v1", `${ID}.v1.venue.json`);
  const rev: Array<[string, string[]]> = [
    ["new", ["--job", "ftc-v2", "--venue", join(F, "venue.json"), "--from-pack", join(root, "ftc-v1", "published", `${ID}.v1.venue.json`), "--revision-note", "Field survey"]],
    ["sources", ["--job", "ftc-v2", "--manifest", join(F, "sources.json"), "--raw", join(F, "raw")]],
    ["extract", ["--job", "ftc-v2", "--input", join(F, "extraction-manual.json")]],
    ["extract", ["--job", "ftc-v2", "--input", join(F, "extraction-ai.json")]],
    ["review", ["--job", "ftc-v2", "--review", join(F, "review-1-facts.json")]],
    ["field-import", ["--job", "ftc-v2", "--input", join(F, "field-import.json")]],
    ["review", ["--job", "ftc-v2", "--review", join(F, "review-3-field.json")]],
    ["compile", ["--job", "ftc-v2"]],
    ["review", ["--job", "ftc-v2", "--review", join(F, "review-2-approve.json")]],
    ["publish", ["--job", "ftc-v2"]],
  ];
  for (const [cmd, args] of rev) { const code = run(cmd, ...args); if (code !== 0) throw new Error(`${cmd} failed:\n${log.join("\n")}`); }
  v2 = packOf("ftc-v2", `${ID}.v2.venue.json`);
  registerVenuePack(v1);
});
afterAll(() => { unregisterVenuePack(ID); rmSync(root, { recursive: true, force: true }); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe("Factory Test Centre — raw evidence → published pack → navigation, with no venue-specific code", () => {
  it("AI can submit, but has no publish authority: its proposals never reach the pack and the gate refuses until a human decides", () => {
    log = [];
    expect(run("publish", "--job", "ftc-v1")).toBe(1); // already published v1 → version rule; more importantly:
    const jobText = readFileSync(join(root, "ftc-v1", "ledger.json"), "utf8");
    const ledger = JSON.parse(jobText) as { facts: Array<{ fact_id: string; status: string; evidence_class: string; decision?: { by: string } }> };
    const shortcut = ledger.facts.find((f) => f.fact_id === "edge:ftc-shortcut-j2-cafe")!;
    expect(shortcut).toMatchObject({ status: "rejected", evidence_class: "ai_inference", decision: { by: "factory fixture reviewer" } });
    expect(ledger.facts.filter((f) => f.status === "accepted" && f.evidence_class === "ai_inference")).toEqual([]);
    expect(v1.graph.edges.some((e) => e.id === "ftc-shortcut-j2-cafe")).toBe(false);
    expect(v1.graph.nodes.some((n) => n.id === "ftc-j4-ghost")).toBe(false);
  });

  it("the published pack loads through the registry, routes with the app router and searches like any bundled venue", () => {
    const v = getVenuePack(ID)!;
    expect(v.name).toBe("Factory Test Centre");
    expect(v.floors.map((f) => f.label)).toEqual(["Ground"]);
    expect(v.pack.venue.pack_version).toBe(1);
    expect(v.pack.venue.sources?.map((s) => s.kind)).toEqual(["official_directory", "field_measurement", "official_map_image", "manual_note"]);
    const r = buildRoute(v, "ftc-entrance-west", "ftc-grocer");
    expect(r.found && !r.fallback).toBe(true);
    expect(r.metric).toBe(false);                      // v1: nothing measured → no metres
    expect(r.total_distance_meters).toBeNull();
    expect(r.steps.map((s) => s.node_id)).toEqual(["ftc-j1", "ftc-arrival-grocer", "ftc-arrival-grocer"]); // two legs + arrival step
    expect(r.steps[0].instruction).toBe("Walk straight in from the West Entrance to the first junction.");
    expect(searchDestinations(v, "chemist").map((d) => d.id)).toEqual(["ftc-pharmacy"]);
    expect(searchDestinations(v, "restroom").map((d) => d.id)).toEqual(["ftc-toilets-amenity"]);
    expect(qrEligibleAnchors().filter((a) => a.venueId === ID).map((a) => a.anchorId)).toEqual(["ftc-east", "ftc-west"]); // landmark start is not QR-eligible
  });

  it("the shared screen navigates the generated pack end to end at no cost to the app (320-wide layout uses the same DOM)", () => {
    render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "ftc-west", "qr")} />);
    expect(screen.getByTestId("wayfinding-pilot")).toHaveAttribute("data-mall-id", ID);
    fireEvent.change(screen.getByTestId("pilot-search"), { target: { value: "coffee" } });
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Cafe"));
    expect(screen.getByTestId("pilot-route-claim")).toHaveTextContent("Mapped route");
    expect(screen.queryByTestId("pilot-summary")).toBeNull();                       // unscaled
    expect(screen.getByTestId("pilot-summary-unscaled")).toHaveTextContent(/Ground/);
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    expect(screen.getByTestId("pilot-step-counter")).toHaveTextContent("Step 1 of 5"); // west → j1 → j2 → j3 → cafe + arrival
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Turn right at the third junction; the Cafe is ahead.");
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("wayfinding-pilot")).toHaveAttribute("data-session-status", "arrived");
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("mapped arrival point for Cafe");
    const text = screen.getByTestId("pilot-navigation").textContent ?? "";
    expect(text).not.toMatch(/\d\s?m\b/i);
    expect(text).not.toMatch(/Ground Floor|Level 1/);
  });

  it("navigation is backend-independent for a factory-made venue too", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("Load failed")));
    try {
      render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(getVenuePack(ID)!, "ftc-east", "qr")} />);
      fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Pharmacy"));
      fireEvent.click(screen.getByTestId("pilot-start-navigation"));
      expect(screen.getByTestId("pilot-step-current")).toHaveTextContent("Walk straight in from the East Entrance to the nearest junction."); // reverse wording, never derived
      while (screen.getByTestId("wayfinding-pilot").getAttribute("data-session-status") === "navigating") fireEvent.click(screen.getByTestId("pilot-next"));
      expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("mapped arrival point for Pharmacy");
    } finally { fetchSpy.mockRestore(); }
  });

  it("a field survey creates revision 2: measured legs show metres, the verified door changes the arrival wording, and the diff says exactly what changed", () => {
    expect(v2.venue.pack_version).toBe(2);
    expect(v2.venue.revision_note).toBe("Field survey");
    const diff = JSON.parse(readFileSync(join(root, "ftc-v2", "published", `${ID}.v2.diff.json`), "utf8"));
    expect(diff.edges.measured).toEqual([{ id: "ftc-e-j1-grocer", distance_m: 8.2 }, { id: "ftc-e-west-j1", distance_m: 12.5 }]);
    expect(diff.destinations.arrival_changed).toEqual([{ id: "ftc-grocer", from: "corridor_arrival", to: "verified_public_door" }]);
    expect(diff.nodes.evidence_changed).toEqual([{ id: "ftc-entrance-west", from: "source-backed", to: "field-verified" }]);
    expect(diff.nodes.moved).toEqual([]);
    expect(diff.venue.evidence_changed).toEqual([{ concern: "field_verification", from: "not-started", to: "partial" }, { concern: "accessibility", from: "unverified", to: "verified" }]);
    registerVenuePack(v2, { replace: true });
    const v = getVenuePack(ID)!;
    const r = buildRoute(v, "ftc-entrance-west", "ftc-grocer");
    expect(r.metric).toBe(true);
    expect(r.total_distance_meters).toBe(20.7);
    expect(buildRoute(v, "ftc-entrance-west", "ftc-pharmacy").metric).toBe(false); // one unmeasured leg → still unscaled
    render(<WayfindingPilot embedded mallId={ID} initialAnchor={anchorFor(v, "ftc-west", "qr")} />);
    fireEvent.click(within(screen.getByTestId("pilot-suggestions")).getByText("Grocer"));
    expect(screen.getByTestId("pilot-summary")).toHaveTextContent(/20\.7 m|21 m/);
    fireEvent.click(screen.getByTestId("pilot-start-navigation"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    fireEvent.click(screen.getByTestId("pilot-next"));
    expect(screen.getByTestId("pilot-arrival")).toHaveTextContent("You’ve reached Grocer.");
  });

  it("PROOF: no application source mentions the Factory Test Centre", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|json|mjs)$/.test(entry)) continue;
        if (full.includes("/fixtures/") || /\.test\.(ts|tsx)$/.test(entry) || /selftest|synthetic-plan/.test(entry)) continue;
        if (/factory-test-centre|\bftc-/.test(readFileSync(full, "utf8"))) hits.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "scripts"));
    expect(hits).toEqual([]);
  });
});
