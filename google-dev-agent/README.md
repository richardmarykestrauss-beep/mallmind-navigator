# MallMind Dev Agent — MVP

> **Version 0.1.0 — Read / Test / Report only.**
> This agent cannot edit code, push branches, open PRs, or deploy anything.
> See `docs/google-cloud-dev-agent-plan.md` for the full architecture plan.

---

## What It Does

The Dev Agent runs smoke tests against the live Cloud Run dev backend, analyses
the results using Gemini 2.5 Flash, and writes a structured Markdown report.

```
Receive task → Safety check → Smoke tests → Gemini analysis → Write report → Exit
```

One task type is supported in this version: **`VERIFY_BACKEND_DEV`**

It tests five endpoints:

| Endpoint | What It Checks |
|---|---|
| `GET /health` | Server is up and returning `status: ok` |
| `POST /detect-active-mall` | Mall detection works from GPS coordinates |
| `POST /recommend-products` | Product search returns ranked results |
| `POST /build-route` | Dijkstra routing returns step-by-step navigation |
| `POST /assistant` | Gemini AI responds to a natural language product query |

Each endpoint is classified as: **REAL**, **DEMO_DATA**, **PARTIAL**, **BROKEN**, or **BLOCKED**

---

## Quick Start

### Prerequisites
- Node.js 22+
- A Google Cloud account with Vertex AI enabled (`gcloud auth application-default login`)
- Access to the MallMind Cloud Run dev service

### Install and run locally

```bash
cd google-dev-agent
npm install
cp .env.example .env
# Edit .env — add SUPABASE_SERVICE_ROLE_KEY for the /build-route test

npm run build
npm run verify
```

The report is written to `reports/dev-agent/backend-smoke-test-<timestamp>.md`

### Run without building (dev mode)

```bash
npm run verify:dev
```

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CLOUD_RUN_DEV_URL` | No | Live dev URL | Backend to test |
| `GOOGLE_CLOUD_PROJECT` | No | — | Enables Gemini report analysis |
| `VERTEX_AI_LOCATION` | No | `us-central1` | Gemini region |
| `SUPABASE_URL` | No | — | Enables `/build-route` test |
| `SUPABASE_SERVICE_ROLE_KEY` | No | — | Enables `/build-route` test |
| `REPORTS_DIR` | No | `../reports/dev-agent` | Report output directory |
| `TEST_MALL_ID` | No | Mall@Reds UUID | Fixture for smoke tests |
| `TEST_MALL_LAT` | No | `-25.8586` | Fixture for detect-mall test |
| `TEST_MALL_LNG` | No | `27.9891` | Fixture for detect-mall test |
| `TEST_SHOP_ID` | No | Game UUID | Fixture for build-route test |
| `TASK` | No | `VERIFY_BACKEND_DEV` | Task type override |

---

## Report Status Classifications

| Status | Meaning |
|---|---|
| ✅ **REAL** | Endpoint works correctly with live Supabase and Gemini data |
| 🟡 **DEMO_DATA** | Endpoint works but operating on manually seeded development data |
| ⚠️ **PARTIAL** | Endpoint responds but returns incomplete or empty results |
| ❌ **BROKEN** | HTTP error, timeout, or unexpected response format |
| ⛔ **BLOCKED** | Not tested — missing credentials or blocked by safety rules |

---

## Safety Rules

The safety guard (`src/safetyGuard.ts`) runs **before** any test. It checks:

1. Task type must be in the allowed list (`VERIFY_BACKEND_DEV`)
2. Any instruction passed via `--instruction` must not contain blocked patterns

Blocked patterns include (not exhaustive):
- `wallet`, `payment`, `p2p`, `transfer`, `balance`, `crypto`, `bnpl`
- `drop table`, `truncate`, `delete from`
- `deploy production`, `push to main`, `change iam`, `change billing`

If the safety check fails, the agent exits immediately with code 1 and writes
nothing. No test is run. No report is created.

These checks are hardcoded in TypeScript — they cannot be overridden by Gemini
or by any prompt content.

---

## What This Agent Cannot Do

This is intentional and enforced by the codebase, not just policy:

- ❌ Edit any source file
- ❌ Create or push a git branch
- ❌ Open a pull request
- ❌ Trigger a Cloud Build
- ❌ Deploy to Cloud Run (dev or production)
- ❌ Modify IAM policies
- ❌ Read or write secrets in Secret Manager
- ❌ Run database migrations or destructive SQL
- ❌ Access any production service
- ❌ Touch any file matching: `wallet`, `payment`, `p2p`, `*.env`, secrets, IAM

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All tests passed (REAL or DEMO_DATA) |
| `1` | Safety check failed or unhandled error |
| `2` | Tests ran but one or more endpoints returned BROKEN |

---

## Report Location

Reports are written to:
```
reports/dev-agent/backend-smoke-test-<YYYY-MM-DD_HH-MM-SS>.md
```

This path is relative to the **repo root** (`mallmind-navigator/`), not the
`google-dev-agent/` folder.

The `reports/` directory is gitignored — reports are never committed to the repo.

---

## Future Versions (not yet built)

Planned expansions from `docs/google-cloud-dev-agent-plan.md`:

- v0.2: Read and analyse source files, identify TypeScript errors
- v0.3: Trigger Cloud Build and read build logs
- v0.4: Create a branch and commit generated code changes
- v0.5: Open a PR with the verification report as the body
- v1.0: Full autonomous loop with human approval gate

Each version requires a separate review before implementation.
