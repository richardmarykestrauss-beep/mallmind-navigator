/**
 * validate-candidate.mjs — standalone checks for the Menlyn research candidate.
 *
 * Deliberately independent of production code (the production validator
 * requires distance_meters > 0, which this unscaled candidate must not claim).
 * Run: node research/menlyn-spatial-poc/validate-candidate.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(join(here, "menlyn-lf-route-candidate.json"), "utf8"));

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log("\nstructure");
ok(Array.isArray(d.nodes) && d.nodes.length === 3, `3 nodes (got ${d.nodes.length})`);
ok(Array.isArray(d.edges) && d.edges.length === 2, `2 edges (got ${d.edges.length})`);
ok(d.distance_unit === "px", "distance_unit is px (no metres claimed)");
ok(d.edges.every((e) => e.distance_meters === null), "every edge distance_meters is null");
ok(d.source_image.scale_bar_present === false, "scale bar explicitly recorded as absent");
ok(d.floors[0].plan_image.url === null, "plan_image url withheld until rights confirmed");

console.log("\nids + connectivity");
const ids = new Set(d.nodes.map((n) => n.node_id));
ok(ids.size === d.nodes.length, "node ids unique");
ok(d.edges.every((e) => ids.has(e.from) && ids.has(e.to)), "edge endpoints resolve");
const deg = {}; for (const e of d.edges) { deg[e.from] = (deg[e.from] ?? 0) + 1; deg[e.to] = (deg[e.to] ?? 0) + 1; }
ok(d.nodes.every((n) => (deg[n.node_id] ?? 0) >= 1), "no disconnected node");
const start = d.nodes.find((n) => n.type === "entrance"), dest = d.nodes.find((n) => n.linked_shop_id);
ok(!!start && !!dest, "has an entrance start and a linked-shop destination");
// simple path walk start -> dest
let cur = start.node_id, seen = new Set([cur]), steps = 0;
while (cur !== dest.node_id && steps < 10) { const e = d.edges.find((x) => x.from === cur && !seen.has(x.to)); if (!e) break; cur = e.to; seen.add(cur); steps++; }
ok(cur === dest.node_id, `entrance reaches destination in ${steps} legs`);

console.log("\ncoordinates");
const W = d.source_image.rendered_width_px, H = d.source_image.rendered_height_px;
const r0 = W / H, r = 1000 / 620, pad = (r / r0 - 1) / 2;
ok(near(pad, d.floors[0].plane_padding.pad_fraction_of_source_width_each_side, 0.0005), `padding fraction each side ${pad.toFixed(5)} matches`);
for (const n of d.nodes) {
  ok(near(n.x_percent_source, (n.x_px_source / W) * 100, 0.05) && near(n.y_percent_source, (n.y_px_source / H) * 100, 0.05),
    `${n.node_id}: source percents derive from source px`);
  const xp = (n.x_percent_source + pad * 100) / (1 + 2 * pad);
  ok(near(n.x_percent, xp, 0.05) && n.y_percent === n.y_percent_source, `${n.node_id}: plane percents follow the padding formula`);
  ok(n.x_percent >= 0 && n.x_percent <= 100 && n.y_percent >= 0 && n.y_percent <= 100, `${n.node_id}: within 0..100`);
  ok(n.evidence === "source-backed" && typeof n.source === "string" && n.source.startsWith("https://www.menlynpark.co.za/"), `${n.node_id}: source-backed with first-party source URL`);
}

console.log("\ngeometry sanity (wall / diagonal checks)");
for (const e of d.edges) {
  const a = d.nodes.find((n) => n.node_id === e.from), b = d.nodes.find((n) => n.node_id === e.to);
  const dx = Math.abs(a.x_px_source - b.x_px_source), dy = Math.abs(b.y_px_source - a.y_px_source);
  ok(dx === 0, `${e.edge_id}: purely vertical along the corridor (dx=${dx})`);
  ok(dy === e.length_px_source, `${e.edge_id}: length_px_source equals |Δy| (${dy})`);
  ok(near(e.length_pct, (dy / W) * 100, 0.05), `${e.edge_id}: length_pct derives from px`);
  ok(e.floor_change === false && a.floor === "LF" && b.floor === "LF", `${e.edge_id}: single floor LF`);
}
ok(d.wall_corridor_validation.pass_1 && d.wall_corridor_validation.pass_2 && d.wall_corridor_validation.rejected_edges.length === 0, "two independent wall/corridor passes recorded, no rejected edges");

console.log(`\ncandidate validation: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
