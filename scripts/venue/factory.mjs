#!/usr/bin/env node
/**
 * factory.mjs — the Venue Pack Factory CLI (npm run venue:<command> -- --job <id> …).
 * Runs src/venue/factory/cli.ts through the same esbuild bundling as validate:venues, so the
 * factory executes the SAME validator, registry, loader and router the app ships.
 *
 *   npm run venue:new          -- --job <id> --venue venue.json [--from-pack src/venue/packs/<id>.venue.json] [--revision-note "…"]
 *   npm run venue:sources      -- --job <id> --manifest sources.json [--raw <dir with the declared files>]
 *   npm run venue:extract      -- --job <id> --input extraction.json [--name <label>]
 *   npm run venue:field-import -- --job <id> --input field.json
 *   npm run venue:review       -- --job <id> --review review.json
 *   npm run venue:compile      -- --job <id>
 *   npm run venue:validate     -- --job <id>
 *   npm run venue:publish      -- --job <id> [--bundle] [--replace]
 *   npm run venue:diff         -- --job <id> [--from pack.json] [--out diff.json]   |   --from a.json --to b.json
 *   npm run venue:status       -- [--job <id>]
 *
 * Jobs root: venue-factory/jobs (override with VENUE_FACTORY_ROOT). Clock for job history:
 * VENUE_FACTORY_NOW (ISO) for reproducible runs; the compiler itself never reads a clock.
 */
import process from "node:process";
import { resolve } from "node:path";
import { importTs } from "./bundle-ts.mjs";

const mod = await importTs("src/venue/factory/cli.ts");
const fixedNow = process.env.VENUE_FACTORY_NOW;
const code = mod.runFactory(process.argv.slice(2), {
  root: resolve(process.env.VENUE_FACTORY_ROOT ?? "venue-factory/jobs"),
  repoRoot: process.cwd(),
  log: (line) => console.log(line),
  now: () => fixedNow ?? new Date().toISOString(),
});
process.exit(code);
