/**
 * CSV ingestion — parse, map to entities, validate per row, and produce a
 * preview (accepted / warning / rejected) that the admin UI approves. No live
 * scraping: this is a controlled manual/CSV import path only.
 */

import type { IngestionDatabase, Product, ProductOffer, Store, OfferChannel, SourceType, PriceTrustLabel, AvailabilityLabel } from "./model";
import { validateOffer, validateProduct, validateStore, type ValidationIssue } from "./validation";

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
    columns: ["productModelNumber", "retailerSlug", "sellerName", "channel", "currency", "currentPrice", "previousPrice", "promotionLabel", "sourceUrl", "sourceType", "sourceObservedAt", "validUntil", "availabilityScope", "priceTrustLabel"],
    sampleRows: [
      ["43A4K", "game", "", "in_store", "ZAR", "3999", "4499", "Weekend special", "https://www.game.co.za/hisense-43a4k", "retailer_product_page", "2026-07-13T08:00:00.000Z", "", "retailer_range_observed", "recently_observed"],
    ],
  },
};

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

export function previewOffersCsv(rows: Record<string, string>[], db: IngestionDatabase, nowIso: string): CsvPreview<ProductOffer> {
  const nowMs = Date.parse(nowIso);
  const results = rows.map((raw, i): CsvRowResult<ProductOffer> => {
    const issues: ValidationIssue[] = [];
    const product = db.products.find((p) => p.modelNumber.trim().toLowerCase() === (raw.productModelNumber ?? "").trim().toLowerCase());
    const retailer = db.retailers.find((r) => r.slug === (raw.retailerSlug ?? "").trim().toLowerCase());
    if (!product) issues.push({ code: "missing_product", severity: "error", field: "productModelNumber", message: `No product with model "${raw.productModelNumber}".` });
    if (!retailer) issues.push({ code: "missing_retailer", severity: "error", field: "retailerSlug", message: `No retailer with slug "${raw.retailerSlug}".` });

    let entity: ProductOffer | null = null;
    if (product && retailer) {
      entity = {
        id: newId("offer"),
        productId: product.id,
        retailerId: retailer.id,
        sellerName: raw.sellerName?.trim() || null,
        channel: (raw.channel?.trim() as OfferChannel) || "online",
        currency: (raw.currency?.trim() || "ZAR").toUpperCase(),
        currentPrice: Number(raw.currentPrice),
        previousPrice: raw.previousPrice?.trim() ? Number(raw.previousPrice) : null,
        promotionLabel: raw.promotionLabel?.trim() || null,
        sourceUrl: raw.sourceUrl?.trim() || "",
        sourceType: (raw.sourceType?.trim() as SourceType) || "csv_import",
        sourceObservedAt: raw.sourceObservedAt?.trim() || nowIso,
        validUntil: raw.validUntil?.trim() || null,
        availabilityScope: (raw.availabilityScope?.trim() as AvailabilityLabel) || "availability_unknown",
        priceTrustLabel: (raw.priceTrustLabel?.trim() as PriceTrustLabel) || "manual_admin",
        reviewStatus: "pending",
        published: false,
        createdAt: nowIso,
        updatedAt: nowIso,
        demonstrationData: true,
      };
      issues.push(...validateOffer(entity, db, nowMs));
    }
    return { rowNumber: i + 1, raw, entity, issues, status: status(issues) };
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
