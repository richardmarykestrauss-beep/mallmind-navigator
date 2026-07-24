# Workstream A — Durable Intake Worker: Dev Deployment Proof Plan

**Status: PLAN ONLY — nothing created, built, deployed, or mutated. Stop gate at A6.**

Region: `africa-south1` · Target DB: `mallmind-dev` (`iivm********`) · **Production (`qsps…`) is never referenced.**

This proves one real path end-to-end on dev cloud infrastructure:

> generated 1,000-record fixture → private dev GCS bucket → private Cloud Run worker →
> `mallmind-dev` Postgres → lease claim → bounded chunk commits → durable checkpoints →
> controlled interruption → lease expiry → replacement worker resumes → exact reconciliation →
> zero duplicate evidence / drafts / quarantine → zero publication.

---

## A1 — Existing implementation (merged Sprint 2E, verified present on this branch)

All components exist and are green (`verify:all` 12/12). **Nothing here is rewritten.**

| Concern | Exact artifact |
|---|---|
| Worker entrypoint | `google-cloud-backend/src/worker.ts` (Express; `/health` unauth, `/internal/intake/*` authed) |
| Typecheck | `npm run typecheck:worker` → `tsc -p tsconfig.worker.json --noEmit` |
| Bundle | `npm run build:worker` → `esbuild src/worker.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist-worker/worker.js --packages=external` |
| Start (in container) | `npm run start:worker` → `node dist-worker/worker.js` |
| Dockerfile | `google-cloud-backend/Dockerfile.worker` — **repo-root build context** (reaches `src/lib/fabric`), unprivileged `USER node`, `INTAKE_FIXTURE_ONLY_MODE=true` baked as default |
| Internal routes | `src/routes/internalIntake.ts` — create / claim-next / run / pause / resume / cancel / job / events / reconciliation |
| GCS adapter | `src/services/intake/realGcsBackend.ts` — ADC only, streamed reads, generation-pinned, **no `put()`**, refuses objects lacking `fixture=true` metadata |
| Postgres gateway | `src/services/intake/supabaseGateway.ts` — table+RPC allowlist over the service-role client |
| Durable store | `src/lib/fabric/intake/durable/postgresStore.ts` — the 033/034 RPCs; fixture-only guard fails closed |
| Fixture uploader | `npm run intake:fixture:upload -- --records 1000 --bucket <dev-bucket>` (`src/services/intake/uploadFixture.ts`); marks `fixture=true`, `no_retailer_data=true`; deterministic; prints `gs://…#generation` |
| Crash-test hook | `INTAKE_DEV_CRASH_AFTER_CHUNK=<n>` → real `process.exit(137)` after a committed chunk; only active under fixture-only mode |
| Fixture-only guard | `src/services/intake/config.ts` — defaults ON; only the exact string `"false"` disables it; refuses non-dev buckets; refuses crash hook outside fixture-only |
| Auth (service-to-service) | `src/services/intake/authInternal.ts` — verifies a Google-signed ID token: audience = worker URL, `email_verified`, caller in `INTAKE_ALLOWED_INVOKERS`. **No CORS.** Cloud Run IAM is the outer gate. |
| Admin proxy (browser path) | `src/routes/adminIntakeProxy.ts` on `mallmind-backend-dev` — Supabase bearer + `profiles.is_admin`, mints an ID token for the worker; browser never holds a service-role key |
| Logging | `src/services/intake/logging.ts` — key-allowlisted structured JSON; scrubs tokens/URLs/signed URLs |
| Sprint doc | `docs/retail-fabric-sprint-2e.md` — the original READY-vs-APPLIED plan |

**Worker runtime env vars (from `config.ts`):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`INTAKE_ALLOWED_BUCKETS`, `INTAKE_ALLOWED_INVOKERS`, `INTAKE_WORKER_AUDIENCE`,
`INTAKE_FIXTURE_ONLY_MODE`, `INTAKE_LEASE_SECONDS`, `INTAKE_CHUNK_SIZE`, `INTAKE_LOG_LEVEL`,
`INTAKE_DEV_CRASH_AFTER_CHUNK`.

## A2 — Resource plan (dev-only; NOT created)

Names follow the merged conventions (`_REGION=africa-south1`, `_AR_REPO=mallmind`, existing
`mallmind-backend-dev`). **The GCP `PROJECT_ID` is `$PROJECT_ID` everywhere in the repo — it is
not committed. Richard must supply the dev GCP project id at execution time.** Everything below
is dev-scoped; production is never referenced.

| Resource | Proposed name | Notes |
|---|---|---|
| Private GCS bucket | `mallmind-intake-dev` | uniform bucket-level access; public-access-prevention enforced; matches the `(^|-)dev(-|$)|fixture` guard in `config.ts` |
| Worker service account | `intake-worker-dev@<PROJECT_ID>.iam.gserviceaccount.com` | dedicated; ADC identity for GCS + token verification |
| Artifact Registry repo | `mallmind` (existing) | reuse; new image `mallmind-intake-worker` |
| Worker image | `africa-south1-docker.pkg.dev/<PROJECT_ID>/mallmind/mallmind-intake-worker` | built from `Dockerfile.worker`, repo-root context |
| Private Cloud Run service | `mallmind-intake-worker-dev` | `--no-allow-unauthenticated`, `--ingress=internal`, `min=0 max=2` |
| Invoker identity | the `mallmind-backend-dev` runtime service account | only it may call the worker (`roles/run.invoker`) |
| Secrets | `supabase-url-dev`, `supabase-service-role-key-dev` | **NEW dev-scoped secrets** — never reuse/overwrite the prod `supabase-url` / `supabase-service-role-key` |

## A3 — IAM matrix (least privilege)

| Identity | Resource | Role / permission | Reason | Phase | Rollback |
|---|---|---|---|---|---|
| `intake-worker-dev` SA | bucket `mallmind-intake-dev` | `roles/storage.objectViewer` (bucket-scoped) | read fixtures only; never writes | runtime | `gcloud storage buckets remove-iam-policy-binding gs://mallmind-intake-dev --member=serviceAccount:intake-worker-dev@… --role=roles/storage.objectViewer` |
| `intake-worker-dev` SA | secret `supabase-url-dev` | `roles/secretmanager.secretAccessor` (secret-scoped) | read dev DB URL | runtime | `gcloud secrets remove-iam-policy-binding supabase-url-dev --member=serviceAccount:intake-worker-dev@… --role=roles/secretmanager.secretAccessor` |
| `intake-worker-dev` SA | secret `supabase-service-role-key-dev` | `roles/secretmanager.secretAccessor` (secret-scoped) | read dev service-role key | runtime | as above for `supabase-service-role-key-dev` |
| `mallmind-backend-dev` SA | Cloud Run `mallmind-intake-worker-dev` | `roles/run.invoker` | only the API service may call the private worker | runtime | `gcloud run services remove-iam-policy-binding mallmind-intake-worker-dev --member=serviceAccount:<backend-dev-sa> --role=roles/run.invoker --region=africa-south1` |
| deploying human/CI | Artifact Registry `mallmind` | `roles/artifactregistry.writer` | push the worker image | build | remove binding post-proof if it was newly added |
| deploying human/CI | Cloud Run | `roles/run.developer` on the dev project | deploy the service | build | remove binding post-proof if newly added |
| `intake-worker-dev` SA | (token verification) | none — uses Google public keys | ID-token verify needs no IAM | runtime | n/a |

**Never granted:** Owner, Editor, Storage Admin, project-wide Secret Manager access,
`allUsers`/`allAuthenticatedUsers` invoker, service-account JSON key files (ADC only).

## A4 — Secret matrix

| Value | Classification | Phase | Notes |
|---|---|---|---|
| `mallmind-dev` Supabase URL | **Secret Manager** `supabase-url-dev` → env `SUPABASE_URL` | runtime | non-secret in principle, but co-located with the key for one source of truth |
| `mallmind-dev` service-role key | **Secret Manager** `supabase-service-role-key-dev` → env `SUPABASE_SERVICE_ROLE_KEY` | runtime | **secret**; never printed; dev key only |
| Direct DB connection string | **not required** | — | worker uses the Supabase JS client via the service-role key, not a raw DSN |
| Permitted GCS bucket | **non-secret env** `INTAKE_ALLOWED_BUCKETS=mallmind-intake-dev` | runtime | allowlist; not a secret |
| Worker audience / service URL | **non-secret env** `INTAKE_WORKER_AUDIENCE=<worker URL>` | runtime | exists only after first deploy → deploy once, read URL, redeploy with it set |
| Fixture-only setting | **non-secret env** `INTAKE_FIXTURE_ONLY_MODE=true` | runtime | fail-closed default |
| Backend service identity | **non-secret env** `INTAKE_ALLOWED_INVOKERS=<backend-dev-sa email>` | runtime | allowlist of who may call `/internal/*` |
| Lease / chunk / log tuning | **non-secret env** `INTAKE_LEASE_SECONDS`, `INTAKE_CHUNK_SIZE`, `INTAKE_LOG_LEVEL` | runtime | optional; defaults 60 / 200 / info |
| Crash hook | **non-secret env** `INTAKE_DEV_CRASH_AFTER_CHUNK=2` | runtime | **only for the interruption test**; remove after |
| Gemini / Vertex settings | **not required by the worker** | — | the worker does no AI; it only streams+commits. (The API service uses Vertex separately.) |

## A5 — Exact execution plan (command blocks; **do not run in this phase**)

Every block sets an explicit dev target and refuses ambiguity. Fill placeholders
`<PROJECT_ID>` (dev GCP project), `<BACKEND_DEV_SA>` (the `mallmind-backend-dev` runtime SA).
Do not print secret values.

```bash
# 0) shared, explicit, dev-only context
export PROJECT_ID=<dev-gcp-project-id>
export REGION=africa-south1
export AR_REPO=mallmind
export BUCKET=mallmind-intake-dev
export WORKER=mallmind-intake-worker-dev
export WORKER_SA=intake-worker-dev@${PROJECT_ID}.iam.gserviceaccount.com
export BACKEND_DEV_SA=<mallmind-backend-dev runtime SA email>
gcloud config set project "$PROJECT_ID"            # expected: Updated property [core/project]
test -n "$PROJECT_ID" || { echo "FAIL: no PROJECT_ID"; exit 1; }   # fail closed
case "$PROJECT_ID" in *prod*) echo "FAIL: refusing prod-looking project"; exit 1;; esac
```

```bash
# 1) context verification — prove dev DB link + guard, no prod
node scripts/supabase/guard-target.mjs --env dev    # expect: target=dev ref=iivm********  (exit 0)
node -e "const j=require('./supabase/.temp/linked-project.json');process.exit(j.ref==='iivmrlgntspbkpfqoboi'?0:1)" && echo "linked=dev OK"
```

```bash
# 2) local build + tests (no cloud) — expect all green
npm ci
npm run verify:db          # expect: migrations=35 tables=53 functions=44 policies=24
npm run verify:all         # expect: ALL CHECKS PASSED (12/12)
```

```bash
# 3) bucket (private) — expect: Created
gcloud storage buckets create gs://${BUCKET} --project=${PROJECT_ID} --location=${REGION} \
  --uniform-bucket-level-access --public-access-prevention
```

```bash
# 4) worker service account — expect: Created service account
gcloud iam service-accounts create intake-worker-dev --project=${PROJECT_ID} \
  --display-name="MallMind durable intake worker (dev)"
```

```bash
# 5) IAM grants (least privilege; bucket/secret-scoped)
gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member="serviceAccount:${WORKER_SA}" --role="roles/storage.objectViewer"
gcloud secrets add-iam-policy-binding supabase-url-dev \
  --member="serviceAccount:${WORKER_SA}" --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}
gcloud secrets add-iam-policy-binding supabase-service-role-key-dev \
  --member="serviceAccount:${WORKER_SA}" --role="roles/secretmanager.secretAccessor" --project=${PROJECT_ID}
# expect: each prints an updated IAM policy (bindings only)
```

```bash
# 6) secrets (dev-scoped; values piped from the operator's session, NEVER echoed)
#    Create the two dev secrets with the mallmind-dev URL + service-role key.
printf '%s' "$MALLMIND_DEV_SUPABASE_URL"  | gcloud secrets create supabase-url-dev              --project=${PROJECT_ID} --data-file=- --replication-policy=automatic
printf '%s' "$MALLMIND_DEV_SERVICE_ROLE"  | gcloud secrets create supabase-service-role-key-dev --project=${PROJECT_ID} --data-file=- --replication-policy=automatic
unset MALLMIND_DEV_SUPABASE_URL MALLMIND_DEV_SERVICE_ROLE
# expect: Created version [1] for each (no value printed)
```

```bash
# 7) image build (repo root context, Dockerfile.worker)
gcloud builds submit . --project=${PROJECT_ID} \
  --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/mallmind-intake-worker \
  --gcs-log-dir=gs://${BUCKET}/_cloudbuild-logs 2>/dev/null || \
  gcloud builds submit . --project=${PROJECT_ID} \
    --config=/dev/stdin <<'CB'
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build","-f","google-cloud-backend/Dockerfile.worker","-t","${_IMG}","."]
images: ["${_IMG}"]
substitutions:
  _IMG: africa-south1-docker.pkg.dev/${PROJECT_ID}/mallmind/mallmind-intake-worker
CB
# expect: SUCCESS; image pushed
```

```bash
# 8) deploy (private) — first pass WITHOUT audience (URL doesn't exist yet)
gcloud run deploy ${WORKER} --project=${PROJECT_ID} --region=${REGION} \
  --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/mallmind-intake-worker \
  --service-account=${WORKER_SA} --no-allow-unauthenticated --ingress=internal \
  --min-instances=0 --max-instances=2 \
  --set-secrets=SUPABASE_URL=supabase-url-dev:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key-dev:latest \
  --set-env-vars=INTAKE_FIXTURE_ONLY_MODE=true,INTAKE_ALLOWED_BUCKETS=${BUCKET},INTAKE_ALLOWED_INVOKERS=${BACKEND_DEV_SA}
export WORKER_URL=$(gcloud run services describe ${WORKER} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)')
gcloud run services update ${WORKER} --project=${PROJECT_ID} --region=${REGION} \
  --update-env-vars=INTAKE_WORKER_AUDIENCE=${WORKER_URL}
# invoker binding: only the backend-dev SA
gcloud run services add-iam-policy-binding ${WORKER} --project=${PROJECT_ID} --region=${REGION} \
  --member="serviceAccount:${BACKEND_DEV_SA}" --role="roles/run.invoker"
# expect: Service [mallmind-intake-worker-dev] deployed; URL captured
```

```bash
# 9) private-access verification — unauth must FAIL, health via ID token must pass
curl -s -o /dev/null -w "%{http_code}\n" ${WORKER_URL}/health            # expect: 403 (no token)
TOKEN=$(gcloud auth print-identity-token --audiences=${WORKER_URL})
curl -s -H "Authorization: Bearer ${TOKEN}" ${WORKER_URL}/health          # expect: {"status":"ok","fixtureOnlyMode":true,...}
```

```bash
# 10) generate + 11) upload 1,000-record fixture (deterministic; fixture-marked)
cd google-cloud-backend
npm run intake:fixture:upload -- --records 1000 --bucket ${BUCKET}
# expect: ref: gs://mallmind-intake-dev/fixtures/scale-1000-<hash>.jsonl#<generation>
#         input_hash: sha256:...   records: 1000   bytes: ~334902
cd ..
export FIXTURE_REF="gs://${BUCKET}/fixtures/scale-1000-<hash>.jsonl#<generation>"
export FIXTURE_HASH="<input_hash from uploader>"
```

```bash
# 12) create the durable job (fixture-marked; requested_by grounded in caller identity)
TOKEN=$(gcloud auth print-identity-token --audiences=${WORKER_URL})
curl -s -X POST ${WORKER_URL}/internal/intake/jobs -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"sourceId\":\"<dev-source-uuid>\",\"inputRef\":\"${FIXTURE_REF}\",\"inputHash\":\"${FIXTURE_HASH}\",\"inputContentType\":\"application/x-ndjson\",\"mode\":\"jsonl\",\"isFixture\":true,\"estimatedRows\":1000}"
# expect: 201 { job: { id: <job-uuid>, status: "queued", isFixture: true } }
export JOB_ID=<job-uuid>
```

```bash
# 13) run + 14) checkpoint verification
curl -s -X POST ${WORKER_URL}/internal/intake/jobs/${JOB_ID}/run -H "Authorization: Bearer ${TOKEN}"
curl -s ${WORKER_URL}/internal/intake/jobs/${JOB_ID} -H "Authorization: Bearer ${TOKEN}" | jq '{status:.job.status, processed:.job.processedRows, chunks:(.chunks|length), reconciles:.reconciliation.reconciles}'
# expect: status needs_review/completed_with_errors, processed 1000, chunks = ceil(1000/chunkSize), reconciles true
```

```bash
# 15) controlled interruption — enable the crash hook and re-run a FRESH job
gcloud run services update ${WORKER} --project=${PROJECT_ID} --region=${REGION} \
  --update-env-vars=INTAKE_DEV_CRASH_AFTER_CHUNK=2
#   create + run a new fixture job (steps 12-13); the instance exits 137 after chunk 2
# 16) lease-expiry wait — sleep past INTAKE_LEASE_SECONDS (default 60s)
sleep 75
# 17) recovery invocation — a replacement worker claims the expired lease and resumes
curl -s -X POST ${WORKER_URL}/internal/intake/jobs/${JOB_ID2}/run -H "Authorization: Bearer ${TOKEN}"
#   remove the crash hook afterwards
gcloud run services update ${WORKER} --project=${PROJECT_ID} --region=${REGION} --remove-env-vars=INTAKE_DEV_CRASH_AFTER_CHUNK
```

```bash
# 18) final reconciliation + 19) duplicate checks + 20) publication check
#     Read-only SELECTs in the mallmind-dev SQL editor (or psql), scoped to ${JOB_ID2}:
```
```sql
-- reconciliation (durable source of truth)
select processed_rows, valid_rows, rejected_rows, duplicate_rows, staged_drafts,
       (valid_rows + duplicate_rows + rejected_rows = processed_rows) as reconciles
  from public.retail_intake_jobs where id = '<JOB_ID2>';                 -- reconciles = true, processed = 1000
-- zero duplicate committed chunks (idempotent replay)
select chunk_index, count(*) from public.retail_intake_job_chunks
  where job_id='<JOB_ID2>' group by chunk_index having count(*) > 1;      -- 0 rows
-- zero duplicate evidence/drafts (unique per record hash within scope)
select draft_ref, count(*) from public.retail_intake_job_drafts
  where job_id='<JOB_ID2>' group by draft_ref having count(*) > 1;        -- 0 rows
select record_hash, count(*) from public.retail_intake_dedup_keys
  group by scope, record_hash having count(*) > 1;                        -- 0 rows
-- zero duplicate quarantine per (chunk,record)
select chunk_index, record_index, count(*) from public.retail_intake_quarantine
  where job_id='<JOB_ID2>' group by chunk_index, record_index having count(*) > 1;  -- 0 rows
-- ZERO publication — the durable path only stages drafts
select count(*) as published from public.products where data_source like 'intake:%';  -- 0 (nothing published)
```

```bash
# 21) rollback / teardown (reverse order; leaves mallmind-dev schema intact)
gcloud run services delete ${WORKER} --project=${PROJECT_ID} --region=${REGION} --quiet
gcloud run services remove-iam-policy-binding ... # (invoker) — implicit on delete
gcloud secrets delete supabase-service-role-key-dev --project=${PROJECT_ID} --quiet
gcloud secrets delete supabase-url-dev --project=${PROJECT_ID} --quiet
gcloud storage buckets remove-iam-policy-binding gs://${BUCKET} --member="serviceAccount:${WORKER_SA}" --role="roles/storage.objectViewer"
gcloud iam service-accounts delete ${WORKER_SA} --project=${PROJECT_ID} --quiet
gcloud storage rm -r gs://${BUCKET}      # removes fixtures + bucket
# Optional: delete the fixture-created intake job rows from mallmind-dev (dev only), never prod.
```

## A6 — STOP GATE

**Execution stops here.** No bucket, no service account, no IAM change, no secret, no image
build, no Cloud Run deploy, no fixture upload, no database job creation has been performed.

Before any of the above runs, Richard must supply/confirm at execution time:
`<PROJECT_ID>` (dev GCP project), `<BACKEND_DEV_SA>` (the `mallmind-backend-dev` runtime SA
email), a `<dev-source-uuid>` for job attribution, and the two dev secret values (piped in the
session, never into chat). This is also where the **real Cloud Run→Supabase (africa-south1 →
Stockholm) latency** from the region decision gets measured — capture `duration_ms` per
`intake.chunk_committed` from the structured logs.

---

## Operational corrections (verified during the live dev proof)

The end-to-end proof (see `mallmind-intake-worker-dev-proof-report.md`) surfaced these; fold
them into any future deploy/runbook:

1. **`INTAKE_WORKER_AUDIENCE` startup ordering.** The worker fails closed without it, but the
   Cloud Run URL doesn't exist until after first deploy. Deploy with a **controlled placeholder
   audience** (e.g. `https://pending-first-deploy.invalid`) so the container starts, then
   **immediately** `gcloud run services update … --update-env-vars=INTAKE_WORKER_AUDIENCE=<real URL>`.
2. **POST needs an explicit body.** A body-less POST to Cloud Run returns **HTTP 411 (Length
   Required)** from the Google Front End. Send `-d '{}'` for the no-payload control endpoints
   (`/run`, `/pause`, `/resume`, `/cancel`).
3. **Internal proof tokens need `--include-email`.** `authInternal` requires a verified `email`
   claim; `gcloud auth print-identity-token` omits it by default → `/internal/*` returns
   **401**. `/health` is unaffected (not behind `authInternal`). Mint with
   `gcloud auth print-identity-token --impersonate-service-account=<proof-caller> --audiences=<worker-url> --include-email`.
4. **Crash / reclaim choreography.** Enable `INTAKE_DEV_CRASH_AFTER_CHUNK=<n>` (fixture-only) →
   invoke → crash after chunk n → run the **premature-reclaim negative test** (expect
   `409 stale_worker`) **before** lease expiry → **remove** the crash var **before** invoking
   recovery → invoke recovery only **after** the lease expires. Never clear or rewrite the lease
   manually.
5. **Worker identity must be instance-unique.** `process.pid` is always 1 in a Cloud Run
   container, so it cannot distinguish instances of a revision — worker identity uses a random
   startup UUID (`services/intake/workerIdentity.ts`), bounded to the RPC's 80-char `worker_id`
   limit. Fixed in commit `1b0daff`.
