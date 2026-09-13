#!/usr/bin/env node
/**
 * migrate-legacy-dataset.mjs — one-off, FAITHFUL conversion of the pre-Sprint-4 spatial datasets
 * (src/components/navigation/data/*.dataset.json) into Venue Packs (schema_version 1).
 *
 * Nothing is reinterpreted: coordinates, evidence, units, pixel lengths, metres, instruction text
 * and provenance are copied verbatim. Mapping rules (documented in docs/venue-packs/README.md):
 *   dataset_status / evidence_status / field_verified   → venue.evidence.{geometry, field_verification}
 *   node.evidence ("on-site-verified")                    → "field-verified" (renamed level, same meaning)
 *   node.type shop + tenant                               → destination (identity from tenant.identity_evidence;
 *                                                           arrival "corridor_arrival" — no dataset claimed a door)
 *   node.type entrance/landmark                           → anchor (start_permitted true, id = node id so QR links keep working)
 *   node.type toilet/lift/food_court                      → amenity (routable true — they were routable before)
 *   edge.instruction                                      → instructions.forward ONLY (text was written for from→to)
 *   edge.distance_meters / length_px                      → distance_m (measurement "measured") / length_px ("unmeasured")
 *
 * Usage: LEGACY_DIR=<folder with the legacy *.dataset.json> node scripts/venue/migrate-legacy-dataset.mjs
 *        (writes src/venue/packs/*.venue.json; the legacy files live in git history at 7d638f9)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// The legacy files were removed from the tree in Sprint 4; they live in git history (integration
// branch at 7d638f9). Extract them and point LEGACY_DIR at the folder to re-run the migration.
const IN = process.env.LEGACY_DIR ?? "src/components/navigation/data";
const OUT = "src/venue/packs";

const LEGACY = [
  { file: "mall-reds-pilot.dataset.json", out: "mallreds-pilot.venue.json", short: "Mall@Reds", city: "Centurion", deployment: { state: "internal-pilot", official: false, label: "Pilot schematic" } },
  { file: "menlyn-park-lf-pilot.dataset.json", out: "menlyn-park.venue.json", short: "Menlyn Park", city: "Pretoria", deployment: { state: "controlled-pilot", official: false, label: "Controlled pilot — source-backed, unscaled, not field verified" } },
  { file: "garden-route-mall.dataset.json", out: "garden-route-mall.venue.json", short: "Garden Route Mall", city: "George", deployment: { state: "controlled-pilot", official: false, label: "Controlled pilot — source-backed, unscaled, awaiting field verification" } },
];

const GEOM = { schematic: "schematic", "source-backed": "source-backed", "on-site-verified": "field-verified" };
const IDENT = { unverified: "unverified", "source-backed": "source-backed", "on-site-verified": "field-verified" };
const AMENITY = { toilet: "toilet", lift: "lift", escalator: "escalator", stairs: "stairs", food_court: "food_court" };

function convert(d, meta) {
  const unit = d.distance_unit ?? "m";
  const pack = {
    schema_version: 1,
    venue: {
      id: d.mall_id,
      name: d.mall_name,
      short_name: meta.short,
      city: meta.city,
      country: "South Africa",
      deployment: meta.deployment,
      evidence: {
        geometry: GEOM[d.dataset_status],
        measurement: unit === "m" ? "measured" : "unmeasured",
        field_verification: d.field_verified === true ? "verified" : d.dataset_status === "schematic" ? "not-started" : "pending",
        accessibility: "unverified",
        note: [d.reality_label, d.source_policy].filter(Boolean).join(" — "),
      },
      sources: [{ kind: "legacy dataset", reference: `${IN}/${meta.file} (asset ${d.asset_id}, dataset_version ${d.dataset_version})`, note: d.coordinate_system }],
      notes: d.notes,
    },
    floors: d.floors.map((f, i) => ({ id: f.id, label: f.label, order: i, plan_image: f.plan_image ?? null })),
    graph: { distance_unit: unit, plane: { width: 1000, height: 620 }, nodes: [], edges: [] },
    destinations: [],
    anchors: [],
    amenities: [],
    policies: {
      start: { allowed_anchor_kinds: ["entrance", "landmark"] },
      destinations: { include_routable_amenities: true },
      floors: { display: "label" },
      metrics: { show: "when-measured" },
      instructions: { generic_fallback: true, start_prefix: true },
    },
  };

  for (const n of d.nodes) {
    const kind = n.type === "shop" ? "arrival" : n.type === "entrance" ? "entrance" : n.type === "landmark" ? "landmark"
      : n.type === "lift" || n.type === "escalator" || n.type === "stairs" ? "vertical" : AMENITY[n.type] ? "amenity" : "corridor";
    const provenance = {};
    for (const k of ["source_px_x", "source_px_y", "x_percent_source", "y_percent_source", "field_verification_required"]) if (n[k] !== undefined) provenance[k] = n[k];
    const node = {
      id: n.node_id, name: n.name, kind, floor: n.floor, x_percent: n.x_percent, y_percent: n.y_percent,
      evidence: { geometry: GEOM[n.evidence] },
    };
    if (n.source) node.source = n.source;
    if (n.notes) node.notes = n.notes;
    if (Object.keys(provenance).length) node.provenance = provenance;
    pack.graph.nodes.push(node);

    if (n.type === "shop") {
      pack.destinations.push({
        id: n.linked_shop_id ?? n.node_id, name: n.name, kind: "store", arrival_node: n.node_id,
        unit: n.tenant?.shop_number ?? null,
        evidence: { identity: IDENT[n.tenant?.identity_evidence ?? "unverified"], arrival: "corridor_arrival", ...(n.tenant?.identity_source ? { identity_source: n.tenant.identity_source } : {}) },
      });
    } else if (n.type === "entrance" || n.type === "landmark") {
      pack.anchors.push({ id: n.node_id, node: n.node_id, label: n.name, kind: n.type, start_permitted: true, qr_eligible: n.type === "entrance", evidence: { geometry: GEOM[n.evidence] } });
      // The legacy finder also offered landmark nodes as routable "amenity" destinations (e.g. the
      // Information Desk). Keep that behaviour: a landmark is ALSO an information amenity.
      if (n.type === "landmark") pack.amenities.push({ id: n.node_id, kind: "information", name: n.name, node: n.node_id, routable: true, evidence: { geometry: GEOM[n.evidence], accessibility: "unverified" } });
    } else if (AMENITY[n.type]) {
      pack.amenities.push({ id: n.node_id, kind: AMENITY[n.type], name: n.name, node: n.node_id, routable: true, evidence: { geometry: GEOM[n.evidence], accessibility: "unverified" } });
    }
  }

  for (const e of d.edges) {
    const edge = { id: e.edge_id, from: e.from, to: e.to, bidirectional: true, floor_change: e.floor_change === true };
    if (unit === "m") { edge.distance_m = e.distance_meters; edge.evidence = { geometry: GEOM[e.evidence], measurement: "measured" }; }
    else { edge.length_px = e.length_px; edge.evidence = { geometry: GEOM[e.evidence], measurement: "unmeasured" }; }
    if (e.instruction) edge.instructions = { forward: e.instruction };
    if (e.source) edge.source = e.source;
    const notes = [e.notes, e.length_px_note].filter(Boolean).join(" ");
    if (notes) edge.notes = notes;
    pack.graph.edges.push(edge);
  }
  return pack;
}

mkdirSync(OUT, { recursive: true });
for (const m of LEGACY) {
  const d = JSON.parse(readFileSync(resolve(IN, m.file), "utf8"));
  const pack = convert(d, m);
  writeFileSync(resolve(OUT, m.out), JSON.stringify(pack, null, 2) + "\n");
  console.log(`${m.out}: ${pack.graph.nodes.length} nodes, ${pack.graph.edges.length} edges, ${pack.destinations.length} destinations, ${pack.anchors.length} anchors, ${pack.amenities.length} amenities, unit ${pack.graph.distance_unit}`);
}
