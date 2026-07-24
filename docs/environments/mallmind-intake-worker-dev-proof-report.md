# MallMind Durable Intake Worker — Dev Proof Report

**Status: PROVEN on real dev infrastructure.** Gate 7 (baseline) and Gate 8 (crash / lease-expiry / reclaim / resume) both pass, including a genuine defect found and fixed mid-proof.

Environment: GCP project `mallmind` (1017902775578) · region `africa-south1` · worker `mallmind-intake-worker-dev` (private, IAM-authenticated, `--ingress=all`, fixture-only) · DB `mallmind-dev` (`iivm…`) · **production (`qsps…`) never touched · `mallmind-backend-dev` never modified · Gate 4B never executed.**

All fixtures are deterministic, synthetic, and carry **zero** real retailer/mall/brand names (Sprint 2E `scaleFixtures` uses neutral tokens `RETAILER_A..E`, `MALL_X..Z`, `BRAND_1`). Nothing published — the worker only stages review drafts.

---

## Gate 7 — baseline (uninterrupted 1,000-record proof)

- Image `proof-26c7e60` digest `sha256:bd4118c0…c8043`; revision `00003-b2w`.
- Fixture: 1000 records, 332,631 bytes, fabric hash `sha256:txt-0b4d783b9a97b1d7-332631`, file SHA-256 `820ee5a1…1017037`.
- Object `gs://mallmind-intake-dev/fixtures/baseline/26c7e60/scale-1000-0b4d783b.jsonl#1784835309828429` (private, anon read 403).
- Job `e5385264-12a2-4744-a35f-9d39923a8257` → `completed_with_errors`, **reconciles: true**, processed 1000 (valid 767 / rejected 186 / duplicate 47 / conflict 27), 5 chunks, checkpoint 1000, published **0**. Anonymous `/health` 403, proof-caller 200. Logs clean.

## Gate 8 — first attempt: PARTIAL, and it found a real defect

Job `5345383e-6c04-451e-8c0b-71d9c0b4e7f4` (object `…/crash-recovery/26c7e60/177ed2f2/…#1784887216972414`). The crash-after-2-chunks and durable checkpoint/resume worked (chunks 0–4 each once, `reconciles: true`, no reprocessing), **but a required invariant failed:**

> **Worker identity defect.** The worker id was `w_<K_REVISION>_<process.pid>`. In a Cloud Run container Node is **always PID 1**, and `K_REVISION` is identical across instances of a revision — so the crashed instance and its replacement received the **same** id (`w_…00005-xt2_1`). The durable lease owner check (`v_owner <> p_worker_id`) could not distinguish two workers.

**Precise risk:** under concurrent scaling (`max-instances>1`, `claim-next`), two live instances of one revision would share an id and could both act as the lease owner — defeating the durable lease's core mutual-exclusion guarantee. (No data was corrupted in the test: the checkpoint + idempotent commit kept it correct, but the lease-ownership guarantee itself was unsound.)

Per protocol the run stopped on the failed invariant; **the failed job and object are preserved as evidence** (not deleted, not mutated: still `completed_with_errors`, version 9).

## The fix — commit `1b0daff6d6cb85154e0140aedfc4e7b3e283bf93`

Narrow, no migration (the 80-char limit is an RPC validation `char_length(worker_id) > 80`, not a column limit — the column is `text`). New `google-cloud-backend/src/services/intake/workerIdentity.ts`:

```
w_<sanitized-revision (≤40)>_<randomUUID>
```
- Uniqueness from a **crypto random startup nonce** (`node:crypto randomUUID`), generated **once** at process start and reused for the process lifetime.
- `process.pid` **dropped** — it was the defect and added no uniqueness.
- Revision retained for observability; full 36-char UUID **never truncated**; worst case 79 ≤ 80.
- No change to lease duration, generation rules, chunk size, checkpoint logic, RPC signatures, migrations, retailer handling, or publication.

Tests added: 6 identity tests (`intakeWorkerHarness`) — same-revision ids differ, stable per fixed nonce, revisions distinguishable, sanitization, ≤80 at max revision, no unsafe chars; and `leaseConcurrency.test.ts` (InMemoryDurableStore, two distinct workers) — owner-mismatch commit/renew/claim rejected on a live lease, expiry reclaim, generation increment, stale owner+version rejection, monotonic checkpoint. `verify:db` (migrations 35 / tables 53 / functions 44 / policies 24) and `verify:all` (12/12, 233 frontend tests, worker harness 34 assertions) green.

## Gate 8 — clean re-run (PASS)

Image `proof-1b0daff` digest `sha256:8dde643609628863386c77d993686527d7befab6d1c5b72aa977ef34300ab69b`.
Third fixture: 1000 records, 332,631 bytes, fabric hash `sha256:txt-292bfc5c6e420d28-332631`, file SHA-256 `2973c536…ac96` (distinct from both prior fixtures). Object `gs://mallmind-intake-dev/fixtures/crash-recovery-workerid-fix/1b0daff/292bfc5c/scale-1000.jsonl#1784892142975723` (private, anon 403). Job **`153c35c7-b873-41b8-bdf0-f60ef019bcf5`**.

| Stage | Evidence |
|---|---|
| Crash-enabled rev | `00008-sqr` (only `+INTAKE_DEV_CRASH_AFTER_CHUNK=1`) |
| Controlled crash | HTTP 503 after **exactly 2 chunks** [0,1]; checkpoint **400**; status `processing`, no completion; `intake.dev_crash` logged |
| **First workerId** | `w_…00008-sqr_6ab009cd-b8c7-431a-ba1a-b29185c54e0f` (unique UUID) |
| **Premature reclaim** | different instance → **HTTP 409 `stale_worker`** ("Another worker owns this job") — the assertion that failed before ✅ |
| Recovery rev | `00009-w6m` (only crash var removed; health 200; fixtureOnly true) |
| Lease | 60s; expired ~11:25:42Z; reclaim invoked 11:26:52Z (after expiry) |
| **Second workerId** | `w_…00009-…_…4f7b-a8db-13cb3f044d17` — **≠ first** ✅ |
| Resume | offset **400**; chunks **2,3,4** newly committed by the second worker; chunks 0,1 by the first worker, **not reprocessed** |
| Generations | 2 `intake.job_claimed` events |
| Stale-owner / stale-generation | real RPCs on a **disposable** job: owner-mismatch commit+renew → `stale_worker: lease`; stale-generation commit+renew → `stale_worker: version` ✅ |
| Final | `completed_with_errors`, **reconciles: true**, processed 1000 |

### Final counts — job `153c35c7` (job-scoped)
processed **1000** · valid 767 · duplicate 47 · conflict 27 · rejected/quarantined 186 · chunks **5** (indices [0,1,2,3,4], each once) · checkpoint **1000** · evidence 767 · drafts 767 · quarantine 186 · intake events (created 1, **claimed 2**, renewed, committed 5, checkpoint 5, completed 1) · **published 0**. Job-scoped duplicate chunk / dedup / evidence / draft / quarantine lineage = **0**.

### Source-scope vs job-scope dedup (do not conflate)
`intake_job_reconciliation.dedupKeys` counts the **source scope** (`scope = source_id`), which is **cumulative across all jobs** at source `412ac943…`: **2301 = 3 jobs × 767** (baseline + failed-Gate-8 + fix). **This job's own contribution is 767** (= its `stagedDrafts`). The job-scoped duplicate assertions above are all 0 regardless.

## Log & secret safety
Across all Gate 7/8 runs: **0** occurrences of Supabase service-role value, JWT/bearer/identity token, raw fixture rows, signed URLs, production Supabase reference, or unexpected personal data. Structured single-line JSON only.

## Operational corrections learned (also in the deployment plan)
1. **`INTAKE_WORKER_AUDIENCE` startup ordering** — the worker fails closed without it, but the Cloud Run URL isn't known until after creation. Deploy with a controlled placeholder audience, then immediately update the revision to the real URL.
2. **POST requests need an explicit body** — the Google Front End returns **411 (Length Required)** for a body-less POST; send `{}`.
3. **Internal proof tokens need `--include-email`** — `authInternal` requires a verified email claim; `gcloud … print-identity-token` omits it by default. (`/health` is unaffected — it's not behind `authInternal`.)
4. **Crash-disable choreography** — enable `INTAKE_DEV_CRASH_AFTER_CHUNK` (fixture-only), crash, run the premature-reclaim negative test **before** lease expiry, remove the crash var **before** invoking recovery, then reclaim only **after** the lease expires. Never mutate the job/lease manually.
5. **Worker identity must be instance-unique** (this defect) — never derive uniqueness from `process.pid` in a container.

## Preserved evidence & untouched systems
- Baseline job `e5385264…` (v8) and object — untouched.
- Failed-Gate-8 job `5345383e…` (v9) and object — **preserved as the defect record**, untouched.
- Clean-rerun job `153c35c7…` and object — retained.
- `mallmind-backend-dev` unmodified; `INTAKE_WORKER_URL` never set on it; no production Supabase/secret used; no migration; no frontend connection; Gate 4B not executed.

## Proof-caller teardown — ✅ EXECUTED (post-proof security cleanup)

The throwaway proof caller has been fully removed; only the backend service account
remains authorized to invoke the worker.

Commands run (in order):
```
gcloud run services update mallmind-intake-worker-dev --region=africa-south1 --update-env-vars=INTAKE_ALLOWED_INVOKERS=1017902775578-compute@developer.gserviceaccount.com
gcloud run services remove-iam-policy-binding mallmind-intake-worker-dev --region=africa-south1 --member="serviceAccount:intake-proof-caller-dev@mallmind.iam.gserviceaccount.com" --role="roles/run.invoker"
gcloud iam service-accounts remove-iam-policy-binding intake-proof-caller-dev@mallmind.iam.gserviceaccount.com --member="user:sovereign.systems.sa@gmail.com" --role="roles/iam.serviceAccountTokenCreator"
gcloud iam service-accounts delete intake-proof-caller-dev@mallmind.iam.gserviceaccount.com
```

Post-cleanup state (verified):
- Worker revision **`00010-vbb`** @ 100%, image digest `sha256:8dde6436…ab69b` (unchanged),
  runtime SA `intake-worker-dev@mallmind…` (preserved), ingress `all`, `fixtureOnlyMode=true`,
  crash hook absent.
- Worker `run.invoker` = **only** `1017902775578-compute@developer.gserviceaccount.com`.
- `INTAKE_ALLOWED_INVOKERS` = **only** the backend SA.
- `intake-proof-caller-dev@mallmind…` **deleted**; its Token Creator binding gone.
- Anonymous `/health` = 403 (private + operational). Authenticated `/health` can no longer be
  exercised from this workstation by design — the sole authorized invoker is now the backend SA,
  which is deliberately not impersonated.
- Preserved and untouched: the worker service, `mallmind-intake-dev` bucket + all three proof
  fixture objects, the two dev secrets, the worker runtime SA, the three proof jobs, and this
  documentation.
- `mallmind-backend-dev` unchanged (`INTAKE_WORKER_URL` never set → Gate 4B still not executed);
  production and its Supabase project/secrets untouched.
