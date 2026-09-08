#!/usr/bin/env node
/**
 * mapping-validate.mjs — validate a governed ExternalRetailLocationMappingV1 file (2L-A).
 * Structural validation + per-mapping resolvability. No network, no DB, no credentials.
 * Exit non-zero only for a mapping-file-level structural failure (bad JSON / no array).
 *
 * Usage: node scripts/retail/mapping-validate.mjs --file docs/sprint-2l-a/example-location-mappings.json
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocationResolver, validateMapping } from "../../src/lib/retail/feed/locationMapping.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const i = process.argv.indexOf("--file");
const fileArg = i >= 0 ? process.argv[i + 1] : null;
if (!fileArg) { console.error("MAPPING FAILURE: usage: --file <mappings.json>"); process.exit(2); }

let doc;
try { doc = JSON.parse(readFileSync(resolve(REPO, fileArg), "utf8")); }
catch (e) { console.error(`MAPPING FAILURE: not valid JSON — ${e.message}`); process.exit(2); }
if (!Array.isArray(doc.mappings)) { console.error("MAPPING FAILURE: no 'mappings' array"); process.exit(2); }

const resolver = createLocationResolver(doc.mappings, { now: doc.resolver_now_utc });
const outcomeTally = {};
let structuralInvalid = 0;

console.log(`Mapping validation — ${basename(fileArg)} (now=${doc.resolver_now_utc})`);
console.log("=".repeat(66));
for (const m of doc.mappings) {
  const problems = validateMapping(m);
  if (problems.length) structuralInvalid++;
  const res = m.external_branch_id
    ? resolver.resolve({ retailer_source_id: m.retailer_source_id, external_branch_id: m.external_branch_id, at: doc.resolver_now_utc })
    : resolver.resolve({ retailer_source_id: m.retailer_source_id, external_branch_name: m.external_branch_name, at: doc.resolver_now_utc });
  outcomeTally[res.outcome] = (outcomeTally[res.outcome] ?? 0) + 1;
  console.log(`  ${String(m.mapping_id).padEnd(12)} ${String(m.status).padEnd(14)} branch=${String(m.external_branch_id ?? m.external_branch_name).padEnd(20)} → ${res.outcome}${problems.length ? "  [structural: " + problems.join("; ") + "]" : ""}`);
}
console.log("-".repeat(66));
console.log(`mappings: ${doc.mappings.length} | structurally invalid: ${structuralInvalid}`);
console.log(`resolution outcomes: ${JSON.stringify(outcomeTally)}`);
console.log(`database_write=false network_call=false publication=false`);
process.exit(0);
