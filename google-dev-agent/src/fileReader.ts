/**
 * fileReader.ts
 *
 * Safe file reader for the IMPLEMENT_TASK workflow.
 *
 * Safety:
 *   - Each requested path is checked against the blocklist before reading.
 *   - Per-file cap: MAX_FILE_BYTES (100 KB)
 *   - Total cap across all files: MAX_TOTAL_BYTES (300 KB)
 *   - Missing files produce a warning entry rather than a hard crash,
 *     so a task can safely list a file that may not exist yet.
 *
 * Returns a Map<relativePath, content> — forward-slash keys, no absolute paths.
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, relative } from "path";
import { isFilePathSafeToRead } from "./safetyGuard.js";

// ── Caps ──────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES  = 100 * 1024;   // 100 KB per file
const MAX_TOTAL_BYTES = 300 * 1024;   // 300 KB total

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReadResult {
  /** file path relative to repo root, forward slashes */
  path: string;
  /** file content, or null if skipped */
  content: string | null;
  /** reason the file was skipped (missing, blocked, too large, over total cap) */
  skipReason?: string;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Read all requested file paths.
 *
 * @param paths       Relative paths from repo root (forward or back slashes accepted)
 * @param repoRoot    Absolute path to the repo root directory
 * @returns           Map<normalisedRelativePath, content> for files that were read.
 *                    Use readAll() for the full result set including skipped files.
 */
export function readFiles(paths: string[], repoRoot: string): Map<string, string> {
  const results = readAll(paths, repoRoot);
  const map = new Map<string, string>();
  for (const r of results) {
    if (r.content !== null) {
      map.set(r.path, r.content);
    }
  }
  return map;
}

/**
 * Read all requested file paths, including entries for skipped files.
 * Useful for reporting which files were read and why some were skipped.
 */
export function readAll(paths: string[], repoRoot: string): ReadResult[] {
  const results: ReadResult[] = [];
  let totalBytes = 0;

  for (const rawPath of paths) {
    const normPath = rawPath.replace(/\\/g, "/");
    const absPath  = resolve(repoRoot, normPath);

    // ── 1. Blocklist check ────────────────────────────────────────────────────
    const safety = isFilePathSafeToRead(normPath);
    if (!safety.allowed) {
      results.push({ path: normPath, content: null, skipReason: `BLOCKED: ${safety.reason}` });
      continue;
    }

    // ── 2. Existence check ────────────────────────────────────────────────────
    if (!existsSync(absPath)) {
      results.push({ path: normPath, content: null, skipReason: "NOT FOUND: file does not exist" });
      continue;
    }

    // ── 3. Per-file size cap ──────────────────────────────────────────────────
    const stat = statSync(absPath);
    if (stat.size > MAX_FILE_BYTES) {
      results.push({
        path: normPath,
        content: null,
        skipReason: `TOO LARGE: ${(stat.size / 1024).toFixed(1)} KB exceeds the ${MAX_FILE_BYTES / 1024} KB per-file cap. ` +
          `Split the task into smaller read_paths or trim the file.`,
      });
      continue;
    }

    // ── 4. Total cap ──────────────────────────────────────────────────────────
    if (totalBytes + stat.size > MAX_TOTAL_BYTES) {
      results.push({
        path: normPath,
        content: null,
        skipReason: `TOTAL CAP: adding this file would exceed the ${MAX_TOTAL_BYTES / 1024} KB total read cap. ` +
          `Remove some paths from read_paths or split into multiple tasks.`,
      });
      continue;
    }

    // ── 5. Read ───────────────────────────────────────────────────────────────
    try {
      const content = readFileSync(absPath, "utf-8");
      totalBytes += Buffer.byteLength(content, "utf-8");
      // Normalise the key to always be relative from repoRoot, forward slashes
      const relPath = relative(repoRoot, absPath).replace(/\\/g, "/");
      results.push({ path: relPath, content });
    } catch (err) {
      results.push({
        path: normPath,
        content: null,
        skipReason: `READ ERROR: ${String(err)}`,
      });
    }
  }

  return results;
}

/** Summarise read results for logging. */
export function summariseReads(results: ReadResult[]): string {
  const read    = results.filter((r) => r.content !== null);
  const skipped = results.filter((r) => r.content === null);
  const lines = [
    `📂 Files read: ${read.length}/${results.length}`,
    ...read.map((r)    => `   ✅ ${r.path}`),
    ...skipped.map((r) => `   ⚠️  ${r.path} — ${r.skipReason}`),
  ];
  return lines.join("\n");
}
