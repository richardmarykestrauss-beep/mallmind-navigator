# Sprint 3A — External Caller Verification Results

Mode: **READ-ONLY.** Records the outcome of the verification runbook
([sprint-3a-external-caller-verification-runbook.md](sprint-3a-external-caller-verification-runbook.md)).
No code, workflow, secret, schema, or hosted change was made; no system was deployed, invoked,
disabled, or mutated. Grounding:
[../architecture/sprint-3a2-direct-writer-quarantine-audit.md](../architecture/sprint-3a2-direct-writer-quarantine-audit.md),
[../architecture/sprint-3a-architecture-decisions.md](../architecture/sprint-3a-architecture-decisions.md).

## 1. Supabase findings (confirmed manually by the operator)

| Project | Finding |
|---------|---------|
| `qspsouemjtcdcfnivpnt` (prod, frozen) | `scrape-prices` Edge Function **not deployed**; `cron.job` does **not exist**; `public.scrape_logs` does **not exist** |
| `iivmrlgntspbkpfqoboi` (dev) | **No** Edge Functions deployed |

**Implication:** the fabricated-price Edge Function is **not running anywhere**, has **no schedule**,
and its log table is absent — the trust-poisoning path is dormant (code present in repo only).

## 2. GitHub workflow findings (repository-grounded, this task)

Workflows present: `agent-build.yml`, `scrape-malls.yml`, `scrape-prices.yml`, `verify.yml`.

| Workflow | Trigger | Reusable / externally dispatchable | References | Can deploy/invoke Supabase/GCP? | Can write products/retail? | Status |
|----------|---------|-----------------------------------|-----------|-------------------------------|----------------------------|--------|
| `scrape-prices.yml` | `workflow_dispatch` **only** (schedule removed; `on:` block verified) | No `workflow_call`/`repository_dispatch` | `scraper`, `SUPABASE_SERVICE_KEY` (writes to `scripts/scraper/.env`), `products` (in quarantine banner) | No deploy/invoke of edge fn/Cloud Run; it *runs the Node scraper* which would write `products` directly **only if** `SUPABASE_SERVICE_KEY` existed | Would (via scraper) — **but the secret is absent** | **Quarantined; manual-only; typed `QUARANTINED` ack required** |
| `scrape-malls.yml` | `workflow_dispatch` **only** (schedule removed) | No | `scraper`, `SUPABASE_SERVICE_KEY` | Same as above (mall/store writes) | Would (via scraper) — secret absent | **Quarantined; manual-only; `QUARANTINED` ack required** |
| `agent-build.yml` | `workflow_dispatch` | No | "Secrets: ONLY `ANTHROPIC_API_KEY`. No Supabase / Google Cloud / deploy secret"; forbids touching `supabase/**`, deploy config | **No** | **No** | Active (AF-1 build loop) |
| `verify.yml` | `push`, `pull_request`, `workflow_dispatch` | No | CI only | **No** | **No** | Active (CI) |

Specific confirmations requested:
1. **`scrape-prices.yml`** — verified: `on: workflow_dispatch` only; `QUARANTINED` acknowledge input required.
2. **`scrape-malls.yml`** — verified: same.
3. **Schedule blocks absent** — **yes.** Every `schedule` occurrence in both files is a **comment**
   ("schedule trigger removed in Sprint 22C", "Do not re-add a `schedule:` trigger"); no active
   `schedule:` trigger exists.
4. **Typed `QUARANTINED` acknowledgement required** — **yes**, both workflows refuse to run unless the
   `acknowledge` input equals `QUARANTINED`.
5. **Any other workflow indirectly calls them** — **no.** No `workflow_call`, `repository_dispatch`,
   or cross-workflow invocation references these workflows.

**Missing-secret reference:** both scraper workflows reference `SUPABASE_SERVICE_KEY`, which the
operator confirms is **not present** in repository secrets (present: `AF1_APP_CLIENT_ID`,
`AF1_APP_PRIVATE_KEY`, `ANTHROPIC_API_KEY`). A manual scraper run would therefore have **no
service-role credential to write with** — the write path is doubly closed (quarantine + no key).

**No workflow can:** deploy/invoke a Supabase Edge Function, invoke Cloud Run or Cloud Scheduler, or
write directly to `products`/retail tables — **except** the two quarantined scrapers, which are
manual-only and lack the now-absent service-role secret.

## 3. Repository scheduler / deployment findings

Scoped sweep (excluding `node_modules`, `dist`, `.claude/worktrees`):

- **Cloud Scheduler / Cloud Run Jobs / Cloud Run services / Eventarc / Pub/Sub** — no repository
  definition or invocation found.
- **cron expressions / scheduler resource names / webhook URLs** — none found.
- **External automation (Make.com / Zapier / n8n / `repository_dispatch`)** — none found.
- **`supabase functions deploy`** — appears **only as header comments** in
  `supabase/functions/{admin-stats,notify-price-drops,scrape-prices}/index.ts:6-14` and in
  `scripts/scraper/README.md:84` / docs; **no workflow or script executes it.** Corroborated by
  `docs/environments/mallmind-environment-separation.md:72-75`: the committed Supabase project link
  was removed and the deploy commands are "comments only … neutralised."
- **`supabase/config.toml`** — no `schedule`/`cron` entries.
- **Scraper writers** (`publish-staged-observations`, `pricecheck`, `takealot`, `import-csv-staging`,
  `reverify-demo-prices`) — no package script, no workflow, no scheduler references them (per Sprint
  3A.2; re-confirmed).

**"No repository evidence of an active external caller was found."**

## 4. Google Cloud findings / authenticated-access blocker

**Track C is BLOCKED for the agent.** The `gcloud` CLI is installed but has **no authenticated
account** available to this session (`gcloud auth list` returned no account, exit 49). I therefore
**cannot** perform the read-only GCP inventory (Cloud Scheduler / Run / Run Jobs / Eventarc /
Pub/Sub / Secret Manager names / service accounts). No GCP API was contacted.

**Residual risk is low but not formally closed:** the repository contains **no** path that deploys or
invokes a scraper via GCP, **no** scheduler definitions, and the only GCP runtime surfaces are the
backend Cloud Run service + intake worker (not scrapers). Formal closure requires an
already-authenticated operator or Gemini to run the read-only inventory in
[the runbook, Track C](sprint-3a-external-caller-verification-runbook.md).

## 5. Remaining founder confirmations (reduced to the minimum)

Repository + operator evidence has closed most questions. Still worth a one-line founder answer:

- **(material)** Was the **fabricated in-store price behaviour** ("store premium above online") ever
  **intentionally used** to populate shopper-facing prices? — determines whether existing `products`
  rows need trust remediation, independent of the (now-dormant) code.
- **(material)** Is there **any external automation outside GitHub / Supabase / GCP** (a personal
  cron, a laptop task, a third-party scheduler) that writes MallMind retail/product data?
- **(low-risk formality)** Was the **19C.1 publish** a one-off manual event? (The planner is unwired;
  low risk.)
- **(low-risk formality)** Does anyone **manually run** the scraper workflows? (Gated by the
  `QUARANTINED` ack **and** blocked by the absent `SUPABASE_SERVICE_KEY`; effectively moot.)

## 6. Final disposition of `scrape-prices`

**NOT DEPLOYED.** Confirmed not deployed in either Supabase project; no cron; `scrape_logs` table
absent; no repository path can deploy or schedule it; the service-role secret it would need is
absent. The fabricated-price capability exists **only as un-deployed repository code** and is not
running or scheduled anywhere verified.

## 7. Final recommendation for Sprint 3A.3

**CONDITIONAL-GO (narrow).** The active-caller risk is effectively cleared: no active external caller
was found; the fabricated-price Edge Function is **not deployed**; the scrapers are quarantined,
manual-only, and cannot write (no service-role secret); no scheduler exists in repo, Supabase (cron
absent), or any evidence trail; CI/build workflows cannot deploy/invoke/write.

Of the six gate conditions (per the Sprint 3A decisions doc):
1. Supabase edge-fn deployment/scheduling — **met** (not deployed).
2. GitHub secret + workflow references — **met** (secret absent; workflows manual-only quarantined).
3. GCP scheduler/service/trigger inventory — **NOT formally completed** (Track C unavailable to the
   agent; low residual risk). ← the single remaining formal gate.
4. ADR-A/B/C/D — **recorded** (pending post-migration promotion).
5. No active process silently broken by quarantine — **strongly supported** (no active writer found).
6. `scrape-prices` disposition documented — **met** (NOT DEPLOYED).

**Recommendation:** proceed to *design and prepare* Sprint 3A.3, and **lift to full GO once the
Track C GCP read-only inventory is completed by an authenticated operator/Gemini** and the two
material founder questions (§5) are answered. This remains CONDITIONAL-GO only because of the
formally-incomplete GCP track — not because any active caller was found.

The fabricated-price function must not be disabled or deployed during this task; ADR implementation
details are not written here.
