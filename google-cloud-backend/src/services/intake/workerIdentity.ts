/**
 * Instance-unique durable worker identity.
 *
 * DEFECT THIS FIXES (Gate 8): the prior scheme `w_<K_REVISION>_<process.pid>` was
 * NOT unique across Cloud Run instances of the same revision. Node runs as PID 1 in
 * every container, and K_REVISION is identical for all instances of a revision, so
 * two separate instances received the *same* worker id. That broke the durable
 * lease's owner check (`v_owner <> p_worker_id`): the DB could not tell two workers
 * apart, so a crashed instance and its replacement looked like one worker, and under
 * concurrent scaling two live instances could both act as the lease owner.
 *
 * FIX: a cryptographically random startup nonce (randomUUID) makes the id unique per
 * process. The revision is retained for observability. `process.pid` is dropped
 * entirely — it was the root cause and contributes no uniqueness.
 *
 * The id is generated ONCE at process startup (in worker.ts) and reused for the
 * lifetime of the process — never per request, chunk, or heartbeat.
 *
 * LENGTH: the RPCs `claim_next_intake_job` / `claim_intake_job` reject a worker_id
 * longer than 80 characters (`char_length(p_worker_id) > 80`). The underlying column
 * is `text` (unlimited), so this is an application-level contract, not a storage
 * limit — no migration is involved. The full 36-char UUID is NEVER truncated; only
 * the revision is sliced. Worst case: `w_`(2) + revision(<=40) + `_`(1) + uuid(36)
 * = 79 <= 80.
 */

import { randomUUID } from "node:crypto";

/** The worker_id length ceiling enforced by the durable claim RPCs. */
export const WORKER_ID_MAX = 80;

/** Max revision slice, chosen so a full UUID always fits under WORKER_ID_MAX. */
export const REVISION_SLICE = 40;

/**
 * Build an instance-unique worker id. `nonce` defaults to a fresh random UUID and is
 * injectable only for tests; production always uses the default.
 */
export function buildWorkerId(revision: string | undefined, nonce: string = randomUUID()): string {
  const rev = (revision && revision.length > 0 ? revision : "local")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, REVISION_SLICE);
  const id = `w_${rev}_${nonce}`;
  // Defence in depth: the budget guarantees <= 79, but never emit an id the RPC
  // would reject — fail loudly at startup rather than silently failing to claim.
  if (id.length > WORKER_ID_MAX) {
    throw new Error(`workerId exceeds ${WORKER_ID_MAX} characters (${id.length}); revision too long.`);
  }
  return id;
}
