/**
 * MallMind Build OS — Issue Form parser (AF-1)
 *
 * Robustly extracts GitHub Issue Form sections from a rendered issue body. The
 * pilot for issue #5 failed because the previous inline parser split on
 * `\n###\s+`, which keeps the `### ` prefix on the FIRST heading (the form's
 * `markdown` intro block is not rendered into the body, so `### Task type` is the
 * first line). That made `task type` always empty.
 *
 * This parser is line-based and tolerant of:
 *   - a heading on the very first line (no leading newline);
 *   - CRLF or LF line endings;
 *   - blank lines between heading and value;
 *   - surrounding whitespace;
 *   - heading capitalization differences;
 *   - multi-line field values;
 *   - inline/fenced formatting inside values (kept verbatim).
 *
 * First occurrence of a heading wins, so a later free-text field cannot override
 * an earlier structured field by embedding a fake `### Heading`.
 *
 * Pure: no I/O, no network, no GitHub API.
 */

export const PERMITTED_TASK_TYPES = ["docs", "frontend", "backend", "test"];
export const FORBIDDEN_TASK_TYPES = [
  "db", "migration", "deployment", "infrastructure",
  "secrets", "workflow", "branch-protection", "billing", "production",
];

/** Logical field -> exact Issue Form heading (lower-cased for matching). */
export const FIELD_HEADINGS = {
  task_type: "task type",
  priority: "priority",
  objective: "objective",
  allowed_files: "allowed file globs",
  acceptance: "acceptance criteria",
  required_gates: "required gates",
  max_diff_lines: "maximum diff lines",
  additional_context: "additional context",
};

/** GitHub renders an empty optional field as this sentinel. */
const NO_RESPONSE = /^_no response_$/i;

/**
 * Parse an issue body into a { heading(lowercased) -> value } map.
 * @param {string} body
 * @returns {Record<string,string>}
 */
export function parseIssueForm(body) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const sections = {};
  let key = null;
  let buf = [];
  const flush = () => {
    if (key !== null && !(key in sections)) {
      const value = buf.join("\n").trim();
      sections[key] = NO_RESPONSE.test(value) ? "" : value;
    }
    buf = [];
  };
  for (const line of lines) {
    // Exactly three '#': "### Heading". "#### x" is NOT a section heading.
    const m = /^###[ \t]+(.+?)[ \t]*$/.exec(line);
    if (m) {
      flush();
      key = m[1].trim().toLowerCase();
    } else if (key !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Extract the known AF-1 task fields from an issue body.
 * @returns {{task_type,priority,objective,allowed_files,acceptance,required_gates,max_diff_lines,additional_context}}
 */
export function extractTask(body) {
  const s = parseIssueForm(body);
  const get = (logical) => (s[FIELD_HEADINGS[logical]] ?? "").trim();
  return {
    task_type: get("task_type").toLowerCase(),
    priority: get("priority"),
    objective: get("objective"),
    allowed_files: get("allowed_files"),
    acceptance: get("acceptance"),
    required_gates: get("required_gates") || "verify:all",
    max_diff_lines: Number.parseInt(get("max_diff_lines") || "400", 10) || 400,
    additional_context: get("additional_context"),
  };
}

/**
 * Validate an extracted task against AF-1 rules.
 * @returns {{ok:boolean, reason:string|null}}
 */
export function validateTask(task) {
  if (FORBIDDEN_TASK_TYPES.includes(task.task_type))
    return { ok: false, reason: `task type \`${task.task_type}\` is forbidden in AF-1` };
  if (!PERMITTED_TASK_TYPES.includes(task.task_type))
    return { ok: false, reason: `task type \`${task.task_type}\` is not one of: ${PERMITTED_TASK_TYPES.join(", ")}` };
  if (!task.allowed_files) return { ok: false, reason: "no allowed_files were specified" };
  if (!task.objective) return { ok: false, reason: "no objective was specified" };
  return { ok: true, reason: null };
}

/** Build the agent branch slug from an issue title. */
export function slugFromTitle(title) {
  return String(title || "task")
    .replace(/^\[AF-1\]\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}
