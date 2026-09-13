/**
 * Venue Pack Factory — unit tests for the truth rules: shape validation, ledger transitions,
 * the deterministic compiler's failure modes, the publish gate, the diff and path safety.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkExtraction, checkReview, checkLedger, checkSourceManifest, checkFieldImport } from "./validateInputs";
import { factsFromExtraction, factsFromFieldImport, appendFacts, applyReview, normalizePoint } from "./ledger";
import { compileDraft } from "./compile";
import { publishGate } from "./publish";
import { diffVenuePacks } from "./diff";
import { safeJoin, jobDir, pngDimensions, sha256, stableJson, FactoryError } from "./jobStore";
import { FACTORY_SCHEMA_VERSION, type IngestionJob, type EvidenceLedger, type SourceEntry, type CandidateExtraction, type ReviewInput, type FieldImport, type EvidenceFact } from "./types";
import type { VenuePack } from "../contract";

const F = join(process.cwd(), "venue-factory/fixtures/factory-test-centre");
const read = <T,>(name: string): T => JSON.parse(readFileSync(join(F, name), "utf8")) as T;
const manifest = checkSourceManifest(read("sources.json"));
if (manifest.status !== "ok") throw new Error("fixture manifest invalid");
const SOURCES: SourceEntry[] = manifest.value.sources;
const SRC = new Map(SOURCES.map((s) => [s.source_id, s]));
const venue = read<IngestionJob["venue"]>("venue.json");

function job(over: Partial<IngestionJob> = {}): IngestionJob {
  return {
    schema_version: FACTORY_SCHEMA_VERSION, job_id: "t", venue_id: venue.id, created_at: "2026-09-13", status: "extracting", venue, pack_version: 1,
    revision_note: "test", sources: "sources.json", extraction_outputs: [], evidence_ledger: "ledger.json", reviews: [], draft_pack: null, validation_result: null,
    approval_state: null, published_pack_version: null, published_pack: null, base_pack: null, history: [], ...over,
  };
}
const empty = (): EvidenceLedger => ({ schema_version: FACTORY_SCHEMA_VERSION, job_id: "t", facts: [] });

/** The fixture pipeline in memory: manual + AI extraction, then review 1. */
function reviewedLedger(): EvidenceLedger {
  const manual = checkExtraction(read("extraction-manual.json"), undefined, new Set(SRC.keys()));
  const ai = checkExtraction(read("extraction-ai.json"), undefined, new Set(SRC.keys()));
  if (manual.status !== "ok" || ai.status !== "ok") throw new Error("fixture extraction invalid");
  const f1 = factsFromExtraction(manual.value, "extractions/01-manual.json", SRC);
  const f2 = factsFromExtraction(ai.value, "extractions/02-ai.json", SRC);
  if (f1.status !== "ok" || f2.status !== "ok") throw new Error("facts failed");
  let l = appendFacts(empty(), [...f1.facts, ...f2.facts]);
  if (l.status !== "ok") throw new Error("append failed");
  const r = checkReview(read("review-1-facts.json"));
  if (r.status !== "ok") throw new Error("review invalid");
  l = applyReview(l.ledger, r.value);
  if (l.status !== "ok") throw new Error("review failed");
  return l.ledger;
}
const setStatus = (l: EvidenceLedger, id: string, status: EvidenceFact["status"]): EvidenceLedger => ({ ...l, facts: l.facts.map((f) => (f.fact_id === id ? { ...f, status } : f)) });
const without = (l: EvidenceLedger, id: string): EvidenceLedger => ({ ...l, facts: l.facts.filter((f) => f.fact_id !== id) });
const messages = (r: ReturnType<typeof compileDraft>) => (r.status === "failed" ? r.errors.map((e) => `${e.path}: ${e.message}`).join("\n") : "");

describe("input validation (shape only, never truth)", () => {
  it("accepts the fixture artifacts and rejects unknown keys, markup and bad points", () => {
    expect(checkExtraction(read("extraction-manual.json")).status).toBe("ok");
    expect(checkFieldImport(read("field-import.json")).status).toBe("ok");
    const bad = read<Record<string, unknown>>("extraction-manual.json");
    (bad as { nodes: Record<string, unknown>[] }).nodes[0] = { ...(bad as { nodes: Record<string, unknown>[] }).nodes[0], name: "<b>Entrance</b>", __proto__: { x: 1 }, extra: 1, at: { x_percent: 120, y_percent: 5 } };
    const r = checkExtraction(bad);
    expect(r.status).toBe("failed");
    const text = r.status === "failed" ? r.errors.map((e) => e.path + " " + e.message).join("\n") : "";
    expect(text).toMatch(/nodes\[0\]\.name.*plain text/);
    expect(text).toMatch(/nodes\[0\]\.extra.*unknown key/);
    expect(text).toMatch(/x_percent.*≤ 100/);
  });

  it("an AI worker may not submit first-party classes without flagging them for review", () => {
    const ai = read<CandidateExtraction>("extraction-ai.json");
    const sneaky = { ...ai, nodes: [{ ...ai.nodes[0], evidence_class: "visual_first_party", manual_review_required: false }] };
    const r = checkExtraction(sneaky);
    expect(r.status).toBe("failed");
    expect(r.status === "failed" ? r.errors[0].message : "").toMatch(/AI worker may only submit non-inference classes with manual_review_required: true/);
  });

  it("a review cannot bulk-accept inference classes and a stored ledger cannot hold an accepted inference without a decision", () => {
    const r = checkReview({ schema_version: 1, reviewer: "x", reviewed_at: "2026-09-13", accept: [], reject: [], override: [], unresolved: [], accept_all_of_class: ["ai_inference"] });
    expect(r.status).toBe("failed");
    const l = checkLedger({ schema_version: 1, job_id: "t", facts: [{ fact_id: "a", subject: "node:a", predicate: "geometry", value: { x_percent: 1, y_percent: 1 }, source_id: "s", evidence_class: "ai_inference", confidence: 0.9, status: "accepted", proposed_by: "x", manual_review_required: true }] }, "t");
    expect(l.status).toBe("failed");
    expect(l.status === "failed" ? l.errors[0].message : "").toMatch(/cannot be accepted without a recorded human decision/);
  });

  it("source files must live under raw/ and images only on image-bearing source types", () => {
    const m = read<{ sources: Record<string, unknown>[] }>("sources.json");
    m.sources[0].file = "../secrets.png";
    m.sources[1].image = { width_px: 1, height_px: 1, origin: "top-left", x_axis: "right", y_axis: "down", fit: "stretch" };
    const r = checkSourceManifest(m);
    expect(r.status).toBe("failed");
    const text = r.status === "failed" ? r.errors.map((e) => e.message).join("\n") : "";
    expect(text).toMatch(/job-relative path/);
    expect(text).toMatch(/only map-image, operator-plan or field-photo sources/);
  });
});

describe("image pixels → plane coordinates", () => {
  it("pad-to-plane reproduces the Garden Route research forensics (417×888 source, x padded)", () => {
    const src = new Map<string, SourceEntry>([["grm", { source_id: "grm", type: "official_map_image", title: "t", origin: "o", acquired_at: "2026-09-03", party: "first_party", rights: { status: "unknown", note: "n" }, image: { width_px: 417, height_px: 888, origin: "top-left", x_axis: "right", y_axis: "down", fit: "pad-to-plane" } }]]);
    const p = normalizePoint({ image: "grm", px_x: 212, px_y: 338 }, src);
    expect(p).toMatchObject({ status: "ok", x_percent: 50.24, y_percent: 38.06 });
    expect(p.status === "ok" ? p.provenance : {}).toMatchObject({ source_px_x: 212, source_px_y: 338, x_percent_source: 50.84, source_fit: "pad-to-plane" });
    expect(normalizePoint({ image: "grm", px_x: 500, px_y: 1 }, src)).toMatchObject({ status: "failed" });
    expect(normalizePoint({ image: "nope", px_x: 1, px_y: 1 }, src)).toMatchObject({ status: "failed" });
  });
  it("stretch normalises each axis independently", () => {
    const src = new Map<string, SourceEntry>([["s", { source_id: "s", type: "official_map_image", title: "t", origin: "o", acquired_at: "2026-09-03", party: "first_party", rights: { status: "permitted", note: "n" }, image: { width_px: 200, height_px: 100, origin: "top-left", x_axis: "right", y_axis: "down", fit: "stretch" } }]]);
    expect(normalizePoint({ image: "s", px_x: 50, px_y: 25 }, src)).toMatchObject({ x_percent: 25, y_percent: 25 });
  });
});

describe("evidence ledger — only humans move facts", () => {
  it("everything enters as proposed; nothing is truth until reviewed", () => {
    const e = checkExtraction(read("extraction-ai.json"));
    if (e.status !== "ok") throw new Error();
    const f = factsFromExtraction(e.value, "x", SRC);
    if (f.status !== "ok") throw new Error();
    expect(f.facts.every((x) => x.status === "proposed")).toBe(true);
    expect(f.facts.every((x) => x.manual_review_required)).toBe(true); // inference is always flagged
    expect(appendFacts(empty(), [{ ...f.facts[0], status: "accepted" }]).status).toBe("failed");
  });

  it("accepting an inference needs a reason; bulk accept skips flagged facts; override supersedes without deleting; rejected stays", () => {
    const l = reviewedLedger();
    const byId = new Map(l.facts.map((f) => [f.fact_id, f]));
    expect(byId.get("edge:ftc-shortcut-j2-cafe")?.status).toBe("rejected");
    expect(byId.get("node:ftc-j4-ghost")?.status).toBe("rejected");
    expect(byId.get("destination:ftc-cafe")?.status).toBe("superseded");
    expect(byId.get("destination:ftc-cafe")?.superseded_by).toBe("destination:ftc-cafe~o1");
    expect(byId.get("destination:ftc-cafe~o1")).toMatchObject({ status: "accepted", supersedes: "destination:ftc-cafe", evidence_class: "explicit_first_party" });
    expect(byId.get("ftc-fact-hours")?.status).toBe("proposed");
    expect(byId.get("anchor:ftc-info-point")).toMatchObject({ status: "accepted", decision: { action: "accept" } });
    expect(l.facts.length).toBe(46); // 41 + 4 + 1 override; nothing erased
    const review = (over: Partial<ReviewInput>): ReviewInput => ({ schema_version: 1, reviewer: "r", reviewed_at: "2026-09-13", accept: [], reject: [], override: [], unresolved: [], ...over });
    const noReason = applyReview(l, review({ accept: [{ fact_id: "ftc-ai-fact-levels" }] }));
    expect(noReason.status).toBe("failed"); // already rejected? no: it is rejected — decide again is allowed? It was rejected; re-deciding is allowed only if not superseded
    const fresh = reviewedLedger();
    const aiFact = fresh.facts.find((f) => f.fact_id === "ftc-ai-fact-levels")!;
    const relisted = { ...fresh, facts: fresh.facts.map((f) => (f === aiFact ? { ...f, status: "proposed" as const } : f)) };
    expect(applyReview(relisted, review({ accept: [{ fact_id: "ftc-ai-fact-levels" }] })).status).toBe("failed");
    expect(applyReview(relisted, review({ accept: [{ fact_id: "ftc-ai-fact-levels", reason: "checked" }] })).status).toBe("ok");
    expect(applyReview(l, review({ accept: [{ fact_id: "destination:ftc-cafe" }] })).status).toBe("failed"); // superseded
    const bulk = applyReview(relisted, review({ accept_all_of_class: ["field_verified"] }));
    expect(bulk.status === "ok" ? bulk.warnings.join() : "").toMatch(/nothing to accept/);
  });

  it("field observations become proposed field_verified facts that still need review", () => {
    const fi = checkFieldImport(read("field-import.json"));
    if (fi.status !== "ok") throw new Error();
    const f = factsFromFieldImport(fi.value, "x", SRC);
    expect(f.status).toBe("ok");
    if (f.status !== "ok") return;
    expect(f.facts.map((x) => x.fact_id)).toEqual(["measurement:ftc-m-west-j1", "measurement:ftc-m-j1-grocer", "confirmation:ftc-c-west", "door:ftc-d-grocer", "accessibility:ftc-a-venue"]);
    expect(f.facts.every((x) => x.status === "proposed" && x.evidence_class === "field_verified" && x.manual_review_required)).toBe(true);
    const wrongSource: FieldImport = { ...fi.value, source_id: "ftc-map" };
    expect(factsFromFieldImport(wrongSource, "x", SRC).status).toBe("failed");
  });
});

describe("deterministic compiler", () => {
  it("compiles the reviewed fixture into a valid pack, byte-identical regardless of ledger order", () => {
    const l = reviewedLedger();
    const a = compileDraft(job(), l, SOURCES);
    expect(a.status).toBe("ok");
    if (a.status !== "ok") return;
    const shuffled = { ...l, facts: [...l.facts].reverse() };
    const b = compileDraft(job(), shuffled, [...SOURCES].reverse());
    expect(b.status).toBe("ok");
    expect(stableJson(a.pack)).toBe(stableJson(b.status === "ok" ? b.pack : null));
    expect(stableJson(a.pack)).not.toMatch(/20\d\dT\d\d:\d\d/); // no clock in the output
    expect(a.pack.venue.evidence).toMatchObject({ geometry: "source-backed", measurement: "unmeasured", field_verification: "not-started", accessibility: "unverified" });
    expect(a.pack.graph.edges.every((e) => e.evidence.measurement === "unmeasured" && e.distance_m == null)).toBe(true);
    expect(a.pack.graph.edges.find((e) => e.id === "ftc-e-j1-info")?.notes).toMatch(/length_px derived/);
    expect(a.pack.graph.edges.some((e) => e.id === "ftc-shortcut-j2-cafe")).toBe(false);
    expect(a.pack.graph.nodes.some((n) => n.id === "ftc-j4-ghost")).toBe(false);
    expect(a.pack.destinations.find((d) => d.id === "ftc-cafe")).toMatchObject({ unit: "G14", evidence: { identity: "source-backed", arrival: "corridor_arrival" } });
    expect(a.pack.graph.nodes.find((n) => n.id === "ftc-entrance-west")).toMatchObject({ x_percent: 16.52, y_percent: 50, provenance: { source_px_x: 30, source_fit: "pad-to-plane" } }); // 600×500 letterboxed into 1000:620
    expect(a.pack.graph.edges.find((e) => e.id === "ftc-e-j1-j2")?.instructions).toEqual({ forward: "Continue straight along the main aisle to the second junction.", reverse: "Head back along the main aisle toward the West Entrance." });
    expect(a.stats).toEqual({ facts_used: 41, facts_ignored: 5 });
  });

  it("fails loudly instead of guessing: unaccepted node, rejected entrance, unknown arrival, unknown floor, unsupported distance state", () => {
    const l = reviewedLedger();
    expect(messages(compileDraft(job(), setStatus(l, "node:ftc-j2", "proposed"), SOURCES))).toMatch(/node:ftc-j2 is not yet accepted/);
    expect(messages(compileDraft(job(), setStatus(l, "node:ftc-entrance-west", "rejected"), SOURCES))).toMatch(/anchor:ftc-west\.node: references node "ftc-entrance-west": node:ftc-entrance-west was REJECTED/);
    expect(messages(compileDraft(job(), without(l, "node:ftc-arrival-grocer"), SOURCES))).toMatch(/destination:ftc-grocer\.arrival_node: references node "ftc-arrival-grocer": unknown node:ftc-arrival-grocer/);
    expect(messages(compileDraft(job(), setStatus(l, "floor:g", "proposed"), SOURCES))).toMatch(/references floor "g": floor:g is not yet accepted/);
    const metric = job({ venue: { ...venue, distance_unit: "m" } });
    expect(messages(compileDraft(metric, l, SOURCES))).toMatch(/requires distance_unit "m" but this edge has no accepted field measurement \(unsupported distance state\)/);
  });

  it("metres come only from accepted field_verified measurements; a verified door only from a field arrival fact; conflicts fail", () => {
    const l = reviewedLedger();
    const fact = (over: Partial<EvidenceFact>): EvidenceFact => ({ fact_id: "x", subject: "edge:ftc-e-west-j1", predicate: "measurement", value: { distance_m: 12.5 }, source_id: "ftc-field", evidence_class: "field_verified", confidence: 1, status: "accepted", proposed_by: "t", manual_review_required: false, decision: { by: "r", at: "2026-09-14", action: "accept", reason: "ok" }, ...over });
    const measured = compileDraft(job(), { ...l, facts: [...l.facts, fact({})] }, SOURCES);
    expect(measured.status).toBe("ok");
    if (measured.status === "ok") {
      expect(measured.pack.graph.edges.find((e) => e.id === "ftc-e-west-j1")).toMatchObject({ distance_m: 12.5, evidence: { measurement: "measured" } });
      expect(measured.pack.venue.evidence.field_verification).toBe("partial");
    }
    expect(messages(compileDraft(job(), { ...l, facts: [...l.facts, fact({ evidence_class: "manual_inference" })] }, SOURCES))).toMatch(/only field_verified measurements may produce metres/);
    expect(messages(compileDraft(job(), { ...l, facts: [...l.facts, fact({ fact_id: "d", subject: "destination:ftc-grocer", predicate: "arrival", value: "verified_public_door", evidence_class: "operator_supplied" })] }, SOURCES))).toMatch(/a verified door needs a field_verified arrival fact/);
    const door = compileDraft(job(), { ...l, facts: [...l.facts, fact({ fact_id: "d", subject: "destination:ftc-grocer", predicate: "arrival", value: "verified_public_door" })] }, SOURCES);
    expect(door.status === "ok" ? door.pack.destinations.find((d) => d.id === "ftc-grocer")?.evidence.arrival : "").toBe("verified_public_door");
    const dup = { ...l, facts: [...l.facts, { ...l.facts.find((f) => f.fact_id === "node:ftc-j1")!, fact_id: "node:ftc-j1-again" }] };
    expect(messages(compileDraft(job(), dup, SOURCES))).toMatch(/2 accepted "geometry" facts conflict/);
  });
});

describe("publish gate", () => {
  function draft() { const l = reviewedLedger(); const r = compileDraft(job(), l, SOURCES); if (r.status !== "ok") throw new Error(messages(r)); return { l, pack: r.pack, sha: sha256(stableJson(r.pack)) }; }
  const approval = (sha: string) => ({ decision: "approve" as const, reviewer: "r", at: "2026-09-13", reason: "ok", draft_sha256: sha });

  it("passes only with a matching approval and no unresolved blocking evidence", () => {
    const { l, pack, sha } = draft();
    const base = { job: job(), draft: pack, draftSha256: sha, ledger: l, bundledIds: [], basePack: null, replace: false };
    expect(publishGate({ ...base, approval: null })).toMatchObject({ status: "failed", errors: [{ path: "approval" }] });
    expect(publishGate({ ...base, approval: approval("0".repeat(64)) }).status).toBe("failed");
    const ok = publishGate({ ...base, approval: approval(sha) });
    expect(ok.status).toBe("ok");
    expect(ok.warnings.join()).toMatch(/unresolved non-blocking fact ftc-fact-hours/);
    // an AI candidate left proposed (not rejected) blocks publishing even though the compiler ignored it
    const stale = setStatus(l, "edge:ftc-shortcut-j2-cafe", "proposed");
    const blocked = publishGate({ ...base, ledger: stale, approval: approval(sha) });
    expect(blocked.status === "failed" ? blocked.errors.map((e) => e.message).join() : "").toMatch(/unresolved blocking fact.*edge:ftc-shortcut-j2-cafe/);
  });

  it("enforces unique venue ids against the bundle and pack_version continuity", () => {
    const { l, pack, sha } = draft();
    const base = { job: job(), draft: pack, draftSha256: sha, ledger: l, approval: approval(sha), basePack: null, replace: false };
    const clash = publishGate({ ...base, bundledIds: [pack.venue.id] });
    expect(clash.status === "failed" ? clash.errors[0].message : "").toMatch(/already a bundled venue/);
    expect(publishGate({ ...base, bundledIds: [pack.venue.id], replace: true }).status).toBe("ok");
    const v3: VenuePack = { ...pack, venue: { ...pack.venue, pack_version: 3 } };
    const bad = publishGate({ ...base, job: job({ pack_version: 3 }), draft: v3, draftSha256: sha256(stableJson(v3)), approval: approval(sha256(stableJson(v3))), bundledIds: [], basePack: pack });
    expect(bad.status === "failed" ? bad.errors.map((e) => e.message).join() : "").toMatch(/must be 2 \(base is v1\)/);
  });
});

describe("diff", () => {
  it("reports moved nodes, measured edges and arrival upgrades", () => {
    const { pack } = (() => { const l = reviewedLedger(); const r = compileDraft(job(), l, SOURCES); if (r.status !== "ok") throw new Error(); return { pack: r.pack }; })();
    const next: VenuePack = JSON.parse(JSON.stringify(pack));
    next.venue.pack_version = 2;
    next.graph.nodes[0].x_percent += 1;
    next.graph.edges[0].distance_m = 10; next.graph.edges[0].evidence.measurement = "measured";
    next.destinations[0].evidence.arrival = "verified_public_door";
    const d = diffVenuePacks(pack, next);
    expect(d.nodes.moved).toHaveLength(1);
    expect(d.edges.measured).toEqual([{ id: next.graph.edges[0].id, distance_m: 10 }]);
    expect(d.destinations.arrival_changed).toEqual([{ id: next.destinations[0].id, from: "corridor_arrival", to: "verified_public_door" }]);
    expect(diffVenuePacks(pack, pack).summary).toEqual([`${pack.venue.id}: v1 → v1`, "no changes"]);
  });
});

describe("filesystem safety", () => {
  it("never resolves outside the job directory and only reads PNG headers", () => {
    const dir = "/tmp/factory-root/job-a";
    expect(safeJoin(dir, "raw/map.png")).toBe(`${dir}/raw/map.png`);
    for (const bad of ["../other/x.json", "/etc/passwd", "raw/../../x", "raw\\map.png", "./x", "raw/./x", ""]) expect(() => safeJoin(dir, bad)).toThrow(FactoryError);
    expect(() => jobDir("/tmp/factory-root", "../escape")).toThrow(FactoryError);
    expect(() => jobDir("/tmp/factory-root", "Job A")).toThrow(FactoryError);
    expect(pngDimensions(readFileSync(join(F, "raw/map.png")))).toEqual({ width: 600, height: 500 });
    expect(pngDimensions(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(pngDimensions(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
