#!/usr/bin/env node
/**
 * make-synthetic-plan.mjs — draws the SYNTHETIC "Factory Test Centre" plan image used by the
 * Venue Pack Factory fixtures (venue-factory/fixtures/factory-test-centre/raw/map.png).
 * Pure procedural artwork (rectangles on a 600×500 canvas) — no third-party rights, no real mall.
 * Deterministic: the same bytes every run. Usage: node scripts/venue/make-synthetic-plan.mjs
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";

const W = 600, H = 500;
const png = new PNG({ width: W, height: H, colorType: 6, deflateLevel: 9, deflateStrategy: 0 });
const fill = (x0, y0, x1, y1, [r, g, b]) => {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
    const i = (y * W + x) * 4; png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  }
};
fill(0, 0, W, H, [246, 244, 238]);                 // paper
fill(20, 20, 580, 480, [255, 255, 255]);           // building outline
// units (synthetic tenants)
fill(90, 40, 210, 200, [214, 228, 246]);           // Grocer G01 (above junction 1)
fill(240, 40, 360, 200, [246, 222, 214]);          // Pharmacy G05 (above junction 2)
fill(390, 300, 510, 460, [222, 240, 214]);         // Cafe (below junction 3)
fill(240, 300, 360, 460, [236, 236, 236]);         // Toilets (below junction 2)
fill(90, 300, 210, 460, [246, 240, 214]);          // Information point (below junction 1)
// main aisle (west entrance → east entrance) and side aisles
fill(20, 230, 580, 270, [200, 200, 200]);
for (const x of [150, 300, 450]) { fill(x - 12, 200, x + 12, 230, [200, 200, 200]); fill(x - 12, 270, x + 12, 300, [200, 200, 200]); }
// entrances (gaps in the outline)
fill(20, 235, 40, 265, [120, 180, 120]); fill(560, 235, 580, 265, [120, 180, 120]);
// node markers
for (const [x, y] of [[30, 250], [150, 250], [300, 250], [450, 250], [570, 250], [150, 120], [300, 120], [450, 380], [300, 380], [150, 380]]) fill(x - 3, y - 3, x + 3, y + 3, [40, 40, 40]);
const out = resolve("venue-factory/fixtures/factory-test-centre/raw/map.png");
writeFileSync(out, PNG.sync.write(png, { deflateLevel: 9, deflateStrategy: 0 }));
console.log(`wrote ${out} (${W}×${H})`);
