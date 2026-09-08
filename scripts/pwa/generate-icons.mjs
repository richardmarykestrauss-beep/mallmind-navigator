/**
 * generate-icons.mjs — deterministic PWA icon generator (no image libraries).
 *
 * Writes public/icons/icon-192.png and icon-512.png: a dark rounded square, a
 * cyan ring and a north-pointing wayfinding arrow. Pure Node (zlib PNG encoder)
 * so the icons can be regenerated on any machine: `node scripts/pwa/generate-icons.mjs`.
 * Both files are committed; this script only exists so they are reproducible.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [10, 10, 15];        // #0a0a0f (manifest background)
const RING = [0, 212, 255];     // #00d4ff (theme colour)
const ARROW = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Geometry helpers (all in unit space 0..1 so both sizes render identically)
function inRoundedSquare(u, v, r) {
  const x = Math.abs(u - 0.5), y = Math.abs(v - 0.5);
  const h = 0.5;
  if (x <= h - r || y <= h - r) return x <= h && y <= h;
  return Math.hypot(x - (h - r), y - (h - r)) <= r;
}
function sign(ax, ay, bx, by, px, py) { return (ax - px) * (by - py) - (bx - px) * (ay - py); }
function inTriangle(p, a, b, c) {
  const d1 = sign(a[0], a[1], b[0], b[1], p[0], p[1]);
  const d2 = sign(b[0], b[1], c[0], c[1], p[0], p[1]);
  const d3 = sign(c[0], c[1], a[0], a[1], p[0], p[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function pixel(size) {
  const ss = 3; // supersampling per axis for smooth edges
  return (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
      const u = (x + (i + 0.5) / ss) / size, v = (y + (j + 0.5) / ss) / size;
      let col = null;
      if (inRoundedSquare(u, v, 0.18)) {
        col = BG;
        const d = Math.hypot(u - 0.5, v - 0.5);
        if (d >= 0.30 && d <= 0.36) col = RING;
        // wayfinding arrow: two triangles meeting at the centre (north-pointing)
        const tip = [0.5, 0.24], base = [0.5, 0.58];
        if (inTriangle([u, v], tip, [0.30, 0.70], base) || inTriangle([u, v], tip, base, [0.70, 0.70])) col = ARROW;
        if (inTriangle([u, v], tip, [0.30, 0.70], base)) col = ARROW;
        if (inTriangle([u, v], tip, base, [0.70, 0.70])) col = [190, 235, 250];
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = ss * ss;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
  };
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, encodePng(size, pixel(size)));
  console.log(`wrote public/icons/icon-${size}.png`);
}
