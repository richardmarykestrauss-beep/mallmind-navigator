/**
 * Search truth (Sprint 8): identity vs routability, category and alias vocabulary, product hints
 * as "you may find" inferences, and deterministic search-miss classification.
 */
import { describe, it, expect } from "vitest";
import { getVenuePack } from "./registry";
import { searchDestinationsDetailed, searchableDestinations, classifySearch, arrivalNodeFor, editDistance } from "./search";
import { matchCategories, CATEGORIES, categoryLabel } from "./vocabulary";

const grm = getVenuePack("garden-route-mall")!;
const names = (q: string) => searchDestinationsDetailed(grm, q).map((h) => `${h.name}${h.routable ? "" : "*"}:${h.matched_via}`);

describe("identity vs routability (Garden Route Mall pack v2)", () => {
  it("lists every known tenant but marks only those with source-backed arrival geometry as routable", () => {
    const all = searchableDestinations(grm);
    expect(all.map((d) => [d.name, d.routable])).toEqual([["Woolworths", true], ["Clicks", true], ["Pick n Pay", true], ["Dis-Chem", false], ["Food Lover's Market", false], ["Game", false]]);
    expect(all.find((d) => d.name === "Dis-Chem")).toMatchObject({ arrivalNode: null, unit: "122/123", categoryLabel: "Health & beauty" });
    expect(arrivalNodeFor(grm, "grm-dischem-122")).toBeNull();
    expect(arrivalNodeFor(grm, "grm-clicks-37")).toBe("grm-clicks-arrival");
  });

  it("name, alias, unit and common spellings resolve; typed ids never leak", () => {
    expect(names("dischem")).toEqual(["Dis-Chem*:alias"]);
    expect(names("dis chem")).toEqual(["Dis-Chem*:name"]);
    expect(names("woolies")).toEqual(["Woolworths:alias"]);
    expect(names("pnp")).toEqual(["Pick n Pay:alias"]);
    expect(names("41")).toEqual(["Pick n Pay:unit"]);
    expect(names("food lovers")).toEqual(["Food Lover's Market*:alias"]);
  });
});

describe("category vocabulary", () => {
  it("'pharmacy' and 'chemist' find the health & beauty tenants, routable first", () => {
    expect(names("pharmacy")).toEqual(["Clicks:alias", "Dis-Chem*:alias"]);
    expect(names("chemist")).toEqual(["Clicks:category", "Dis-Chem*:category"]);
  });
  it("'groceries' / 'supermarket' use visitor aliases, not an invented category", () => {
    expect(names("groceries")).toEqual(["Woolworths:alias", "Pick n Pay:alias", "Food Lover's Market*:alias"]);
    expect(names("supermarket")).toEqual(["Pick n Pay:alias", "Food Lover's Market*:alias"]);
  });
  it("a product hint ('shampoo') is a plausibility inference, reported as such — never stock", () => {
    const hits = searchDestinationsDetailed(grm, "where can I buy shampoo");
    expect(hits.map((h) => [h.name, h.matched_via])).toEqual([["Clicks", "product_hint"], ["Dis-Chem", "product_hint"]]);
    expect(matchCategories("shampoo")).toEqual([{ category: CATEGORIES[0], via: "product_hint" }]);
    expect(matchCategories("pharmacy")[0].via).toBe("term");
  });
  it("the vocabulary is small, closed and labelled", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["health_beauty", "supermarket", "department_store", "food_drink"]);
    expect(categoryLabel("department_store")).toBe("Department store");
    expect(categoryLabel("nope")).toBeNull();
  });
});

describe("search-miss classification (deterministic groundwork for demand analytics)", () => {
  it("results → matched_via and categories; no raw text is needed downstream", () => {
    expect(classifySearch(grm, "Clicks")).toMatchObject({ query_normalized: "clicks", result_count: 1, matched_via: "name", miss_reason: null });
    expect(classifySearch(grm, "shampoo")).toMatchObject({ result_count: 2, matched_via: "product_hint", categories: ["health_beauty"] });
  });
  it("a near-miss of a known name is a possible typo / alias gap, with the nearest known word for curation", () => {
    expect(classifySearch(grm, "Clics")).toMatchObject({ result_count: 0, miss_reason: "possible_typo_or_alias_gap", nearest_known: "clicks" });
    expect(classifySearch(grm, "Woolwoths")).toMatchObject({ miss_reason: "possible_typo_or_alias_gap", nearest_known: "woolworths" });
  });
  it("a known category the venue lacks is 'known_category_absent'; nonsense is 'unknown'", () => {
    expect(classifySearch(grm, "coffee")).toMatchObject({ result_count: 0, miss_reason: "known_category_absent", categories: ["food_drink"] });
    expect(classifySearch(grm, "Banana Kingdom")).toMatchObject({ result_count: 0, miss_reason: "unknown", categories: [] });
    expect(classifySearch(grm, "   ")).toMatchObject({ result_count: 0, miss_reason: null });
  });
  it("edit distance is the plain Levenshtein", () => {
    expect(editDistance("clicks", "clics")).toBe(1);
    expect(editDistance("", "ab")).toBe(2);
  });
});
