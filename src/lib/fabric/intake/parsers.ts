/**
 * Streaming chunk parsers: an async iterable of text/byte chunks → an async
 * iterable of flat RawRecords. CSV and JSONL stream line-by-line (bounded
 * memory); JSON arrays are buffered (JSONL is the streaming-preferred format).
 *
 * Nothing here holds all rows in memory: the engine consumes records lazily.
 */

import type { RawRecord } from "./types";
import { safeJsonParse, scrubObject } from "./security";

// `InstanceType<typeof TextDecoder>` rather than `TextDecoder`: the DOM lib declares
// TextDecoder as both a type and a value, but Node's lib declares only the value, and
// this module is compiled for BOTH the browser bundle and the Cloud Run worker.
function toText(chunk: string | Uint8Array, dec: InstanceType<typeof TextDecoder>): string {
  return typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
}

/** Split one CSV logical line into fields (quotes + escaped quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

/** Yield complete CSV logical lines as chunks arrive, respecting quoted newlines. */
async function* logicalCsvLines(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "", inQ = false;
  for await (const chunk of chunks) {
    buf += toText(chunk, dec);
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === "\n" && !inQ) { yield buf.slice(start, i).replace(/\r$/, ""); start = i + 1; }
    }
    buf = buf.slice(start);
  }
  if (buf.trim() !== "") yield buf.replace(/\r$/, "");
}

export async function* streamCsvRecords(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<RawRecord> {
  let headers: string[] | null = null;
  for await (const line of logicalCsvLines(chunks)) {
    const fields = splitCsvLine(line);
    if (headers === null) { headers = fields.map((h) => h.trim()); continue; }
    const rec: RawRecord = {};
    headers.forEach((h, i) => (rec[h] = (fields[i] ?? "").trim()));
    yield scrubObject(rec);
  }
}

export async function* streamJsonlRecords(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<RawRecord> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of chunks) {
    buf += toText(chunk, dec);
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) yield scrubObject(safeJsonParse(line)) as RawRecord;
    }
  }
  if (buf.trim()) yield scrubObject(safeJsonParse(buf.trim())) as RawRecord;
}

/** JSON array parser — buffers the whole document, then yields elements lazily. */
export async function* streamJsonArrayRecords(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<RawRecord> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of chunks) buf += toText(chunk, dec);
  const parsed = safeJsonParse(buf);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array at the top level.");
  for (const el of parsed) yield scrubObject(el) as RawRecord;
}

export function recordStreamFor(mode: "csv" | "jsonl" | "json", chunks: AsyncIterable<string | Uint8Array>): AsyncIterable<RawRecord> {
  if (mode === "csv") return streamCsvRecords(chunks);
  if (mode === "jsonl") return streamJsonlRecords(chunks);
  return streamJsonArrayRecords(chunks);
}
