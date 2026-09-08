/**
 * retailAdapter.ts — Sprint 2I
 *
 * The DELIBERATELY TINY retail source-adapter contract. A source adapter does two
 * things only:
 *   1. acquire()  — get bytes from a permitted source → an immutable snapshot reference (bronze)
 *   2. parse()    — turn that snapshot into raw, observation-shaped candidates (silver-input)
 *
 * Everything else — normalization, product-identity matching, trust, freshness,
 * human review, publication — is SHARED, retailer-agnostic pipeline and is NOT part
 * of an adapter. Legal/commercial RIGHTS are governed DATA on retail_data_sources,
 * never decided in adapter code. Adapters emit work the existing durable intake
 * worker runs; the worker terminates at the observation/staging boundary and never
 * publishes.
 */

export type PriceScope =
  | "online_national" | "online_regional" | "branch_specific" | "catalogue_national" | "unknown";
export type AvailabilityScope =
  | "online" | "delivery_area" | "click_collect" | "branch_confirmed" | "unknown" | "not_observed";
export type PriceCondition =
  | "standard" | "loyalty" | "promotional" | "bulk" | "bundle" | "online_only" | "unknown";

/** Immutable evidence pointer the durable worker persists (bronze). */
export interface SnapshotReference {
  sourceId: string;
  capturedAt: string;      // ISO 8601
  contentHash: string;     // deterministic; used for idempotency / de-dup of captures
  mediaType: string;       // e.g. "application/json", "text/csv"
  byteSize: number;
  sourceUrl?: string | null;
}

export interface AcquisitionInput {
  sourceId: string;
  /** Opaque discovery reference (URL, file path, feed cursor). Adapter-specific. */
  reference?: unknown;
}

/**
 * One parsed, observation-shaped row BEFORE normalization/matching/trust. Every
 * unknown stays null/absent — an adapter never invents a floor, category, scope, or
 * branch. Identity precedence: sourceProductId → retailerSku → barcode+attrs.
 */
export interface RawRetailCandidate {
  // ── as-observed identity ──
  sourceProductId?: string | null;
  retailerSku?: string | null;
  barcode?: string | null;          // GTIN as STRING — leading zeros preserved
  sourceUrl?: string | null;
  // ── catalogue ──
  productName: string;
  brand?: string | null;
  category?: string | null;         // null = unknown (never invented)
  variant?: string | null;
  packSize?: string | null;
  // ── price ──
  price: number;
  originalPrice?: number | null;
  priceScope?: PriceScope;
  priceCondition?: PriceCondition;
  priceConditionLabel?: string | null;
  loyaltyProgram?: string | null;
  minimumQuantity?: number | null;
  promotionText?: string | null;
  // ── availability ──
  availabilityScope?: AvailabilityScope;
  inStock?: boolean | null;
  // ── provenance ──
  observedAt: string;               // ISO 8601
  validTo?: string | null;
}

/** The two-method adapter contract. Nothing else belongs here. */
export interface RetailAdapter {
  readonly sourceId: string;
  readonly adapterName: string;
  readonly adapterVersion: string;
  acquire(input: AcquisitionInput): Promise<SnapshotReference>;
  parse(snapshot: SnapshotReference): Promise<RawRetailCandidate[]>;
}

/** Deterministic, dependency-free content hash (djb2) — fine for capture idempotency. */
export function contentHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * Candidate-level integrity mirroring the DB CHECK constraints in migration 036, so a
 * bad candidate is caught in the pipeline before it ever reaches Postgres. Returns the
 * list of problems ([] = valid). Does NOT decide rights or branch identity (those are
 * source data / publisher concerns).
 */
export function validateCandidate(c: RawRetailCandidate): string[] {
  const problems: string[] = [];
  if (!c.productName || !c.productName.trim()) problems.push("productName is required");
  if (!(typeof c.price === "number") || c.price < 0) problems.push("price must be >= 0");
  const cond = c.priceCondition ?? "unknown";
  const minQty = c.minimumQuantity ?? null;
  if (minQty !== null && !(minQty > 0)) problems.push("minimumQuantity must be > 0");
  if ((cond === "bulk" || cond === "bundle") && minQty === null)
    problems.push(`${cond} price requires minimumQuantity`);
  if (cond === "loyalty" && !c.loyaltyProgram && !c.priceConditionLabel)
    problems.push("loyalty price requires loyaltyProgram or priceConditionLabel");
  if (cond === "standard" && minQty !== null)
    problems.push("standard price must not carry minimumQuantity");
  return problems;
}

/**
 * De-duplicate candidates by deterministic listing identity (precedence
 * sourceProductId → retailerSku → barcode). Later candidates win (a refresh updates
 * the listing). Candidates with no stable identity are kept as-is (never merged on
 * product name alone).
 */
export function dedupeCandidates(candidates: RawRetailCandidate[]): RawRetailCandidate[] {
  const keyed = new Map<string, RawRetailCandidate>();
  const unkeyed: RawRetailCandidate[] = [];
  for (const c of candidates) {
    const id = c.sourceProductId ?? c.retailerSku ?? c.barcode ?? null;
    if (id === null) { unkeyed.push(c); continue; }
    keyed.set(id, c); // later wins
  }
  return [...keyed.values(), ...unkeyed];
}
