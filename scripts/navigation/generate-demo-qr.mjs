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
 *   VITE_PUBLIC_APP_ORIGIN=https://<published-host> node scripts/navigation/generate-demo-qr.mjs [--out docs/qr-demo]
 *   node scripts/navigation/generate-demo-qr.mjs --origin https://<published-host>
 *
 * The origin comes from ONE seam (VITE_PUBLIC_APP_ORIGIN in .env.local / the environment, or
 * --origin). Without a valid public origin the script exits non-zero: it never encodes a guessed
 * hostname. http:// is accepted only for localhost (local development; never print those).
 *
 * The anchors below are the ONLY inputs; every one must be a permitted start of a bundled mall
 * (the app validates them again on scan). The output is clearly labelled DEMO / PILOT and is not
 * official mall signage.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

/** Minimal dotenv reader (no dependency): KEY=value lines, quotes stripped, comments ignored. */
function readDotenv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return out;
}

/**
 * Resolve the public origin from ONE seam: --origin, else VITE_PUBLIC_APP_ORIGIN (process env, then
 * .env.local, then .env). Returns { origin, source } or { error }. Never guesses a hostname.
 */
export function resolvePublicOrigin(argv = process.argv, env = process.env, cwd = process.cwd()) {
  const i = argv.indexOf("--origin");
  const candidates = [
    ["--origin", i >= 0 ? argv[i + 1] : ""],
    ["VITE_PUBLIC_APP_ORIGIN (environment)", env.VITE_PUBLIC_APP_ORIGIN],
    ["VITE_PUBLIC_APP_ORIGIN (.env.local)", readDotenv(resolve(cwd, ".env.local")).VITE_PUBLIC_APP_ORIGIN],
    ["VITE_PUBLIC_APP_ORIGIN (.env)", readDotenv(resolve(cwd, ".env")).VITE_PUBLIC_APP_ORIGIN],
  ];
  const found = candidates.find(([, v]) => typeof v === "string" && v.trim());
  if (!found) return { error: "no public origin configured" };
  const [source, raw] = found;
  const value = raw.trim();
  let url;
  try { url = new URL(value); } catch { return { error: `${source} is not a valid URL: "${value}"` }; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { error: `${source} must use https:// (http:// only for localhost): "${value}"` };
  if (url.pathname !== "/" || url.search || url.hash || value.endsWith("/")) return { error: `${source} must be scheme + host only, no path/query/trailing slash: "${value}"` };
  if (!url.hostname.includes(".") && !local) return { error: `${source} does not look like a public host: "${value}"` };
  return { origin: url.origin, source, local };
}

const resolved = resolvePublicOrigin();
if (resolved.error) {
  console.error(`generate-demo-qr: ${resolved.error}.`);
  console.error("Set VITE_PUBLIC_APP_ORIGIN (in .env.local or the environment) to the PUBLISHED frontend origin,");
  console.error("or pass --origin https://<host>. Refusing to encode a guessed hostname into QR codes.");
  process.exit(1);
}
const { origin, source, local } = resolved;
console.log(`origin ${origin} (from ${source})${local ? " — LOCAL DEVELOPMENT ORIGIN, not for printing" : ""}`);
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
  generated_by: "scripts/navigation/generate-demo-qr.mjs", origin, origin_source: source, local_origin: local,
  label: "DEMO / PILOT QR — not official mall signage",
  note: "Origin comes from VITE_PUBLIC_APP_ORIGIN (or --origin). Regenerate whenever the published origin changes. The app validates mall + start on every scan.",
  anchors: manifest,
}, null, 2) + "\n");
