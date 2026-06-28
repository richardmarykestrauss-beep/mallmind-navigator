/**
 * MallMind Build OS — AF-1 Scope Guard tests (pure, no git, no network).
 * Run: npm run test:scope-guard
 */

import { evaluateScope, globToRegExp, matchesAny } from "./scope-guard.mjs";
import process from "node:process";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const ALLOWED = ["src/**", "docs/**/*.md"];
const opt = (over = {}) => ({ allowedGlobs: ALLOWED, maxLines: 400, ...over });

console.log("\nAF-1 scope-guard");

// glob basics
assert(globToRegExp("src/**").test("src/a/b.ts"), "glob src/** matches nested");
assert(!globToRegExp("src/**").test("docs/a.md"), "glob src/** rejects other dir");
assert(globToRegExp("docs/**/*.md").test("docs/x/y.md"), "glob docs/**/*.md matches nested md");
assert(matchesAny("package-lock.json", ["**/package-lock.json", "package-lock.json"]), "matchesAny root lockfile");

// 1. allowed file change → PASS
{
  const r = evaluateScope([{ path: "src/pages/Home.tsx", status: "M", added: 10, deleted: 4 }], opt());
  assert(r.ok && r.violations.length === 0, "allowed file change passes");
}

// 2. forbidden path: .github/** → FAIL (ci_workflow)
{
  const r = evaluateScope([{ path: ".github/workflows/agent-build.yml", status: "M", added: 5, deleted: 1 }], opt());
  assert(!r.ok && r.violations.some((v) => v.rule === "ci_workflow"), "workflow modification blocked");
}

// 3. excessive diff size → FAIL (max_lines)
{
  const r = evaluateScope([{ path: "src/big.ts", status: "M", added: 500, deleted: 60 }], opt());
  assert(!r.ok && r.violations.some((v) => v.rule === "max_lines"), "excessive diff size blocked");
}

// 4. migration modification → FAIL (migrations)
{
  const r = evaluateScope([{ path: "supabase/migrations/033_x.sql", status: "A", added: 20, deleted: 0 }], opt());
  assert(!r.ok && r.violations.some((v) => v.rule === "migrations"), "migration modification blocked");
}

// 5. supabase config → FAIL
{
  const r = evaluateScope([{ path: "supabase/config.toml", status: "M", added: 2, deleted: 1 }], opt());
  assert(!r.ok && r.violations.some((v) => v.rule === "supabase_config"), "supabase config blocked");
}

// 6. suspicious test deletion → FAIL (test_deletion)
{
  const r = evaluateScope([{ path: "src/__tests__/home.test.ts", status: "D", added: 0, deleted: 120 }], opt());
  assert(!r.ok && r.violations.some((v) => v.rule === "test_deletion"), "test file deletion blocked");
}

// 6b. assertion reduction in a modified test → FAIL (assertion_reduction)
{
  const r = evaluateScope(
    [{ path: "src/a.test.ts", status: "M", added: 2, deleted: 8, assertionsAdded: 0, assertionsRemoved: 5 }],
    opt({ allowedGlobs: ["src/**"] }),
  );
  assert(!r.ok && r.violations.some((v) => v.rule === "assertion_reduction"), "assertion gutting blocked");
}

// 7. out-of-scope path → FAIL (out_of_scope)
{
  const r = evaluateScope([{ path: "google-cloud-backend/src/server.ts", status: "M", added: 3, deleted: 1 }], opt());
  assert(!r.ok && r.violations.some((v) => v.rule === "out_of_scope"), "path outside allowed_files blocked");
}

// 8. .env secret file added → FAIL (secret_file); .env.example allowed by rule (still needs allow-list)
{
  const r = evaluateScope([{ path: "src/.env", status: "A", added: 1, deleted: 0 }], opt({ allowedGlobs: ["src/**"] }));
  assert(!r.ok && r.violations.some((v) => v.rule === "secret_file"), ".env addition blocked");
  const ex = evaluateScope([{ path: "src/.env.example", status: "A", added: 1, deleted: 0 }], opt({ allowedGlobs: ["src/**"] }));
  assert(!ex.violations.some((v) => v.rule === "secret_file"), ".env.example is not treated as a secret file");
}

// 8b. key material → FAIL
{
  const r = evaluateScope([{ path: "src/key.pem", status: "A", added: 30, deleted: 0 }], opt({ allowedGlobs: ["src/**"] }));
  assert(!r.ok && r.violations.some((v) => v.rule === "secret_file"), "pem key blocked");
}

// 9. secret content in added lines → FAIL (secret_content)
{
  const r = evaluateScope([{ path: "src/config.ts", status: "M", added: 1, deleted: 0, secretHit: true }], opt({ allowedGlobs: ["src/**"] }));
  assert(!r.ok && r.violations.some((v) => v.rule === "secret_content"), "secret content blocked");
}

// 10. lockfile change blocked by default, allowed with flag
{
  const blocked = evaluateScope([{ path: "package-lock.json", status: "M", added: 50, deleted: 10 }], opt({ allowedGlobs: ["**"] }));
  assert(blocked.violations.some((v) => v.rule === "lockfile"), "lockfile blocked by default");
  const ok = evaluateScope([{ path: "package-lock.json", status: "M", added: 50, deleted: 10 }], opt({ allowedGlobs: ["**"], allowLockfiles: true }));
  assert(!ok.violations.some((v) => v.rule === "lockfile"), "lockfile allowed with --allow-lockfiles");
}

// 11. Build OS authority protected by default
{
  const blocked = evaluateScope([{ path: "docs/build-os/AUTHORITY.md", status: "M", added: 3, deleted: 3 }], opt({ allowedGlobs: ["docs/**"] }));
  assert(blocked.violations.some((v) => v.rule === "buildos_authority"), "Build OS authority protected");
  const ok = evaluateScope([{ path: "docs/build-os/AUTHORITY.md", status: "M", added: 3, deleted: 3 }], opt({ allowedGlobs: ["docs/**"], allowBuildOs: true }));
  assert(!ok.violations.some((v) => v.rule === "buildos_authority"), "Build OS authority editable with --allow-buildos");
}

// 12. empty allow-list denies everything (safe default)
{
  const r = evaluateScope([{ path: "src/a.ts", status: "M", added: 1, deleted: 0 }], { allowedGlobs: [], maxLines: 400 });
  assert(!r.ok && r.violations.some((v) => v.rule === "out_of_scope"), "empty allow-list denies by default");
}

// 13. scripts/build-os protected by default
{
  const r = evaluateScope([{ path: "scripts/build-os/scope-guard.mjs", status: "M", added: 2, deleted: 2 }], opt({ allowedGlobs: ["scripts/**"] }));
  assert(r.violations.some((v) => v.rule === "buildos_authority"), "scripts/build-os protected");
}

// 14. AF-1 protected set: .github/**, docs/build-os/**, scripts/build-os/**, supabase/migrations/**
//     are ALL blocked for an ordinary agent task even if allow-list is permissive.
{
  const protectedPaths = [
    ".github/workflows/agent-build.yml",
    "docs/build-os/AUTHORITY.md",
    "scripts/build-os/verify-all.mjs",
    "supabase/migrations/033_x.sql",
  ];
  const changes = protectedPaths.map((p) => ({ path: p, status: "M", added: 1, deleted: 1 }));
  const r = evaluateScope(changes, { allowedGlobs: ["**"], maxLines: 400 });
  const blocked = new Set(r.violations.map((v) => v.path));
  assert(protectedPaths.every((p) => blocked.has(p)), "all four AF-1 protected path sets are blocked together");
}

console.log(`\n===== AF-1 SCOPE GUARD: ${passed} passed, ${failed} failed =====`);
if (failed > 0) process.exit(1);
