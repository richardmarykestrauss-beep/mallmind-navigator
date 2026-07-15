/**
 * Production-shaped Cloud Storage input store adapter.
 *
 * Postgres holds only an object REFERENCE (`gs://bucket/path#generation`), never
 * the payload. The worker validates the bucket allowlist, sanitizes the object
 * name (no path traversal), verifies generation + size + content hash, and STREAMS
 * the object (no full-object memory load). The real `@google-cloud/storage` client
 * is injected behind `GcsBackend` — this sprint ships a deterministic fixture
 * backend only (no network, no credentials, no public URLs).
 */

import type { IntakeInputStore, IntakeInputRef, IntakeInputMetadata } from "../types";
import { INTAKE_LIMITS } from "../security";
import { contentHash } from "../../hash";

export interface GcsObjectMeta { bucket: string; object: string; generation: string; sizeBytes: number; contentType: string; contentHash: string; }

/** The injectable storage backend. A real impl wraps @google-cloud/storage; here it is a fixture. */
export interface GcsBackend {
  head(bucket: string, object: string, generation?: string): Promise<GcsObjectMeta>;
  openStream(bucket: string, object: string, generation: string): Promise<AsyncIterable<string | Uint8Array>>;
  put?(bucket: string, object: string, content: string, contentType: string): Promise<GcsObjectMeta>;
}

export class GcsRefError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "GcsRefError"; }
}

/** Control-char matcher built from escapes (no literal control bytes in source). */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

export interface ParsedGcsRef { bucket: string; object: string; generation: string; }

/** Parse + sanitize a `gs://bucket/path#generation` reference. */
export function parseGcsRef(ref: string): ParsedGcsRef {
  const m = /^gs:\/\/([a-z0-9][a-z0-9._-]{0,220})\/([^#]+)#(\d+)$/.exec(ref);
  if (!m) throw new GcsRefError("malformed_ref", "Object reference must be gs://bucket/object#generation.");
  const [, bucket, object, generation] = m;
  if (object.includes("..") || object.startsWith("/") || CONTROL_CHARS.test(object)) throw new GcsRefError("path_traversal", "Illegal object name.");
  return { bucket, object, generation };
}

export interface GcsInputStoreConfig {
  allowedBuckets: string[];
  maxBytes?: number;
  /** Expected content hashes keyed by ref, when known (defence in depth). */
  expectedHashes?: Record<string, string>;
}

export class GcsInputStore implements IntakeInputStore {
  private allowed: Set<string>;
  private maxBytes: number;
  constructor(private backend: GcsBackend, private config: GcsInputStoreConfig) {
    this.allowed = new Set(config.allowedBuckets);
    this.maxBytes = config.maxBytes ?? INTAKE_LIMITS.maxBytes;
  }

  private validateRef(ref: string): ParsedGcsRef {
    const parsed = parseGcsRef(ref);
    if (!this.allowed.has(parsed.bucket)) throw new GcsRefError("bucket_not_allowed", `Bucket "${parsed.bucket}" is not allow-listed.`);
    return parsed;
  }

  /** Verify existence, generation, size and (when expected) content hash. */
  async verify(ref: string): Promise<GcsObjectMeta> {
    const { bucket, object, generation } = this.validateRef(ref);
    const meta = await this.backend.head(bucket, object, generation);
    if (meta.generation !== generation) throw new GcsRefError("generation_mismatch", "Object generation changed since it was referenced.");
    if (meta.sizeBytes > this.maxBytes) throw new GcsRefError("too_large", `Object exceeds max size (${meta.sizeBytes} > ${this.maxBytes}).`);
    const expected = this.config.expectedHashes?.[ref];
    if (expected && expected !== meta.contentHash) throw new GcsRefError("hash_mismatch", "Object content hash does not match expected metadata.");
    return meta;
  }

  async put(input: { content: Uint8Array | string; contentType: string; metadata?: Record<string, string> }): Promise<IntakeInputRef> {
    if (!this.backend.put) throw new GcsRefError("put_unsupported", "This backend does not support uploads (use the admin fixture uploader).");
    const bucket = this.config.allowedBuckets[0];
    const text = typeof input.content === "string" ? input.content : new TextDecoder().decode(input.content);
    const object = `fixtures/${contentHash(text).replace(/[^a-z0-9]/gi, "")}.dat`;
    const meta = await this.backend.put(bucket, object, text, input.contentType);
    return { ref: `gs://${meta.bucket}/${meta.object}#${meta.generation}` };
  }

  async open(ref: string): Promise<AsyncIterable<string | Uint8Array>> {
    await this.verify(ref);
    const { bucket, object, generation } = this.validateRef(ref);
    return this.backend.openStream(bucket, object, generation);
  }

  async stat(ref: string): Promise<IntakeInputMetadata> {
    const meta = await this.verify(ref);
    return { ref, contentType: meta.contentType, sizeBytes: meta.sizeBytes, metadata: { bucket: meta.bucket, object: meta.object, generation: meta.generation, contentHash: meta.contentHash } };
  }
}

/** Deterministic in-memory fixture backend — models GCS objects with generations. */
export class FixtureGcsBackend implements GcsBackend {
  private objects = new Map<string, { content: string; contentType: string; generation: string }>();
  private key(bucket: string, object: string) { return `${bucket}/${object}`; }

  /** Seed a fixture object; returns its ref. */
  seed(bucket: string, object: string, content: string, contentType = "text/plain", generation = "1"): string {
    this.objects.set(this.key(bucket, object), { content, contentType, generation });
    return `gs://${bucket}/${object}#${generation}`;
  }

  async put(bucket: string, object: string, content: string, contentType: string): Promise<GcsObjectMeta> {
    const generation = String(Date.parse("2026-07-13T12:00:00.000Z")); // deterministic
    this.objects.set(this.key(bucket, object), { content, contentType, generation });
    return { bucket, object, generation, sizeBytes: content.length, contentType, contentHash: contentHash(content) };
  }
  async head(bucket: string, object: string): Promise<GcsObjectMeta> {
    const o = this.objects.get(this.key(bucket, object));
    if (!o) throw new GcsRefError("not_found", "Object not found.");
    return { bucket, object, generation: o.generation, sizeBytes: o.content.length, contentType: o.contentType, contentHash: contentHash(o.content) };
  }
  async openStream(bucket: string, object: string): Promise<AsyncIterable<string>> {
    const o = this.objects.get(this.key(bucket, object));
    if (!o) throw new GcsRefError("not_found", "Object not found.");
    const content = o.content, chunkBytes = 64 * 1024;
    return (async function* () { for (let i = 0; i < content.length; i += chunkBytes) yield content.slice(i, i + chunkBytes); })();
  }

  /** Recovery-test hook: bump an object's generation (models an object changing mid-job). */
  bumpGeneration(bucket: string, object: string): void {
    const o = this.objects.get(this.key(bucket, object)); if (o) o.generation = String(Number(o.generation) + 1);
  }
}
