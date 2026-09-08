#!/usr/bin/env node
/**
 * generate-demo-qr.mjs — DEMO / PILOT QR codes for MallMind's trusted start anchors.
 *
 * A MallMind QR code is nothing more than a physical encoding of the canonical deep link
 *   <origin>/navigate?mall=<mall-id>&start=<anchor-id>&via=qr
 * (see src/components/navigation/wayfindingAnchor.ts). No QR backend, no database, no external
 * QR API: codes are generated locally with the `qrcode` dev dependency.
 *
 * Usage:
 *   node scripts/navigation/generate-demo-qr.mjs --origin https://<your-deployment> [--out docs/qr-demo]
 *
 * The anchors below are the ONLY inputs; every one must be a permitted start of a bundled mall
 * (the app validates them again on scan). The output is clearly labelled DEMO / PILOT and is not
 * official mall signage.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";

const ANCHORS = [
  { mallId: "garden-route-mall", mallName: "Garden Route Mall", anchorId: "grm-entrance-4", label: "Entrance 4", status: "source-backed · unscaled · awaiting field verification" },
  { mallId: "menlyn-park", mallName: "Menlyn Park", anchorId: "menlyn-lf-entrance-13", label: "Entrance 13 (Lower First Level)", status: "source-backed · unscaled · not field verified" },
  { mallId: "mallreds-pilot", mallName: "Mall@Reds", anchorId: "entrance-main", label: "Main Entrance", status: "schematic pilot · unverified geometry" },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const origin = arg("origin", "");
if (!/^https?:\/\/[^/\s?#]+$/i.test(origin)) {
  console.error("Usage: node scripts/navigation/generate-demo-qr.mjs --origin https://<deployment-origin> [--out docs/qr-demo]");
  console.error("       (origin only — no path, query or trailing slash; the canonical path is appended)");
  process.exit(1);
}
const outDir = resolve(arg("out", "docs/qr-demo"));
mkdirSync(outDir, { recursive: true });

export function deepLinkFor(origin, mallId, anchorId) {
  const p = new URLSearchParams({ mall: mallId, start: anchorId, via: "qr" });
  return `${origin}/navigate?${p.toString()}`;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Wrap the raw QR SVG (a 0 0 N N viewBox) in a labelled poster so a print can never pass as official signage. */
function poster(rawSvg, a, url) {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(rawSvg);
  const n = vb ? Number(vb[1]) : 33;
  const inner = rawSvg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const W = 480, QR = 320, x = (W - QR) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="600" viewBox="0 0 ${W} 600" role="img" aria-label="DEMO PILOT QR code: ${esc(a.mallName)} ${esc(a.label)}">
  <title>DEMO / PILOT QR — ${esc(a.mallName)} · ${esc(a.label)}</title>
  <rect width="${W}" height="600" fill="#ffffff"/>
  <rect x="12" y="12" width="${W - 24}" height="576" fill="none" stroke="#111827" stroke-width="3" stroke-dasharray="10 6"/>
  <text x="${W / 2}" y="52" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#b91c1c">DEMO / PILOT QR — NOT OFFICIAL SIGNAGE</text>
  <text x="${W / 2}" y="82" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600" fill="#111827">${esc(a.mallName)} · ${esc(a.label)}</text>
  <svg x="${x}" y="100" width="${QR}" height="${QR}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">${inner}</svg>
  <text x="${W / 2}" y="452" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="15" fill="#111827">Scan to start MallMind from this point</text>
  <text x="${W / 2}" y="478" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="#374151">${esc(a.status)}</text>
  <text x="${W / 2}" y="504" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="#374151">Your position is not tracked. Distances only where measured.</text>
  <text x="${W / 2}" y="540" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="10.5" fill="#6b7280">${esc(url)}</text>
  <text x="${W / 2}" y="566" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="11" fill="#6b7280">MallMind controlled pilot · anchor ${esc(a.anchorId)} · mall ${esc(a.mallId)}</text>
</svg>
`;
}

const manifest = [];
for (const a of ANCHORS) {
  const url = deepLinkFor(origin, a.mallId, a.anchorId);
  const base = `${a.mallId}--${a.anchorId}`;
  const raw = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  writeFileSync(resolve(outDir, `${base}.svg`), poster(raw, a, url));
  await QRCode.toFile(resolve(outDir, `${base}.png`), url, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 512 });
  manifest.push({ ...a, url, svg: `${base}.svg`, png: `${base}.png` });
  console.log(`${base}: ${url}`);
}
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify({
  generated_by: "scripts/navigation/generate-demo-qr.mjs", origin, label: "DEMO / PILOT QR — not official mall signage",
  note: "Regenerate with --origin <deployment> before printing. The app validates mall + start on every scan.",
  anchors: manifest,
}, null, 2) + "\n");
