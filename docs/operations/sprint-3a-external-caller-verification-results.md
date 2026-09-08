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

## 4. Google Cloud findings (completed — authenticated operator inventory)

Track C is now **complete**, performed by an authenticated operator (not the agent; the agent's
`gcloud` session had no authenticated account). Read-only inventory:

**Project `mallmind`:**
- Cloud Run services: `mallmind-backend-dev`, `mallmind-intake-worker-dev`.
- Cloud Run jobs: **none**.
- Cloud Scheduler: **API disabled; no Scheduler jobs**.
- Eventarc triggers: **none**. Pub/Sub topics: **none**. Pub/Sub subscriptions: **none**.
- **No scraper, pricecheck, Takealot, or retail-publisher workload found.**

**Project `mallmind-495518`:**
- Cloud Run services: **none**. Cloud Run jobs: **none**.
- Cloud Scheduler: **API disabled**. Eventarc triggers: **none**. Pub/Sub topics/subscriptions:
  **none**.

**Conclusion:** the only GCP runtime surfaces are the backend Cloud Run service and the intake
worker (dev) — **neither is a scraper or a fabricated-price writer**. No Cloud Scheduler, Eventarc,
Pub/Sub, Run Job, or retail-publisher workload exists in either project. **No active external caller
exists in Google Cloud.**

### Audit note — unintended API enablement during the first inventory attempt

Honesty record: during the **first** GCP inventory attempt, four APIs were **enabled unintentionally**
while responding to interactive `gcloud` prompts:
- `run.googleapis.com` on `mallmind-495518`
- `eventarc.googleapis.com` on `mallmind-495518`
- `secretmanager.googleapis.com` on `mallmind-495518`
- `eventarc.googleapis.com` on `mallmind`

**No Cloud Run service, job, Scheduler job, Eventarc trigger, Pub/Sub resource, secret, or
deployment was created.** Only the API *enablement flags* changed. Per instruction these APIs are
**not** being disabled in this task; this note records the configuration change transparently for
later review.

## 5. Founder confirmations (received)

Richard confirmed:
- All MallMind work was performed as part of the guided build process; he **did not independently
  configure external automation**.
- To his knowledge, the **fabricated 2–6% "in-store premium" logic was never deliberately run** to
  populate MallMind shopper prices.
- **No** Make.com, Zapier, n8n, external server, webhook, or other automation was created outside
  GitHub, Supabase, and the two inspected Google Cloud projects.

This closes the two material questions (no external automation; fabricated pricing not deliberately
run) and the two formalities (manual-only, guided-process operation).

## 6. Final disposition of `scrape-prices`

**NOT DEPLOYED / NOT SCHEDULED / NOT ACTIVE.** Confirmed not deployed in either Supabase project; no
`cron.job`; `scrape_logs` table absent; no Cloud Scheduler / Eventarc / Pub/Sub / Run Job in either
GCP project; no repository path can deploy or schedule it; the service-role secret it would need is
absent from GitHub. The fabricated-price capability exists **only as un-deployed repository code** and
is not running, scheduled, or active anywhere across the inspected GitHub, Supabase, and Google Cloud
surfaces.

## 7. Final external direct-writer verdict & Sprint 3A.3 gate

**External-caller verdict: NO ACTIVE AUTOMATED EXTERNAL CALLER FOUND.** Every surface was inspected —
repository, GitHub Actions + secrets, both Supabase projects, and both Google Cloud projects — plus
founder confirmation. No scheduler, no deployed edge function, no cloud workload, and no external
automation writes MallMind retail/product data.

All six gate conditions (per the Sprint 3A decisions doc) are now satisfied:
1. Supabase edge-fn deployment/scheduling — **met** (not deployed; no cron; no `scrape_logs`).
2. GitHub secret + workflow references — **met** (`SUPABASE_SERVICE_KEY` absent; scrapers manual-only,
   quarantined, ack-gated; no reusable/dispatch path).
3. GCP scheduler/service/trigger inventory — **met** (completed; no scraper/scheduler/eventarc/pubsub
   workload in either project).
4. ADR-A/B/C/D — **recorded** (pending post-migration promotion).
5. No active process silently broken by quarantine — **met** (no active writer exists anywhere).
6. `scrape-prices` disposition documented — **met** (NOT DEPLOYED / NOT SCHEDULED / NOT ACTIVE).

**Sprint 3A.3 verdict: FULL GO.** The external-caller gate is closed. 3A.3 (canonical funnel runtime
wiring) may proceed under the approved ADR directions, still subject to the standing migration +
security review of the implementation itself. Note (unchanged by this gate): the fabricated-price
function must never be deployed or run (fabricated-price hard rule); its dormant code should be
retired/converted as part of the direct-writer quarantine, not activated.
