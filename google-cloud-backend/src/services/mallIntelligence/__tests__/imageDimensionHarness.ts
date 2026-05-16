/**
 * imageDimensionHarness.ts — Sprint 12D.1
 *
 * Manual test harness for imageDimensionService.
 * Run with:
 *   npx ts-node --transpile-only src/services/mallIntelligence/__tests__/imageDimensionHarness.ts
 *
 * Policy:
 *   - Tests parseImageDimensions (pure, no network) synchronously
 *   - Tests fetchImageDimensions (HTTP) in async main
 *   - No Supabase writes
 */

export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  parseImageDimensions,
  fetchImageDimensions,
  MAX_DIMENSION_FETCH_BYTES,
  DIMENSION_FETCH_TIMEOUT_MS,
} = require("../imageDimensionService") as
  typeof import("../imageDimensionService");

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

// ── Minimal PNG builder ───────────────────────────────────────────────────────
//
// image-size only needs the PNG signature (8 bytes) + IHDR chunk (25 bytes)
// = 33 bytes total to extract width/height.

function buildMinimalPng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);

  // PNG signature: \x89PNG\r\n\x1a\n
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;

  // IHDR chunk length = 13 (big-endian)
  buf[8]  = 0x00; buf[9]  = 0x00; buf[10] = 0x00; buf[11] = 0x0d;

  // IHDR type = "IHDR"
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;

  // Width (big-endian 4 bytes)
  buf.writeUInt32BE(width, 16);

  // Height (big-endian 4 bytes)
  buf.writeUInt32BE(height, 20);

  // bit_depth=8, color_type=2 (RGB), compression=0, filter=0, interlace=0
  buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0;

  // CRC (4 bytes — not validated by image-size)
  buf[29] = 0x00; buf[30] = 0x00; buf[31] = 0x00; buf[32] = 0x00;

  return buf;
}

// ── Minimal JPEG builder ──────────────────────────────────────────────────────
//
// image-size requires an APP0 (JFIF) segment before the SOF0 to locate
// dimensions.  Structure: SOI → APP0 → SOF0 → EOI.

function buildMinimalJpeg(width: number, height: number): Buffer {
  const chunks: number[] = [];

  // SOI
  chunks.push(0xff, 0xd8);

  // APP0 (JFIF): marker, length=16, "JFIF\0", version, density_unit, Xd, Yd, thumb
  chunks.push(0xff, 0xe0);
  chunks.push(0x00, 0x10);                              // segment length = 16
  chunks.push(0x4a, 0x46, 0x49, 0x46, 0x00);           // "JFIF\0"
  chunks.push(0x01, 0x01);                              // version 1.1
  chunks.push(0x00);                                    // density unit = 0
  chunks.push(0x00, 0x01, 0x00, 0x01);                 // X/Y density = 1
  chunks.push(0x00, 0x00);                              // no thumbnail

  // SOF0: length=11, precision=8, height(2), width(2), components=1
  chunks.push(0xff, 0xc0);
  chunks.push(0x00, 0x0b);
  chunks.push(0x08);
  chunks.push((height >> 8) & 0xff, height & 0xff);
  chunks.push((width  >> 8) & 0xff, width  & 0xff);
  chunks.push(0x01);

  // EOI
  chunks.push(0xff, 0xd9);

  return Buffer.from(chunks);
}

// ─────────────────────────────────────────────────────────────────────────────
// TC20 — Exported constants
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC20 — Constants");
assertEqual(MAX_DIMENSION_FETCH_BYTES,  524_288, "MAX_DIMENSION_FETCH_BYTES = 512 kB");
assertEqual(DIMENSION_FETCH_TIMEOUT_MS, 10_000,  "DIMENSION_FETCH_TIMEOUT_MS = 10 s");

// ─────────────────────────────────────────────────────────────────────────────
// TC21 — parseImageDimensions: PNG 800×600
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC21 — parseImageDimensions: PNG 800×600");
{
  const buf  = buildMinimalPng(800, 600);
  const dims = parseImageDimensions(buf);
  assert(dims !== null,          "returns non-null for valid PNG header");
  assertEqual(dims?.width,  800, "width = 800");
  assertEqual(dims?.height, 600, "height = 600");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC22 — parseImageDimensions: PNG 1920×1080
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC22 — parseImageDimensions: PNG 1920×1080");
{
  const buf  = buildMinimalPng(1920, 1080);
  const dims = parseImageDimensions(buf);
  assert(dims !== null,           "returns non-null");
  assertEqual(dims?.width,  1920, "width = 1920");
  assertEqual(dims?.height, 1080, "height = 1080");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC23 — parseImageDimensions: JPEG 1024×768
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC23 — parseImageDimensions: JPEG 1024×768");
{
  const buf  = buildMinimalJpeg(1024, 768);
  const dims = parseImageDimensions(buf);
  assert(dims !== null,           "returns non-null for valid JPEG");
  assertEqual(dims?.width,  1024, "width = 1024");
  assertEqual(dims?.height, 768,  "height = 768");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC24 — parseImageDimensions: empty buffer → null
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC24 — parseImageDimensions: empty buffer");
{
  const dims = parseImageDimensions(Buffer.alloc(0));
  assert(dims === null, "empty buffer → null");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC25 — parseImageDimensions: random bytes → null (no throw)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC25 — parseImageDimensions: random bytes → null");
{
  const buf = Buffer.from([
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22,
  ]);
  const dims = parseImageDimensions(buf);
  assert(dims === null, "random bytes → null (no throw)");
}

// ─────────────────────────────────────────────────────────────────────────────
// TC26 — parseImageDimensions: Uint8Array input (not Buffer)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nTC26 — parseImageDimensions: Uint8Array input");
{
  const pngBuf     = buildMinimalPng(400, 300);
  const uint8Input = new Uint8Array(pngBuf);
  const dims       = parseImageDimensions(uint8Input);
  assert(dims !== null,          "Uint8Array input accepted");
  assertEqual(dims?.width,  400, "width = 400");
  assertEqual(dims?.height, 300, "height = 300");
}

// ─────────────────────────────────────────────────────────────────────────────
// Async tests (TC27–TC28) — wrapped to avoid top-level await + require conflict
// ─────────────────────────────────────────────────────────────────────────────

void (async () => {
  // TC27 — fetchImageDimensions: unreachable IP → null + warning
  console.log("\nTC27 — fetchImageDimensions: unreachable URL");
  {
    // 192.0.2.x is TEST-NET-1 (RFC 5737) — guaranteed non-routable
    const result = await fetchImageDimensions("http://192.0.2.1/nonexistent.jpg").catch(
      () => ({ dimensions: null as null, warnings: ["unexpected rejection"] }),
    );
    assert(result.dimensions === null,  "unreachable URL → dimensions null");
    assert(result.warnings.length > 0,  "unreachable URL → at least one warning");
    console.log(`    warning: ${result.warnings[0]}`);
  }

  // TC28 — fetchImageDimensions: 404 response → null + warning
  console.log("\nTC28 — fetchImageDimensions: 404 response");
  {
    // Use httpbin.org; if network is unavailable the connection error is also fine
    const result = await fetchImageDimensions("https://httpbin.org/status/404").catch(
      () => ({ dimensions: null as null, warnings: ["connection unavailable"] }),
    );
    assert(result.dimensions === null,  "404 response → dimensions null");
    assert(result.warnings.length > 0,  "404 response → at least one warning");
    console.log(`    warning: ${result.warnings[0]}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error(`\n✗ ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log(`\n✓ All ${passed} tests passed`);
  }
})();
