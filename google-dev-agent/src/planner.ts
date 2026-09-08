/**
 * planner.ts
 *
 * Calls Gemini 2.5 Flash to generate a structured implementation plan
 * from a task description and file contents.
 *
 * Credential priority:
 *   1. GEMINI_API_KEY env var  → direct API key (no gcloud needed, good for local dev)
 *   2. GOOGLE_CLOUD_PROJECT    → Vertex AI with Application Default Credentials
 *
 * Gemini is asked to return ONLY a JSON object. The agent then:
 *   - Extracts the JSON (code-block or raw)
 *   - Validates the structure
 *   - Re-checks all file paths against the safety gates
 *   - Verifies every old_string exists in the actual file content
 *
 * Only "edit" change_type is accepted from Gemini.
 * Gemini does NOT produce: plan_id, created_at, build_commands — these are
 * added by the agent code to prevent Gemini from hallucinating those fields.
 */

import { GoogleGenAI } from "@google/genai";
import { isFilePathAllowed } from "./safetyGuard.js";
import type { AgentTask, PlanChange, StoredPlan } from "./taskSchema.js";
import { buildCommandsFor } from "./taskSchema.js";

// ── Gemini client factory ─────────────────────────────────────────────────────

function makeAI(): GoogleGenAI {
  if (process.env.GEMINI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.VERTEX_AI_LOCATION ?? "us-central1",
    });
  }
  throw new Error(
    "Gemini credentials not found.\n" +
      "  Option A (local): set GEMINI_API_KEY in .env\n" +
      "  Option B (GCP):   set GOOGLE_CLOUD_PROJECT and run:\n" +
      "                    gcloud auth application-default login"
  );
}

// ── Plan ID generator ─────────────────────────────────────────────────────────

function makePlanId(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return [
    "plan",
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPlannerPrompt(task: AgentTask, fileContents: Map<string, string>): string {
  const filesSection = [...fileContents.entries()]
    .map(
      ([path, content]) =>
        `### FILE: ${path}\n\`\`\`\n${content}\n\`\`\``
    )
    .join("\n\n");

  const allowedWriteList = task.allowed_write_paths.map((p) => `  - ${p}`).join("\n");

  return `You are a TypeScript code implementation agent for the MallMind project.
Your job is to produce a precise, minimal implementation plan as a JSON object.

## Task

**ID:** ${task.task_id}
**Description:** ${task.description}

**Implementation instruction:**
${task.instruction}

${task.context ? `**Additional context:**\n${task.context}` : ""}

## Files you may edit

Only these files are in scope for edits:
${allowedWriteList}

DO NOT propose edits to any file not in this list.

## Current file contents

${filesSection}

## Instructions for your response

Return ONLY a valid JSON object — no markdown prose before or after it.
The JSON must follow this exact schema:

{
  "summary": "<one paragraph describing what this plan does and why>",
  "changes": [
    {
      "file_path": "<relative path from repo root, forward slashes>",
      "change_type": "edit",
      "description": "<one sentence describing this specific edit>",
      "old_string": "<exact substring currently in the file — must match character-for-character>",
      "new_string": "<replacement string>"
    }
  ],
  "suggested_commit_message": "<conventional commit message with type(scope): subject and a body paragraph>"
}

Rules you must follow:
1. change_type must always be "edit". Never use "create" or "delete".
2. old_string must be an EXACT substring of the current file content shown above.
   Copy it directly from the file — do not paraphrase, reformat, or abbreviate.
3. new_string replaces old_string entirely. Include enough surrounding context in
   old_string to make it unique if the string appears more than once.
4. Keep changes minimal — only touch lines that are directly necessary.
5. Propose no more than 10 changes total.
6. Do not edit files outside the allowed list above.
7. The suggested_commit_message should follow Conventional Commits format:
   type(scope): short subject (max 72 chars)

   Body explaining the "why" in 2-4 sentences.
8. If the task is already done (e.g. the field already exists), return an empty
   changes array with a summary explaining why no changes are needed.

Return only the JSON object. No code fences around the entire response.`;
}

// ── JSON extractor ────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const trimmed = text.trim();

  // Try bare JSON first (starts with {)
  if (trimmed.startsWith("{")) return trimmed;

  // Try extracting from ```json ... ``` code block
  const jsonBlock = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock?.[1]) return jsonBlock[1].trim();

  // Try extracting from ``` ... ``` code block (no language tag)
  const rawBlock = trimmed.match(/```\s*([\s\S]*?)```/);
  if (rawBlock?.[1]) return rawBlock[1].trim();

  // Last resort: find the first { and last } and extract
  const first = trimmed.indexOf("{");
  const last  = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return trimmed;
}

// ── Plan validator ────────────────────────────────────────────────────────────

interface GeminiPlanRaw {
  summary?: unknown;
  changes?: unknown;
  suggested_commit_message?: unknown;
}

function validateGeminiPlan(
  raw: GeminiPlanRaw,
  task: AgentTask,
  fileContents: Map<string, string>
): PlanChange[] {
  if (typeof raw.summary !== "string" || !raw.summary.trim()) {
    throw new Error("Gemini response missing \"summary\" field.");
  }

  if (!Array.isArray(raw.changes)) {
    throw new Error("Gemini response missing \"changes\" array.");
  }

  if (raw.changes.length > 10) {
    throw new Error(`Gemini proposed ${raw.changes.length} changes but the maximum is 10.`);
  }

  const allowedSet = new Set(task.allowed_write_paths.map((p) => p.replace(/\\/g, "/")));
  const validated: PlanChange[] = [];

  for (let i = 0; i < raw.changes.length; i++) {
    const c   = raw.changes[i] as Record<string, unknown>;
    const idx = `Change ${i + 1}`;

    // change_type
    if (c.change_type !== "edit") {
      throw new Error(
        `${idx}: change_type is "${c.change_type}" but only "edit" is supported. ` +
          `Creating and deleting files requires manual implementation.`
      );
    }

    // file_path
    if (typeof c.file_path !== "string" || !c.file_path.trim()) {
      throw new Error(`${idx}: "file_path" must be a non-empty string.`);
    }
    const norm = (c.file_path as string).replace(/\\/g, "/");

    // Must be in allowed_write_paths
    if (!allowedSet.has(norm)) {
      throw new Error(
        `${idx}: Gemini proposed editing "${norm}" which is not in allowed_write_paths. ` +
          `Allowed: ${[...allowedSet].join(", ")}.`
      );
    }

    // Must pass safety gates
    const safety = isFilePathAllowed(norm);
    if (!safety.allowed) {
      throw new Error(`${idx}: "${norm}" failed safety check — ${safety.reason}`);
    }

    // old_string / new_string
    if (typeof c.old_string !== "string" || c.old_string === "") {
      throw new Error(`${idx}: "old_string" must be a non-empty string.`);
    }
    if (typeof c.new_string !== "string") {
      throw new Error(`${idx}: "new_string" must be a string.`);
    }

    // Verify old_string exists in file content
    const content = fileContents.get(norm);
    if (content === undefined) {
      throw new Error(
        `${idx}: no content loaded for "${norm}". ` +
          `Ensure it is listed in read_paths so the agent can read it.`
      );
    }
    if (!content.includes(c.old_string as string)) {
      const preview = (c.old_string as string).slice(0, 80).replace(/\n/g, "↵");
      throw new Error(
        `${idx}: old_string not found verbatim in "${norm}".\n` +
          `  Looking for: "${preview}${(c.old_string as string).length > 80 ? "…" : ""}"\n` +
          `  Gemini may have reformatted the string. Re-run plan generation.`
      );
    }

    // description
    if (typeof c.description !== "string") {
      throw new Error(`${idx}: "description" must be a string.`);
    }

    validated.push({
      file_path:   norm,
      change_type: "edit",
      description: c.description as string,
      old_string:  c.old_string as string,
      new_string:  c.new_string as string,
    });
  }

  return validated;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generatePlan(
  task: AgentTask,
  fileContents: Map<string, string>
): Promise<StoredPlan> {
  const ai = makeAI();

  console.log(`\n🤖 Calling Gemini 2.5 Flash to generate plan...`);
  const prompt = buildPlannerPrompt(task, fileContents);

  let responseText: string;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1, // low temperature for deterministic code edits
      },
    });
    responseText = response.text?.trim() ?? "";
  } catch (err) {
    throw new Error(`Gemini API call failed: ${String(err)}`);
  }

  if (!responseText) {
    throw new Error("Gemini returned an empty response. Check your API credentials and quota.");
  }

  // Extract and parse JSON
  let raw: GeminiPlanRaw;
  try {
    const jsonStr = extractJson(responseText);
    raw = JSON.parse(jsonStr) as GeminiPlanRaw;
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini response as JSON: ${String(err)}\n` +
        `Response was:\n${responseText.slice(0, 500)}`
    );
  }

  // Validate the plan content
  const changes = validateGeminiPlan(raw, task, fileContents);

  const planId = makePlanId();
  const storedPlan: StoredPlan = {
    plan_version:              "2",
    plan_id:                   planId,
    created_at:                new Date().toISOString(),
    task,
    summary:                   (raw.summary as string).trim(),
    changes,
    build_commands:            buildCommandsFor(task.build_target),
    suggested_commit_message:  typeof raw.suggested_commit_message === "string"
                                 ? (raw.suggested_commit_message as string).trim()
                                 : "",
  };

  console.log(`✅ Plan generated: ${planId} (${changes.length} change${changes.length !== 1 ? "s" : ""})`);
  return storedPlan;
}
