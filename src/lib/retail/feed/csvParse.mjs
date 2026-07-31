/**
 * csvParse.mjs — small, dependency-free, deterministic CSV reader (Sprint 2K).
 * Quote-aware (RFC-4180-ish): handles quoted fields containing commas, quotes ("")
 * and newlines; tolerant of CRLF/LF. Pure — no I/O, no network. Returns raw string
 * cells; the adapter decides meaning. source_row_number is 1-based on DATA rows
 * (header is row 0), matching how a retailer references their spreadsheet rows.
 */

/**
 * @param {string} text
 * @returns {{ headers: string[], rows: Array<{ source_row_number: number, cells: string[] }> }}
 */
export function parseCsv(text) {
  const records = [];
  let field = "", record = [], inQuotes = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
    } else field += c;
  }
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }

  // Drop trailing fully-empty records (blank lines at EOF).
  while (records.length && records[records.length - 1].every((v) => v.trim() === "")) records.pop();
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    if (cells.every((v) => v.trim() === "")) continue; // skip blank data lines
    rows.push({ source_row_number: r, cells });
  }
  return { headers, rows };
}

/** Zip a data row's cells to a header→value object (extra cells → __extra_N). */
export function rowToObject(headers, cells) {
  const obj = {};
  const n = Math.max(headers.length, cells.length);
  for (let i = 0; i < n; i++) {
    const key = headers[i] !== undefined && headers[i] !== "" ? headers[i] : `__extra_${i}`;
    obj[key] = cells[i] !== undefined ? cells[i] : "";
  }
  return obj;
}
