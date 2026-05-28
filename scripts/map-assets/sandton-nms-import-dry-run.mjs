#!/usr/bin/env node
/**
 * Sprint 18C.3 — Sandton/NMS Asset Importer Dry Run
 *
 * This script validates the Sandton/NMS proprietary asset pack and produces
 * a dry-run import preview.
 *
 * It does NOT connect to Supabase.
 * It does NOT modify mall_nodes.
 * It does NOT modify mall_edges.
 * It does NOT publish to the app.
 *
 * Purpose:
 * - prove the asset pack can become MallMind graph data
 * - create approval-gated preview outputs
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const assetDir = path.join(repoRoot, "map-assets", "sandton-nms-lower");
const outDir = path.join(assetDir, "generated");

const files = {
  svg: path.join(assetDir, "sandton-nms-lower.svg"),
  layout: path.join(assetDir, "sandton-nms-lower.layout.json"),
  nodes: path.join(assetDir, "sandton-nms-lower.nodes.json"),
  edges: path.join(assetDir, "sandton-nms-lower.edges.json"),
};

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function assertNumber(value, label) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number`);
  }
  if (value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
}

function validateNode(node, index) {
  if (!node.name) throw new Error(`Node ${index} missing name`);
  if (!node.type) throw new Error(`Node ${index} missing type`);
  if (!node.floor) throw new Error(`Node ${index} missing floor`);
  assertNumber(node.x_percent, `Node ${node.name} x_percent`);
  assertNumber(node.y_percent, `Node ${node.name} y_percent`);
}

function validateEdge(edge, index, nodeNames) {
  if (!edge.from) throw new Error(`Edge ${index} missing from`);
  if (!edge.to) throw new Error(`Edge ${index} missing to`);
  if (!nodeNames.has(edge.from)) {
    throw new Error(`Edge ${index} references missing from node: ${edge.from}`);
  }
  if (!nodeNames.has(edge.to)) {
    throw new Error(`Edge ${index} references missing to node: ${edge.to}`);
  }
}

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function buildPreviewSql(layout, nodes, edges, svg) {
  const mallId = "059ee9b0-c4f9-46c3-835e-0a4b30b9de0a";
  const floor = "Ground Floor";
  const assetId = layout.asset_id || "sandton-nms-lower-v0";

  const lines = [];
  lines.push("-- MallMind Sandton/NMS asset import dry-run SQL");
  lines.push("-- APPROVAL REQUIRED before adapting this for live Supabase execution.");
  lines.push("-- This preview is intentionally not executed by the importer.");
  lines.push("");
  lines.push("-- 1. Generated floorplan preview");
  lines.push("/*");
  lines.push("insert into map_factory_generated_floorplans");
  lines.push("  (mall_id, floor_label, version, layout_json, svg_output, status)");
  lines.push("values");
  lines.push(`  (${sqlString(mallId)}, ${sqlString(floor)}, 1, '${JSON.stringify(layout).replaceAll("'", "''")}'::jsonb, ${sqlString(svg.slice(0, 160) + "...")}, 'draft');`);
  lines.push("*/");
  lines.push("");
  lines.push("-- 2. Node preview");
  for (const node of nodes) {
    const nodeId = `${assetId}_${slugify(node.name)}`;
    lines.push(`-- node: ${node.name}`);
    lines.push(`-- type=${node.type}, floor=${node.floor}, x=${node.x_percent}, y=${node.y_percent}, id_hint=${nodeId}`);
  }
  lines.push("");
  lines.push("-- 3. Edge preview");
  for (const edge of edges) {
    lines.push(`-- edge: ${edge.from} -> ${edge.to}, distance=${edge.distance_meters ?? "unknown"}m, floor_change=${Boolean(edge.floor_change)}`);
  }
  lines.push("");

  return lines.join("\n");
}

fs.mkdirSync(outDir, { recursive: true });

const svg = readText(files.svg);
const layout = readJson(files.layout);
const nodes = readJson(files.nodes);
const edges = readJson(files.edges);

if (!svg.includes("MallMind proprietary")) {
  throw new Error("SVG does not include MallMind proprietary marker");
}

if (!Array.isArray(nodes)) throw new Error("nodes JSON must be an array");
if (!Array.isArray(edges)) throw new Error("edges JSON must be an array");

nodes.forEach(validateNode);
const nodeNames = new Set(nodes.map((n) => n.name));
edges.forEach((edge, i) => validateEdge(edge, i, nodeNames));

const targetNode = nodes.find((n) => n.name === "69 Belmont");
if (!targetNode) throw new Error("Expected target node missing: 69 Belmont");

const summary = {
  ok: true,
  mode: "dry-run",
  asset_dir: "map-assets/sandton-nms-lower",
  asset_id: layout.asset_id ?? null,
  status: layout.status ?? null,
  reality_label: layout.reality_label ?? null,
  source_policy: layout.source_policy ?? null,
  svg_bytes: Buffer.byteLength(svg, "utf8"),
  nodes: nodes.length,
  edges: edges.length,
  target: {
    name: targetNode.name,
    shop_number: targetNode.shop_number ?? null,
    x_percent: targetNode.x_percent,
    y_percent: targetNode.y_percent,
    confidence: targetNode.confidence ?? null,
  },
  warnings: [
    "Dry run only. No database writes performed.",
    "Coordinates are approximate until reference-led reconstruction and field verification.",
    "Approval gate required before writing to map_factory_generated_floorplans, mall_nodes, or mall_edges."
  ],
};

const summaryPath = path.join(outDir, "sandton-nms-import-preview.json");
const sqlPath = path.join(outDir, "sandton-nms-import-preview.sql");

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
fs.writeFileSync(sqlPath, buildPreviewSql(layout, nodes, edges, svg), "utf8");

console.log("✅ Sandton/NMS asset import dry run complete");
console.log(JSON.stringify(summary, null, 2));
console.log("");
console.log(`Preview JSON: ${path.relative(repoRoot, summaryPath)}`);
console.log(`Preview SQL:  ${path.relative(repoRoot, sqlPath)}`);
