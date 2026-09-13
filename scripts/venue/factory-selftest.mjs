#!/usr/bin/env node
/**
 * factory-selftest.mjs — `npm run venue:selftest`: runs the synthetic Factory Test Centre through
 * the whole pipeline (sources → extraction → review → compile → approve → publish → field import →
 * revision → diff) in a throw-away jobs root and checks the outputs. Part of verify:all.
 * Nothing touches src/venue/packs. Exit 1 on any deviation.
 */
import process from "node:process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { importTs } from "./bundle-ts.mjs";

const F = resolve("venue-factory/fixtures/factory-test-centre");
const root = mkdtempSync(join(tmpdir(), "mallmind-factory-"));
const mod = await importTs("src/venue/factory/cli.ts");
const lines = [];
const env = { root, repoRoot: process.cwd(), log: (l) => { lines.push(l); console.log(l); }, now: () => "2026-09-13T12:00:00Z" };
const run = (...argv) => mod.runFactory(argv, env);
const expect = (cond, msg) => { if (!cond) { console.error(`SELFTEST FAILED: ${msg}`); rmSync(root, { recursive: true, force: true }); process.exit(1); } };

const t0 = performance.now();
expect(run("new", "--job", "ftc-v1", "--venue", join(F, "venue.json")) === 0, "new");
expect(run("sources", "--job", "ftc-v1", "--manifest", join(F, "sources.json"), "--raw", join(F, "raw")) === 0, "sources");
expect(run("extract", "--job", "ftc-v1", "--input", join(F, "extraction-manual.json")) === 0, "extract manual");
expect(run("extract", "--job", "ftc-v1", "--input", join(F, "extraction-ai.json")) === 0, "extract ai");
expect(run("publish", "--job", "ftc-v1") === 1, "publish must be refused before compile/approval");
expect(run("compile", "--job", "ftc-v1") === 1, "compile must fail while nothing is accepted");
expect(run("review", "--job", "ftc-v1", "--review", join(F, "review-1-facts.json")) === 0, "review 1");
expect(run("compile", "--job", "ftc-v1") === 0, "compile");
expect(run("publish", "--job", "ftc-v1") === 1, "publish must be refused without approval");
expect(run("review", "--job", "ftc-v1", "--review", join(F, "review-2-approve.json")) === 0, "approve");
expect(run("publish", "--job", "ftc-v1") === 0, "publish v1");
const v1 = join(root, "ftc-v1", "published", "factory-test-centre.v1.venue.json");
expect(existsSync(v1), "published v1 exists");
const pack1 = JSON.parse(readFileSync(v1, "utf8"));
expect(pack1.venue.pack_version === 1 && pack1.graph.edges.every((e) => e.evidence.measurement === "unmeasured"), "v1 is unmeasured");
expect(!pack1.graph.edges.some((e) => e.id === "ftc-shortcut-j2-cafe"), "rejected AI shortcut must not be compiled");

// Revision with field data
expect(run("new", "--job", "ftc-v2", "--venue", join(F, "venue.json"), "--from-pack", v1, "--revision-note", "Field survey: two legs measured, grocer door verified.") === 0, "new revision");
expect(run("sources", "--job", "ftc-v2", "--manifest", join(F, "sources.json"), "--raw", join(F, "raw")) === 0, "sources v2");
expect(run("extract", "--job", "ftc-v2", "--input", join(F, "extraction-manual.json")) === 0, "extract v2");
expect(run("extract", "--job", "ftc-v2", "--input", join(F, "extraction-ai.json")) === 0, "extract ai v2");
expect(run("review", "--job", "ftc-v2", "--review", join(F, "review-1-facts.json")) === 0, "review v2 base");
expect(run("field-import", "--job", "ftc-v2", "--input", join(F, "field-import.json")) === 0, "field import");
expect(run("compile", "--job", "ftc-v2") === 0, "compile v2 before field review (field facts still proposed)");
expect(run("review", "--job", "ftc-v2", "--review", join(F, "review-3-field.json")) === 0, "review field facts");
expect(run("compile", "--job", "ftc-v2") === 0, "compile v2");
expect(run("review", "--job", "ftc-v2", "--review", join(F, "review-2-approve.json")) === 0, "approve v2");
expect(run("publish", "--job", "ftc-v2") === 0, "publish v2");
const v2 = JSON.parse(readFileSync(join(root, "ftc-v2", "published", "factory-test-centre.v2.venue.json"), "utf8"));
expect(v2.venue.pack_version === 2, "v2 version");
const measured = v2.graph.edges.filter((e) => e.evidence.measurement === "measured").map((e) => e.id).sort();
expect(JSON.stringify(measured) === JSON.stringify(["ftc-e-j1-grocer", "ftc-e-west-j1"]), `v2 measured edges: ${measured.join(",")}`);
expect(v2.destinations.find((d) => d.id === "ftc-grocer").evidence.arrival === "verified_public_door", "grocer door verified in v2");
expect(v2.venue.evidence.field_verification === "partial", "v2 field_verification partial");
const diff = JSON.parse(readFileSync(join(root, "ftc-v2", "published", "factory-test-centre.v2.diff.json"), "utf8"));
expect(diff.edges.measured.length === 2 && diff.destinations.arrival_changed.length === 1, "diff reports measurements and arrival upgrade");
console.log(`\nfactory selftest passed in ${Math.round(performance.now() - t0)} ms (jobs root ${root} removed)`);
rmSync(root, { recursive: true, force: true });
