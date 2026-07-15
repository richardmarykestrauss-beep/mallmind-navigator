# Retail Intelligence Fabric — Sprint 2D

**Durable Intake Worker + Crash-Safe Persistence.** Connects the proven pure
engine (Sprint 2C) to a durable, resumable, concurrency-safe worker path that
survives Cloud Run restarts, crashes, worker replacement, retries, duplicate
delivery and concurrent workers — without weakening any governance or publication
protection.

> **Reality label:** _Prototype — this machine has no Docker and no service-role
> key_, so migrations are NOT applied and no live Postgres/Supabase/GCS runs. The
> durable path is proven against a **Postgres-faithful in-memory reference store**
> that enforces the identical invariants (atomic commit, unique constraints,
> optimistic version, leases). The real path is the additive migration + RPCs
> (`supabase/migrations/033_*`) + a GCS adapter, all ready for a reviewed apply.
> **No live scraping. No production retailer data. No automatic approval. No
> automatic publication. No AI operator implemented. No production deployment.**

> **Branch note:** stacked on `feat/retail-fabric-sprint-2c` (PR #30). Rollback
> anchor: commit `1d1e116`. The stack #25→…→#30→this is unmerged into
> `claude-premium-nav-test` (verified with `git merge-base`).

## Architecture

```
AUTHORIZED INPUT → DURABLE OBJECT REF (gs://bucket/obj#gen) → INTAKE JOB ROW
→ WORKER CLAIM (lease) → CHUNK READ (stream) → PURE INTAKE ENGINE
→ ATOMIC CHUNK COMMIT (chunk+dedup+quarantine+counters+checkpoint+event, 1 tx)
→ DURABLE CHECKPOINT → REVIEW QUEUE
```
Import never publishes; the furthest a row reaches is a **staged draft**.

## Data model (`supabase/migrations/033_retail_intake_durable.sql`)

`retail_intake_jobs` (all Sprint-spec columns + status enum + `version`),
`retail_intake_worker_leases`, `retail_intake_job_chunks` (PK `(job_id, chunk_index)`),
`retail_intake_checkpoints`, `retail_intake_quarantine` (bounded excerpt ≤256, unique
`(job_id, chunk_index, record_index)`), `retail_intake_events` (bounded metadata),
`retail_intake_dedup_keys` (PK `(scope, record_hash)`). All: RLS enabled + forced,
revoked from `public/anon/authenticated`, granted to `service_role` only.

## Worker claim / lease design

One coherent mechanism: `claim_next_intake_job` uses **`SELECT … FOR UPDATE SKIP
LOCKED`** to atomically pick the highest-priority reclaimable job whose lease is
absent/expired, writes the lease, and bumps the job `version`. Heartbeats renew via
`renew_intake_lease` under an **optimistic `version` guard**; if a reclaim advanced
the version, the old worker's renew/commit raises `stale_worker`. Reclaim only after
`lease_expires_at <= now()`.

## Atomic chunk transaction

`commit_intake_chunk(job_id, worker_id, job_version, chunk jsonb)` validates the
lease + version, then in ONE transaction: inserts the chunk row
`ON CONFLICT (job_id, chunk_index) DO NOTHING` (idempotent replay), inserts dedup
keys + quarantine `ON CONFLICT DO NOTHING`, updates job counters, upserts the
checkpoint, and writes chunk-committed + checkpoint-saved events. Either all commit
or none. Payload is bounded (`pg_column_size ≤ 1 MB`) — never a whole-job payload.

## Checkpoint / resume

The checkpoint is written **inside** the chunk transaction, so there is no separate
"local ack" that can diverge. On resume the worker re-opens the input, verifies the
object generation + content hash are unchanged (**fails safely** if changed),
loads the checkpoint, and continues from the next uncommitted chunk. If checkpoint
and counters disagree it raises an integrity failure and stops.

## Cloud Storage adapter

`GcsInputStore` holds only a `gs://bucket/object#generation` reference; it validates
the bucket allowlist, sanitizes the object name (no traversal/control chars),
verifies generation + size + content hash, and **streams** the object (no full load).
The real `@google-cloud/storage` client is injected behind `GcsBackend`; this sprint
ships a deterministic `FixtureGcsBackend` (no network, no credentials, no public URLs).

## Deduplication

Hashes: `input_hash`, `job_identity_hash`, `chunk_hash`, `record_hash` (= the
normalizer `draftHash`; key-order + CRLF independent), `evidence_hash`, `draft_hash`.
Dedup scope is the source. Identical evidence never multiplies (unique
`(scope, record_hash)`); a changed price/time is a NEW record hash → a new draft /
conflict candidate; prior evidence stays immutable. Proven across re-run, re-import,
overlapping chunk retry, reordered keys, and CRLF/LF.

## Quarantine

Persisted, bounded, sanitized (job/chunk/record index, ≤256-char excerpt, error
class, codes, retryable, disposition). A bad record never fails the job. Supports
list/filter/export/reject/resolve.

## Security model

RLS + service_role-only RPCs (browser never holds a service-role key or the internal
token); internal endpoints require service-to-service auth and ground `requested_by`
in the authenticated caller; bucket allowlist + object validation; payload/row/field
limits; parser safety + JSON prototype-pollution + CSV formula-injection defences
carried from 2C; parameterized RPCs (no SQL injection); sanitized errors; no secrets
or raw payloads in logs/events; **import can neither approve nor publish**; a stale
worker cannot commit.

## Crash-simulation methodology

`crashRecovery.test.ts` runs the real worker against the reference store with crash
hooks covering all 20 cases (crash before/after commit, lease expiry + second-worker
reclaim, stale-worker rejection, duplicate/rerun, pause, cancel, transient fault,
generation/hash change, overlapping replay, concurrent workers). Every case asserts:
no duplicate drafts/evidence/quarantine, exact counter reconciliation vs a clean run,
monotonic checkpoints, committed chunks survive, uncommitted chunks rerun safely,
conflicts stay blocked, policy stays authoritative, and **nothing publishes**.

## Performance

The durable worker adds per-chunk atomic-commit bookkeeping on top of the pure
engine. Against the **in-memory reference store** (no DB/network) it processes the
fixtures at engine-class throughput — this is NOT comparable to real Postgres. Real
figures (object-read throughput, parser vs engine vs **DB chunk-commit latency**,
checkpoint latency, recovery time, retry overhead, peak memory) must be measured in
the Level-3 dev smoke test against a dev Supabase + dev bucket + Cloud Run worker;
that is documented below and gated on credentials, not run here.

## Test profile

- **Level 1 (CI, no network):** `durable.test.ts` (8) + `crashRecovery.test.ts` (10)
  + all existing 2A–2C tests. `npm test` → **184 pass, 1 skipped**.
- **Level 2 (local durable integration):** the reference store IS the Level-2 target
  on a machine without Docker; a Postgres-backed store implementing the same
  `DurableIntakeStore` interface (via the RPCs) is the drop-in for a Docker/dev DB.
- **Level 3 (cloud dev smoke — documented, gated, not run):**
  ```
  # apply migration to a DEV project (reviewed), then:
  DEV_SUPABASE_URL=… SERVICE_ROLE_KEY=… DEV_BUCKET=mallmind-intake-dev \
    npm run intake:smoke   # generated fixture only, no production data
  ```

## Migration apply / rollback

1. `git rev-parse HEAD` (record) — rollback anchor `1d1e116`; create a tag.
2. Review `supabase/migrations/033_retail_intake_durable.sql` (additive; enums are
   idempotent; RLS + grants locked).
3. Apply to a **dev** project only: `supabase db push` (or `psql -f 033_*.sql`).
   Do NOT apply to production without explicit instruction.
4. Verify:
   ```sql
   select relname from pg_class where relname like 'retail_intake_%';
   select proname, prosecdef from pg_proc where proname like '%intake%';
   -- confirm EXECUTE is service_role-only:
   select proname, proacl from pg_proc where proname = 'commit_intake_chunk';
   ```
5. Smoke: create a fixture job → claim → commit chunks → confirm counters +
   checkpoint + no duplicate dedup keys.
6. Rollback: `psql -f supabase/rollback/033_retail_intake_durable_rollback.sql`
   (additive → reversible). The rollback lives OUTSIDE `supabase/migrations/` so the
   migration runner never treats it as a forward migration.

## Browser QA (zero app console errors)

Recovery test at `/admin/data-command-center` → Durable Intake Worker: crash after
chunk 1 (2 chunks committed) → worker-2 reclaimed the expired lease and resumed →
**120 processed, 90 staged, reconciliation EXACT ✓, no duplicate drafts ✓, nothing
published**. Durable Jobs show the lease owner, heartbeat, checkpoint, counters, and
the `gs://…#generation` object reference (never a signed URL); chunk history shows
per-chunk worker ids; 24 quarantine rows persisted; Start/Pause/Resume/Cancel call
the real durable APIs.

## Future AI operator boundary

Unchanged from [retail-fabric-ai-agent-contract.md](./retail-fabric-ai-agent-contract.md):
the future operator may create jobs from authorized inputs, monitor, summarize
errors, propose corrections/decisions, and request pause/resume — it may NOT alter
source legal policy, obtain credentials, bypass input validation, override leases,
modify immutable evidence, self-approve, resolve conflicts silently, or publish.

## Known limitations

No live Postgres/GCS/Cloud Run on this machine (Level 3 gated); the reference store
is the tested target; the Postgres store adapter (RPC calls) is written as the
migration contract but not exercised without credentials; browser demo runs bounded
fixtures.

## Recommended Sprint 2E

Implement the Postgres-backed `DurableIntakeStore` (thin RPC wrappers), a real
`@google-cloud/storage` `GcsBackend`, and the Cloud Run worker deployment; run the
Level-3 smoke + performance profile against dev; map the durable events to
Pub/Sub/Eventarc; **then** build the specialized AI intake operator within the
documented permission boundary.
