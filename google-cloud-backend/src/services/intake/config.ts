/**
 * Durable intake worker configuration.
 *
 * Every value comes from the environment (Cloud Run injects secrets from Secret
 * Manager). Nothing here is hardcoded, and no secret is ever logged or echoed.
 *
 * The worker fails CLOSED: it refuses to start unless the fixture-only boundary and
 * the bucket allowlist are explicitly configured.
 */

export interface IntakeWorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Buckets the worker may read. Empty is a startup error, never "allow all". */
  allowedBuckets: string[];
  /** When true, the worker only touches generated fixtures. Defaults to TRUE. */
  fixtureOnlyMode: boolean;
  /** Service accounts permitted to invoke /internal/*. Empty is a startup error. */
  allowedInvokers: string[];
  /** This service's own URL — the expected audience of an inbound ID token. */
  expectedAudience: string;
  leaseSeconds: number;
  chunkSize: number;
  /** Dev-only crash hook; ignored unless fixtureOnlyMode is on. */
  devCrashAfterChunk: number | null;
  logLevel: "info" | "debug";
}

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

const list = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * `true` unless explicitly set to the exact string "false". An unset, empty or
 * misspelled value keeps the restriction on — a typo must never silently open the
 * worker to non-fixture data.
 */
function fixtureOnlyFrom(raw: string | undefined): boolean {
  return raw !== "false";
}

function intFrom(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer in [${min}, ${max}].`);
  return n;
}

export function loadIntakeWorkerConfig(env: NodeJS.ProcessEnv): IntakeWorkerConfig {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new ConfigError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const allowedBuckets = list(env.INTAKE_ALLOWED_BUCKETS);
  if (allowedBuckets.length === 0) {
    throw new ConfigError("INTAKE_ALLOWED_BUCKETS is required — the worker refuses to run without a bucket allowlist.");
  }

  const fixtureOnlyMode = fixtureOnlyFrom(env.INTAKE_FIXTURE_ONLY_MODE);

  // Guard rail: a dev bucket naming convention, so a production bucket cannot be
  // allow-listed by accident while the worker is in its dev fixture posture.
  if (fixtureOnlyMode) {
    const nonDev = allowedBuckets.filter((b) => !/(^|-)dev(-|$)|fixture/.test(b));
    if (nonDev.length) {
      throw new ConfigError(`Fixture-only mode allows dev/fixture buckets only; refusing: ${nonDev.join(", ")}`);
    }
  }

  const allowedInvokers = list(env.INTAKE_ALLOWED_INVOKERS);
  if (allowedInvokers.length === 0) {
    throw new ConfigError("INTAKE_ALLOWED_INVOKERS is required — /internal/* must name its callers.");
  }

  const expectedAudience = env.INTAKE_WORKER_AUDIENCE ?? "";
  if (!expectedAudience) {
    throw new ConfigError("INTAKE_WORKER_AUDIENCE is required to validate inbound identity tokens.");
  }

  const devCrashRaw = env.INTAKE_DEV_CRASH_AFTER_CHUNK;
  let devCrashAfterChunk: number | null = null;
  if (devCrashRaw !== undefined && devCrashRaw !== "") {
    if (!fixtureOnlyMode) {
      throw new ConfigError("INTAKE_DEV_CRASH_AFTER_CHUNK is a fixture-only development hook and cannot be enabled outside fixture-only mode.");
    }
    devCrashAfterChunk = intFrom(devCrashRaw, 0, 0, 1_000_000, "INTAKE_DEV_CRASH_AFTER_CHUNK");
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    allowedBuckets,
    fixtureOnlyMode,
    allowedInvokers,
    expectedAudience,
    leaseSeconds: intFrom(env.INTAKE_LEASE_SECONDS, 60, 10, 3600, "INTAKE_LEASE_SECONDS"),
    chunkSize: intFrom(env.INTAKE_CHUNK_SIZE, 200, 1, 5000, "INTAKE_CHUNK_SIZE"),
    devCrashAfterChunk,
    logLevel: env.INTAKE_LOG_LEVEL === "debug" ? "debug" : "info",
  };
}

/** A log-safe view of the config — proves at startup what is on, leaks nothing. */
export function describeConfig(c: IntakeWorkerConfig): Record<string, unknown> {
  return {
    supabase_host: safeHost(c.supabaseUrl),          // host only, never the key
    allowed_buckets: c.allowedBuckets,
    fixture_only_mode: c.fixtureOnlyMode,
    allowed_invoker_count: c.allowedInvokers.length, // identities are not logged
    lease_seconds: c.leaseSeconds,
    chunk_size: c.chunkSize,
    dev_crash_after_chunk: c.devCrashAfterChunk,
  };
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return "[invalid-url]"; }
}
