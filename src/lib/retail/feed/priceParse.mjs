/**
 * priceParse.mjs — decimal-safe South African rand parsing (Sprint 2K).
 *
 * Prices are parsed to INTEGER minor units (cents) using string math only — never a
 * binary float — so R79.99 is exactly 7999, not 79.98999999. The exact display string
 * is preserved alongside. Pure, deterministic, no I/O.
 */

/**
 * @param {unknown} raw
 * @returns {{ ok: true, cents: number, display: string } | { ok: false, reason: string }}
 */
export function parseRand(raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
  let s = String(raw).trim();
  if (s === "") return { ok: false, reason: "empty" };
  // Strip currency markers and spaces (thousands spaces included).
  s = s.replace(/^R\s*/i, "").replace(/ZAR/i, "").replace(/\s/g, "");
  // Decide decimal separator deterministically:
  //  - if both '.' and ',' present → the LAST one is the decimal, the other is thousands
  //  - if only ',' present and it has exactly 2 trailing digits → decimal comma; else thousands
  const hasDot = s.includes("."), hasComma = s.includes(",");
  let decSep = ".";
  if (hasDot && hasComma) decSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
  else if (hasComma && !hasDot) decSep = /,\d{1,2}$/.test(s) ? "," : ".";
  // Remove the thousands separator, normalise decimal to '.'
  const thouSep = decSep === "." ? "," : ".";
  s = s.split(thouSep).join("");
  if (decSep === ",") s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: "non_numeric" };
  const [intPart, fracRaw = ""] = s.split(".");
  if (fracRaw.length > 2) return { ok: false, reason: "too_many_decimals" };
  const frac = (fracRaw + "00").slice(0, 2);
  const cents = Number(intPart) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents) || cents < 0) return { ok: false, reason: "out_of_range" };
  const display = `${intPart}.${frac}`;
  return { ok: true, cents, display };
}

/** Format integer cents back to a display string (audit/report use). */
export function formatCents(cents) {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
