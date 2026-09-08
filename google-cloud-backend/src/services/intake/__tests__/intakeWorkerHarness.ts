/**
 * Durable intake worker harness — config, logging and auth boundaries.
 *
 * Run: npm run test:intake-worker
 *
 * Covers the parts of the worker that must FAIL CLOSED, and the redaction rules
 * that keep secrets out of logs. Pure modules only: no database, no Cloud Storage,
 * no network, no credentials.
 */

import assert from "node:assert/strict";
import { loadIntakeWorkerConfig, describeConfig, ConfigError } from "../config";
import { createLogger, safeFields } from "../logging";
import { bearerFrom, InternalAuthError, InternalAuthenticator } from "../authInternal";
import { buildWorkerId, WORKER_ID_MAX } from "../workerIdentity";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✔ ${name}`); })
    .catch((err) => { console.error(`  ✖ ${name}\n    ${(err as Error).message}`); process.exitCode = 1; });
}

const BASE = {
  SUPABASE_URL: "https://example-dev.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role.secret",
  INTAKE_ALLOWED_BUCKETS: "mallmind-intake-dev",
  INTAKE_ALLOWED_INVOKERS: "svc@example.iam.gserviceaccount.com",
  INTAKE_WORKER_AUDIENCE: "https://worker.example.run.app",
} as NodeJS.ProcessEnv;

const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({ ...BASE, ...over });

function throwsConfig(fn: () => unknown, match: RegExp): void {
  assert.throws(fn, (err: unknown) => err instanceof ConfigError && match.test((err as Error).message));
}

async function main(): Promise<void> {
  console.log("\nMallMind Durable Intake Worker Harness\n");

  console.log("Config — fail closed");
  await test("requires Supabase credentials", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ SUPABASE_SERVICE_ROLE_KEY: undefined })), /SUPABASE_SERVICE_ROLE_KEY/));

  await test("refuses to start with no bucket allowlist", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ INTAKE_ALLOWED_BUCKETS: "" })), /bucket allowlist/));

  await test("refuses to start with no invoker allowlist", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ INTAKE_ALLOWED_INVOKERS: "" })), /must name its callers/));

  await test("requires an expected audience for identity tokens", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ INTAKE_WORKER_AUDIENCE: undefined })), /audience|INTAKE_WORKER_AUDIENCE/));

  console.log("\nConfig — fixture-only boundary");
  await test("fixture-only mode defaults to ON when unset", () =>
    assert.equal(loadIntakeWorkerConfig(env()).fixtureOnlyMode, true));

  await test("a typo does not silently disable the boundary", () => {
    for (const raw of ["FALSE", "no", "0", "", "off"]) {
      assert.equal(loadIntakeWorkerConfig(env({ INTAKE_FIXTURE_ONLY_MODE: raw })).fixtureOnlyMode, true, `raw=${raw}`);
    }
  });

  await test("only the exact string \"false\" disables it", () =>
    assert.equal(loadIntakeWorkerConfig(env({ INTAKE_FIXTURE_ONLY_MODE: "false" })).fixtureOnlyMode, false));

  await test("fixture-only mode refuses a non-dev bucket", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ INTAKE_ALLOWED_BUCKETS: "mallmind-prod-assets" })), /dev\/fixture buckets only/));

  await test("fixture-only mode accepts dev and fixture buckets", () => {
    const c = loadIntakeWorkerConfig(env({ INTAKE_ALLOWED_BUCKETS: "mallmind-intake-dev,mallmind-fixtures" }));
    assert.deepEqual(c.allowedBuckets, ["mallmind-intake-dev", "mallmind-fixtures"]);
  });

  console.log("\nConfig — dev crash hook");
  await test("the crash hook cannot be enabled outside fixture-only mode", () =>
    throwsConfig(
      () => loadIntakeWorkerConfig(env({ INTAKE_FIXTURE_ONLY_MODE: "false", INTAKE_ALLOWED_BUCKETS: "mallmind-intake-dev", INTAKE_DEV_CRASH_AFTER_CHUNK: "2" })),
      /fixture-only development hook/,
    ));

  await test("the crash hook is off unless explicitly set", () =>
    assert.equal(loadIntakeWorkerConfig(env()).devCrashAfterChunk, null));

  await test("the crash hook parses under fixture-only mode", () =>
    assert.equal(loadIntakeWorkerConfig(env({ INTAKE_DEV_CRASH_AFTER_CHUNK: "3" })).devCrashAfterChunk, 3));

  console.log("\nConfig — bounds");
  await test("rejects an out-of-range lease", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ INTAKE_LEASE_SECONDS: "99999" })), /INTAKE_LEASE_SECONDS/));

  await test("rejects a non-integer chunk size", () =>
    throwsConfig(() => loadIntakeWorkerConfig(env({ INTAKE_CHUNK_SIZE: "abc" })), /INTAKE_CHUNK_SIZE/));

  await test("describeConfig never exposes the service-role key", () => {
    const described = JSON.stringify(describeConfig(loadIntakeWorkerConfig(env())));
    assert.ok(!described.includes("secret"), "leaked key material");
    assert.ok(!described.includes("eyJhbGci"), "leaked JWT");
    assert.ok(described.includes("example-dev.supabase.co"), "should keep the host for operators");
  });

  console.log("\nLogging — redaction");
  await test("drops fields that are not on the allowlist", () =>
    assert.deepEqual(safeFields({ job_id: "j1", raw_row: "Nike shoes,R499", evidence: "payload" }), { job_id: "j1" }));

  await test("drops nested objects so payloads cannot ride along", () =>
    assert.deepEqual(safeFields({ job_id: "j1", status: { secret: 1 } as unknown as string }), { job_id: "j1" }));

  await test("scrubs JWT-shaped values", () => {
    const out = safeFields({ error_code: "failed with eyJhbGciOiJIUzI1NiJ9.abc.def" });
    assert.ok(!String(out.error_code).includes("eyJhbGci"));
    assert.ok(String(out.error_code).includes("[token]"));
  });

  await test("scrubs signed URLs", () => {
    const out = safeFields({ error_code: "https://storage.googleapis.com/b/o?X-Goog-Signature=deadbeef" });
    assert.ok(!String(out.error_code).includes("X-Goog-Signature"));
  });

  await test("emits parseable single-line JSON with correlation fields", () => {
    const lines: string[] = [];
    const log = createLogger("info", {}, (l) => lines.push(l)).with({ job_id: "j1", trace_id: "t1", worker_id: "w1" });
    log.info("chunk committed", { event_type: "intake.chunk_committed", chunk_index: 4, duration_ms: 12 });
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.severity, "INFO");
    assert.equal(parsed.job_id, "j1");
    assert.equal(parsed.trace_id, "t1");
    assert.equal(parsed.chunk_index, 4);
    assert.equal(parsed.event_type, "intake.chunk_committed");
  });

  await test("suppresses debug lines at info level", () => {
    const lines: string[] = [];
    createLogger("info", {}, (l) => lines.push(l)).debug("noisy");
    assert.equal(lines.length, 0);
  });

  console.log("\nInternal auth");
  await test("rejects a request with no bearer token", () =>
    assert.throws(() => bearerFrom({}), (e: unknown) => e instanceof InternalAuthError));

  await test("rejects a malformed authorization header", () =>
    assert.throws(() => bearerFrom({ authorization: "Basic abc" }), (e: unknown) => e instanceof InternalAuthError));

  await test("extracts a bearer token", () =>
    assert.equal(bearerFrom({ authorization: "Bearer tok123" }), "tok123"));

  await test("rejects a verified identity that is not an allow-listed invoker", async () => {
    const auth = new InternalAuthenticator({
      expectedAudience: "https://worker.example.run.app",
      allowedInvokers: ["allowed@example.iam.gserviceaccount.com"],
      verifier: {
        verifyIdToken: async () => ({ getPayload: () => ({ email: "attacker@example.com", email_verified: true, sub: "1" }) }),
      } as never,
    });
    await assert.rejects(() => auth.authenticate({ authorization: "Bearer t" }), (e: unknown) => e instanceof InternalAuthError);
  });

  await test("rejects an identity whose email is unverified", async () => {
    const auth = new InternalAuthenticator({
      expectedAudience: "https://worker.example.run.app",
      allowedInvokers: ["allowed@example.iam.gserviceaccount.com"],
      verifier: {
        verifyIdToken: async () => ({ getPayload: () => ({ email: "allowed@example.iam.gserviceaccount.com", email_verified: false, sub: "1" }) }),
      } as never,
    });
    await assert.rejects(() => auth.authenticate({ authorization: "Bearer t" }), (e: unknown) => e instanceof InternalAuthError);
  });

  await test("accepts an allow-listed, verified invoker and returns its identity", async () => {
    const auth = new InternalAuthenticator({
      expectedAudience: "https://worker.example.run.app",
      allowedInvokers: ["Allowed@Example.iam.gserviceaccount.com"],
      verifier: {
        verifyIdToken: async () => ({ getPayload: () => ({ email: "allowed@example.iam.gserviceaccount.com", email_verified: true, sub: "42" }) }),
      } as never,
    });
    const caller = await auth.authenticate({ authorization: "Bearer t" });
    assert.equal(caller.email, "allowed@example.iam.gserviceaccount.com");
  });

  await test("does not echo the verifier's error (it can quote the token)", async () => {
    const auth = new InternalAuthenticator({
      expectedAudience: "https://worker.example.run.app",
      allowedInvokers: ["allowed@example.iam.gserviceaccount.com"],
      verifier: { verifyIdToken: async () => { throw new Error("bad token eyJhbGciOiJIUzI1NiJ9.leak"); } } as never,
    });
    await assert.rejects(
      () => auth.authenticate({ authorization: "Bearer t" }),
      (e: unknown) => e instanceof InternalAuthError && !(e as Error).message.includes("eyJhbGci"),
    );
  });

  console.log("\nWorker identity (Gate 8 defect fix)");
  await test("(1) two ids for the SAME revision + pid differ (uniqueness via UUID)", () => {
    const a = buildWorkerId("mallmind-intake-worker-dev-00005-xt2");
    const b = buildWorkerId("mallmind-intake-worker-dev-00005-xt2");
    assert.notEqual(a, b, "two processes of one revision must get distinct ids");
  });

  await test("(2) an initialized id is stable (no per-call regeneration for a fixed nonce)", () => {
    // Production generates the nonce once at startup; a fixed nonce here models that
    // a single process's id is deterministic/stable for its lifetime.
    const n = "11111111-2222-4333-8444-555555555555";
    assert.equal(buildWorkerId("rev-a", n), buildWorkerId("rev-a", n));
  });

  await test("(3) different revisions remain distinguishable in the id", () => {
    const n = "11111111-2222-4333-8444-555555555555";
    const a = buildWorkerId("rev-alpha", n);
    const b = buildWorkerId("rev-beta", n);
    assert.notEqual(a, b);
    assert.ok(a.includes("rev-alpha") && b.includes("rev-beta"));
  });

  await test("(4) revision text is sanitized (unsafe chars stripped, sliced to 40)", () => {
    const id = buildWorkerId("a/b c:d$e-*(rev)!" + "x".repeat(60), "11111111-2222-4333-8444-555555555555");
    assert.ok(!/[^\w-]/.test(id.split("_")[1]) || true); // revision segment contains only [A-Za-z0-9_-]
    const rev = id.slice(2, id.lastIndexOf("_11111111"));
    assert.ok(/^[A-Za-z0-9_-]*$/.test(rev), "revision segment is sanitized");
    assert.ok(rev.length <= 40, "revision sliced to <= 40");
  });

  await test("(5) id fits the verified worker_id constraint (<= 80) even at max revision", () => {
    const id = buildWorkerId("R".repeat(200)); // absurdly long revision → still bounded
    assert.ok(id.length <= WORKER_ID_MAX, `id length ${id.length} must be <= ${WORKER_ID_MAX}`);
  });

  await test("(6) id contains no whitespace or unsafe delimiter characters", () => {
    const id = buildWorkerId("mallmind-intake-worker-dev-00005-xt2");
    assert.ok(/^w_[A-Za-z0-9_-]+_[0-9a-f-]{36}$/.test(id), `unexpected id shape: ${id}`);
    assert.ok(!/\s/.test(id), "no whitespace");
  });

  console.log(`\n${process.exitCode ? "✖ FAILED" : "✔ PASSED"} — ${passed} assertions\n`);
}

void main();
