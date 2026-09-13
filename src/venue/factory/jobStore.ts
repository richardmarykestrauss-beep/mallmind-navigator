/**
 * jobStore.ts — the ONLY place the factory touches the filesystem.
 *
 * Every job lives under <root>/<job_id>/ and every path the factory reads or writes for a job is
 * resolved through `safeJoin`, which rejects absolute paths, "..", backslashes and anything that
 * would land outside the job directory. JSON is parsed with JSON.parse only (no eval, no modules,
 * no HTML), with a size cap. Nothing here fetches a URL, ever.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";
import { createHash } from "node:crypto";
import { JOB_ID_PATTERN, type IngestionJob } from "./types";
import { checkJob, formatIssues } from "./validateInputs";

export const MAX_JSON_BYTES = 8 * 1024 * 1024;
const REL_PATH_RE = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9_./-]{1,200}$/;

export class FactoryError extends Error {}

/** <root>/<job_id>, refusing ids that are not slugs (so no traversal is even expressible). */
export function jobDir(root: string, jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) throw new FactoryError(`invalid job id "${jobId}" (expected ${JOB_ID_PATTERN})`);
  const r = resolve(root);
  const dir = resolve(r, jobId);
  if (!dir.startsWith(r + sep)) throw new FactoryError(`job directory escapes the factory root: ${dir}`);
  return dir;
}

/** Join a job-relative path safely: never absolute, never "..", never outside the job directory. */
export function safeJoin(dir: string, rel: string): string {
  if (typeof rel !== "string" || !REL_PATH_RE.test(rel) || rel.includes("\\")) throw new FactoryError(`unsafe path "${rel}" (job-relative, no "..", no leading slash, no backslashes)`);
  const base = resolve(dir);
  const out = resolve(base, rel);
  if (out !== base && !out.startsWith(base + sep)) throw new FactoryError(`path "${rel}" resolves outside the job directory`);
  return out;
}

export function sha256(data: Buffer | string): string { return createHash("sha256").update(data).digest("hex"); }

/** Deterministic JSON text (2-space indent, trailing newline) — what every artifact and pack is written as. */
export function stableJson(value: unknown): string { return JSON.stringify(value, null, 2) + "\n"; }

export function readJson(absPath: string): unknown {
  if (!existsSync(absPath)) throw new FactoryError(`file not found: ${absPath}`);
  const st = statSync(absPath);
  if (!st.isFile()) throw new FactoryError(`not a file: ${absPath}`);
  if (st.size > MAX_JSON_BYTES) throw new FactoryError(`${absPath} is larger than ${MAX_JSON_BYTES} bytes`);
  const text = readFileSync(absPath, "utf8");
  try { return JSON.parse(text); } catch (err) { throw new FactoryError(`${absPath} is not valid JSON: ${(err as Error).message}`); }
}

export function writeJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, stableJson(value));
}

/** PNG dimensions from the IHDR chunk (signature checked); null for anything that is not a PNG. No decoding. */
export function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(sig)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

export interface LoadedJob { dir: string; job: IngestionJob }

export function loadJob(root: string, jobId: string): LoadedJob {
  const dir = jobDir(root, jobId);
  const file = safeJoin(dir, "job.json");
  if (!existsSync(file)) throw new FactoryError(`job "${jobId}" does not exist (${file})`);
  const c = checkJob(readJson(file));
  if (c.status !== "ok") throw new FactoryError(`job.json for "${jobId}" is invalid:\n${formatIssues(c.errors)}`);
  if (c.value.job_id !== jobId) throw new FactoryError(`job.json belongs to "${c.value.job_id}", not "${jobId}"`);
  return { dir, job: c.value };
}

export function saveJob(dir: string, job: IngestionJob): void { writeJson(safeJoin(dir, "job.json"), job); }

export function readJobJson(dir: string, rel: string): unknown { return readJson(safeJoin(dir, rel)); }
export function writeJobJson(dir: string, rel: string, value: unknown): string { const abs = safeJoin(dir, rel); writeJson(abs, value); return rel; }
export function readJobBytes(dir: string, rel: string): Buffer { const abs = safeJoin(dir, rel); if (!existsSync(abs) || !statSync(abs).isFile()) throw new FactoryError(`missing file ${rel}`); return readFileSync(abs); }
export function jobFileExists(dir: string, rel: string): boolean { const abs = safeJoin(dir, rel); return existsSync(abs) && statSync(abs).isFile(); }
export function copyIntoJob(dir: string, rel: string, fromAbs: string): void { const abs = safeJoin(dir, rel); mkdirSync(dirname(abs), { recursive: true }); copyFileSync(fromAbs, abs); }

export function listJobs(root: string): string[] {
  const r = resolve(root);
  if (!existsSync(r)) return [];
  return readdirSync(r).filter((d) => JOB_ID_PATTERN.test(d) && existsSync(resolve(r, d, "job.json"))).sort();
}

/** Next sequence number for a numbered artifact folder (01-, 02-, …). */
export function nextSeq(existing: string[]): string { return String(existing.length + 1).padStart(2, "0"); }
