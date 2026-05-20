/**
 * imageDimensionService.ts — Sprint 12D.1
 *
 * Utility to read pixel dimensions from image buffers or remote URLs.
 * Uses the `image-size` v1.x package (CommonJS compatible).
 *
 * Policy:
 *   - Max 512 kB downloaded per image (headers are usually in the first few KB)
 *   - 10-second fetch timeout
 *   - Errors are non-fatal — returns null dimensions + a warning string
 *   - No writes to any table; caller decides how to use dimensions
 */

import imageSize from "image-size";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImageDimensions {
  width:  number;
  height: number;
}

export interface FetchDimensionsResult {
  dimensions: ImageDimensions | null;
  warnings:   string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum bytes downloaded before giving up. Most image headers are <1 kB. */
export const MAX_DIMENSION_FETCH_BYTES = 512 * 1024; // 512 kB

/** Fetch timeout in milliseconds. */
export const DIMENSION_FETCH_TIMEOUT_MS = 10_000;

// ── Pure buffer parser ────────────────────────────────────────────────────────

/**
 * Parse pixel dimensions from an in-memory image buffer.
 * Returns null if the buffer is too small or not a recognised image format.
 *
 * Pure function — no network, no side-effects. Testable without mocks.
 */
export function parseImageDimensions(
  buffer: Buffer | Uint8Array,
): ImageDimensions | null {
  if (!buffer || buffer.length === 0) return null;

  try {
    const result = imageSize(buffer instanceof Buffer ? buffer : Buffer.from(buffer));
    if (
      result &&
      typeof result.width  === "number" &&
      typeof result.height === "number" &&
      result.width  > 0 &&
      result.height > 0
    ) {
      return { width: result.width, height: result.height };
    }
    return null;
  } catch {
    return null;
  }
}

// ── HTTP fetcher ──────────────────────────────────────────────────────────────

/**
 * Fetch an image URL and return its pixel dimensions.
 * Always resolves (never rejects) — errors are returned as warnings.
 *
 * The function downloads at most MAX_DIMENSION_FETCH_BYTES so it works
 * efficiently on large PNGs and multi-megabyte floor-map images.
 */
export async function fetchImageDimensions(
  url: string,
): Promise<FetchDimensionsResult> {
  const warnings: string[] = [];

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), DIMENSION_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MallMindBot/1.0 (research-only; +https://mallmind.co.za/bot)",
        "Accept":     "image/*",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      warnings.push(
        `Image dimension fetch failed: HTTP ${response.status} from ${url}`,
      );
      return { dimensions: null, warnings };
    }

    // Stream only up to MAX_DIMENSION_FETCH_BYTES
    const reader   = response.body?.getReader();
    if (!reader) {
      warnings.push(`Image dimension fetch: no response body for ${url}`);
      return { dimensions: null, warnings };
    }

    const chunks: Uint8Array[] = [];
    let   totalBytes = 0;
    let   truncated  = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const remaining = MAX_DIMENSION_FETCH_BYTES - totalBytes;
        if (value.length <= remaining) {
          chunks.push(value);
          totalBytes += value.length;
        } else {
          // Take only what we still need
          chunks.push(value.slice(0, remaining));
          totalBytes += remaining;
          truncated   = true;
          await reader.cancel();
          break;
        }
      }
    }

    if (truncated) {
      warnings.push(
        `Image truncated at ${MAX_DIMENSION_FETCH_BYTES / 1024} kB for dimension read: ${url}`,
      );
    }

    // Merge chunks into a single Buffer
    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const dims   = parseImageDimensions(merged);

    if (!dims) {
      warnings.push(`Could not parse image dimensions from ${url}`);
    }

    return { dimensions: dims, warnings };

  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(
      msg.includes("abort")
        ? `Image dimension fetch timed out after ${DIMENSION_FETCH_TIMEOUT_MS / 1000} s: ${url}`
        : `Image dimension fetch error for ${url}: ${msg}`,
    );
    return { dimensions: null, warnings };
  }
}
