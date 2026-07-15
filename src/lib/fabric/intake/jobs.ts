/**
 * Intake job factory + end-to-end runner over an input store.
 */

import type { IntakeJob, IntakeMode, IntakeInputStore, IntakeRunResult } from "./types";
import type { SourceAccessPolicy } from "../types";
import { recordStreamFor } from "./parsers";
import { processIntakeStream } from "./engine";

export interface CreateJobInput {
  sourceId: string;
  mode: IntakeMode;
  inputRef: string;
  inputHash: string;
  requestedBy: string;
  adapterId?: string;
  estimatedRows?: number;
  totalBytes?: number;
}

export function createIntakeJob(input: CreateJobInput, nowIso: string): IntakeJob {
  return {
    id: `job_${input.inputHash.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`,
    sourceId: input.sourceId, adapterId: input.adapterId, mode: input.mode, status: "queued",
    inputRef: input.inputRef, inputHash: input.inputHash, requestedBy: input.requestedBy,
    totalBytes: input.totalBytes, estimatedRows: input.estimatedRows,
    processedRows: 0, validRows: 0, rejectedRows: 0, duplicateRows: 0, conflictRows: 0,
    stagedDrafts: 0, evidenceCreated: 0, retryCount: 0,
    createdAt: nowIso, updatedAt: nowIso,
  };
}

/** Open an input from the store, parse it as a record stream, and run the engine. */
export async function runJobFromStore(
  job: IntakeJob, store: IntakeInputStore, policy: SourceAccessPolicy | undefined, nowIso: string,
  opts: { chunkSize?: number; concurrency?: number } = {},
): Promise<IntakeRunResult> {
  const chunks = await store.open(job.inputRef);
  const parseMode = job.mode === "csv" ? "csv" : job.mode === "jsonl" ? "jsonl" : "json";
  const records = recordStreamFor(parseMode, chunks);
  return processIntakeStream({ job, records, policy, nowIso, chunkSize: opts.chunkSize, concurrency: opts.concurrency });
}
