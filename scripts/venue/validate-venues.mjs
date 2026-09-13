#!/usr/bin/env node
/**
 * validate-venues.mjs — `npm run validate:venues`
 *
 * Runs the SAME validator the app uses (src/venue) against every bundled production Venue Pack.
 * The TypeScript is bundled on the fly with esbuild (already a dev dependency via Vite), so there
 * is exactly one validation implementation. Exit code 1 on any issue; errors name the JSON path.
 */

import { build } from "esbuild";
import { resolve } from "node:path";
import process from "node:process";

const result = await build({
  entryPoints: [resolve("src/venue/cli.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
  loader: { ".json": "json" },
});
const code = result.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
process.exit(mod.runValidateVenues());
