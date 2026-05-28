#!/usr/bin/env node
/**
 * Sprint 18C.5 — Dev-only Sandton/NMS asset importer
 *
 * DEFAULT MODE:
 * - dry run only
 * - no database writes
 *
 * LIVE WRITE MODE:
 * - requires APPROVE_IMPORT=YES
 * - requires SUPABASE_URL
 * - requires SUPABASE_SERVICE_ROLE_KEY
 *
 * Current write scope:
 * - inserts a DRAFT generated floorplan row only
 * - does NOT overwrite mall_nodes
 * - does NOT overwrite mall_edges
 * - does NOT mark anything production/verified
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const repoRoot = process.cwd();
const assetDir = path.join(repoRoot, "map-assets", "sandton-nms-lower");

const files = {
  svg: path.join(assetDir, "sandton-nms-lower.svg"),
  layout: path.join(assetDir, "sandton-nms-lower.layout.json"),
  nodes: path.join(assetDir, "sandton-nms-lower.nodes.json"),
  edges: path.join(assetDir, "sandton-nms-lower.edges.json"),
  previewJson: path.join(assetDir, "generated", "sandton-nms-import-preview.json"),
  previewSql: path.join(assetDir, "generated", "sandton-nms-import-preview.sql"),
};

const MALL_ID = "059ee9b0-c4f9-46c3-835e-0a4b30b9de0a";
const FLOOR_LABEL = "Ground Floor";

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function assertPercent(value, label) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a number from 0 to 100`);
  }
}

function validatePack() {
  const svg = readText(files.svg);
  const layout = readJson(files.layout);
  const nodes = readJson(files.nodes);
  const edges = readJson(files.edges);
  const preview = readJson(files.previewJson);
  readText(files.previewSql);

  if (!svg.includes("MallMind proprietary")) {
    throw new Error("SVG missing MallMind proprietary marker");
  }

  if (!Array.isArray(nodes)) {
    throw new Error("nodes JSON must be an array");
  }

  if (!Array.isArray(edges)) {
    throw new Error("edges JSON must be an array");
  }

  for (const [i, node] of nodes.entries()) {
    if (!node.name) throw new Error(`Node ${i} missing name`);
    if (!node.type) throw new Error(`Node ${i} missing type`);
    if (!node.floor) throw new Error(`Node ${i} missing floor`);
    assertPercent(node.x_percent, `Node ${node.name} x_percent`);
    assertPercent(node.y_percent, `Node ${node.name} y_percent`);
  }

  const names = new Set(nodes.map((n) => n.name));
  for (const [i, edge] of edges.entries()) {
    if (!edge.from || !names.has(edge.from)) {
      throw new Error(`Edge ${i} has invalid from node: ${edge.from}`);
    }
    if (!edge.to || !names.has(edge.to)) {
      throw new Error(`Edge ${i} has invalid to node: ${edge.to}`);
    }
  }

  const target = nodes.find((node) => node.name === "69 Belmont");
  if (!target) {
    throw new Error("Missing target node: 69 Belmont");
  }

  return { svg, layout, nodes, edges, preview, target };
}

async function main() {
  const approve = process.env.APPROVE_IMPORT === "YES";
  const pack = validatePack();

  const summary = {
    ok: true,
    mode: approve ? "APPROVED_WRITE" : "DRY_RUN_ONLY",
    mall_id: MALL_ID,
    floor_label: FLOOR_LABEL,
    asset_id: pack.layout.asset_id ?? null,
    svg_bytes: Buffer.byteLength(pack.svg, "utf8"),
    nodes: pack.nodes.length,
    edges: pack.edges.length,
    target: {
      name: pack.target.name,
      shop_number: pack.target.shop_number ?? null,
      x_percent: pack.target.x_percent,
      y_percent: pack.target.y_percent,
      confidence: pack.target.confidence ?? null,
    },
    safety: [
      "Importer writes only a draft floorplan row.",
      "Importer does not overwrite mall_nodes.",
      "Importer does not overwrite mall_edges.",
      "Importer does not mark production/verified.",
      "APPROVE_IMPORT=YES is required for live write.",
    ],
  };

  console.log("===== SANDTON/NMS DEV IMPORTER CHECK =====");
  console.log(JSON.stringify(summary, null, 2));

  if (!approve) {
    console.log("");
    console.log("DRY RUN ONLY: no database writes performed.");
    console.log("To write the draft floorplan later, explicitly run with APPROVE_IMPORT=YES.");
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("APPROVE_IMPORT=YES was set, but Supabase env vars are missing");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("");
  console.log("APPROVED WRITE MODE: inserting draft floorplan row only.");

  const { data: previousRows, error: previousErr } = await supabase
    .from("map_factory_generated_floorplans")
    .select("id, version, status, created_at")
    .eq("mall_id", MALL_ID)
    .eq("floor_label", FLOOR_LABEL)
    .order("version", { ascending: false })
    .limit(1);

  if (previousErr) {
    throw new Error(previousErr.message);
  }

  const previous = previousRows?.[0] ?? null;
  const nextVersion = previous?.version ? Number(previous.version) + 1 : 1;

  const layoutJson = {
    ...pack.layout,
    import_mode: "dev_only_approval_gate",
    import_status: "draft",
    imported_from: "map-assets/sandton-nms-lower",
    nodes_preview: pack.nodes,
    edges_preview: pack.edges,
    warnings: [
      "Reference-led proprietary stub.",
      "Approximate coordinates.",
      "Field verification required.",
      "Do not mark production verified.",
    ],
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("map_factory_generated_floorplans")
    .insert({
      mall_id: MALL_ID,
      floor_label: FLOOR_LABEL,
      version: nextVersion,
      layout_json: layoutJson,
      svg_output: pack.svg,
      status: "draft",
    })
    .select("id, mall_id, floor_label, version, status, created_at")
    .single();

  if (insertErr) {
    throw new Error(insertErr.message);
  }

  console.log("");
  console.log("✅ Draft floorplan inserted.");
  console.log(JSON.stringify(inserted, null, 2));

  console.log("");
  console.log("IMPORTANT:");
  console.log("- mall_nodes were not modified.");
  console.log("- mall_edges were not modified.");
  console.log("- imported asset is still draft/stub only.");
}

main().catch((err) => {
  console.error("❌ Importer failed:");
  console.error(err);
  process.exit(1);
});
