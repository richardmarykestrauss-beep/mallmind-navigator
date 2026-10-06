/**
 * sw-plugin.mjs — Vite plugin that turns public/sw.js into a build-specific service worker.
 *
 * After the bundle is written it replaces two placeholders in dist/sw.js:
 *   "__BUILD_ID__"        → a short hash of the emitted asset list (changes whenever any asset does)
 *   /*__PRECACHE__*​/[]   → the list of /assets/* files (JS + CSS) to precache
 * No framework, no generated worker: the worker source stays readable in public/sw.js.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export function mallmindSw() {
  let assets = [];
  let outDir = "dist";
  return {
    name: "mallmind-sw",
    apply: "build",
    configResolved(cfg) { outDir = cfg.build.outDir; },
    generateBundle(_opts, bundle) {
      assets = Object.values(bundle)
        .map((b) => b.fileName)
        .filter((f) => f.startsWith("assets/") && /\.(js|css)$/.test(f))
        .sort()
        .map((f) => `/${f}`);
    },
    closeBundle() {
      const file = join(outDir, "sw.js");
      if (!existsSync(file)) return;
      const buildId = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
      const src = readFileSync(file, "utf8")
        .replace('"__BUILD_ID__"', JSON.stringify(buildId))
        .replace("/*__PRECACHE__*/[]", JSON.stringify(assets));
      writeFileSync(file, src);
      writeFileSync(join(outDir, "precache-manifest.json"), JSON.stringify({ build_id: buildId, assets }, null, 2) + "\n");
    },
  };
}
