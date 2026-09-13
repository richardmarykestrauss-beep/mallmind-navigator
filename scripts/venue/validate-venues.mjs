#!/usr/bin/env node
/**
 * validate-venues.mjs — `npm run validate:venues`
 * Runs the SAME validator/registry/router the app uses against every bundled production Venue
 * Pack (see scripts/venue/bundle-ts.mjs). Exit code 1 on any issue; errors name the JSON path.
 */
import process from "node:process";
import { importTs } from "./bundle-ts.mjs";

const mod = await importTs("src/venue/cli.ts");
process.exit(mod.runValidateVenues());
