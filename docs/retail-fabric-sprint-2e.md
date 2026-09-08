# Sprint 2E — Real Durable Adapter + Dev Cloud Run Worker

**Status: CODE COMPLETE — NOTHING DEPLOYED, NOTHING APPLIED.**

This sprint makes the durable intake path real: a `PostgresDurableIntakeStore` on
actual Supabase RPCs, a real Cloud Storage reader, and a private Cloud Run worker
with service-to-service auth. Every infrastructure action is written down here and
**deliberately not executed** — see [Deployment gate](#deployment-gate).

---

## READY TO APPLY vs ACTUALLY APPLIED

| Action | Ready to apply | Actually applied |
| --- | --- | --- |
| Migration 034 → dev Supabase | ✅ written + rollback | ❌ **not applied** |
| Dev bucket created | ✅ commands below | ❌ **not created** |
| Worker service account | ✅ commands below | ❌ **not created** |
| IAM bindings | ✅ commands below | ❌ **not bound** |
| Worker image built/pushed | ✅ `Dockerfile.worker` | ❌ **not built** |
| Cloud Run worker deployed | ✅ commands below | ❌ **not deployed** |
| Fixtures uploaded | ✅ CLI works (dry-run verified) | ❌ **not uploaded** |
| Live dev smoke test | ✅ script below | ❌ **not run** |
| Crash/reclaim test on real infra | ✅ hook + script | ❌ **not run** |
| Real latency / throughput numbers | — | ❌ **not measured** |

Everything in the right column requires explicit approval. No live numbers appear
in this document, because none were measured. What *is* verified locally:

| Gate | Result |
| --- | --- |
| `npm test` (frontend) | **212 passed**, 1 skipped |
| `npm run build` (frontend) | ✅ |
| `npx tsc -p tsconfig.app.json` | 11 errors — the **pre-existing baseline**, unchanged |
| `npm run build` (backend API service) | ✅ unaffected |
| `npm run typecheck:worker` | ✅ 0 errors |
| `npm run test:intake-worker` | ✅ 28 assertions |
| `npm run build:worker` | ✅ 72 kB bundle |
| `npm run verify:all` | ✅ **12/12 steps** |
| CI "Rebuild and verify database" | applies 000–034 from scratch |

---

## What was built

### 1. `PostgresDurableIntakeStore` (`src/lib/fabric/intake/durable/postgresStore.ts`)

Implements the **same** `DurableIntakeStore` contract as the Sprint 2D in-memory
store, so the worker orchestration is unchanged and the 18 Sprint-2D durable tests
still pass untouched.

Two decisions worth stating plainly:

- **It does not import `@supabase/supabase-js`.** It talks to an injected
  `PostgresGateway` port. That keeps the store pure (no client, no `process.env`, no
  secrets), lets 28 tests cover it with no database, and confines the service-role
  key to one backend adapter that can never reach the browser bundle.
- **It never emulates a transaction.** Claim, chunk commit, finalize and fail are
  each exactly one RPC; Postgres owns atomicity. A test asserts a chunk commit is a
  single RPC call.

Errors are classified — `stale_worker` (abort, don't retry), transient (SQLSTATE
`08/40/53/57/58` or network-shaped → bounded retry), permanent — and scrubbed of
JWTs, URLs and `gs://` refs before leaving the module. Reads are paged
(1 000/page) with a hard 500 000-row ceiling.

The store contract widened from `T` to `Awaitable<T>` so an async store satisfies
it while concrete `InMemoryDurableStore` callers stay synchronous.

### 2. Migration 034 — additive, and it closes two real gaps

033 shipped the durable tables but was **insufficient** for a real store, and
reviewing it surfaced two silent correctness holes:

| Gap in 033 | Consequence | Fix in 034 |
| --- | --- | --- |
| No product-index table | 033 persisted dedup keys but not the `(product, source-category) → price` index. The worker's cross-chunk conflict detection lived only in the process's memory, so a **resumed job silently missed conflicts**. | `retail_intake_product_index`, written inside the same chunk-commit transaction |
| No staged-draft table | 033 counted `staged_drafts` but never recorded *which* drafts, so review could not trace a draft to the job/chunk that staged it. | `retail_intake_job_drafts` |

Also added: `is_fixture` + `trace_id` columns, an identity index, and five
`service_role`-only `SECURITY DEFINER` RPCs (`create_intake_job`,
`claim_intake_job`, `finalize_intake_job`, `fail_intake_job`,
`intake_job_reconciliation`). `commit_intake_chunk` is `CREATE OR REPLACE`d with an
identical signature and return shape, plus the two bounded inserts — so commit stays
all-or-nothing and idempotent on `(job_id, chunk_index)`.

`create_intake_job` enforces the fixture boundary **in the database**, with the
exact operator wording:

> `Durable worker is currently restricted to generated development fixtures.`

Rollback: `supabase/rollback/034_retail_intake_durable_rpcs_rollback.sql`. It is
outside `migrations/` on purpose — a `033_*_rollback.sql` sharing a version prefix
broke CI's `schema_migrations` primary key in Sprint 2D.

### 3. Fixture-only boundary — four independent layers

It fails closed at each one, so no single mistake opens it:

1. **Config** — `INTAKE_FIXTURE_ONLY_MODE` defaults to ON; only the exact string
   `"false"` disables it. `"FALSE"`, `"no"`, `"0"`, `"off"` all keep it ON (tested):
   a typo must never open the boundary.
2. **Bucket allowlist** — no allowlist → the worker refuses to start. In
   fixture-only mode a non-dev/non-fixture bucket name is refused outright.
3. **Store** — `createJob` refuses a non-fixture job *before* any wire call.
4. **Object** — `RealGcsBackend.head` refuses any object lacking
   `fixture=true` custom metadata.

### 4. Worker service (`google-cloud-backend/src/worker.ts`)

A **separate** Cloud Run service from `mallmind-backend-dev`, from its own image.
The existing `Dockerfile` and API service are untouched.

- `GET /health` — unauthenticated, liveness + posture only.
- `POST/GET /internal/intake/*` — create, claim-next, run, pause/resume/cancel,
  job, events, reconciliation.
- **`requested_by` is grounded in the authenticated caller**, never in request JSON.
- **No `cors()` at all.** CORS is a browser convention, not authentication, and this
  service is only ever called service-to-service.
- Cloud Run IAM is the first gate; `authInternal` independently verifies a
  Google-signed ID token (audience + verified email + explicit invoker allowlist) so
  the worker is not defenceless if that binding is ever loosened.

### 5. Real Cloud Storage (`realGcsBackend.ts`)

Implements the `GcsBackend` port, so every check `GcsInputStore` already enforced
(allowlist, traversal, generation, size, hash) still applies — this only does the
I/O. ADC only: no embedded JSON key, no key file, no credential in source or env.
Reads are **streamed** and pinned to an exact generation, so an object replaced
mid-job fails the read instead of silently mixing two versions into one job's
counters. There is **no `put()`** — the worker never needs object-create permission.

> **Why object metadata carries the hash:** GCS's `md5Hash`/`crc32c` are different
> algorithms from the fabric's `contentHash`, so they cannot answer "is this the
> object the job was created against?". The uploader writes the fabric hash into
> custom metadata; the worker compares against it. That also binds the object to our
> uploader rather than to whatever else wrote the bucket.

### 6. Fixture uploader

```bash
npm run intake:fixture:upload -- --records 10000 --bucket mallmind-intake-dev --dry-run
npm run intake:fixture:upload -- --records 10000 --bucket mallmind-intake-dev
```

Generated from the **same** `scaleRecords` generator as the Sprint 2C scale harness,
so 1k/10k/50k are byte-identical run to run (verified: identical `input_hash` across
runs) and the hash is in the object name. Marks `fixture=true` and
`no_retailer_data=true`; prints a `gs://…#generation` ref, never a signed URL.
Refuses non-dev buckets, path traversal and out-of-range sizes.

It is bundled with esbuild rather than run through ts-node, because the fabric is ESM
under the root `package.json` and CJS ts-node fails on it with `ERR_REQUIRE_ESM`.

### 7. Observability (`logging.ts`)

Single-line JSON with `severity` for Cloud Logging, carrying `trace_id`, `job_id`,
`worker_id`, `chunk_index`, `event_type`, `duration_ms`, row counts, lease state,
retry count and a sanitized `error_code`.

Fields are **allow-listed by key**: anything not on the list is dropped, nested
objects are dropped, and values are scrubbed for JWTs and signed URLs. Raw rows,
evidence payloads, tokens and object contents are undroppable **by construction
rather than by discipline** — a caller cannot widen what gets logged by accident.

A counter mismatch (`reconciles: false`) is logged at ERROR as a **blocker**. It is
never downgraded to a warning.

### 8. Dashboard (`devDurableWorkerSection.tsx`)

The browser holds **no service-role key** and cannot reach the private worker. It
calls `/admin/intake/*` on the API service, which re-checks `profiles.is_admin`
server-side (the same pattern as `retailObservationsAdmin`) and forwards to the
worker with the API service's own Google identity. The admin's identity gates the
call; the service's identity authorises the hop.

`adminIntakeProxy.ts` imports **no fabric code**, so the API service's build
(`rootDir: "src"`) and image are unaffected. It is not a general proxy: only named
job paths and four control actions are reachable.

Until the worker is deployed, the panel renders an explicit **"Not configured"**
state with disabled controls — an honest empty state, not a dead button. Labels:
"Dev durable worker" / "Generated fixture — no retailer data".

### 9. Build plumbing — why the worker has its own everything

The API service pins `rootDir: "src"` and its Dockerfile copies only its own
sources, so it **cannot** see `../src/lib/fabric`. Rather than loosen the API
service's build, the worker gets:

- `tsconfig.worker.json` (typecheck only; `@/*` → `../src/*`, meaning the fabric —
  backend-local modules use relative imports so the two never blur);
- an esbuild bundle (`build:worker`);
- `Dockerfile.worker` with a **repo-root build context**;
- worker sources **excluded** from the main backend `tsconfig.json`.

`verify:all` gained the worker typecheck, harness and bundle — without the dedicated
typecheck, nothing would catch a cross-tree type error.

One fabric change was required: `parsers.ts` now uses
`InstanceType<typeof TextDecoder>` rather than `TextDecoder`, because the DOM lib
declares `TextDecoder` as both a type and a value but Node's lib declares only the
value, and that module now compiles for both the browser bundle and the worker.

---

## Deployment gate

**None of the following has been run.** They are documented for review and require
explicit approval. Replace every placeholder; no project id is hardcoded anywhere in
this repo.

```bash
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=africa-south1                    # matches the existing backend
export BUCKET=mallmind-intake-dev
export WORKER=mallmind-intake-worker-dev
export WORKER_SA=intake-worker-dev@${PROJECT_ID}.iam.gserviceaccount.com
export API_SA=<the mallmind-backend-dev runtime service account>
```

### Step 1 — migration (dev Supabase only)

```bash
# Check what is applied BEFORE touching anything
supabase migration list --linked

# Apply (additive; no destructive change; no data backfill)
supabase db push --linked

# Verify the contract landed
supabase db execute --linked --sql "
  select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and proname in
   ('create_intake_job','claim_intake_job','finalize_intake_job','fail_intake_job','intake_job_reconciliation');
  select to_regclass('public.retail_intake_product_index'), to_regclass('public.retail_intake_job_drafts');"

# PostgREST caches the schema; new RPCs 404 until it reloads
supabase db execute --linked --sql "notify pgrst, 'reload schema';"

# Rollback if needed
supabase db execute --linked --file supabase/rollback/034_retail_intake_durable_rpcs_rollback.sql
```

### Step 2 — bucket (dev, private, no public access)

```bash
gcloud storage buckets create gs://${BUCKET} \
  --project=${PROJECT_ID} --location=${REGION} \
  --uniform-bucket-level-access --public-access-prevention
```

### Step 3 — service account + least-privilege IAM

```bash
gcloud iam service-accounts create intake-worker-dev \
  --project=${PROJECT_ID} --display-name="MallMind durable intake worker (dev)"

# Read ONLY the dev bucket — objectViewer, bucket-scoped. Not Storage Admin,
# not project-scoped. The worker never writes objects.
gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member="serviceAccount:${WORKER_SA}" --role="roles/storage.objectViewer"

# ONE secret each, secret-scoped. Not project-wide secret access.
gcloud secrets add-iam-policy-binding supabase-url \
  --member="serviceAccount:${WORKER_SA}" --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}
gcloud secrets add-iam-policy-binding supabase-service-role-key \
  --member="serviceAccount:${WORKER_SA}" --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}

# Only the API service may invoke the worker. NOT allUsers.
gcloud run services add-iam-policy-binding ${WORKER} \
  --member="serviceAccount:${API_SA}" --role="roles/run.invoker" \
  --region=${REGION} --project=${PROJECT_ID}
```

**Not granted, deliberately:** Owner, Editor, Storage Admin, project-level secret
access, `allUsers` invoker.

**Removal / rollback of IAM:** swap `add-iam-policy-binding` for
`remove-iam-policy-binding` in reverse order, then
`gcloud run services delete ${WORKER} --region=${REGION}`,
`gcloud iam service-accounts delete ${WORKER_SA}`, and finally
`gcloud storage rm -r gs://${BUCKET}`. Deleting the worker service is enough to stop
all durable activity; the dashboard degrades to its "Not configured" state.

### Step 4 — build + deploy (private)

```bash
# Build context is the REPO ROOT so the image can reach src/lib/fabric
gcloud builds submit . \
  --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/mallmind/${WORKER} \
  --project=${PROJECT_ID}
# (Dockerfile.worker; e.g. via cloudbuild config or --config, not the default Dockerfile)

gcloud run deploy ${WORKER} \
  --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/mallmind/${WORKER} \
  --region=${REGION} --project=${PROJECT_ID} \
  --service-account=${WORKER_SA} \
  --no-allow-unauthenticated \
  --ingress=internal \
  --min-instances=0 --max-instances=2 \
  --set-secrets=SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest \
  --set-env-vars=INTAKE_FIXTURE_ONLY_MODE=true,INTAKE_ALLOWED_BUCKETS=${BUCKET},INTAKE_ALLOWED_INVOKERS=${API_SA},INTAKE_WORKER_AUDIENCE=<worker-url-after-first-deploy>

# INTAKE_WORKER_AUDIENCE is the service's own URL, which only exists after the first
# deploy — deploy once, read the URL, then re-deploy with it set.

# Point the API service at the worker
gcloud run services update mallmind-backend-dev --region=${REGION} \
  --set-env-vars=INTAKE_WORKER_URL=<worker-url>
```

### Step 5 — smoke test (generated fixtures only)

```bash
# 1. Upload a fixture
npm run intake:fixture:upload -- --records 10000 --bucket ${BUCKET}
# → gs://…#generation + input_hash

# 2. Create + run the job (as the API service identity; the worker is private)
TOKEN=$(gcloud auth print-identity-token --audiences=<worker-url>)
curl -sS -X POST <worker-url>/internal/intake/jobs \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"sourceId":"<uuid>","inputRef":"gs://…#gen","inputHash":"…","inputContentType":"application/x-ndjson","mode":"jsonl","isFixture":true}'

curl -sS -X POST <worker-url>/internal/intake/jobs/<job-id>/run -H "Authorization: Bearer ${TOKEN}"
curl -sS <worker-url>/internal/intake/jobs/<job-id>/reconciliation -H "Authorization: Bearer ${TOKEN}"
```

**Expected once run** (from `expectedCounts(10000)`, not from a measurement):
`reconciles: true`, `valid + duplicates + rejected == processed`, `staged == valid`.

**Negative test — the boundary must hold:** create a job with `isFixture:false`, or
point at an object without `fixture=true` metadata. Expect **422** and:
`Durable worker is currently restricted to generated development fixtures.`

### Step 6 — crash / reclaim on real infrastructure

```bash
gcloud run services update ${WORKER} --region=${REGION} \
  --set-env-vars=INTAKE_DEV_CRASH_AFTER_CHUNK=3    # fixture-only mode enforces this hook's safety
```

The hook `process.exit(137)` after a committed chunk — a **real** abrupt exit, not a
simulated throw, so reclaim is exercised against genuine interruption. Expected: the
lease expires, another instance claims via `claim_next_intake_job`, and the job
resumes from the durable checkpoint with **no double counting** (chunk commit is
idempotent on `(job_id, chunk_index)`). Remove the env var afterwards.

### Step 7 — performance

Not measured. Once deployed, `duration_ms` per `intake.chunk_committed` and the
per-job `intake.job_finished` line give throughput directly from the structured
logs; no extra instrumentation is needed.

---

## Boundaries still in force

- No live scraping. No retailer production data. Generated fixtures only.
- No automatic approval. No automatic publication. **Import only ever stages drafts.**
- No AI intake operator.
- No Pub/Sub or Eventarc — `claim-next` + an explicit `run` cover the dev path.
- No public worker endpoint. No service-role key in browser code. No secrets in
  source control. No signed or public GCS URLs in the UI.
- No destructive migration. No production deployment, bucket, or Supabase project.
- No broad IAM. No browser-side bulk processing in durable mode. No giant payload
  RPCs (chunk commits are bounded at 1 MiB by the RPC itself). No whole-job
  transaction.
