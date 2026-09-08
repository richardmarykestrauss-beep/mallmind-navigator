/**
 * Real Cloud Storage backend for the durable intake worker.
 *
 * Implements the `GcsBackend` port that Sprint 2D defined, so ALL the safety rules
 * already enforced by `GcsInputStore` (bucket allowlist, path-traversal rejection,
 * generation match, size ceiling, content-hash verification) apply unchanged — this
 * file only performs the network I/O behind them.
 *
 * Credentials: Application Default Credentials only, resolved from the Cloud Run
 * service account. There is no embedded service-account JSON key, no key file path,
 * and no key material in source or in env.
 *
 * The object payload is STREAMED. It is never fully buffered, never logged, and no
 * signed or public URL is ever generated — the durable job carries a
 * `gs://bucket/object#generation` reference, and nothing else ever leaves this file.
 */

import { Storage } from "@google-cloud/storage";
import type { GcsBackend, GcsObjectMeta } from "@/lib/fabric/intake/durable/gcsInputStore";
import { GcsRefError } from "@/lib/fabric/intake/durable/gcsInputStore";

/**
 * Custom-metadata key holding the fabric content hash the uploader computed.
 *
 * GCS's own md5Hash/crc32c are different algorithms from the fabric's `contentHash`,
 * so they cannot answer "is this the object the job was created against?". The
 * uploader writes the fabric hash here, and the worker compares against it — which
 * also binds the object to our uploader rather than to whatever wrote the bucket.
 */
export const FIXTURE_HASH_METADATA_KEY = "input_hash";
/** Custom-metadata marker proving the object came from the generated fixture uploader. */
export const FIXTURE_MARKER_METADATA_KEY = "fixture";

export interface RealGcsBackendOptions {
  /** Optional injected client (tests). Defaults to ADC. */
  storage?: Storage;
  /** When true, refuse to read any object not marked as a generated fixture. */
  fixtureOnlyMode: boolean;
}

export class RealGcsBackend implements GcsBackend {
  private readonly storage: Storage;
  private readonly fixtureOnlyMode: boolean;

  constructor(opts: RealGcsBackendOptions) {
    // No keyFilename / no credentials object: ADC from the worker service account.
    this.storage = opts.storage ?? new Storage();
    this.fixtureOnlyMode = opts.fixtureOnlyMode;
  }

  private file(bucket: string, object: string, generation?: string) {
    const f = this.storage.bucket(bucket).file(object, generation ? { generation: Number(generation) } : undefined);
    return f;
  }

  async head(bucket: string, object: string, generation?: string): Promise<GcsObjectMeta> {
    let meta: Record<string, unknown>;
    try {
      [meta] = (await this.file(bucket, object, generation).getMetadata()) as unknown as [Record<string, unknown>];
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) throw new GcsRefError("not_found", "Object not found.");
      if (code === 403) throw new GcsRefError("forbidden", "Worker is not permitted to read this object.");
      // Never surface the driver message: it can carry URLs and auth details.
      throw new GcsRefError("storage_error", "Cloud Storage read failed.");
    }

    const custom = (meta.metadata ?? {}) as Record<string, string>;

    // Fixture-only boundary, enforced at the object as well as at the job.
    if (this.fixtureOnlyMode && custom[FIXTURE_MARKER_METADATA_KEY] !== "true") {
      throw new GcsRefError("fixture_only", "Durable worker is currently restricted to generated development fixtures.");
    }

    const contentHash = custom[FIXTURE_HASH_METADATA_KEY];
    if (!contentHash) {
      throw new GcsRefError("missing_hash", "Object has no fabric content hash; it was not written by the fixture uploader.");
    }

    return {
      bucket,
      object,
      generation: String(meta.generation ?? ""),
      sizeBytes: Number(meta.size ?? 0),
      contentType: String(meta.contentType ?? "application/octet-stream"),
      contentHash,
    };
  }

  /**
   * Stream the object at an EXACT generation. Pinning the generation means an
   * object replaced mid-job fails the read rather than silently mixing two versions
   * into one job's counters.
   */
  async openStream(bucket: string, object: string, generation: string): Promise<AsyncIterable<Uint8Array>> {
    const stream = this.file(bucket, object, generation).createReadStream();
    return (async function* () {
      try {
        for await (const chunk of stream) yield chunk as Uint8Array;   // streamed; never buffered whole
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code === 404) throw new GcsRefError("generation_gone", "Object generation is no longer available.");
        throw new GcsRefError("storage_error", "Cloud Storage stream failed.");
      } finally {
        stream.destroy();
      }
    })();
  }

  // `put` is intentionally NOT implemented. The worker reads inputs; only the
  // operator-run fixture uploader writes them, so the worker's service account
  // needs no object-create permission at all.
}
