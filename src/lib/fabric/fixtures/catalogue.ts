/**
 * Deterministic catalogue fixture — extracted catalogue blocks.
 *
 * PROTOTYPE FIXTURE representing what a catalogue extractor (future Document AI /
 * OCR) WOULD emit for a public specials catalogue. No OCR, no API, no network call
 * is performed here — these are hand-authored blocks with page + bounding-box
 * metadata so the provenance drawer can show where a value came from.
 */

export interface CatalogueBlock {
  blockId: string;
  productTitle: string;
  brand: string;
  price: number;
  originalPrice: number | null;
  currency: string;
  validFrom: string;
  validTo: string;
  pageNumber: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  rawText: string;
}

export interface CatalogueFixture {
  catalogueId: string;
  sourceUrl: string;
  title: string;
  owner: string;
  blocks: CatalogueBlock[];
}

export const CATALOGUE_FIXTURE: CatalogueFixture = {
  catalogueId: "cat_checkers_2026_07",
  sourceUrl: "https://www.checkers.co.za/catalogue/electronics-2026-07.pdf",
  title: "Checkers Electronics Catalogue — July 2026",
  owner: "Checkers",
  blocks: [
    {
      blockId: "cat_blk_hisense32",
      productTitle: 'Hisense 32" A4 HD Smart TV',
      brand: "Hisense",
      price: 2999,
      originalPrice: 3499,
      currency: "ZAR",
      validFrom: "2026-07-11",
      validTo: "2026-07-17",
      pageNumber: 4,
      boundingBox: { x: 62, y: 410, width: 240, height: 96 },
      rawText: 'Hisense 32" A4 HD Smart TV — R2 999 (was R3 499). Valid 11–17 July.',
    },
    {
      blockId: "cat_blk_skyworth40",
      productTitle: 'Skyworth 40" FHD Smart TV',
      brand: "Skyworth",
      price: 3499,
      originalPrice: null,
      currency: "ZAR",
      validFrom: "2026-07-11",
      validTo: "2026-07-17",
      pageNumber: 5,
      boundingBox: { x: 320, y: 120, width: 236, height: 92 },
      rawText: 'Skyworth 40" FHD Smart TV — R3 499. Valid 11–17 July.',
    },
  ],
};
