#!/usr/bin/env node
import fs from "node:fs";
const required = [
  "map-assets/sandton-nms-lower/sandton-nms-lower.svg",
  "map-assets/sandton-nms-lower/sandton-nms-lower.layout.json",
  "map-assets/sandton-nms-lower/sandton-nms-lower.nodes.json",
  "map-assets/sandton-nms-lower/sandton-nms-lower.edges.json",
  "map-assets/sandton-nms-lower/generated/sandton-nms-import-preview.json",
  "map-assets/sandton-nms-lower/generated/sandton-nms-import-preview.sql"
];
const missing = required.filter((p) => !fs.existsSync(p));
if (missing.length) {
  console.error("Missing import prerequisites:", missing);
  process.exit(1);
}
const svg = fs.readFileSync(required[0], "utf8");
if (!svg.includes("MallMind proprietary")) {
  console.error("SVG missing MallMind proprietary marker.");
  process.exit(1);
}
console.log("✅ Sandton import approval prerequisites present.");
console.log("No database writes performed.");
console.log("Next live importer must require APPROVE_IMPORT=YES.");
