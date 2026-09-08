#!/usr/bin/env node
/**
 * feed-dry-run.mjs — RetailerFeedContractV1 local dry-run (Sprint 2K).
 *
 * Parses a retailer feed CSV, maps it via the example adapter, runs the importer, and
 * prints a coded summary + writes a deterministic report under artifacts/. It makes NO
 * network calls, uses NO hosted credentials, performs NO database writes, invokes NO
 * Cloud Run worker, and calls NO publication function. Exit code is non-zero only for a
 * FEED-LEVEL failure (unreadable file / no rows) — NOT merely because rows were quarantined.
 *
 * Usage: node scripts/retail/feed-dry-run.mjs --file docs/sprint-2k/example-retailer-authorised-feed.csv
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../../src/lib/retail/feed/csvParse.mjs";
import { mapRows, unrecognisedColumns, EXAMPLE_FEED_META } from "../../src/lib/retail/feed/exampleRetailerAdapter.mjs";
import { importFeed, djb2 } from "../../src/lib/retail/feed/feedImporter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");

const args = process.argv.slice(2);
const i = args.indexOf("--file");
const fileArg = i >= 0 ? args[i + 1] : null;
if (!fileArg) { console.error("FEED FAILURE: usage: --file <path.csv>"); process.exit(2); }

let text;
try { text = readFileSync(resolve(REPO, fileArg), "utf8"); }
catch { console.error(`FEED FAILURE: cannot read ${fileArg}`); process.exit(2); }

const feedHash = djb2(text);
const { headers, rows } = parseCsv(text);
if (rows.length === 0) { console.error("FEED FAILURE: no data rows"); process.exit(2); }

const fileName = basename(fileArg);
const records = mapRows(headers, rows, EXAMPLE_FEED_META, fileName);
const { summary, results } = importFeed(records, {
  branchMapping: {},              // no branch mapping in the default dry-run
  sourceFileName: fileName,
  unrecognisedColumns: unrecognisedColumns(headers),
});

// ── Console summary ───────────────────────────────────────────────────────────
console.log("RetailerFeedContractV1 dry-run");
console.log("=".repeat(60));
console.log(`file              : ${fileName}`);
console.log(`feed_hash         : ${feedHash}`);
console.log(`contract_version  : ${summary.contract_version}`);
console.log(`total_rows        : ${summary.total_rows}`);
console.log(`accepted          : ${summary.accepted}`);
console.log(`accepted_warnings : ${summary.accepted_with_warnings}`);
console.log(`quarantined       : ${summary.quarantined}`);
console.log(`duplicates        : ${summary.duplicates}`);
console.log(`warning_counts    : ${JSON.stringify(summary.warning_counts)}`);
console.log(`rejection_counts  : ${JSON.stringify(summary.rejection_counts)}`);
console.log("-".repeat(60));
for (const r of results) {
  const codes = [...r.rejection_codes, ...r.warning_codes].join(",") || "-";
  console.log(`  row ${String(r.source_row_number).padStart(2)}  ${r.outcome.padEnd(22)} ${(r.source_product_id ?? "(no-id)").padEnd(10)} ${codes}`);
}
console.log("-".repeat(60));
console.log(`publication_occurred    : ${summary.publication_occurred}`);
console.log(`database_write_occurred : ${summary.database_write_occurred}`);
console.log(`network_call_occurred   : ${summary.network_call_occurred}`);

// ── Deterministic report (artifacts/, gitignored) ─────────────────────────────
const outDir = resolve(REPO, "artifacts", "retail-feed");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `${fileName}.dry-run.json`);
writeFileSync(outPath, JSON.stringify({ file: fileName, feed_hash: feedHash, summary, results }, null, 2) + "\n");
console.log(`report            : artifacts/retail-feed/${fileName}.dry-run.json`);

// Feed was processed successfully → exit 0 even when individual rows were quarantined.
process.exit(0);
