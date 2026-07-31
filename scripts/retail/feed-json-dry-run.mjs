#!/usr/bin/env node
/**
 * feed-json-dry-run.mjs — JSON retailer feed dry-run (Sprint 2L-A).
 * Reads a JSON feed (+ optional governed mappings) and runs the SAME importer as CSV.
 * No network, no DB, no credentials, no publication. Exit non-zero only for a feed-level
 * failure (unreadable/invalid JSON / bad shape). Individual quarantined rows do not fail it.
 *
 * Usage: node scripts/retail/feed-json-dry-run.mjs --file <feed.json> [--mappings <mappings.json>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFeed, validateFeedEnvelope } from "../../src/lib/retail/feed/jsonFeedReader.mjs";
import { mapKingdomFeed } from "../../src/lib/retail/feed/kingdomAdapter.mjs";
import { importFeed, djb2 } from "../../src/lib/retail/feed/feedImporter.mjs";
import { createLocationResolver, makeResolveBranch } from "../../src/lib/retail/feed/locationMapping.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const fileArg = arg("--file");
if (!fileArg) { console.error("FEED FAILURE: usage: --file <feed.json> [--mappings <mappings.json>]"); process.exit(2); }

let text;
try { text = readFileSync(resolve(REPO, fileArg), "utf8"); }
catch { console.error(`FEED FAILURE: cannot read ${fileArg}`); process.exit(2); }

const read = readJsonFeed(text);
if (!read.ok) { console.error(`FEED FAILURE: ${read.error} — ${read.message}`); process.exit(2); }
const envProblems = validateFeedEnvelope(read.envelope);
if (envProblems.length) { console.error(`FEED FAILURE: invalid feed envelope — ${envProblems.join("; ")}`); process.exit(2); }

let resolveBranch;
const mapArg = arg("--mappings");
if (mapArg) {
  const m = JSON.parse(readFileSync(resolve(REPO, mapArg), "utf8"));
  const resolver = createLocationResolver(m.mappings ?? [], { now: m.resolver_now_utc });
  resolveBranch = makeResolveBranch(resolver);
}

const fileName = basename(fileArg);
const records = mapKingdomFeed(read.envelope, read.products, fileName);
const { summary, results } = importFeed(records, { sourceFileName: fileName, resolveBranch });

console.log("Kingdom JSON feed dry-run" + (mapArg ? " (with governed mappings)" : " (no mappings)"));
console.log("=".repeat(60));
console.log(`file             : ${fileName}   feed_hash: ${djb2(text)}   contract: ${summary.contract_version}`);
console.log(`rows ${summary.total_rows} | accepted ${summary.accepted} | +warnings ${summary.accepted_with_warnings} | quarantined ${summary.quarantined} | duplicates ${summary.duplicates}`);
console.log(`warnings   : ${JSON.stringify(summary.warning_counts)}`);
console.log(`rejections : ${JSON.stringify(summary.rejection_counts)}`);
console.log("-".repeat(60));
for (const r of results) {
  const status = r.record ? (r.record.branch_mapping_status ?? "-") : "-";
  const codes = [...r.rejection_codes, ...r.warning_codes].join(",") || "-";
  console.log(`  row ${String(r.source_row_number).padStart(2)}  ${r.outcome.padEnd(22)} map:${String(status).padEnd(18)} ${codes}`);
}
console.log("-".repeat(60));
console.log(`publication_occurred=${summary.publication_occurred} database_write_occurred=${summary.database_write_occurred} network_call_occurred=${summary.network_call_occurred}`);

const outDir = resolve(REPO, "artifacts", "retail-feed");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, `${fileName}.dry-run.json`), JSON.stringify({ file: fileName, summary, results }, null, 2) + "\n");
process.exit(0);
