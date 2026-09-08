/**
 * jsonFeedReader.mjs — deterministic JSON feed reader (Sprint 2L-A).
 *
 * Reads a JSON feed (text or already-parsed) into a products array with retained source
 * position, WITHOUT a second validation pipeline: the products are handed to a retailer
 * adapter and then the SAME `importFeed` used for CSV. Pure — no network, no I/O beyond
 * the caller passing text. Invalid JSON and invalid feed shape fail deterministically.
 */

/**
 * @param {string|object} input  JSON text or a parsed object
 * @param {{ productsPath?: string }} [opts]
 * @returns {{ ok: true, envelope: object, products: Array<{source_row_number:number, product:any}> }
 *         | { ok: false, error: string, message: string }}
 */
export function readJsonFeed(input, opts = {}) {
  const productsPath = opts.productsPath ?? "products";
  let value;
  if (typeof input === "string") {
    try { value = JSON.parse(input); }
    catch (e) { return { ok: false, error: "INVALID_JSON", message: `not valid JSON: ${String(e && e.message)}` }; }
  } else {
    value = input;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "INVALID_FEED_SHAPE", message: "feed root must be a JSON object" };
  }
  const arr = value[productsPath];
  if (!Array.isArray(arr)) {
    return { ok: false, error: "INVALID_FEED_SHAPE", message: `expected an array at '${productsPath}'` };
  }
  // Array position is the deterministic source_row_number (1-based).
  const products = arr.map((product, i) => ({ source_row_number: i + 1, product }));
  return { ok: true, envelope: value, products };
}

/** Feed-level metadata assertions (shape only — never network). */
export function validateFeedEnvelope(envelope) {
  const problems = [];
  if (!envelope || typeof envelope !== "object") { problems.push("envelope missing"); return problems; }
  if (envelope.feed_contract_version !== undefined && String(envelope.feed_contract_version).split(".")[0] !== "1")
    problems.push(`unsupported feed_contract_version '${envelope.feed_contract_version}'`);
  if (!envelope.retailer_source_id) problems.push("retailer_source_id is required at feed level");
  return problems;
}
