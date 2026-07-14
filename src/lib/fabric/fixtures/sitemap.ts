/**
 * Deterministic XML sitemap fixture.
 *
 * PROTOTYPE FIXTURE — a local <urlset> string. The SitemapFixtureAdapter parses
 * it to emit candidate product/category URLs. No live request is ever made.
 */

export const SITEMAP_FIXTURE = {
  sourceUrl: "https://www.game.co.za/sitemap-products.xml",
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.game.co.za/hisense-43a4k</loc>
    <lastmod>2026-07-13</lastmod>
  </url>
  <url>
    <loc>https://www.game.co.za/tcl-43p635</loc>
    <lastmod>2026-07-12</lastmod>
  </url>
  <url>
    <loc>https://www.game.co.za/category/televisions</loc>
    <lastmod>2026-07-10</lastmod>
  </url>
</urlset>`,
};
