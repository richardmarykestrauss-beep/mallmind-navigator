import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "node:child_process";

/**
 * Build marker baked into every bundle (see src/lib/buildInfo.ts): lets anyone prove WHICH tree a
 * hosted deployment is serving (the Navigate footer shows it; <meta name="mallmind-build"> too).
 * Git may be absent on the hosting builder, so the commit is best-effort.
 */
function buildMarker(): string {
  let commit = "nogit";
  try { commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "nogit"; } catch { /* no git on the builder */ }
  return `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} ${commit}`;
}
const BUILD_MARKER = buildMarker();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: { __MALLMIND_BUILD__: JSON.stringify(BUILD_MARKER) },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    { name: "mallmind-build-meta", transformIndexHtml: (html: string) => html.replace("</head>", `    <meta name="mallmind-build" content="${BUILD_MARKER}" />\n  </head>`) },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — almost never changes, cache hits on every deploy
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // Supabase — changes only when upgrading the SDK
          "vendor-supabase": ["@supabase/supabase-js"],
          // UI primitives — Radix + shadcn components
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-toast", "@radix-ui/react-tooltip", "@radix-ui/react-slot", "class-variance-authority", "clsx", "tailwind-merge"],
          // Lucide icons tree-shook separately
          "vendor-icons": ["lucide-react"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));
