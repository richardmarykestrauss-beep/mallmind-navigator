/**
 * Durable identity hashes — the deterministic keys that make the intake path
 * crash-safe and idempotent across retries, replays and re-imports.
 *
 * All are content-derived (no randomness, no timestamps that vary per run), so a
 * repeat produces identical keys and the durable unique constraints deduplicate.
 */

import type { RawRecord } from "../types";
import type { OfferDraft } from "../../types";
import { contentHash, structuredHash } from "../../hash";

/** Verified content fingerprint of an input object (also the object metadata hash). */
export function inputHash(content: string): string {
  return contentHash(content);
}

/** Stable identity of a job: (source, input, mode). Same input re-submitted → same job identity. */
export function jobIdentityHash(sourceId: string, inputHashValue: string, mode: string): string {
  return structuredHash({ sourceId, inputHash: inputHashValue, mode });
}

/** Deterministic chunk identity within a job. */
export function chunkHash(jobId: string, chunkIndex: number, rowOffsetStart: number, rowOffsetEnd: number): string {
  return structuredHash({ jobId, chunkIndex, rowOffsetStart, rowOffsetEnd });
}

/** Record identity — key-order + CRLF independent (built from the parsed record). */
export function recordHash(record: RawRecord): string {
  return structuredHash(record);
}

/** The normalizer's draftHash IS the semantic record identity used for dedup/conflict. */
export function draftHashOf(draft: OfferDraft): string {
  return draft.draftHash;
}

/** Evidence identity — content-addressed so identical evidence never multiplies. */
export function evidenceHash(record: RawRecord): string {
  return structuredHash({ e: record });
}
