#!/usr/bin/env node
/**
 * factory-dryrun.mjs — `npm run venue:dryrun -- <name>`: replays a recorded dry run
 * (venue-factory/dry-runs/<name>/dryrun.json) through the factory in a THROW-AWAY jobs root and
 * writes the reproducible outputs next to the inputs (output/): the compiled draft, the published
 * pack (published only inside the temp job — never into src/venue/packs), the ledger, the job
 * record and a diff against `compare_to`. Fixed clock → byte-identical output on every run.
 */
import process from "node:process";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { importTs } from "./bundle-ts.mjs";

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) { console.error("usage: factory-dryrun.mjs <dry-run name>"); process.exit(2); }
const D = resolve("venue-factory/dry-runs", name);
const spec = JSON.parse(readFileSync(join(D, "dryrun.json"), "utf8"));
const root = mkdtempSync(join(tmpdir(), "mallmind-dryrun-"));
const mod = await importTs("src/venue/factory/cli.ts");
const log = [];
const env = { root, repoRoot: process.cwd(), log: (l) => { log.push(l); console.log(l); }, now: () => "2026-09-13T15:00:00Z" };
const run = (...argv) => { const code = mod.runFactory(argv, env); if (code !== 0) { console.error(`dry run step failed: ${argv.join(" ")}`); rmSync(root, { recursive: true, force: true }); process.exit(1); } };
const J = spec.job_id;
run("new", "--job", J, "--venue", join(D, spec.venue));
run("sources", "--job", J, "--manifest", join(D, spec.sources), "--raw", join(D, "raw"));
for (const e of spec.extractions) run("extract", "--job", J, "--input", join(D, e));
for (const r of spec.reviews) run("review", "--job", J, "--review", join(D, r));
run("compile", "--job", J);
run("review", "--job", J, "--review", join(D, spec.approve));
run("publish", "--job", J, "--replace"); // --replace only lifts the "already bundled" rule; without --bundle nothing leaves the temp job
const out = join(D, "output");
mkdirSync(out, { recursive: true });
const jobDir = join(root, J);
const job = JSON.parse(readFileSync(join(jobDir, "job.json"), "utf8"));
copyFileSync(join(jobDir, job.published_pack), join(out, "published.venue.json"));
copyFileSync(join(jobDir, "ledger.json"), join(out, "ledger.json"));
copyFileSync(join(jobDir, "job.json"), join(out, "job.json"));
if (spec.compare_to && existsSync(resolve(spec.compare_to))) {
  run("diff", "--from", resolve(spec.compare_to), "--to", join(jobDir, job.published_pack), "--out", join(out, "diff-vs-production.json"));
}
writeFileSync(join(out, "run.log"), log.join("\n") + "\n");
console.log(`\ndry run "${name}" complete → ${out} (temp jobs root ${root} removed)`);
rmSync(root, { recursive: true, force: true });
