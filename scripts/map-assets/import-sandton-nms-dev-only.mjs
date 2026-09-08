#!/usr/bin/env node

/**
 * Sprint 18C.5 — Dev-Only Sandton/NMS Asset Importer
 *
 * Default mode: DRY RUN ONLY.
 *
 * Live write mode requires:
 *   APPROVE_IMPORT=YES
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Current approved live scope:
 *   - Insert one draft generated floorplan row only.
 *   - Do NOT overwrite mall_nodes.
 *   - Do NOT overwrite mall_edges.
 *   - Do NOT mark production/verified.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const ASSET_DIR = path.join(ROOT, "map-assets", "sandton-nms-lower");
const SVG_PATH = path.join(ASSET_DIR, "sandton-nms-lower.svg");
const LAYOUT_PATH = path.join(ASSET_DIR, "sandton-nms-lower.layout.json");
const NODES_PATH = path.join(ASSET_DIR, "sandton-nms-lower.nodes.json");
const EDGES_PATH = path.join(ASSET_DIR, "sandton-nms-lower.edges.json");
const GENERATED_DIR = path.join(ASSET_DIR, "generated");
const PREVIEW_PATH = path.join(GENERATED_DIR, "sandton-nms-dev-import-preview.json");

const APPROVED = process.env.APPROVE_IMPORT === "YES";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) fail(`Missing required file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  const raw = readText(filePath);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function assertPercent(value, label) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 100) {
    fail(`${label} must be a number from 0 to 100. Received: ${value}`);
  }
}

function getArrayPayload(payload, likelyKeys) {
  if (Array.isArray(payload)) return payload;

  for (const key of likelyKeys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  fail(`Could not find array payload. Tried keys: ${likelyKeys.join(", ")}`);
}

function nodeName(node) {
  return node.name || node.label || node.title || node.id;
}

function edgeEndpoint(edge, keys) {
  for (const key of keys) {
    if (edge[key]) return edge[key];
  }
  return null;
}

fs.mkdirSync(GENERATED_DIR, { recursive: true });

const svg = readText(SVG_PATH);
const layout = readJson(LAYOUT_PATH);
const nodesPayload = readJson(NODES_PATH);
const edgesPayload = readJson(EDGES_PATH);

const nodes = getArrayPayload(nodesPayload, ["nodes", "mall_nodes"]);
const edges = getArrayPayload(edgesPayload, ["edges", "mall_edges"]);

if (!svg.includes("MallMind")) {
  fail("SVG must include a MallMind proprietary marker.");
}

if (svg.includes("<image") || svg.includes("base64")) {
  fail("SVG appears to embed external/raster artwork. Keep this proprietary vector-only.");
}

if (!nodes.length) fail("Node list is empty.");
if (!edges.length) fail("Edge list is empty.");

const names = new Set();

for (const node of nodes) {
  const name = nodeName(node);
  if (!name) fail(`Node missing name/label/title/id: ${JSON.stringify(node)}`);

  const x = node.x_percent ?? node.xPercent ?? node.x;
  const y = node.y_percent ?? node.yPercent ?? node.y;

  assertPercent(x, `Node "${name}" x`);
  assertPercent(y, `Node "${name}" y`);

  names.add(name);
}

const belmont = nodes.find((node) => {
  const serialised = JSON.stringify(node).toLowerCase();
  return serialised.includes("69 belmont") || serialised.includes("l41");
});

if (!belmont) {
  fail("Required target node not found: 69 Belmont / L41.");
}

for (const edge of edges) {
  const from = edgeEndpoint(edge, ["from", "source", "source_name", "from_name", "fromNode", "sourceNode"]);
  const to = edgeEndpoint(edge, ["to", "target", "target_name", "to_name", "toNode", "targetNode"]);

  if (!from || !to) {
    fail(`Edge missing from/to endpoint: ${JSON.stringify(edge)}`);
  }

  if (!names.has(from)) {
    fail(`Edge references unknown source node "${from}".`);
  }

  if (!names.has(to)) {
    fail(`Edge references unknown target node "${to}".`);
  }
}

const preview = {
  sprint: "18C.5",
  mode: APPROVED ? "APPROVED_WRITE_REQUESTED" : "DRY_RUN_ONLY",
  reality_label: "reference-led-proprietary-stub",
  asset_pack: "sandton-nms-lower",
  generated_at: new Date().toISOString(),
  safety: {
    writes_allowed: APPROVED,
    approved_env_present: APPROVED,
    supabase_url_present: Boolean(SUPABASE_URL),
    service_role_key_present: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    writes_scope: "draft generated floorplan row only",
    will_overwrite_mall_nodes: false,
    will_overwrite_mall_edges: false,
    will_mark_verified_or_production: false
  },
  validation: {
    svg_chars: svg.length,
    layout_keys: Object.keys(layout),
    node_count: nodes.length,
    edge_count: edges.length,
    target_node: nodeName(belmont)
  },
  draft_floorplan_row_preview: {
    mall_slug: "sandton-nms",
    floor_label: "lower",
    source_type: "mallmind-proprietary-reference-led-reconstruction",
    reality_label: "reference-led-proprietary-stub",
    status: "draft",
    svg_output_chars: svg.length
  }
};

fs.writeFileSync(PREVIEW_PATH, JSON.stringify(preview, null, 2));

console.log("\n✅ Sandton/NMS dev importer validation passed.");
console.log(`Mode: ${preview.mode}`);
console.log(`Nodes: ${nodes.length}`);
console.log(`Edges: ${edges.length}`);
console.log(`Target: ${preview.validation.target_node}`);
console.log(`Preview written: ${path.relative(ROOT, PREVIEW_PATH)}`);

if (!APPROVED) {
  console.log("\n🟡 DRY RUN ONLY. No Supabase write attempted.");
  process.exit(0);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail("APPROVE_IMPORT=YES was set, but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
}

console.log("\n🛑 Live write mode is intentionally not implemented in Sprint 18C.5.");
console.log("This sprint only proves the approval gate and dry-run validation.");
console.log("Implement the actual Supabase insert separately in Sprint 18C.6 after review.");
process.exit(0);
