/**
 * cli.ts — the Venue Pack Factory command set (bundled into scripts/venue/factory.mjs).
 *
 *   venue:new          open a job (venue identity + policies; optionally revising an existing pack)
 *   venue:sources      register the source manifest (files under raw/ are checksummed; PNGs header-checked)
 *   venue:extract      submit a candidate extraction (human- or AI-written JSON) → proposed facts
 *   venue:field-import submit field observations → proposed field_verified facts
 *   venue:review       apply a human review (accept / reject / override / unresolved / approve)
 *   venue:compile      deterministically compile accepted facts → validated draft pack
 *   venue:validate     re-run the app validator + publish checks on the draft (no approval needed)
 *   venue:publish      publish gate → published/<id>.v<N>.venue.json (--bundle copies into the app)
 *   venue:diff         change report (job vs its base pack, or --from/--to files)
 *   venue:status       print a job's state and ledger summary
 *
 * Every command returns an exit code and prints plain text. Nothing here executes, renders or
 * fetches anything from the artifacts it reads.
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import type { VenuePack } from "../contract";
import { validateVenuePack, formatVenueIssues } from "../validate";
import { bundledVenueIds } from "../registry";
import { FACTORY_SCHEMA_VERSION, type IngestionJob, type EvidenceLedger, type SourceEntry, type JobStatus, type ReviewInput } from "./types";
import { checkVenueConfig, checkSourceManifest, checkExtraction, checkLedger, checkReview, checkFieldImport, formatIssues, type Issue } from "./validateInputs";
import { factsFromExtraction, factsFromFieldImport, appendFacts, applyReview, ledgerSummary } from "./ledger";
import { compileDraft } from "./compile";
import { publishGate } from "./publish";
import { diffVenuePacks, formatDiff } from "./diff";
import {
  FactoryError, jobDir, safeJoin, sha256, stableJson, readJson, writeJson, pngDimensions, loadJob, saveJob, readJobJson, writeJobJson, readJobBytes,
  jobFileExists, copyIntoJob, listJobs, nextSeq,
} from "./jobStore";

export interface CliEnv {
  /** Factory jobs root (default venue-factory/jobs). */
  root: string;
  /** Repository root (for --bundle). */
  repoRoot: string;
  log: (line: string) => void;
  /** Clock for job history — injectable so tests and dry runs are reproducible. Never used by the compiler. */
  now: () => string;
}

function arg(argv: string[], name: string): string | undefined { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; }
function flag(argv: string[], name: string): boolean { return argv.includes(`--${name}`); }
function need(argv: string[], name: string): string { const v = arg(argv, name); if (!v) throw new FactoryError(`--${name} is required`); return v; }

const fmt = (errors: Issue[]) => formatIssues(errors);

function transition(job: IngestionJob, status: JobStatus, note: string, now: string): IngestionJob {
  return { ...job, status, history: [...job.history, { at: now, status, note }] };
}
/** Any change to evidence makes the draft, its validation and its approval stale. */
function invalidateDraft(job: IngestionJob): IngestionJob { return { ...job, draft_pack: null, validation_result: null, approval_state: null }; }

function readLedger(dir: string, job: IngestionJob): EvidenceLedger {
  const c = checkLedger(readJobJson(dir, job.evidence_ledger), job.job_id);
  if (c.status !== "ok") throw new FactoryError(`ledger is invalid:\n${fmt(c.errors)}`);
  return c.value;
}
function readSources(dir: string, job: IngestionJob): SourceEntry[] {
  if (!job.sources) return [];
  const c = checkSourceManifest(readJobJson(dir, job.sources), job.job_id);
  if (c.status !== "ok") throw new FactoryError(`source manifest is invalid:\n${fmt(c.errors)}`);
  return c.value.sources;
}
function readPack(abs: string): VenuePack {
  const v = validateVenuePack(readJson(abs));
  if (v.status !== "ok") throw new FactoryError(`${abs} is not a valid Venue Pack:\n${formatVenueIssues(v.errors)}`);
  return v.pack;
}
function readDraft(dir: string, job: IngestionJob): { pack: VenuePack; sha: string; text: string } {
  if (!job.draft_pack) throw new FactoryError("no draft compiled yet (run venue:compile)");
  const text = readJobBytes(dir, job.draft_pack).toString("utf8");
  const v = validateVenuePack(JSON.parse(text));
  if (v.status !== "ok") throw new FactoryError(`draft is not a valid Venue Pack:\n${formatVenueIssues(v.errors)}`);
  return { pack: v.pack, sha: sha256(text), text };
}

// ── commands ─────────────────────────────────────────────────────────────────
function cmdNew(argv: string[], env: CliEnv): number {
  const jobId = need(argv, "job");
  const cfg = checkVenueConfig(readJson(resolve(need(argv, "venue"))));
  if (cfg.status !== "ok") { env.log(`venue config is invalid:\n${fmt(cfg.errors)}`); return 1; }
  const dir = jobDir(env.root, jobId);
  if (existsSync(safeJoin(dir, "job.json"))) { env.log(`job "${jobId}" already exists`); return 1; }
  const now = env.now();
  let basePack: string | null = null, version = 1;
  const from = arg(argv, "from-pack");
  if (from) {
    const base = readPack(resolve(from));
    if (base.venue.id !== cfg.value.id) { env.log(`--from-pack is "${base.venue.id}" but the venue config is "${cfg.value.id}"`); return 1; }
    mkdirSync(dir, { recursive: true });
    basePack = writeJobJson(dir, `base/${base.venue.id}.v${base.venue.pack_version}.venue.json`, base);
    version = base.venue.pack_version + 1;
  }
  const job: IngestionJob = {
    schema_version: FACTORY_SCHEMA_VERSION, job_id: jobId, venue_id: cfg.value.id, created_at: now, status: "created", venue: cfg.value,
    pack_version: version, revision_note: arg(argv, "revision-note") ?? (from ? `Revision ${version} compiled by the Venue Pack Factory (job ${jobId}).` : `Initial pack compiled by the Venue Pack Factory (job ${jobId}).`),
    sources: null, extraction_outputs: [], evidence_ledger: "ledger.json", reviews: [], draft_pack: null, validation_result: null, approval_state: null,
    published_pack_version: null, published_pack: null, base_pack: basePack, history: [{ at: now, status: "created", note: from ? `revision job from ${basename(from)} (v${version - 1})` : "new venue job" }],
  };
  mkdirSync(safeJoin(dir, "raw"), { recursive: true });
  writeJobJson(dir, "ledger.json", { schema_version: FACTORY_SCHEMA_VERSION, job_id: jobId, facts: [] });
  saveJob(dir, job);
  env.log(`created job ${jobId} for venue ${cfg.value.id} (pack_version ${version}) at ${dir}`);
  return 0;
}

function cmdSources(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  const c = checkSourceManifest(readJson(resolve(need(argv, "manifest"))), job.job_id);
  if (c.status !== "ok") { env.log(`source manifest rejected:\n${fmt(c.errors)}`); return 1; }
  const errors: Issue[] = [];
  const manifest = c.value;
  const rawDir = arg(argv, "raw");
  manifest.sources.forEach((s, i) => {
    const p = `$.sources[${i}]`;
    if (s.file && rawDir) {
      const src = resolve(rawDir, s.file.replace(/^raw\//, ""));
      if (existsSync(src)) copyIntoJob(dir, s.file, src);
    }
    if (s.file) {
      if (!jobFileExists(dir, s.file)) { errors.push({ path: `${p}.file`, message: `${s.file} is not present in the job directory (copy the artifact under raw/ first)` }); return; }
      const bytes = readJobBytes(dir, s.file);
      const sum = sha256(bytes);
      if (s.checksum !== sum) errors.push({ path: `${p}.checksum`, message: `declared ${s.checksum} but the file is ${sum}` });
      if (s.image) {
        const dim = pngDimensions(bytes);
        if (!dim) errors.push({ path: `${p}.image`, message: `${s.file} is not a PNG (only PNG headers are read; nothing is decoded)` });
        else if (dim.width !== s.image.width_px || dim.height !== s.image.height_px) errors.push({ path: `${p}.image`, message: `declared ${s.image.width_px}×${s.image.height_px} but the PNG header says ${dim.width}×${dim.height}` });
      }
    } else if (s.image && (s.type === "official_map_image" || s.type === "operator_provided_plan")) {
      env.log(`note: ${s.source_id} declares an image coordinate system without a stored file — pixel coordinates will be normalised against the declared ${s.image.width_px}×${s.image.height_px} (unverified)`);
    }
    if (s.rights.status === "unknown" || s.rights.status === "restricted" || s.rights.status === "public_no_reuse") env.log(`rights: ${s.source_id} is "${s.rights.status}" — its artwork must not be bundled; only extracted facts may be used`);
  });
  if (errors.length) { env.log(`source manifest rejected:\n${fmt(errors)}`); return 1; }
  const rel = writeJobJson(dir, "sources.json", { ...manifest, job_id: job.job_id });
  saveJob(dir, transition({ ...job, sources: rel }, "sources_registered", `${manifest.sources.length} source(s) registered`, env.now()));
  env.log(`registered ${manifest.sources.length} source(s) for job ${job.job_id}`);
  return 0;
}

function cmdExtract(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  if (!job.sources) { env.log("register sources first (venue:sources)"); return 1; }
  const inputPath = resolve(need(argv, "input"));
  const sources = readSources(dir, job);
  const known = new Set(sources.map((s) => s.source_id));
  const c = checkExtraction(readJson(inputPath), job.job_id, known);
  if (c.status !== "ok") { env.log(`extraction rejected (shape):\n${fmt(c.errors)}`); return 1; }
  const name = (arg(argv, "name") ?? basename(inputPath, ".json")).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const rel = `extractions/${nextSeq(job.extraction_outputs)}-${name}.json`;
  const facts = factsFromExtraction(c.value, rel, new Map(sources.map((s) => [s.source_id, s])));
  if (facts.status !== "ok") { env.log(`extraction rejected (coordinates):\n${fmt(facts.errors)}`); return 1; }
  const ledger = readLedger(dir, job);
  const merged = appendFacts(ledger, facts.facts);
  if (merged.status !== "ok") { env.log(`extraction rejected (ledger):\n${fmt(merged.errors)}`); return 1; }
  writeJobJson(dir, rel, { ...c.value, job_id: job.job_id });
  writeJobJson(dir, job.evidence_ledger, merged.ledger);
  saveJob(dir, transition(invalidateDraft({ ...job, extraction_outputs: [...job.extraction_outputs, rel] }), "extracting", `${rel}: ${facts.facts.length} proposed fact(s) from ${c.value.worker.kind} worker "${c.value.worker.name}"`, env.now()));
  const review = facts.facts.filter((f) => f.manual_review_required).length;
  env.log(`accepted ${facts.facts.length} candidate(s) as PROPOSED facts (${review} flagged manual_review_required); nothing is truth until reviewed`);
  return 0;
}

function cmdFieldImport(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  if (!job.sources) { env.log("register sources first (venue:sources)"); return 1; }
  const inputPath = resolve(need(argv, "input"));
  const sources = readSources(dir, job);
  const c = checkFieldImport(readJson(inputPath), job.job_id);
  if (c.status !== "ok") { env.log(`field import rejected (shape):\n${fmt(c.errors)}`); return 1; }
  const rel = `extractions/${nextSeq(job.extraction_outputs)}-field-${basename(inputPath, ".json").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.json`;
  const facts = factsFromFieldImport(c.value, rel, new Map(sources.map((s) => [s.source_id, s])));
  if (facts.status !== "ok") { env.log(`field import rejected:\n${fmt(facts.errors)}`); return 1; }
  const merged = appendFacts(readLedger(dir, job), facts.facts);
  if (merged.status !== "ok") { env.log(`field import rejected (ledger):\n${fmt(merged.errors)}`); return 1; }
  writeJobJson(dir, rel, { ...c.value, job_id: job.job_id });
  writeJobJson(dir, job.evidence_ledger, merged.ledger);
  saveJob(dir, transition(invalidateDraft({ ...job, extraction_outputs: [...job.extraction_outputs, rel] }), "extracting", `${rel}: ${facts.facts.length} proposed field_verified fact(s) by ${c.value.observer}`, env.now()));
  env.log(`recorded ${facts.facts.length} field observation(s) as PROPOSED field_verified facts — review to accept`);
  return 0;
}

function cmdReview(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  const inputPath = resolve(need(argv, "review"));
  const c = checkReview(readJson(inputPath), job.job_id);
  if (c.status !== "ok") { env.log(`review rejected (shape):\n${fmt(c.errors)}`); return 1; }
  const review: ReviewInput = c.value;
  const ledger = readLedger(dir, job);
  const r = applyReview(ledger, review);
  if (r.status !== "ok") { env.log(`review rejected:\n${fmt(r.errors)}`); return 1; }
  for (const w of r.warnings) env.log(`warning: ${w}`);
  const rel = `reviews/${nextSeq(job.reviews)}-${basename(inputPath, ".json").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.json`;
  writeJobJson(dir, rel, { ...review, job_id: job.job_id });
  let next: IngestionJob = { ...job, reviews: [...job.reviews, rel] };
  const now = env.now();
  if (r.changed > 0 || r.added > 0) {
    writeJobJson(dir, job.evidence_ledger, r.ledger);
    next = transition(invalidateDraft(next), "extracting", `${rel}: ${r.changed} fact decision(s), ${r.added} override(s) by ${review.reviewer}`, now);
    env.log(`applied ${r.changed} decision(s) and ${r.added} override(s); the draft (if any) is stale — run venue:compile`);
  }
  if (review.decision) {
    if (r.changed > 0 || r.added > 0) { env.log("a job-level decision cannot accompany fact changes (the draft they produce has not been compiled yet); submit the decision in a second review"); saveJob(dir, next); return 1; }
    if (review.decision.action === "approve") {
      if (!next.draft_pack || next.validation_result?.status !== "ok") { env.log("cannot approve: no validated draft (run venue:compile first)"); saveJob(dir, next); return 1; }
      const { sha } = readDraft(dir, next);
      next = transition({ ...next, approval_state: { decision: "approve", reviewer: review.reviewer, at: review.reviewed_at, reason: review.decision.reason, draft_sha256: sha } }, "approved", `${rel}: approved by ${review.reviewer} — ${review.decision.reason}`, now);
      env.log(`draft approved by ${review.reviewer} (sha256 ${sha.slice(0, 12)}…) — run venue:publish`);
    } else {
      next = transition({ ...next, approval_state: { decision: "reject", reviewer: review.reviewer, at: review.reviewed_at, reason: review.decision.reason, draft_sha256: next.draft_pack ? readDraft(dir, next).sha : sha256("") } }, "rejected", `${rel}: rejected by ${review.reviewer} — ${review.decision.reason}`, now);
      env.log(`job rejected by ${review.reviewer}: ${review.decision.reason}`);
    }
  }
  saveJob(dir, next);
  const s = ledgerSummary(r.status === "ok" ? r.ledger : ledger);
  env.log(`ledger: ${s.accepted} accepted · ${s.proposed} proposed · ${s.rejected} rejected · ${s.superseded} superseded`);
  return 0;
}

function cmdCompile(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  const ledger = readLedger(dir, job);
  const sources = readSources(dir, job);
  const t0 = performance.now();
  const r = compileDraft(job, ledger, sources);
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  const now = env.now();
  if (r.status !== "ok") {
    const validation = { at: now, status: "failed" as const, errors: r.errors, warnings: [] };
    saveJob(dir, transition({ ...job, draft_pack: null, validation_result: validation, approval_state: null }, "validation_failed", `compile failed with ${r.errors.length} issue(s)`, now));
    env.log(`compile FAILED (${r.errors.length} issue(s), ${ms} ms):\n${fmt(r.errors)}`);
    return 1;
  }
  const rel = writeJobJson(dir, `draft/${job.venue_id}.draft.venue.json`, r.pack);
  const sha = sha256(readJobBytes(dir, rel));
  const validation = { at: now, status: "ok" as const, errors: [], warnings: r.warnings };
  let next = transition({ ...job, draft_pack: rel, validation_result: validation, approval_state: null }, "draft_ready", `draft compiled from ${r.stats.facts_used} accepted fact(s) (${r.stats.facts_ignored} not used) in ${ms} ms; sha256 ${sha}`, now);
  next = transition(next, "awaiting_review", "draft validated by the app validator; awaiting human approval", now);
  saveJob(dir, next);
  for (const w of r.warnings) env.log(`warning: ${w}`);
  env.log(`draft compiled → ${rel} (${r.pack.graph.nodes.length} nodes, ${r.pack.graph.edges.length} edges, ${r.pack.destinations.length} destinations, ${r.pack.anchors.length} anchors, ${r.pack.amenities.length} amenities, ${r.pack.connectors?.length ?? 0} connectors; evidence geometry=${r.pack.venue.evidence.geometry} measurement=${r.pack.venue.evidence.measurement} field_verification=${r.pack.venue.evidence.field_verification}) in ${ms} ms; sha256 ${sha.slice(0, 12)}…`);
  env.log("awaiting human approval (venue:review with decision.action = approve)");
  return 0;
}

function gateFor(dir: string, job: IngestionJob, replace: boolean) {
  const { pack, sha } = readDraft(dir, job);
  const base = job.base_pack ? readPack(safeJoin(dir, job.base_pack)) : null;
  return { pack, sha, base, result: publishGate({ job, draft: pack, draftSha256: sha, ledger: readLedger(dir, job), approval: job.approval_state, bundledIds: bundledVenueIds(), basePack: base, replace }) };
}

function cmdValidate(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  const g = gateFor(dir, job, flag(argv, "replace"));
  for (const w of g.result.warnings) env.log(`warning: ${w}`);
  const errors = g.result.status === "failed" ? g.result.errors.filter((e) => e.path !== "approval") : [];
  const approvalIssues = g.result.status === "failed" ? g.result.errors.filter((e) => e.path === "approval") : [];
  if (errors.length) { env.log(`draft FAILS the publish checks:\n${fmt(errors)}`); return 1; }
  env.log(`draft ${job.draft_pack} passes every publish check${approvalIssues.length ? ` except approval (${approvalIssues[0].message})` : " including approval"}`);
  return 0;
}

function cmdPublish(argv: string[], env: CliEnv): number {
  const { dir, job } = loadJob(env.root, need(argv, "job"));
  const replace = flag(argv, "replace");
  const g = gateFor(dir, job, replace);
  for (const w of g.result.warnings) env.log(`warning: ${w}`);
  if (g.result.status !== "ok") { env.log(`publish REFUSED:\n${fmt(g.result.errors)}`); return 1; }
  const rel = writeJobJson(dir, `published/${job.venue_id}.v${g.pack.venue.pack_version}.venue.json`, g.pack);
  const diff = diffVenuePacks(g.base, g.pack);
  writeJobJson(dir, `published/${job.venue_id}.v${g.pack.venue.pack_version}.diff.json`, diff);
  const now = env.now();
  saveJob(dir, transition({ ...job, published_pack: rel, published_pack_version: g.pack.venue.pack_version }, "published", `published ${rel} (sha256 ${g.sha})`, now));
  env.log(`published ${rel} (pack_version ${g.pack.venue.pack_version}, sha256 ${g.sha.slice(0, 12)}…)`);
  env.log(formatDiff(diff));
  if (flag(argv, "bundle")) {
    const packsDir = resolve(env.repoRoot, "src/venue/packs");
    const target = resolve(packsDir, `${job.venue_id}.venue.json`);
    if (!target.startsWith(packsDir)) throw new FactoryError("refusing to write outside src/venue/packs");
    if (existsSync(target) && !replace) { env.log(`NOT bundled: ${target} exists (pass --replace to overwrite the bundled pack)`); return 1; }
    mkdirSync(packsDir, { recursive: true });
    writeFileSync(target, stableJson(g.pack));
    const bundleFile = resolve(packsDir, "bundle.json");
    const bundle = readJson(bundleFile) as { _doc?: string; order: string[] };
    const entry = `${job.venue_id}.venue.json`;
    if (!bundle.order.includes(entry)) { bundle.order.push(entry); writeJson(bundleFile, bundle); }
    env.log(`bundled into ${target}${bundle.order.includes(entry) ? " and listed in bundle.json" : ""} — run npm run validate:venues`);
  } else {
    env.log("not registered into the app bundle (pass --bundle to copy it into src/venue/packs and list it in bundle.json)");
  }
  return 0;
}

function cmdDiff(argv: string[], env: CliEnv): number {
  const fromArg = arg(argv, "from"), toArg = arg(argv, "to");
  let from: VenuePack | null = null, to: VenuePack;
  if (toArg) { to = readPack(resolve(toArg)); from = fromArg ? readPack(resolve(fromArg)) : null; }
  else {
    const { dir, job } = loadJob(env.root, need(argv, "job"));
    to = readDraft(dir, job).pack;
    from = fromArg ? readPack(resolve(fromArg)) : job.base_pack ? readPack(safeJoin(dir, job.base_pack)) : null;
  }
  const d = diffVenuePacks(from, to);
  const out = arg(argv, "out");
  if (out) { const abs = resolve(out); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, stableJson(d)); env.log(`diff written to ${abs}`); }
  env.log(formatDiff(d));
  return 0;
}

function cmdStatus(argv: string[], env: CliEnv): number {
  const jobId = arg(argv, "job");
  if (!jobId) { const jobs = listJobs(env.root); env.log(jobs.length ? `jobs: ${jobs.join(", ")}` : `no jobs under ${resolve(env.root)}`); return 0; }
  const { dir, job } = loadJob(env.root, jobId);
  const s = ledgerSummary(readLedger(dir, job));
  env.log(`job ${job.job_id} · venue ${job.venue_id} · status ${job.status} · next pack_version ${job.pack_version}${job.base_pack ? ` (revises ${job.base_pack})` : ""}`);
  env.log(`sources ${job.sources ?? "none"} · extractions ${job.extraction_outputs.length} · reviews ${job.reviews.length} · draft ${job.draft_pack ?? "none"} · published ${job.published_pack ?? "none"}`);
  env.log(`ledger: ${s.accepted} accepted · ${s.proposed} proposed · ${s.rejected} rejected · ${s.superseded} superseded`);
  if (job.validation_result) env.log(`validation: ${job.validation_result.status}${job.validation_result.errors.length ? `\n${fmt(job.validation_result.errors)}` : ""}`);
  if (job.approval_state) env.log(`approval: ${job.approval_state.decision} by ${job.approval_state.reviewer} (${job.approval_state.reason})`);
  for (const h of job.history) env.log(`  ${h.at}  ${h.status.padEnd(18)} ${h.note}`);
  return 0;
}

const COMMANDS: Record<string, (argv: string[], env: CliEnv) => number> = {
  new: cmdNew, sources: cmdSources, extract: cmdExtract, "field-import": cmdFieldImport, review: cmdReview, compile: cmdCompile,
  validate: cmdValidate, publish: cmdPublish, diff: cmdDiff, status: cmdStatus,
};

export function runFactory(argv: string[], env: CliEnv): number {
  const [command, ...rest] = argv;
  const fn = command ? COMMANDS[command] : undefined;
  if (!fn) { env.log(`usage: factory <${Object.keys(COMMANDS).join("|")}> --job <id> [options]`); return 2; }
  try { return fn(rest, env); }
  catch (err) {
    if (err instanceof FactoryError) { env.log(`error: ${err.message}`); return 1; }
    throw err;
  }
}

/** For tests: read a pack file through the same guarded reader. */
export function readVenuePackFile(abs: string): VenuePack { return readPack(abs); }
