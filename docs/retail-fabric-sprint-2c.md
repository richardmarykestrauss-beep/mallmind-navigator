# Retail Intelligence Fabric — Sprint 2C

**Production-Shape Bulk Intake Engine + Scale and Resilience Harness.** A durable,
resumable, chunk-streaming intake engine that absorbs large batches without losing
evidence, duplicating observations, blocking on giant in-memory arrays, publishing
unreviewed data, or corrupting review state.

> **Reality label:** _Prototype — local persisted data / in-memory processing_. No
> live scraping, no external service, no deploy, no production writes, no automatic
> publishing, and **no specialized AI agent yet** (its permission contract is
> defined only). Existing evidence/review/recommendation protections are preserved.

> **Branch note:** stacked on `feat/retail-fabric-sprint-2b`. The stack
> #25→#26→#27→#29→this is unmerged into `claude-premium-nav-test` (no `src/lib/fabric/`
> there). Verified with `git merge-base` before branching.

## Pipeline (unchanged doctrine)

```
SOURCE → INTAKE JOB → CHUNK PARSE → VALIDATE → NORMALIZE → DEDUPLICATE
→ CAPTURE EVIDENCE → CREATE DRAFTS → DETECT CONFLICTS → REVIEW QUEUE → PUBLICATION GATE
```

Nothing publishes from import. The furthest a row reaches is a **staged draft**
(`needs_review`); approval + a separate publication gate happen exactly as in
Sprints 2A/2B.

## Architecture (`src/lib/fabric/intake/`)

| Module | Role |
| --- | --- |
| `types.ts` | Job / checkpoint / record-result / quarantine / batch / metrics / event / input-store types. |
| `security.ts` | Prototype-pollution-safe JSON, CSV formula neutralization, payload/row/field limits, sanitized excerpts. |
| `inputStore.ts` | `IntakeInputStore` + in-memory `LocalFixtureInputStore` (Cloud Storage / Supabase Storage shaped). |
| `parsers.ts` | Streaming CSV + JSONL (line-by-line) and buffered JSON-array → lazy `AsyncIterable<RawRecord>`. |
| `recordPipeline.ts` | The one controlled per-record path → staged / duplicate / conflict / rejected. |
| `engine.ts` | `processIntakeStream` — bounded chunks, bounded concurrency, checkpoints, metrics, events, resume. |
| `retry.ts` | Retryable-only, bounded, exponential-backoff **metadata** (no real sleeping). |
| `quarantine` (in engine + types) | Bad rows quarantined without failing the job. |
| `reviewBatch.ts` | Batch review — bulk approval only for independently-approvable drafts, one auditable decision each. |
| `publicationBatch.ts` | Post-review publication plan — dry-run vs apply, idempotent, blockers preserved. |
| `scaleFixtures.ts` | Deterministic generated mixture (no retailer data) as a lazy generator. |
| `jobs.ts` | Job factory + end-to-end store runner. |

## Job lifecycle

`queued → validating → processing → (paused) → needs_review / completed /
completed_with_errors / failed / cancelled`. Progress counters are explicit
(processed / valid / rejected / duplicate / conflict / drafts / evidence), partial
success is honest (`completed_with_errors`), and cancellation is explicit.

## Chunking / backpressure

The engine consumes an `AsyncIterable<RawRecord>` in chunks of `chunkSize`, one
chunk in flight at a time (backpressure), each chunk processed with bounded
`concurrency` (order-preserving). It never materializes the full input — the scale
fixtures are a **lazy generator**, so 50,000 records stay memory-bounded.

## Checkpoint / resume / idempotency

A checkpoint (`chunkIndex`, `rowOffset`, `lastRecordHash`) is committed **after**
each successful chunk; a crash before the commit re-runs only that chunk.
Deterministic identities: the record hash is the normalizer's `draftHash`
(normalizer version + normalized title + price + currency + gtin/model/sku +
observedAt + sourceId) — so **reordered JSON keys and CRLF/LF differences hash
identically**. Re-import with a retained dedup index yields all duplicates and no
new drafts. Different evidence (changed price / newer time) is a new draft →
conflict/freshness, never a silent overwrite.

## Quarantine

Bad records are quarantined (job id, record index, sanitized excerpt/hash, error
codes, warnings, retryable flag, disposition) and classified (structural /
validation / policy / identity / evidence / conflict / storage / transient /
internal). A bad row never fails a large job. Supports retry-selected (retryable
only, bounded), permanent rejection, and report export.

## Review batching + publication planning

`ReviewBatch` groups a job's staged drafts with rich filters. **Bulk approval
approves only drafts that independently pass approval rules** — a conflicted/invalid
draft is never hidden, and every draft gets its own auditable `ReviewDecision`.
`planPublication` runs only after review: it evaluates each offer independently,
lists eligible vs blocked (blockers preserved, never downgraded), is idempotent,
writes nothing in dry-run, and requires explicit apply.

## Load-test methodology + actual benchmark

Deterministic generated fixtures (100 / 1,000 / 10,000 / 50,000) mixing valid,
duplicate, invalid-price, missing-title, expired, unsupported-currency, conflict,
multi-mall/branch, online-only, and malformed rows. CI runs **1,000 and 10,000**
with exact-count reconciliation; the **50,000** benchmark is gated:

```
# CI (fast, deterministic)
npm test            # includes intake + 1k/10k scale
# Extended benchmark (local)
INTAKE_BENCH=1 npx vitest run src/lib/fabric/intake/scale.test.ts
```

**Actual measured (this environment):** 50,000 records processed in **2.10 s →
≈ 23,866 rows/s**, peak heap ≈ **195 MB**, chunkSize 2,000, concurrency 8. All
counts reconciled; nothing auto-published. (Exact per-category counts are asserted
up to 10,000; beyond ~14.5k the generator's price space wraps and a small number of
generated "conflicts" legitimately collide to identical drafts — the always-true
reconciliation invariant `valid + duplicate + rejected = processed` still holds.)

## Operational dashboard

The Data Command Center gains a **Bulk Intake Engine** block: Scale Test (run a
generated fixture in bounded sizes; throughput / avg-chunk / checkpoints / rates /
peak-heap), Intake Jobs (+ job-detail chunk history, input hash, no raw payload),
Quarantine (export report, reject), and Review Batches (bulk-approve a bounded
sample; conflicts skipped with individual decisions). Clearly labelled "Generated
scale fixture — no retailer data." No dead buttons. (The interactive bulk-review
demo is capped to a small sample; the engine + lib handle any size, proven by the
scale tests.)

## Security controls

Prototype-pollution-safe JSON parsing (drops `__proto__`/`constructor`/`prototype`),
CSV formula-injection neutralization on every field, payload (256 MB) / row
(500,000) / field-length (8,192) / field-count (128) limits, sanitized bounded
error excerpts, no secrets in job/input metadata, no dynamic code/module loading, no
path traversal, no unbounded logging, blocked source policy enforced at intake, and
no approval/publication from import itself.

## Future AI intake-operator contract (defined, NOT implemented)

See [retail-fabric-ai-agent-contract.md](./retail-fabric-ai-agent-contract.md). In
short — the future agent MAY create source candidates, submit authorized inputs,
start/monitor jobs, inspect quarantine summaries, and propose corrections/decisions;
it MAY NOT change source policy, approve legal access, bypass quarantine, override
conflicts, self-approve evidence, publish offers, set `verified_live` without
eligible evidence, or alter immutable provenance.

## Tests

`intake.test.ts` (16) + `scale.test.ts` (4 CI + 1 gated benchmark): streaming
parsers, security (prototype pollution, formula injection, limits), chunking,
bounded-concurrency determinism, counter reconciliation, dedup + stable/key-order-
independent hashes, conflict preservation, evidence lineage, blocked-source
rejection, idempotent repeat import, checkpoint/resume equivalence, monotonic
checkpoints, cancellation, retry classification, batch review (individual
decisions, conflicts skipped), publication dry-run/apply/idempotency, and the
1k/10k/50k scale harness. Plus the extended DCC render test.

## Gates

`npm test` **166 pass, 1 skipped** (50k bench) · `npm run build` · `npm run
verify:all` **9/9** · `typecheck` adds **zero** new errors (11 pre-existing).

## Known limitations

In-memory prototype (no Supabase/Cloud Storage/Cloud Run yet); JSON-array parsing
buffers (JSONL streams); the browser demo runs bounded sizes and a bounded bulk-
review sample (the lib is unbounded); throughput is single-process (a worker fleet
would parallelize across jobs).

## Recommended next sprint

Wire the durable job/checkpoint/quarantine models to Supabase/Postgres + a Cloud Run
worker that consumes a Cloud Storage input via the `IntakeInputStore` contract; map
the intake events to Pub/Sub/Eventarc; **then** build the specialized AI intake
operator strictly within the permission contract defined here.
