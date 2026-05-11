/**
 * fileEditor.ts
 *
 * Applies a validated plan to disk, with safety checks and automatic backups.
 *
 * Safety guarantees:
 *   - Every file_path is re-validated against the allowlist + blocklist before writing.
 *   - Every old_string is verified to exist verbatim in the current file.
 *     If ANY change fails pre-flight, the ENTIRE plan is aborted before touching disk.
 *   - Originals are backed up before the first write.
 *   - Only "edit" change_type is accepted ("create"/"delete" are Phase 3+ scope).
 *   - The agent never deletes files.
 *
 * Rollback: restoreBackup() reverses all writes by copying backups back.
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import { isFilePathAllowed } from "./safetyGuard.js";
import type { PlanChange, StoredPlan } from "./taskSchema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditResult {
  file_path: string;
  success: boolean;
  description: string;
  /** Lines added (positive) and removed (negative) — approximate. */
  lines_added: number;
  lines_removed: number;
  backup_path: string | null;
  error?: string;
}

export interface ApplyOutcome {
  success: boolean;
  results: EditResult[];
  /** If false, no files were touched (pre-flight failed). */
  disk_writes_attempted: boolean;
  error?: string;
}

// ── Pre-flight check ──────────────────────────────────────────────────────────
// Runs entirely before touching disk. Any failure aborts the whole plan.

interface PreflightResult {
  ok: boolean;
  error?: string;
  /** Absolute file contents keyed by file_path for use during apply. */
  currentContents: Map<string, string>;
}

function preflightPlan(
  changes: PlanChange[],
  allowedWritePaths: string[],
  repoRoot: string
): PreflightResult {
  const allowedSet = new Set(allowedWritePaths.map((p) => p.replace(/\\/g, "/")));
  const currentContents = new Map<string, string>();

  if (changes.length === 0) {
    return { ok: false, error: "Plan contains no changes.", currentContents };
  }
  if (changes.length > 10) {
    return {
      ok: false,
      error: `Plan has ${changes.length} changes but the maximum is 10. Split into smaller tasks.`,
      currentContents,
    };
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const label  = `Change ${i + 1} ("${change.file_path}")`;
    const norm   = (change.file_path ?? "").replace(/\\/g, "/");

    // 1. change_type must be "edit"
    if (change.change_type !== "edit") {
      return {
        ok: false,
        error: `${label}: change_type is "${change.change_type}" but only "edit" is supported in Phase 2.`,
        currentContents,
      };
    }

    // 2. File path must be in the task's allowed_write_paths
    if (!allowedSet.has(norm)) {
      return {
        ok: false,
        error: `${label}: "${norm}" is not in allowed_write_paths. ` +
          `Add it to the task file if this edit is intentional.`,
        currentContents,
      };
    }

    // 3. File path must pass the system-level safety gates
    const safety = isFilePathAllowed(norm);
    if (!safety.allowed) {
      return {
        ok: false,
        error: `${label}: safety check failed — ${safety.reason}`,
        currentContents,
      };
    }

    // 4. old_string and new_string must be non-empty strings
    if (typeof change.old_string !== "string" || change.old_string === "") {
      return { ok: false, error: `${label}: old_string must be a non-empty string.`, currentContents };
    }
    if (typeof change.new_string !== "string") {
      return { ok: false, error: `${label}: new_string must be a string.`, currentContents };
    }

    // 5. File must exist on disk
    const absPath = resolve(repoRoot, norm);
    if (!existsSync(absPath)) {
      return {
        ok: false,
        error: `${label}: file "${absPath}" does not exist. ` +
          `Only "edit" is supported — creating new files is Phase 3 scope.`,
        currentContents,
      };
    }

    // 6. Read current content (once per file — subsequent changes to same file see original)
    let content = currentContents.get(norm);
    if (content === undefined) {
      try {
        content = readFileSync(absPath, "utf-8");
        currentContents.set(norm, content);
      } catch (err) {
        return { ok: false, error: `${label}: cannot read "${absPath}": ${String(err)}`, currentContents };
      }
    }

    // 7. old_string must exist verbatim in the file
    if (!content.includes(change.old_string)) {
      // Provide a useful diagnostic — show first 80 chars of old_string
      const preview = change.old_string.slice(0, 80).replace(/\n/g, "↵");
      return {
        ok: false,
        error: `${label}: old_string not found in "${norm}". ` +
          `The file may have changed since the plan was generated. Re-run plan mode.\n` +
          `  Looking for: "${preview}${change.old_string.length > 80 ? "…" : ""}"`,
        currentContents,
      };
    }
  }

  return { ok: true, currentContents };
}

// ── Diff summary ──────────────────────────────────────────────────────────────

function diffSummary(oldStr: string, newStr: string): { lines_added: number; lines_removed: number } {
  const oldLines = oldStr.split("\n").length;
  const newLines = newStr.split("\n").length;
  const delta = newLines - oldLines;
  return {
    lines_added:   delta > 0 ? delta : 0,
    lines_removed: delta < 0 ? -delta : 0,
  };
}

// ── Backup ────────────────────────────────────────────────────────────────────

function backupFile(
  filePath: string,
  repoRoot: string,
  backupDir: string
): string {
  const absPath    = resolve(repoRoot, filePath);
  // Replace slashes and colons with underscores for a flat backup filename
  const safeName   = filePath.replace(/[/\\:]/g, "_");
  const backupPath = resolve(backupDir, safeName);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(absPath, backupPath);
  return backupPath;
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export function applyPlan(plan: StoredPlan, repoRoot: string, backupBaseDir: string): ApplyOutcome {
  const { changes, task } = plan;

  // 1. Pre-flight — check everything before touching disk
  const preflight = preflightPlan(changes, task.allowed_write_paths, repoRoot);
  if (!preflight.ok) {
    return {
      success: false,
      results: [],
      disk_writes_attempted: false,
      error: preflight.error,
    };
  }

  // 2. Backup originals
  const backupDir = resolve(backupBaseDir, plan.plan_id);
  mkdirSync(backupDir, { recursive: true });

  const backedUp = new Map<string, string>(); // file_path → backup_path
  const uniqueFiles = [...new Set(changes.map((c) => c.file_path.replace(/\\/g, "/")))];

  for (const filePath of uniqueFiles) {
    try {
      const bp = backupFile(filePath, repoRoot, backupDir);
      backedUp.set(filePath.replace(/\\/g, "/"), bp);
    } catch (err) {
      return {
        success: false,
        results: [],
        disk_writes_attempted: false,
        error: `Failed to backup "${filePath}" before applying changes: ${String(err)}`,
      };
    }
  }

  // 3. Apply edits — accumulate current content per file so multiple edits to
  //    the same file compose correctly.
  const workingContent = new Map(preflight.currentContents);
  const results: EditResult[] = [];
  let allSuccess = true;

  for (const change of changes) {
    const norm       = change.file_path.replace(/\\/g, "/");
    const absPath    = resolve(repoRoot, norm);
    const current    = workingContent.get(norm)!;
    const updated    = current.replace(change.old_string, change.new_string);
    const { lines_added, lines_removed } = diffSummary(change.old_string, change.new_string);

    try {
      writeFileSync(absPath, updated, "utf-8");
      workingContent.set(norm, updated); // subsequent edits to same file see new content
      results.push({
        file_path:     norm,
        success:       true,
        description:   change.description,
        lines_added,
        lines_removed,
        backup_path:   backedUp.get(norm) ?? null,
      });
    } catch (err) {
      allSuccess = false;
      results.push({
        file_path:     norm,
        success:       false,
        description:   change.description,
        lines_added:   0,
        lines_removed: 0,
        backup_path:   backedUp.get(norm) ?? null,
        error:         String(err),
      });
      // Stop on first write failure — don't leave the repo in a partial state
      break;
    }
  }

  return {
    success: allSuccess,
    results,
    disk_writes_attempted: true,
  };
}

// ── Rollback ──────────────────────────────────────────────────────────────────

export interface RollbackOutcome {
  success: boolean;
  restored: string[];
  errors: string[];
}

export function restoreBackup(plan: StoredPlan, repoRoot: string, backupBaseDir: string): RollbackOutcome {
  const backupDir  = resolve(backupBaseDir, plan.plan_id);
  const uniqueFiles = [...new Set(plan.changes.map((c) => c.file_path.replace(/\\/g, "/")))];
  const restored: string[] = [];
  const errors:   string[] = [];

  for (const filePath of uniqueFiles) {
    const safeName   = filePath.replace(/[/\\:]/g, "_");
    const backupPath = resolve(backupDir, safeName);
    const targetPath = resolve(repoRoot, filePath);

    if (!existsSync(backupPath)) {
      errors.push(`No backup found for "${filePath}" at "${backupPath}".`);
      continue;
    }

    try {
      copyFileSync(backupPath, targetPath);
      restored.push(filePath);
    } catch (err) {
      errors.push(`Failed to restore "${filePath}": ${String(err)}`);
    }
  }

  return {
    success: errors.length === 0,
    restored,
    errors,
  };
}
