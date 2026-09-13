/**
 * bundle-ts.mjs — run a TypeScript module from src/ inside a plain Node script.
 *
 * Bundles with esbuild (already a dev dependency via Vite) and imports the result from a data URL,
 * so CLIs reuse the SAME code the app runs (one validator, one registry, one router). Vite's
 * `import.meta.glob(pattern, { eager: true, import: "default" })` is rewritten into static imports
 * by a tiny plugin, because esbuild does not implement it.
 */

import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const globPlugin = {
  name: "vite-import-meta-glob",
  setup(b) {
    b.onLoad({ filter: /\.ts$/ }, (args) => {
      let code = readFileSync(args.path, "utf8");
      if (!code.includes("import.meta.glob(")) return null;
      const imports = [];
      let n = 0;
      code = code.replace(/import\.meta\.glob\(\s*"([^"]+)"\s*,\s*\{[^}]*\}\s*\)/g, (_m, pattern) => {
        const dir = resolve(dirname(args.path), dirname(pattern));
        const re = new RegExp("^" + pattern.split("/").pop().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        const files = readdirSync(dir).filter((f) => re.test(f)).sort();
        const entries = files.map((f) => {
          const id = `__glob${n++}`;
          imports.push(`import ${id} from ${JSON.stringify(join(dir, f))};`);
          return `${JSON.stringify(`${dirname(pattern)}/${f}`)}: ${id}`;
        });
        return `({ ${entries.join(", ")} })`;
      });
      return { contents: imports.join("\n") + "\n" + code, loader: "ts", resolveDir: dirname(args.path) };
    });
  },
};

export async function importTs(entry) {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "silent",
    loader: { ".json": "json" },
    plugins: [globPlugin],
    alias: { "@": resolve("src") },
  });
  const code = result.outputFiles[0].text;
  // Written to a temp file (not a data: URL) so stack traces stay readable.
  const dir = join(tmpdir(), "mallmind-bundle-ts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash("sha256").update(code).digest("hex").slice(0, 16)}.mjs`);
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}
