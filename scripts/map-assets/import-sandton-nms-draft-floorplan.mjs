#!/usr/bin/env node

/**
 * Sprint 18C.6 — Sandton/NMS Draft Floorplan Import
 *
 * Default mode: DRY RUN ONLY.
 *
 * Live write mode requires:
 *   APPROVE_IMPORT=YES
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Live write scope:
 *   - Create one dev-only map_factory_jobs row.
 *   - Insert one draft map_factory_generated_floorplans row.
 *   - Do NOT overwrite mall_nodes.
 *   - Do NOT overwrite mall_edges.
 *   - Do NOT publish.
 *   - Do NOT mark verified/production.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

const ASSET_DIR = path.join(ROOT, "map-assets", "sandton-nms-lower");
const SVG_PATH = path.join(ASSET_DIR, "sandton-nms-lower.svg");
const LAYOUT_PATH = path.join(ASSET_DIR, "sandton-nms-lower.layout.json");
const NODES_PATH = path.join(ASSET_DIR, "sandton-nms-lower.nodes.json");
const EDGES_PATH = path.join(ASSET_DIR, "sandton-nms-lower.edges.json");
const GENERATED_DIR = path.join(ASSET_DIR, "generated");
const PREVIEW_PATH = path.join(GENERATED_DIR, "sandton-nms-draft-floorplan-import-preview.json");

const APPROVED = process.env.APPROVE_IMPORT === "YES";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TARGET_MALL_NAME = "Sandton";
const TARGET_MALL_SLUGS = ["sandton", "sandton-city", "sandton-nms", "nelson-mandela-square"];
const FLOOR_LABEL = "lower";

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

function validateAssetPack() {
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

    if (!from || !to) fail(`Edge missing from/to endpoint: ${JSON.stringify(edge)}`);
    if (!names.has(from)) fail(`Edge references unknown source node "${from}".`);
    if (!names.has(to)) fail(`Edge references unknown target node "${to}".`);
  }

  return { svg, layout, nodes, edges, belmont };
}

async function findMallId(supabase) {
  const { data, error } = await supabase
    .from("malls")
    .select("id, name, slug")
    .or(
      [
        `name.ilike.%${TARGET_MALL_NAME}%`,
        ...TARGET_MALL_SLUGS.map((slug) => `slug.eq.${slug}`)
      ].join(",")
    )
    .limit(10);

  if (error) fail(`Could not search malls table: ${error.message}`);

  if (!data?.length) {
    fail(`Could not find Sandton mall row. Checked name like "${TARGET_MALL_NAME}" and slugs: ${TARGET_MALL_SLUGS.join(", ")}`);
  }

  const preferred =
    data.find((mall) => String(mall.slug || "").includes("sandton")) ||
    data.find((mall) => String(mall.name || "").toLowerCase().includes("sandton")) ||
    data[0];

  return preferred;
}

async function main() {
  const pack = validateAssetPack();

  const preview = {
    sprint: "18C.6",
    mode: APPROVED ? "APPROVED_WRITE_REQUESTED" : "DRY_RUN_ONLY",
    asset_pack: "sandton-nms-lower",
    generated_at: new Date().toISOString(),
    safety: {
      writes_allowed: APPROVED,
      supabase_url_present: Boolean(SUPABASE_URL),
      service_role_key_present: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      writes_scope: "create one dev-only map_factory_jobs row and one draft map_factory_generated_floorplans row",
      will_overwrite_mall_nodes: false,
      will_overwrite_mall_edges: false,
      will_publish: false,
      will_mark_verified_or_production: false
    },
    validation: {
      svg_chars: pack.svg.length,
      node_count: pack.nodes.length,
      edge_count: pack.edges.length,
      target_node: nodeName(pack.belmont)
    },
    planned_insert: {
      map_factory_jobs: {
        status: "paused",
        stage: "floorplan_generation",
        readiness_score: 0,
        notes: "DEV-ONLY Sandton/NMS reference-led proprietary draft floorplan import. No node/edge overwrite. Field verification required."
      },
      map_factory_generated_floorplans: {
        floor_label: FLOOR_LABEL,
        version: 1,
        status: "draft",
        notes: "Sprint 18C.6 draft floorplan import. Reference-led proprietary stub. Not verified. Not published."
      }
    }
  };

  fs.writeFileSync(PREVIEW_PATH, JSON.stringify(preview, null, 2));

  console.log("\n✅ Sandton/NMS draft floorplan import validation passed.");
  console.log(`Mode: ${preview.mode}`);
  console.log(`Preview written: ${path.relative(ROOT, PREVIEW_PATH)}`);
  console.log(`Nodes checked but not imported: ${pack.nodes.length}`);
  console.log(`Edges checked but not imported: ${pack.edges.length}`);

  if (!APPROVED) {
    console.log("\n🟡 DRY RUN ONLY. No Supabase write attempted.");
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    fail("APPROVE_IMPORT=YES was set, but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const mall = await findMallId(supabase);

  console.log(`\n🟠 APPROVED WRITE MODE`);
  console.log(`Mall target: ${mall.name} (${mall.id})`);
  console.log("Writing one dev-only job row and one draft floorplan row only.");

  const { data: job, error: jobError } = await supabase
    .from("map_factory_jobs")
    .insert({
      mall_id: mall.id,
      status: "paused",
      stage: "floorplan_generation",
      readiness_score: 0,
      notes: [
        "DEV-ONLY Sandton/NMS reference-led proprietary draft floorplan import.",
        "Created by scripts/map-assets/import-sandton-nms-draft-floorplan.mjs.",
        "Draft floorplan only.",
        "No mall_nodes overwrite.",
        "No mall_edges overwrite.",
        "Not verified.",
        "Not published.",
        "Field verification required."
      ].join("\n")
    })
    .select("id, mall_id, status, stage, readiness_score, notes, created_at")
    .single();

  if (jobError) fail(`Failed to create map_factory_jobs row: ${jobError.message}`);

  const { data: floorplan, error: floorplanError } = await supabase
    .from("map_factory_generated_floorplans")
    .insert({
      job_id: job.id,
      mall_id: mall.id,
      floor_label: FLOOR_LABEL,
      version: 1,
      layout_json: {
        ...pack.layout,
        imported_by: "Sprint 18C.6 draft floorplan importer",
        import_reality_label: "reference-led-proprietary-stub",
        imported_node_count_reference_only: pack.nodes.length,
        imported_edge_count_reference_only: pack.edges.length,
        target_node_reference: nodeName(pack.belmont)
      },
      svg_output: pack.svg,
      status: "draft",
      notes: [
        "Sprint 18C.6 draft floorplan import.",
        "Reference-led MallMind proprietary reconstruction stub.",
        "Not verified.",
        "Not published.",
        "No nodes or edges imported by this script.",
        "Field verification required before any production use."
      ].join("\n")
    })
    .select("id, job_id, mall_id, floor_label, version, status, created_at")
    .single();

  if (floorplanError) fail(`Failed to create map_factory_generated_floorplans row: ${floorplanError.message}`);

  console.log("\n✅ Draft floorplan inserted safely.");
  console.log(JSON.stringify({ job, floorplan }, null, 2));
}

main().catch((error) => fail(error.message || String(error)));
