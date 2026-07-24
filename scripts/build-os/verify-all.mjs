import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [
  {
    name: "Repository whitespace check",
    command: "git",
    args: ["diff", "--check"],
    cwd: ".",
  },
  {
    name: "Frontend production build",
    command: "npm",
    args: ["run", "build"],
    cwd: ".",
  },
  {
    name: "Frontend tests",
    command: "npm",
    args: ["test"],
    cwd: ".",
  },
  {
    // Sprint 2G — the Mall@Reds tenant-import preview is deterministic and
    // import-safe (no DB/network). This re-derives the preview from the register
    // and runs every safety invariant; it never mutates anything.
    name: "Mall@Reds tenant-import validation",
    command: "node",
    args: ["scripts/retail/validate-mallreds-tenant-import.mjs"],
    cwd: ".",
  },
  {
    name: "Backend TypeScript build",
    command: "npm",
    args: ["run", "build"],
    cwd: "google-cloud-backend",
  },
  {
    name: "Retail core harness",
    command: "npm",
    args: ["run", "test:retail-core"],
    cwd: "google-cloud-backend",
  },
  {
    name: "Retail publisher harness",
    command: "npm",
    args: ["run", "test:retail-publisher"],
    cwd: "google-cloud-backend",
  },
  {
    name: "Retail CSV intake harness",
    command: "npm",
    args: ["run", "test:retail-csv-intake"],
    cwd: "google-cloud-backend",
  },
  {
    name: "Shopping assistant harness",
    command: "npm",
    args: ["run", "test:shopping-assistant"],
    cwd: "google-cloud-backend",
  },
  {
    name: "CORS allowlist harness",
    command: "npm",
    args: ["run", "test:cors"],
    cwd: "google-cloud-backend",
  },
  {
    // The durable worker is the one backend target that compiles against the
    // frontend fabric, so it needs its own typecheck: the main backend build
    // deliberately excludes it (see google-cloud-backend/tsconfig.worker.json).
    name: "Durable intake worker typecheck",
    command: "npm",
    args: ["run", "typecheck:worker"],
    cwd: "google-cloud-backend",
  },
  {
    name: "Durable intake worker harness",
    command: "npm",
    args: ["run", "test:intake-worker"],
    cwd: "google-cloud-backend",
  },
  {
    // Proves the deployable artifact actually bundles (fabric + worker) before a
    // deploy is ever attempted, rather than discovering it in Cloud Build.
    name: "Durable intake worker bundle",
    command: "npm",
    args: ["run", "build:worker"],
    cwd: "google-cloud-backend",
  },
];

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

console.log("MallMind Build OS Verification");
console.log(`Node ${process.versions.node}`);

if (nodeMajor !== 22) {
  console.warn(
    `WARNING: authoritative runtime is Node 22.x; current runtime is Node ${process.versions.node}.`,
  );
}

const startedAt = Date.now();
const results = [];

for (const step of steps) {
  const stepStartedAt = Date.now();

  console.log(`\n▶ ${step.name}`);

  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  const durationSeconds = ((Date.now() - stepStartedAt) / 1000).toFixed(1);
  const passed = result.status === 0;

  results.push({
    name: step.name,
    passed,
    durationSeconds,
  });

  if (!passed) {
    console.error(`\n✖ Verification failed: ${step.name}`);
    console.error(`Exit code: ${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }

  console.log(`✔ ${step.name} (${durationSeconds}s)`);
}

const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log("\nMallMind verification summary");

for (const result of results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"}  ${result.name} (${result.durationSeconds}s)`,
  );
}

console.log(`\nALL CHECKS PASSED in ${totalSeconds}s`);
