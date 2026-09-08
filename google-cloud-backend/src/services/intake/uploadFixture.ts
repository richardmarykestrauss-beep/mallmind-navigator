/**
 * Generated fixture uploader (operator CLI).
 *
 *   npm run intake:fixture:upload -- --records 10000 --bucket mallmind-intake-dev --source-id <uuid>
 *   npm run intake:fixture:upload -- --records 1000 --dry-run
 *
 * Generates a DETERMINISTIC development fixture from the same `scaleRecords`
 * generator the Sprint 2C scale harness uses, uploads it to an allow-listed dev
 * bucket, and prints the `gs://bucket/object#generation` reference to hand to the
 * worker. The same --records value always produces byte-identical content and the
 * same input hash, so a re-upload is verifiable rather than a new mystery object.
 *
 * This tool contains NO retailer data and touches no retailer system: every row is
 * synthesised. The object is marked `fixture=true` and `no_retailer_data=true`, and
 * the worker refuses to read any object lacking that marker while in fixture-only
 * mode.
 *
 * Credentials: Application Default Credentials (`gcloud auth application-default
 * login`). There is no key file, no embedded JSON key, and no credential in source.
 */

import { Storage } from "@google-cloud/storage";
import { scaleRecords, expectedCounts, SCALE_FIXTURE_LABEL } from "@/lib/fabric/intake/scaleFixtures";
import { contentHash } from "@/lib/fabric/hash";
import { FIXTURE_HASH_METADATA_KEY, FIXTURE_MARKER_METADATA_KEY } from "./realGcsBackend";

/** Fixed base timestamp — determinism is the point; a clock read would break it. */
const FIXTURE_BASE_ISO = "2026-07-13T12:00:00.000Z";
const CONTENT_TYPE = "application/x-ndjson";
const SUPPORTED_SIZES = [100, 1_000, 10_000, 50_000];

interface Args { records: number; bucket: string; sourceId: string | null; dryRun: boolean; prefix: string; }

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const recordsRaw = get("records");
  const records = Number(recordsRaw);
  if (!recordsRaw || !Number.isInteger(records) || records < 1 || records > 200_000) {
    throw new Error("--records must be an integer in [1, 200000] (typical: 1000, 10000, 50000).");
  }

  const bucket = get("bucket") ?? process.env.INTAKE_FIXTURE_BUCKET ?? "";
  const dryRun = argv.includes("--dry-run");
  if (!bucket && !dryRun) throw new Error("--bucket (or INTAKE_FIXTURE_BUCKET) is required.");

  // A production bucket must never be reachable from a fixture tool, even by typo.
  if (bucket && !/(^|-)dev(-|$)|fixture/.test(bucket)) {
    throw new Error(`Refusing to upload to "${bucket}": the fixture uploader only writes to dev/fixture buckets.`);
  }
  if (bucket && !/^[a-z0-9][a-z0-9._-]{1,220}$/.test(bucket)) throw new Error("Invalid bucket name.");

  const prefix = get("prefix") ?? "fixtures";
  if (prefix.includes("..") || prefix.startsWith("/") || !/^[A-Za-z0-9._\-/]+$/.test(prefix)) {
    throw new Error("Invalid --prefix (no traversal, no absolute paths).");
  }

  const sourceId = get("source-id") ?? null;
  if (sourceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    throw new Error("--source-id must be a UUID.");
  }

  return { records, bucket, sourceId, dryRun, prefix };
}

/** Build the fixture body. Deterministic: same n → identical bytes → identical hash. */
async function buildFixture(records: number): Promise<string> {
  const lines: string[] = [];
  for await (const record of scaleRecords(records, FIXTURE_BASE_ISO)) {
    lines.push(JSON.stringify(record));
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!SUPPORTED_SIZES.includes(args.records)) {
    console.warn(`[warn] --records ${args.records} is outside the profiled sizes (${SUPPORTED_SIZES.join(", ")}).`);
  }

  console.log(`[fixture] generating ${args.records} synthetic records (${SCALE_FIXTURE_LABEL})`);
  const body = await buildFixture(args.records);
  const hash = contentHash(body);
  const bytes = Buffer.byteLength(body, "utf8");

  // The hash is in the object name, so a given fixture always lands at the same
  // path and a changed body cannot masquerade as an existing fixture.
  const object = `${args.prefix}/scale-${args.records}-${hash.replace(/[^a-z0-9]/gi, "").slice(0, 24)}.jsonl`;
  const counts = expectedCounts(args.records);

  console.log(`[fixture] bytes=${bytes} input_hash=${hash}`);
  console.log(`[fixture] expected category counts: ${JSON.stringify(counts)}`);

  if (args.dryRun) {
    console.log(`[fixture] --dry-run: nothing uploaded. Would write gs://${args.bucket || "<bucket>"}/${object}`);
    return;
  }

  const storage = new Storage();                      // ADC only
  const file = storage.bucket(args.bucket).file(object);

  await file.save(body, {
    contentType: CONTENT_TYPE,
    resumable: false,
    metadata: {
      contentType: CONTENT_TYPE,
      metadata: {
        [FIXTURE_MARKER_METADATA_KEY]: "true",
        [FIXTURE_HASH_METADATA_KEY]: hash,
        no_retailer_data: "true",
        record_count: String(args.records),
        generated_at: FIXTURE_BASE_ISO,
        generator: "scaleRecords",
      },
    },
  });

  const [meta] = await file.getMetadata();
  const generation = String(meta.generation ?? "");
  const ref = `gs://${args.bucket}/${object}#${generation}`;

  console.log(`\n[fixture] uploaded`);
  console.log(`  ref:        ${ref}`);           // a gs:// reference — never a signed URL
  console.log(`  input_hash: ${hash}`);
  console.log(`  records:    ${args.records}`);
  console.log(`  bytes:      ${bytes}`);
  console.log(`\nCreate the durable job with (requires an allow-listed invoker identity):`);
  console.log(`  POST /internal/intake/jobs`);
  console.log(`  ${JSON.stringify({ sourceId: args.sourceId ?? "<source-uuid>", inputRef: ref, inputHash: hash, inputContentType: CONTENT_TYPE, mode: "jsonl", isFixture: true, estimatedRows: args.records, totalBytes: bytes })}`);
}

main().catch((err: unknown) => {
  console.error(`[fixture] ${(err as Error).message}`);   // message only: never the raw client error
  process.exit(1);
});
