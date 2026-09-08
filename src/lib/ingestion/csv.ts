/**
 * CSV ingestion — parse, map to entities, validate per row, and produce a
 * preview (accepted / warning / rejected) that the admin UI approves. No live
 * scraping: this is a controlled manual/CSV import path only.
 */

import type { IngestionDatabase, Product, ProductOffer, Store, OfferChannel, SourceType, PriceTrustLabel, AvailabilityLabel, AvailabilityStatus } from "./model";
import { validateOffer, validateProduct, validateStore, type ValidationIssue } from "./validation";
import { isValidSourceType, isValidTrustLabel, isValidAvailabilityStatus } from "./labels";
import { isEffectivelyStale } from "./freshness";

export type CsvKind = "stores" | "products" | "offers";

export interface CsvTemplate {
  kind: CsvKind;
  filename: string;
  columns: string[];
  sampleRows: string[][];
}

export const CSV_TEMPLATES: Record<CsvKind, CsvTemplate> = {
  products: {
    kind: "products",
    filename: "mallmind-products-template.csv",
    columns: ["canonicalName", "brand", "modelNumber", "category", "descriptionSummary", "gtin", "manufacturerSku"],
    sampleRows: [
      ['Hisense 43" A4 FHD Smart TV', "Hisense", "43A4K", "television", "43-inch Full HD smart TV", "", "43A4K"],
      ['TCL 50" P635 4K Smart TV', "TCL", "50P635", "television", "50-inch 4K UHD Google TV", "", "50P635"],
    ],
  },
  stores: {
    kind: "stores",
    filename: "mallmind-stores-template.csv",
    columns: ["retailerSlug", "mallSlug", "tradingName", "shopNumber", "floorLabel", "telephone", "storeUrl", "verificationStatus"],
    sampleRows: [
      ["game", "mall-at-reds", "Game Mall@Reds", "G12", "Ground Floor", "012 000 0000", "https://www.game.co.za/", "verified"],
    ],
  },
  offers: {
    kind: "offers",
    filename: "mallmind-offers-template.csv",
    columns: ["retailer", "mall", "store", "product_title", "brand", "category", "price", "original_price", "source_url", "source_type", "observed_at", "expires_at", "trust_label", "availability_status", "evidence_text"],
    sampleRows: [
      ["Game", "Mall@Reds", "Game Mall@Reds", 'Hisense 43" A4 FHD Smart TV', "Hisense", "television", "3999", "4499", "https://www.game.co.za/hisense-43a4k", "retailer_product_page", "2026-07-13T08:00:00.000Z", "", "recently_observed", "inferred", 'Product page: R3,999 (was R4,499)'],
      ["Checkers", "Mall@Reds", "", 'Hisense 32" A4 HD Smart TV', "Hisense", "television", "2999", "3499", "https://www.checkers.co.za/catalogue/hisense-32", "retailer_specials_page", "2026-07-12T16:00:00.000Z", "2026-07-16T00:00:00.000Z", "catalogue_special", "inferred", "Weekly catalogue p4"],
    ],
  },
};

/** Map the coarse RC1 availability_status onto a detailed availability scope. */
function scopeForStatus(status: AvailabilityStatus): AvailabilityLabel {
  switch (status) {
    case "known_available": return "online_stock_only";
    case "inferred": return "retailer_range_observed";
    case "unavailable": return "out_of_stock";
    default: return "availability_unknown";
  }
}

/** Build a downloadable CSV string (header + sample rows) for a template. */
export function templateCsvString(kind: CsvKind): string {
  const t = CSV_TEMPLATES[kind];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [t.columns.join(","), ...t.sampleRows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}

/** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v.trim() !== "")) records.push(row); }
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}

export interface CsvRowResult<T> {
  rowNumber: number;
  raw: Record<string, string>;
  entity: T | null;
  /** A new product to be created on commit (offers CSV, when the title is unknown). */
  newProduct?: Product | null;
  issues: ValidationIssue[];
  status: "accepted" | "warning" | "rejected";
}

export interface CsvPreview<T> {
  kind: CsvKind;
  columns: string[];
  results: CsvRowResult<T>[];
  totalRows: number;
  acceptedRows: number;
  warningRows: number;
  rejectedRows: number;
  missingColumns: string[];
}

function newId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${prefix}_${uuid}`;
}

const status = (issues: ValidationIssue[]): CsvRowResult<unknown>["status"] =>
  issues.some((i) => i.severity === "error") ? "rejected" : issues.some((i) => i.severity === "warning") ? "warning" : "accepted";

function assemble<T>(kind: CsvKind, results: CsvRowResult<T>[]): CsvPreview<T> {
  return {
    kind,
    columns: CSV_TEMPLATES[kind].columns,
    results,
    totalRows: results.length,
    acceptedRows: results.filter((r) => r.status === "accepted").length,
    warningRows: results.filter((r) => r.status === "warning").length,
    rejectedRows: results.filter((r) => r.status === "rejected").length,
    missingColumns: [],
  };
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

export function previewOffersCsv(rows: Record<string, string>[], db: IngestionDatabase, nowIso: string): CsvPreview<ProductOffer> {
  const nowMs = Date.parse(nowIso);
  const results = rows.map((raw, i): CsvRowResult<ProductOffer> => {
    const issues: ValidationIssue[] = [];
    // Retailer (required) — resolve by name or slug.
    const rName = norm(raw.retailer);
    const retailer = db.retailers.find((r) => norm(r.name) === rName || r.slug === rName);
    if (!retailer) issues.push({ code: "missing_retailer", severity: "error", field: "retailer", message: `No retailer "${raw.retailer}".` });
    // Mall (optional).
    let mallId: string | null = null;
    if (raw.mall?.trim()) {
      const mall = db.malls.find((m) => norm(m.name) === norm(raw.mall) || m.slug === norm(raw.mall));
      if (!mall) issues.push({ code: "wrong_mall", severity: "warning", field: "mall", message: `Mall "${raw.mall}" not found — offer staged without a mall link.` });
      else mallId = mall.id;
    }
    // Product — resolve by title; stage a NEW product if unknown.
    const title = raw.product_title?.trim() || "";
    if (!title) issues.push({ code: "missing_product", severity: "error", field: "product_title", message: "product_title is required." });
    let product = title ? db.products.find((p) => norm(p.canonicalName) === norm(title)) : undefined;
    let newProduct: Product | null = null;
    if (title && !product) {
      newProduct = {
        id: newId("product"), canonicalName: title, brand: raw.brand?.trim() || "", modelNumber: "",
        category: raw.category?.trim() || "television", descriptionSummary: "", gtin: null, manufacturerSku: null,
        normalizationStatus: "needs_review",
      };
      product = newProduct;
      issues.push({ code: "new_product", severity: "warning", field: "product_title", message: `New product "${title}" will be created (needs normalization).` });
    }

    // Taxonomy validation — invalid enum values must not silently pass through.
    const rawPrice = raw.price?.trim() ?? "";
    if (rawPrice === "" || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0)
      issues.push({ code: "invalid_price", severity: "error", field: "price", message: `Invalid price "${raw.price ?? ""}".` });

    const rawSourceType = raw.source_type?.trim() || "";
    if (rawSourceType && !isValidSourceType(rawSourceType))
      issues.push({ code: "invalid_source_type", severity: "error", field: "source_type", message: `Unknown source_type "${rawSourceType}".` });
    const sourceType: SourceType = isValidSourceType(rawSourceType) ? rawSourceType : "admin_csv";

    const rawTrust = raw.trust_label?.trim() || "";
    if (rawTrust && !isValidTrustLabel(rawTrust))
      issues.push({ code: "invalid_trust_label", severity: "error", field: "trust_label", message: `Unknown trust_label "${rawTrust}".` });
    const priceTrustLabel: PriceTrustLabel = isValidTrustLabel(rawTrust) ? rawTrust : "manual_admin";

    const rawAvail = raw.availability_status?.trim() || "";
    if (rawAvail && !isValidAvailabilityStatus(rawAvail))
      issues.push({ code: "invalid_availability", severity: "warning", field: "availability_status", message: `Unknown availability_status "${rawAvail}" — defaulted to unknown.` });
    const availabilityStatus: AvailabilityStatus = isValidAvailabilityStatus(rawAvail) ? rawAvail : "unknown";

    let entity: ProductOffer | null = null;
    if (retailer && product) {
      entity = {
        id: newId("offer"),
        productId: product.id,
        retailerId: retailer.id,
        sellerName: null,
        channel: (retailer.physicalRetailer ? "in_store" : "online") as OfferChannel,
        currency: "ZAR",
        currentPrice: Number(raw.price),
        previousPrice: raw.original_price?.trim() ? Number(raw.original_price) : null,
        promotionLabel: null,
        sourceUrl: raw.source_url?.trim() || "",
        sourceType,
        sourceObservedAt: raw.observed_at?.trim() || nowIso,
        expiresAt: raw.expires_at?.trim() || null,
        validUntil: raw.expires_at?.trim() || null,
        availabilityStatus,
        availabilityScope: scopeForStatus(availabilityStatus),
        priceTrustLabel,
        snapshotId: null,
        evidenceText: raw.evidence_text?.trim() || null,
        evidenceHash: null,
        conflictGroupId: null,
        reviewStatus: "staged",
        published: false,
        createdAt: nowIso,
        updatedAt: nowIso,
        demonstrationData: true,
      };
      issues.push(...validateOffer(entity, product === newProduct ? { ...db, products: [...db.products, newProduct!] } : db, nowMs));
      // Stale-on-import detection (past expiry, or observed beyond its freshness window).
      if (isEffectivelyStale(entity, nowMs))
        issues.push({ code: "stale_on_import", severity: "warning", field: "observed_at", message: "Row is already stale/expired at import — will be flagged for re-verification." });
    }
    return { rowNumber: i + 1, raw, entity, newProduct, issues, status: status(issues) };
  });
  return assemble("offers", results);
}

export function previewProductsCsv(rows: Record<string, string>[], db: IngestionDatabase, nowIso: string): CsvPreview<Product> {
  const results = rows.map((raw, i): CsvRowResult<Product> => {
    const entity: Product = {
      id: newId("product"),
      canonicalName: raw.canonicalName?.trim() || "",
      brand: raw.brand?.trim() || "",
      modelNumber: raw.modelNumber?.trim() || "",
      category: raw.category?.trim() || "television",
      descriptionSummary: raw.descriptionSummary?.trim() || "",
      gtin: raw.gtin?.trim() || null,
      manufacturerSku: raw.manufacturerSku?.trim() || null,
      normalizationStatus: "pending",
    };
    const issues = validateProduct(entity, db);
    return { rowNumber: i + 1, raw, entity, issues, status: status(issues) };
  });
  return assemble("products", results);
}

export function previewStoresCsv(rows: Record<string, string>[], db: IngestionDatabase, nowIso: string): CsvPreview<Store> {
  const results = rows.map((raw, i): CsvRowResult<Store> => {
    const issues: ValidationIssue[] = [];
    const retailer = db.retailers.find((r) => r.slug === (raw.retailerSlug ?? "").trim().toLowerCase());
    const mall = db.malls.find((m) => m.slug === (raw.mallSlug ?? "").trim().toLowerCase());
    let entity: Store | null = null;
    if (!retailer) issues.push({ code: "missing_retailer", severity: "error", field: "retailerSlug", message: `No retailer with slug "${raw.retailerSlug}".` });
    if (!mall) issues.push({ code: "wrong_mall", severity: "error", field: "mallSlug", message: `No mall with slug "${raw.mallSlug}".` });
    if (retailer && mall) {
      entity = {
        id: newId("store"),
        retailerId: retailer.id,
        mallId: mall.id,
        tradingName: raw.tradingName?.trim() || retailer.name,
        shopNumber: raw.shopNumber?.trim() || null,
        floorLabel: raw.floorLabel?.trim() || null,
        telephone: raw.telephone?.trim() || null,
        storeUrl: raw.storeUrl?.trim() || null,
        verificationStatus: (raw.verificationStatus?.trim() as Store["verificationStatus"]) || "needs_review",
        lastVerifiedAt: nowIso,
      };
      issues.push(...validateStore(entity, db));
    }
    return { rowNumber: i + 1, raw, entity, issues, status: status(issues) };
  });
  return assemble("stores", results);
}
