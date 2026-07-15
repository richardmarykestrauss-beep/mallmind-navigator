/**
 * Intake input store abstraction + a safe local/fixture implementation.
 *
 * Shaped for future Cloud Storage / Supabase Storage / authorized email
 * attachments / partner-feed downloads. This sprint ships ONLY an in-memory
 * fixture store — no massive raw payloads are written to localStorage.
 */

import type { IntakeInputStore, IntakeInputRef, IntakeInputMetadata } from "./types";
import { INTAKE_LIMITS } from "./security";
import { contentHash } from "../hash";

interface StoredInput { content: string; contentType: string; metadata: Record<string, string>; sizeBytes: number; }

/** In-memory fixture store. `open()` yields the content in bounded chunks to mimic streaming. */
export class LocalFixtureInputStore implements IntakeInputStore {
  private map = new Map<string, StoredInput>();
  constructor(private chunkBytes = 64 * 1024) {}

  async put(input: { content: Uint8Array | string; contentType: string; metadata?: Record<string, string> }): Promise<IntakeInputRef> {
    const text = typeof input.content === "string" ? input.content : new TextDecoder().decode(input.content);
    const sizeBytes = typeof input.content === "string" ? text.length : input.content.byteLength;
    if (sizeBytes > INTAKE_LIMITS.maxBytes) throw new Error(`Input exceeds max size (${sizeBytes} > ${INTAKE_LIMITS.maxBytes}).`);
    const ref = `fixture://${contentHash(text)}`;
    this.map.set(ref, { content: text, contentType: input.contentType, metadata: input.metadata ?? {}, sizeBytes });
    return { ref };
  }

  async open(ref: string): Promise<AsyncIterable<string>> {
    const rec = this.map.get(ref);
    if (!rec) throw new Error(`Unknown input ref "${ref}".`);
    const { content } = rec;
    const chunkBytes = this.chunkBytes;
    return (async function* () {
      for (let i = 0; i < content.length; i += chunkBytes) yield content.slice(i, i + chunkBytes);
    })();
  }

  async stat(ref: string): Promise<IntakeInputMetadata> {
    const rec = this.map.get(ref);
    if (!rec) throw new Error(`Unknown input ref "${ref}".`);
    return { ref, contentType: rec.contentType, sizeBytes: rec.sizeBytes, metadata: rec.metadata };
  }

  async delete(ref: string): Promise<void> { this.map.delete(ref); }
}
