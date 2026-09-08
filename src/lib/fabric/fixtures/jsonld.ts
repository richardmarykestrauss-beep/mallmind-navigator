/**
 * Deterministic Schema.org Product/Offer JSON-LD fixtures.
 *
 * PROTOTYPE FIXTURE — these strings stand in for what a public product page's
 * embedded JSON-LD would contain. No network request is ever made. No personal
 * data is present.
 */

export interface JsonLdFixture {
  candidateId: string;
  sourceUrl: string;
  title: string;
  /** Raw JSON-LD exactly as it would appear in a <script type="application/ld+json">. */
  jsonLd: string;
}

export const JSONLD_FIXTURES: JsonLdFixture[] = [
  {
    candidateId: "jsonld_game_hisense43",
    sourceUrl: "https://www.game.co.za/hisense-43a4k",
    title: 'Hisense 43" A4 FHD Smart TV',
    jsonLd: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: 'Hisense 43" A4 FHD Smart TV',
      brand: { "@type": "Brand", name: "Hisense" },
      sku: "43A4K",
      mpn: "43A4K",
      gtin13: "6942147489012",
      category: "television",
      offers: {
        "@type": "Offer",
        priceCurrency: "ZAR",
        price: "3999.00",
        availability: "https://schema.org/InStock",
        url: "https://www.game.co.za/hisense-43a4k",
      },
    }, null, 2),
  },
  {
    candidateId: "jsonld_pnp_tcl43",
    sourceUrl: "https://www.pnp.co.za/tcl-43p635",
    title: 'TCL 43" P635 4K Google TV',
    jsonLd: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: 'TCL 43" P635 4K Google TV',
      brand: { "@type": "Brand", name: "TCL" },
      sku: "43P635",
      mpn: "43P635",
      category: "television",
      offers: {
        "@type": "Offer",
        priceCurrency: "ZAR",
        price: "3799.00",
        availability: "https://schema.org/LimitedAvailability",
        url: "https://www.pnp.co.za/tcl-43p635",
      },
    }, null, 2),
  },
];
