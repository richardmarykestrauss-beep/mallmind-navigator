/**
 * vocabulary.ts — the SMALL, deterministic category vocabulary shared by every venue.
 *
 * A destination's `category` is an id from this file. Each category carries visitor words
 * ("pharmacy", "chemist") and a few PRODUCT HINTS ("shampoo") that make a category PLAUSIBLE.
 * A hint match is an inference about where a visitor "may find" something — never an inventory,
 * stock or price fact. The list is deliberately short and testable; it is not a retail ontology.
 */

export interface VenueCategory {
  id: string;
  /** Visitor-facing label. */
  label: string;
  /** Words a visitor might type for this category (matched as whole words). */
  terms: string[];
  /** Products that make this category plausible ("you may find this at …"). Never a stock claim. */
  product_hints: string[];
}

export const CATEGORIES: readonly VenueCategory[] = [
  {
    id: "health_beauty",
    label: "Health & beauty",
    terms: ["pharmacy", "chemist", "health", "beauty", "medicine", "medication", "cosmetics", "toiletries"],
    product_hints: ["shampoo", "toothpaste", "vitamins", "plasters", "sunscreen", "deodorant", "soap", "painkillers", "nappies"],
  },
  {
    id: "supermarket",
    label: "Supermarket",
    terms: ["supermarket", "groceries", "grocery", "grocer", "food store"],
    product_hints: ["milk", "bread", "eggs", "vegetables", "fruit", "meat", "snacks", "cooldrink"],
  },
  {
    id: "department_store",
    label: "Department store",
    terms: ["department store", "department stores"],
    product_hints: ["clothes", "clothing", "homeware", "appliances", "bedding", "toys"],
  },
  {
    id: "food_drink",
    label: "Food & drink",
    terms: ["restaurant", "restaurants", "coffee", "cafe", "café", "takeaway", "eat", "lunch"],
    product_hints: [],
  },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryById(id: string | null | undefined): VenueCategory | null {
  return id ? byId.get(id) ?? null : null;
}

export function categoryLabel(id: string | null | undefined): string | null {
  return categoryById(id)?.label ?? null;
}

/** Normalise free text for matching: lower case, accents folded, punctuation → spaces. */
export function normalizeTerm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export interface CategoryMatch { category: VenueCategory; via: "term" | "product_hint" }

/**
 * Which categories a query points at. A query matches a category when it contains one of the
 * category's terms as whole words (strong) or one of its product hints (plausible, "you may find").
 */
export function matchCategories(query: string): CategoryMatch[] {
  const q = ` ${normalizeTerm(query)} `;
  if (q.trim() === "") return [];
  const out: CategoryMatch[] = [];
  for (const c of CATEGORIES) {
    if (c.terms.some((t) => q.includes(` ${normalizeTerm(t)} `))) out.push({ category: c, via: "term" });
    else if (c.product_hints.some((h) => q.includes(` ${normalizeTerm(h)} `))) out.push({ category: c, via: "product_hint" });
  }
  return out;
}
