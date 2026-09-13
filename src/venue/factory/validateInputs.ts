/**
 * validateInputs.ts — shape validation of every factory artifact (all UNTRUSTED JSON).
 *
 * These validators check SHAPE and vocabulary only — they never decide whether a fact is true.
 * Unknown keys are rejected (closed objects, which also shuts out `__proto__`-style keys), every
 * string is plain text, ids match their patterns, and every issue is reported with a JSON path.
 */

import { VENUE_ID_PATTERN, DEPLOYMENT_STATES, DISTANCE_UNITS, NODE_KINDS, DESTINATION_KINDS, ANCHOR_KINDS, AMENITY_KINDS, VERTICAL_KINDS } from "../contract";
import { UNSAFE_TEXT } from "../validate";
import {
  FACTORY_SCHEMA_VERSION, SOURCE_TYPES, SOURCE_PARTIES, RIGHTS_STATUSES, EVIDENCE_CLASSES, FACT_STATUSES, JOB_STATUSES, INFERENCE_CLASSES,
  JOB_ID_PATTERN, SOURCE_ID_PATTERN, FACT_ID_PATTERN, CANDIDATE_ID_PATTERN,
  type SourceManifest, type CandidateExtraction, type ReviewInput, type FieldImport, type JobVenueConfig, type IngestionJob,
  type EvidenceLedger, type CandidatePoint, type FactValue,
} from "./types";

export interface Issue { path: string; message: string }
export type Checked<T> = { status: "ok"; value: T } | { status: "failed"; errors: Issue[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
/** Job-relative artifact path: forward slashes, no leading slash, no "." / ".." segments, no drive letters. */
const REL_PATH_RE = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9_./-]{1,200}$/;

export class Check {
  errors: Issue[] = [];
  fail(path: string, message: string) { this.errors.push({ path, message }); }
  /** Closed object: every present key must be in `allowed`. */
  obj(path: string, v: unknown, allowed: readonly string[]): v is Rec {
    if (!isRec(v)) { this.fail(path, "must be an object"); return false; }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) this.fail(`${path}.${k}`, `unknown key "${k}" (allowed: ${allowed.join(", ")})`);
    return true;
  }
  text(path: string, v: unknown, required = true, max = 300): v is string {
    if (v == null || v === "") { if (required) this.fail(path, "required plain-text string is missing"); return false; }
    if (typeof v !== "string") { this.fail(path, `must be a string (got ${typeof v})`); return false; }
    if (v.length > max) { this.fail(path, `longer than ${max} characters`); return false; }
    if (UNSAFE_TEXT.test(v)) { this.fail(path, "must be plain text (no markup, control characters or template braces)"); return false; }
    return true;
  }
  id(path: string, v: unknown, pattern: RegExp): v is string {
    if (typeof v !== "string" || !pattern.test(v)) { this.fail(path, `must be an id matching ${pattern} (got ${JSON.stringify(v)})`); return false; }
    return true;
  }
  oneOf<T extends string>(path: string, v: unknown, allowed: readonly T[], required = true): v is T {
    if (v == null) { if (required) this.fail(path, `required; one of ${allowed.join(" | ")}`); return false; }
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) { this.fail(path, `unknown value ${JSON.stringify(v)}; expected one of ${allowed.join(" | ")}`); return false; }
    return true;
  }
  num(path: string, v: unknown, o: { min?: number; max?: number; integer?: boolean; required?: boolean } = {}): v is number {
    if (v == null) { if (o.required ?? true) this.fail(path, "required number is missing"); return false; }
    if (typeof v !== "number" || !Number.isFinite(v)) { this.fail(path, `must be a finite number (got ${JSON.stringify(v)})`); return false; }
    if (o.integer && !Number.isInteger(v)) { this.fail(path, `must be an integer (got ${v})`); return false; }
    if (o.min != null && v < o.min) { this.fail(path, `must be ≥ ${o.min} (got ${v})`); return false; }
    if (o.max != null && v > o.max) { this.fail(path, `must be ≤ ${o.max} (got ${v})`); return false; }
    return true;
  }
  bool(path: string, v: unknown, required = true): v is boolean {
    if (v == null) { if (required) this.fail(path, "required boolean is missing"); return false; }
    if (typeof v !== "boolean") { this.fail(path, `must be true or false (got ${JSON.stringify(v)})`); return false; }
    return true;
  }
  array(path: string, v: unknown, required = true): v is unknown[] {
    if (v == null) { if (required) this.fail(path, "required array is missing"); return false; }
    if (!Array.isArray(v)) { this.fail(path, "must be an array"); return false; }
    return true;
  }
  date(path: string, v: unknown, required = true): v is string {
    if (v == null) { if (required) this.fail(path, "required date is missing"); return false; }
    if (typeof v !== "string" || !DATE_RE.test(v)) { this.fail(path, `must be an ISO date (YYYY-MM-DD or full timestamp), got ${JSON.stringify(v)}`); return false; }
    return true;
  }
  relPath(path: string, v: unknown, required = true): v is string {
    if (v == null) { if (required) this.fail(path, "required job-relative path is missing"); return false; }
    if (typeof v !== "string" || !REL_PATH_RE.test(v) || v.includes("\\")) { this.fail(path, `must be a job-relative path (no leading slash, no "..", no backslashes), got ${JSON.stringify(v)}`); return false; }
    return true;
  }
  schema(path: string, v: unknown) { if (v !== FACTORY_SCHEMA_VERSION) this.fail(path, `schema_version must be ${FACTORY_SCHEMA_VERSION} (got ${JSON.stringify(v)})`); }
  jobId(path: string, v: unknown, expected?: string) {
    if (!this.id(path, v, JOB_ID_PATTERN)) return;
    if (expected && v !== expected) this.fail(path, `belongs to job "${v}", not "${expected}"`);
  }
  /** Submitted artifacts (manifest, extraction, review, field import) may omit job_id; when present it must match. */
  jobIdOptional(path: string, v: unknown, expected?: string) { if (v != null) this.jobId(path, v, expected); }
  unique(path: string, ids: string[], what: string) {
    const seen = new Set<string>();
    ids.forEach((id, i) => { if (seen.has(id)) this.fail(`${path}[${i}].id`, `duplicate ${what} id "${id}"`); seen.add(id); });
  }
  aliases(path: string, v: unknown) {
    if (v == null) return;
    if (!this.array(path, v)) return;
    v.forEach((a, i) => this.text(`${path}[${i}]`, a, true, 80));
  }
  point(path: string, v: unknown): v is CandidatePoint {
    if (!isRec(v)) { this.fail(path, "must be a point object"); return false; }
    if ("image" in v) {
      this.obj(path, v, ["image", "px_x", "px_y"]);
      this.id(`${path}.image`, v.image, SOURCE_ID_PATTERN);
      this.num(`${path}.px_x`, v.px_x, { min: 0 });
      this.num(`${path}.px_y`, v.px_y, { min: 0 });
    } else {
      this.obj(path, v, ["x_percent", "y_percent"]);
      this.num(`${path}.x_percent`, v.x_percent, { min: 0, max: 100 });
      this.num(`${path}.y_percent`, v.y_percent, { min: 0, max: 100 });
    }
    return true;
  }
  /** Scalars, or a flat object / list of flat objects of scalars — never nested structures or code. */
  factValue(path: string, v: unknown): v is FactValue {
    const scalar = (x: unknown) => x === null || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.length <= 300 && !UNSAFE_TEXT.test(x));
    const flat = (x: unknown, p: string) => {
      if (!isRec(x)) { this.fail(p, "must be a flat object of scalars"); return; }
      for (const [k, val] of Object.entries(x)) {
        if (!/^[a-z0-9_]{1,40}$/.test(k)) this.fail(`${p}.${k}`, "keys must be snake_case identifiers");
        if (!scalar(val)) this.fail(`${p}.${k}`, "must be a scalar (plain text, number, boolean or null)");
      }
    };
    if (scalar(v)) return true;
    if (Array.isArray(v)) { if (v.length > 200) this.fail(path, "at most 200 entries"); v.forEach((x, i) => flat(x, `${path}[${i}]`)); return true; }
    if (isRec(v)) { flat(v, path); return true; }
    this.fail(path, "must be a scalar, a flat object or a list of flat objects");
    return false;
  }
  candidateBase(path: string, v: Rec) {
    this.id(`${path}.id`, v.id, CANDIDATE_ID_PATTERN);
    this.id(`${path}.source_id`, v.source_id, SOURCE_ID_PATTERN);
    this.oneOf(`${path}.evidence_class`, v.evidence_class, EVIDENCE_CLASSES);
    this.num(`${path}.confidence`, v.confidence, { min: 0, max: 1 });
    this.bool(`${path}.manual_review_required`, v.manual_review_required);
    this.text(`${path}.notes`, v.notes, false, 600);
  }
  done<T>(value: T): Checked<T> { return this.errors.length ? { status: "failed", errors: this.errors } : { status: "ok", value }; }
}

const BASE_KEYS = ["id", "source_id", "evidence_class", "confidence", "manual_review_required", "notes"];

// ── Job venue config ─────────────────────────────────────────────────────────
export function checkVenueConfig(input: unknown, path = "$"): Checked<JobVenueConfig> {
  const c = new Check();
  if (!c.obj(path, input, ["id", "name", "short_name", "city", "country", "deployment", "distance_unit", "field_verification_intent", "policies", "notes"])) return c.done(input as JobVenueConfig);
  c.id(`${path}.id`, input.id, VENUE_ID_PATTERN);
  c.text(`${path}.name`, input.name, true, 120);
  c.text(`${path}.short_name`, input.short_name, false, 40);
  c.text(`${path}.city`, input.city, false, 80);
  c.text(`${path}.country`, input.country, false, 80);
  if (c.obj(`${path}.deployment`, input.deployment, ["state", "official", "label"])) {
    c.oneOf(`${path}.deployment.state`, input.deployment.state, DEPLOYMENT_STATES);
    c.bool(`${path}.deployment.official`, input.deployment.official);
    c.text(`${path}.deployment.label`, input.deployment.label, false, 160);
  }
  c.oneOf(`${path}.distance_unit`, input.distance_unit, DISTANCE_UNITS);
  c.oneOf(`${path}.field_verification_intent`, input.field_verification_intent, ["not-started", "pending"] as const, false);
  if (c.obj(`${path}.policies`, input.policies, ["start", "destinations", "floors", "metrics", "instructions"])) {
    const p = input.policies;
    if (c.obj(`${path}.policies.start`, p.start, ["default_anchor", "allowed_anchor_kinds"])) {
      if (p.start.default_anchor != null) c.id(`${path}.policies.start.default_anchor`, p.start.default_anchor, VENUE_ID_PATTERN);
      if (p.start.allowed_anchor_kinds != null && c.array(`${path}.policies.start.allowed_anchor_kinds`, p.start.allowed_anchor_kinds)) p.start.allowed_anchor_kinds.forEach((k, i) => c.oneOf(`${path}.policies.start.allowed_anchor_kinds[${i}]`, k, ANCHOR_KINDS));
    }
    if (c.obj(`${path}.policies.destinations`, p.destinations, ["searchable_kinds", "include_routable_amenities"])) {
      c.bool(`${path}.policies.destinations.include_routable_amenities`, p.destinations.include_routable_amenities);
      if (p.destinations.searchable_kinds != null && c.array(`${path}.policies.destinations.searchable_kinds`, p.destinations.searchable_kinds)) p.destinations.searchable_kinds.forEach((k, i) => c.oneOf(`${path}.policies.destinations.searchable_kinds[${i}]`, k, DESTINATION_KINDS));
    }
    if (c.obj(`${path}.policies.floors`, p.floors, ["display"])) c.oneOf(`${path}.policies.floors.display`, p.floors.display, ["label", "id"] as const);
    if (c.obj(`${path}.policies.metrics`, p.metrics, ["show"])) c.oneOf(`${path}.policies.metrics.show`, p.metrics.show, ["when-measured", "never"] as const);
    if (c.obj(`${path}.policies.instructions`, p.instructions, ["generic_fallback", "start_prefix"])) {
      c.bool(`${path}.policies.instructions.generic_fallback`, p.instructions.generic_fallback);
      c.bool(`${path}.policies.instructions.start_prefix`, p.instructions.start_prefix);
    }
  }
  c.text(`${path}.notes`, input.notes, false, 1000);
  return c.done(input as unknown as JobVenueConfig);
}

// ── Job file (read back from disk: untrusted) ────────────────────────────────
export function checkJob(input: unknown): Checked<IngestionJob> {
  const c = new Check();
  const keys = ["schema_version", "job_id", "venue_id", "created_at", "status", "venue", "pack_version", "revision_note", "sources", "extraction_outputs", "evidence_ledger", "reviews", "draft_pack", "validation_result", "approval_state", "published_pack_version", "published_pack", "base_pack", "history"];
  if (!c.obj("$", input, keys)) return c.done(input as IngestionJob);
  c.schema("$.schema_version", input.schema_version);
  c.jobId("$.job_id", input.job_id);
  c.id("$.venue_id", input.venue_id, VENUE_ID_PATTERN);
  c.date("$.created_at", input.created_at);
  c.oneOf("$.status", input.status, JOB_STATUSES);
  const v = checkVenueConfig(input.venue, "$.venue");
  if (v.status === "failed") c.errors.push(...v.errors);
  else if (v.value.id !== input.venue_id) c.fail("$.venue.id", "must equal $.venue_id");
  c.num("$.pack_version", input.pack_version, { min: 1, integer: true });
  c.text("$.revision_note", input.revision_note, true, 300);
  if (input.sources != null) c.relPath("$.sources", input.sources);
  if (c.array("$.extraction_outputs", input.extraction_outputs)) input.extraction_outputs.forEach((p, i) => c.relPath(`$.extraction_outputs[${i}]`, p));
  c.relPath("$.evidence_ledger", input.evidence_ledger);
  if (c.array("$.reviews", input.reviews)) input.reviews.forEach((p, i) => c.relPath(`$.reviews[${i}]`, p));
  if (input.draft_pack != null) c.relPath("$.draft_pack", input.draft_pack);
  if (input.validation_result != null && c.obj("$.validation_result", input.validation_result, ["at", "status", "errors", "warnings"])) {
    c.date("$.validation_result.at", input.validation_result.at);
    c.oneOf("$.validation_result.status", input.validation_result.status, ["ok", "failed"] as const);
    if (c.array("$.validation_result.errors", input.validation_result.errors)) input.validation_result.errors.forEach((e, i) => { if (c.obj(`$.validation_result.errors[${i}]`, e, ["path", "message"])) { c.text(`$.validation_result.errors[${i}].path`, e.path, true, 300); c.text(`$.validation_result.errors[${i}].message`, e.message, true, 600); } });
    if (c.array("$.validation_result.warnings", input.validation_result.warnings)) input.validation_result.warnings.forEach((w, i) => c.text(`$.validation_result.warnings[${i}]`, w, true, 600));
  }
  if (input.approval_state != null && c.obj("$.approval_state", input.approval_state, ["decision", "reviewer", "at", "reason", "draft_sha256"])) {
    c.oneOf("$.approval_state.decision", input.approval_state.decision, ["approve", "reject"] as const);
    c.text("$.approval_state.reviewer", input.approval_state.reviewer, true, 120);
    c.date("$.approval_state.at", input.approval_state.at);
    c.text("$.approval_state.reason", input.approval_state.reason, true, 600);
    if (typeof input.approval_state.draft_sha256 !== "string" || !SHA256_RE.test(input.approval_state.draft_sha256)) c.fail("$.approval_state.draft_sha256", "must be a sha256 hex digest");
  }
  if (input.published_pack_version != null) c.num("$.published_pack_version", input.published_pack_version, { min: 1, integer: true });
  if (input.published_pack != null) c.relPath("$.published_pack", input.published_pack);
  if (input.base_pack != null) c.relPath("$.base_pack", input.base_pack);
  if (c.array("$.history", input.history)) input.history.forEach((h, i) => { if (c.obj(`$.history[${i}]`, h, ["at", "status", "note"])) { c.date(`$.history[${i}].at`, h.at); c.oneOf(`$.history[${i}].status`, h.status, JOB_STATUSES); c.text(`$.history[${i}].note`, h.note, true, 600); } });
  return c.done(input as unknown as IngestionJob);
}

// ── Source manifest ──────────────────────────────────────────────────────────
export function checkSourceManifest(input: unknown, jobId?: string): Checked<SourceManifest> {
  const c = new Check();
  if (!c.obj("$", input, ["schema_version", "job_id", "sources"])) return c.done(input as SourceManifest);
  c.schema("$.schema_version", input.schema_version);
  c.jobIdOptional("$.job_id", input.job_id, jobId);
  if (c.array("$.sources", input.sources)) {
    if (input.sources.length === 0) c.fail("$.sources", "at least one source is required");
    const ids: string[] = [];
    input.sources.forEach((s, i) => {
      const p = `$.sources[${i}]`;
      if (!c.obj(p, s, ["source_id", "type", "title", "origin", "acquired_at", "party", "rights", "checksum", "file", "image", "notes"])) return;
      if (c.id(`${p}.source_id`, s.source_id, SOURCE_ID_PATTERN)) ids.push(s.source_id);
      c.oneOf(`${p}.type`, s.type, SOURCE_TYPES);
      c.text(`${p}.title`, s.title, true, 200);
      c.text(`${p}.origin`, s.origin, true, 500);
      c.date(`${p}.acquired_at`, s.acquired_at);
      c.oneOf(`${p}.party`, s.party, SOURCE_PARTIES);
      if (c.obj(`${p}.rights`, s.rights, ["status", "note"])) { c.oneOf(`${p}.rights.status`, s.rights.status, RIGHTS_STATUSES); c.text(`${p}.rights.note`, s.rights.note, true, 400); }
      if (s.checksum != null && (typeof s.checksum !== "string" || !SHA256_RE.test(s.checksum))) c.fail(`${p}.checksum`, "must be a sha256 hex digest");
      if (s.file != null) {
        if (c.relPath(`${p}.file`, s.file) && !s.file.startsWith("raw/")) c.fail(`${p}.file`, 'stored artifacts must live under the job\'s "raw/" folder');
        if (s.checksum == null) c.fail(`${p}.checksum`, "required when a file is stored with the job");
      }
      if (s.image != null && c.obj(`${p}.image`, s.image, ["width_px", "height_px", "origin", "x_axis", "y_axis", "fit"])) {
        c.num(`${p}.image.width_px`, s.image.width_px, { min: 1, integer: true });
        c.num(`${p}.image.height_px`, s.image.height_px, { min: 1, integer: true });
        c.oneOf(`${p}.image.origin`, s.image.origin, ["top-left"] as const);
        c.oneOf(`${p}.image.x_axis`, s.image.x_axis, ["right"] as const);
        c.oneOf(`${p}.image.y_axis`, s.image.y_axis, ["down"] as const);
        c.oneOf(`${p}.image.fit`, s.image.fit, ["stretch", "pad-to-plane"] as const);
        if (s.type !== "official_map_image" && s.type !== "operator_provided_plan" && s.type !== "field_photo") c.fail(`${p}.image`, "only map-image, operator-plan or field-photo sources carry an image coordinate system");
      }
      c.text(`${p}.notes`, s.notes, false, 1000);
    });
    const seen = new Set<string>();
    ids.forEach((id, i) => { if (seen.has(id)) c.fail(`$.sources[${i}].source_id`, `duplicate source id "${id}"`); seen.add(id); });
  }
  return c.done(input as unknown as SourceManifest);
}

// ── Candidate extraction ─────────────────────────────────────────────────────
export function checkExtraction(input: unknown, jobId?: string, knownSources?: ReadonlySet<string>): Checked<CandidateExtraction> {
  const c = new Check();
  const lists = ["floors", "nodes", "unit_polygons", "store_labels", "corridor_centerlines", "edges", "instructions", "destinations", "anchors", "amenities", "facts"] as const;
  if (!c.obj("$", input, ["schema_version", "job_id", "worker", "source_ids", ...lists])) return c.done(input as CandidateExtraction);
  c.schema("$.schema_version", input.schema_version);
  c.jobIdOptional("$.job_id", input.job_id, jobId);
  if (c.obj("$.worker", input.worker, ["kind", "name", "version", "model"])) {
    c.oneOf("$.worker.kind", input.worker.kind, ["manual", "file", "ai"] as const);
    c.text("$.worker.name", input.worker.name, true, 120);
    c.text("$.worker.version", input.worker.version, false, 60);
    c.text("$.worker.model", input.worker.model, false, 120);
  }
  const sourceOk = (p: string, id: unknown) => { if (c.id(p, id, SOURCE_ID_PATTERN) && knownSources && !knownSources.has(id)) c.fail(p, `source "${id}" is not in the job's source manifest`); };
  if (c.array("$.source_ids", input.source_ids)) input.source_ids.forEach((s, i) => sourceOk(`$.source_ids[${i}]`, s));
  for (const l of lists) c.array(`$.${l}`, input[l]);
  if (c.errors.length) return c.done(input as unknown as CandidateExtraction);
  const each = (list: string, keys: readonly string[], fn: (p: string, v: Rec) => void) => {
    const ids: string[] = [];
    (input[list] as unknown[]).forEach((v, i) => {
      const p = `$.${list}[${i}]`;
      if (!c.obj(p, v, [...BASE_KEYS, ...keys])) return;
      c.candidateBase(p, v);
      sourceOk(`${p}.source_id`, v.source_id);
      if (typeof v.id === "string") ids.push(v.id);
      fn(p, v);
    });
    c.unique(`$.${list}`, ids, list.replace(/s$/, ""));
  };
  const isAi = (v: Rec) => v.evidence_class === "ai_inference";
  each("floors", ["label", "order", "aliases"], (p, v) => { c.text(`${p}.label`, v.label, true, 80); c.num(`${p}.order`, v.order, { integer: true }); c.aliases(`${p}.aliases`, v.aliases); });
  each("nodes", ["name", "kind", "floor", "at"], (p, v) => { c.text(`${p}.name`, v.name, true, 120); c.oneOf(`${p}.kind`, v.kind, NODE_KINDS); c.id(`${p}.floor`, v.floor, CANDIDATE_ID_PATTERN); c.point(`${p}.at`, v.at); });
  each("unit_polygons", ["floor", "label", "points"], (p, v) => { c.id(`${p}.floor`, v.floor, CANDIDATE_ID_PATTERN); c.text(`${p}.label`, v.label, false, 120); if (c.array(`${p}.points`, v.points)) { if (v.points.length < 3) c.fail(`${p}.points`, "a polygon needs at least 3 points"); v.points.forEach((pt, j) => c.point(`${p}.points[${j}]`, pt)); } });
  each("store_labels", ["text", "floor", "at", "unit"], (p, v) => { c.text(`${p}.text`, v.text, true, 120); c.id(`${p}.floor`, v.floor, CANDIDATE_ID_PATTERN); c.point(`${p}.at`, v.at); c.text(`${p}.unit`, v.unit, false, 40); });
  each("corridor_centerlines", ["floor", "points"], (p, v) => { c.id(`${p}.floor`, v.floor, CANDIDATE_ID_PATTERN); if (c.array(`${p}.points`, v.points)) { if (v.points.length < 2) c.fail(`${p}.points`, "a centerline needs at least 2 points"); v.points.forEach((pt, j) => c.point(`${p}.points[${j}]`, pt)); } });
  each("edges", ["from", "to", "bidirectional", "floor_change", "vertical_kind", "length_px"], (p, v) => {
    c.id(`${p}.from`, v.from, CANDIDATE_ID_PATTERN); c.id(`${p}.to`, v.to, CANDIDATE_ID_PATTERN);
    if (v.from === v.to) c.fail(`${p}.to`, "self-loop");
    c.bool(`${p}.bidirectional`, v.bidirectional, false); c.bool(`${p}.floor_change`, v.floor_change, false);
    c.oneOf(`${p}.vertical_kind`, v.vertical_kind, VERTICAL_KINDS, false);
    c.num(`${p}.length_px`, v.length_px, { min: 0.01, required: false });
  });
  each("instructions", ["edge", "direction", "text"], (p, v) => { c.id(`${p}.edge`, v.edge, CANDIDATE_ID_PATTERN); c.oneOf(`${p}.direction`, v.direction, ["forward", "reverse"] as const); c.text(`${p}.text`, v.text, true, 400); });
  each("destinations", ["name", "kind", "category", "arrival_node", "unit", "aliases"], (p, v) => {
    c.text(`${p}.name`, v.name, true, 120); c.oneOf(`${p}.kind`, v.kind, DESTINATION_KINDS); c.text(`${p}.category`, v.category, false, 60);
    c.id(`${p}.arrival_node`, v.arrival_node, CANDIDATE_ID_PATTERN); if (v.unit != null) c.text(`${p}.unit`, v.unit, false, 40); c.aliases(`${p}.aliases`, v.aliases);
  });
  each("anchors", ["node", "label", "kind", "start_permitted", "qr_eligible"], (p, v) => {
    c.id(`${p}.node`, v.node, CANDIDATE_ID_PATTERN); c.text(`${p}.label`, v.label, true, 120); c.oneOf(`${p}.kind`, v.kind, ANCHOR_KINDS);
    c.bool(`${p}.start_permitted`, v.start_permitted); c.bool(`${p}.qr_eligible`, v.qr_eligible, false);
  });
  each("amenities", ["kind", "name", "node", "routable", "aliases"], (p, v) => { c.oneOf(`${p}.kind`, v.kind, AMENITY_KINDS); c.text(`${p}.name`, v.name, true, 120); c.id(`${p}.node`, v.node, CANDIDATE_ID_PATTERN); c.bool(`${p}.routable`, v.routable); c.aliases(`${p}.aliases`, v.aliases); });
  each("facts", ["subject", "predicate", "value"], (p, v) => { c.text(`${p}.subject`, v.subject, true, 160); c.text(`${p}.predicate`, v.predicate, true, 60); c.factValue(`${p}.value`, v.value); });
  // An AI worker's candidates are inference by definition unless they carry a first-party class AND are flagged for review.
  if (isRec(input.worker) && input.worker.kind === "ai") {
    for (const l of lists) (input[l] as unknown[]).forEach((v, i) => {
      if (isRec(v) && !isAi(v) && !INFERENCE_CLASSES.includes(v.evidence_class as never) && v.manual_review_required !== true) c.fail(`$.${l}[${i}].manual_review_required`, "an AI worker may only submit non-inference classes with manual_review_required: true");
    });
  }
  return c.done(input as unknown as CandidateExtraction);
}

// ── Ledger (read back from disk: untrusted) ──────────────────────────────────
export function checkLedger(input: unknown, jobId?: string): Checked<EvidenceLedger> {
  const c = new Check();
  if (!c.obj("$", input, ["schema_version", "job_id", "facts"])) return c.done(input as EvidenceLedger);
  c.schema("$.schema_version", input.schema_version);
  c.jobId("$.job_id", input.job_id, jobId);
  if (c.array("$.facts", input.facts)) {
    const ids: string[] = [];
    input.facts.forEach((f, i) => {
      const p = `$.facts[${i}]`;
      if (!c.obj(p, f, ["fact_id", "subject", "predicate", "value", "source_id", "evidence_class", "confidence", "status", "proposed_by", "manual_review_required", "notes", "decision", "supersedes", "superseded_by"])) return;
      if (c.id(`${p}.fact_id`, f.fact_id, FACT_ID_PATTERN)) ids.push(f.fact_id);
      c.text(`${p}.subject`, f.subject, true, 160); c.text(`${p}.predicate`, f.predicate, true, 60); c.factValue(`${p}.value`, f.value);
      c.id(`${p}.source_id`, f.source_id, SOURCE_ID_PATTERN); c.oneOf(`${p}.evidence_class`, f.evidence_class, EVIDENCE_CLASSES);
      c.num(`${p}.confidence`, f.confidence, { min: 0, max: 1 }); c.oneOf(`${p}.status`, f.status, FACT_STATUSES);
      c.text(`${p}.proposed_by`, f.proposed_by, true, 200); c.bool(`${p}.manual_review_required`, f.manual_review_required); c.text(`${p}.notes`, f.notes, false, 600);
      if (f.decision != null && c.obj(`${p}.decision`, f.decision, ["by", "at", "action", "reason"])) { c.text(`${p}.decision.by`, f.decision.by, true, 120); c.date(`${p}.decision.at`, f.decision.at); c.oneOf(`${p}.decision.action`, f.decision.action, ["accept", "reject", "override", "unresolved"] as const); c.text(`${p}.decision.reason`, f.decision.reason, true, 600); }
      if (f.supersedes != null) c.id(`${p}.supersedes`, f.supersedes, FACT_ID_PATTERN);
      if (f.superseded_by != null) c.id(`${p}.superseded_by`, f.superseded_by, FACT_ID_PATTERN);
      // Invariant: an accepted inference-class fact must carry a human decision.
      if (f.status === "accepted" && INFERENCE_CLASSES.includes(f.evidence_class as never) && !isRec(f.decision)) c.fail(`${p}.status`, "an inference fact cannot be accepted without a recorded human decision");
    });
    const seen = new Set<string>();
    ids.forEach((id, i) => { if (seen.has(id)) c.fail(`$.facts[${i}].fact_id`, `duplicate fact id "${id}"`); seen.add(id); });
  }
  return c.done(input as unknown as EvidenceLedger);
}

// ── Review ───────────────────────────────────────────────────────────────────
export function checkReview(input: unknown, jobId?: string): Checked<ReviewInput> {
  const c = new Check();
  if (!c.obj("$", input, ["schema_version", "job_id", "reviewer", "reviewed_at", "accept", "reject", "override", "unresolved", "accept_all_of_class", "decision"])) return c.done(input as ReviewInput);
  c.schema("$.schema_version", input.schema_version);
  c.jobIdOptional("$.job_id", input.job_id, jobId);
  c.text("$.reviewer", input.reviewer, true, 120);
  c.date("$.reviewed_at", input.reviewed_at);
  const decisions = (key: string, reasonRequired: boolean) => {
    if (!c.array(`$.${key}`, input[key])) return;
    (input[key] as unknown[]).forEach((d, i) => { const p = `$.${key}[${i}]`; if (c.obj(p, d, ["fact_id", "reason"])) { c.id(`${p}.fact_id`, d.fact_id, FACT_ID_PATTERN); c.text(`${p}.reason`, d.reason, reasonRequired, 600); } });
  };
  decisions("accept", false); decisions("reject", true); decisions("unresolved", false);
  if (c.array("$.override", input.override)) input.override.forEach((o, i) => {
    const p = `$.override[${i}]`;
    if (!c.obj(p, o, ["fact_id", "value", "reason", "evidence_class", "source_id"])) return;
    c.id(`${p}.fact_id`, o.fact_id, FACT_ID_PATTERN); c.factValue(`${p}.value`, o.value); c.text(`${p}.reason`, o.reason, true, 600);
    c.oneOf(`${p}.evidence_class`, o.evidence_class, EVIDENCE_CLASSES, false); if (o.source_id != null) c.id(`${p}.source_id`, o.source_id, SOURCE_ID_PATTERN);
  });
  if (input.accept_all_of_class != null && c.array("$.accept_all_of_class", input.accept_all_of_class)) input.accept_all_of_class.forEach((k, i) => {
    if (c.oneOf(`$.accept_all_of_class[${i}]`, k, EVIDENCE_CLASSES) && INFERENCE_CLASSES.includes(k)) c.fail(`$.accept_all_of_class[${i}]`, `"${k}" is an inference class: inference is accepted only fact by fact, with a reason`);
  });
  if (input.decision != null && c.obj("$.decision", input.decision, ["action", "reason"])) { c.oneOf("$.decision.action", input.decision.action, ["approve", "reject"] as const); c.text("$.decision.reason", input.decision.reason, true, 600); }
  return c.done(input as unknown as ReviewInput);
}

// ── Field verification import ───────────────────────────────────────────────
export function checkFieldImport(input: unknown, jobId?: string): Checked<FieldImport> {
  const c = new Check();
  if (!c.obj("$", input, ["schema_version", "job_id", "observer", "observed_at", "source_id", "measurements", "node_confirmations", "door_confirmations", "accessibility"])) return c.done(input as FieldImport);
  c.schema("$.schema_version", input.schema_version);
  c.jobIdOptional("$.job_id", input.job_id, jobId);
  c.text("$.observer", input.observer, true, 120);
  c.date("$.observed_at", input.observed_at);
  c.id("$.source_id", input.source_id, SOURCE_ID_PATTERN);
  const list = (key: string, keys: readonly string[], fn: (p: string, v: Rec) => void) => {
    if (!c.array(`$.${key}`, input[key])) return;
    const ids: string[] = [];
    (input[key] as unknown[]).forEach((v, i) => { const p = `$.${key}[${i}]`; if (!c.obj(p, v, ["id", "notes", ...keys])) return; if (c.id(`${p}.id`, v.id, CANDIDATE_ID_PATTERN)) ids.push(v.id); c.text(`${p}.notes`, v.notes, false, 600); fn(p, v); });
    c.unique(`$.${key}`, ids, key);
  };
  list("measurements", ["edge", "distance_m", "method"], (p, v) => { c.id(`${p}.edge`, v.edge, CANDIDATE_ID_PATTERN); c.num(`${p}.distance_m`, v.distance_m, { min: 0.1, max: 5000 }); c.text(`${p}.method`, v.method, true, 120); });
  list("node_confirmations", ["node", "at"], (p, v) => { c.id(`${p}.node`, v.node, CANDIDATE_ID_PATTERN); if (v.at != null) c.point(`${p}.at`, v.at); });
  list("door_confirmations", ["destination"], (p, v) => c.id(`${p}.destination`, v.destination, CANDIDATE_ID_PATTERN));
  list("accessibility", ["subject", "step_free"], (p, v) => { c.text(`${p}.subject`, v.subject, true, 160); c.bool(`${p}.step_free`, v.step_free); });
  return c.done(input as unknown as FieldImport);
}

export function formatIssues(errors: Issue[]): string {
  return errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
}
