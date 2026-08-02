# Sprint 3A — External Caller Verification Runbook (READ-ONLY)

Purpose: prove, **without changing anything**, whether any external system actively invokes the
legacy direct-writers — chiefly the Supabase Edge Function `scrape-prices` — before Sprint 3A.3
quarantines any writer. Grounding:
[sprint-3a2-direct-writer-quarantine-audit.md](../architecture/sprint-3a2-direct-writer-quarantine-audit.md).

> **Global safety rules for every track below.**
> Read-only only: **do not create, update, deploy, delete, invoke, enable, disable, pause, resume,
> re-schedule, or change IAM/secrets.** **Never reveal or copy secret values, JWTs, passwords,
> connection strings, or private row contents.** Report only object/function names, deployed/not-
> deployed, schedule names, enabled/disabled, last-run timestamps, non-sensitive counts, and
> secret-redacted screenshots. If a step would require a mutation to answer, **stop and report the
> limitation** instead.

Record results in the checkboxes; attach redacted evidence; return to the architecture owner.

---

## Track A — Supabase operator verification (Dashboard, read-only)

Operator: someone with read access to the intended Supabase project(s). Do **not** assume which
project — confirm it (question 6).

1. **Is the Edge Function `scrape-prices` deployed?**
   Dashboard → Edge Functions → look for `scrape-prices`. Record: deployed / not deployed.
   - [ ] Result: ______________
2. **Is it enabled / callable?** Record enabled/disabled and whether an invoke URL is shown.
   - [ ] Result: ______________
3. **Is any schedule invoking it?** Check **all** of: Edge Functions → `scrape-prices` → Schedules;
   Database → Extensions → `pg_cron` (Cron jobs list); Database → Webhooks; any external scheduler
   documented by the team. Record each schedule **name** (not payload) and its cron expression.
   - [ ] Schedules found (names/cron): ______________
4. **Last invocation time, if visible?** Edge Functions → `scrape-prices` → Invocations/Logs; record
   the most recent timestamp only.
   - [ ] Last run: ______________
5. **Recent `scrape_logs` rows?** SQL Editor, **read-only**:
   `select count(*) as n, max(created_at) as last from public.scrape_logs;`
   Report only the count and the max timestamp — **no row contents.**
   - [ ] n=______  last=______
6. **Which project contains it?** Record the **project name/ref** only (not keys). Confirm whether it
   is the dev project or the frozen legacy project `qspsouemjtcdcfnivpnt` (which must stay untouched).
   - [ ] Project: ______________
7. **Does it reference a service-role secret?** Confirm **presence only** (e.g. the function reads a
   `SUPABASE_SERVICE_KEY`/service-role env) — **do not open or print the value.**
   - [ ] Service-role secret referenced: yes / no
8. **Can absence of a schedule be proven without changing anything?** If Schedules/Cron lists are
   empty and no webhook targets it, that is sufficient. Record how absence was established.
   - [ ] Schedule provably absent: yes / no — basis: ______________

**Track A disposition (pick one):** ☐ not deployed ☐ deployed-but-unscheduled ☐ deployed-and-scheduled
☐ state-unknown.

---

## Track B — GitHub verification (repo settings + workflow files, read-only)

1. **Does a repository or environment secret named `SUPABASE_SERVICE_KEY` exist?**
   Settings → Secrets and variables → Actions (repo + each Environment). Report **existence only** —
   **do not open/reveal the value.**
   - [ ] Repo secret exists: yes / no   Environment secret(s): ______________
2. **Which workflows reference it?** (Repo evidence: `scrape-prices.yml` and `scrape-malls.yml` write
   it into `scripts/scraper/.env`.) Confirm no other workflow references it.
   - [ ] Referencing workflows: ______________
3. **Are `scrape-prices.yml` and `scrape-malls.yml` manual-only?** Confirm each `on:` block is
   `workflow_dispatch` only, with **no `schedule:`** (repo shows schedule removed in Sprint 22C and a
   `QUARANTINED` acknowledgement gate). Confirm the live files on the default branch match.
   - [ ] Manual-only confirmed: yes / no
4. **Any environment or protection rule capable of triggering scraper deployment?** Check Environments,
   deployment branch rules, and any auto-deploy Action. Record findings.
   - [ ] Result: ______________
5. **Reusable workflows or external `repository_dispatch`?** Search for `workflow_call`,
   `repository_dispatch`, or cross-repo callers targeting these workflows.
   - [ ] Result: ______________

**Reminder:** the two workflows themselves state *"HUMAN ACTION STILL REQUIRED: if the
`SUPABASE_SERVICE_KEY` repository secret is configured, inspect/remove it."* Removal is an operator
decision — **not part of this read-only task.**

---

## Track C — Google Cloud / Gemini execution track (READ-ONLY inventory prompt)

Give the following prompt to Gemini or Google Cloud's authenticated read-only tooling. It must run
**only** read/list/describe commands.

> **READ-ONLY GCP inventory — no mutations.** In the MallMind Google Cloud project (region
> `africa-south1`), perform a strictly read-only inventory and report names/status only. You are
> **prohibited** from create, update, deploy, delete, invoke, pause/resume, IAM changes, and any
> access to secret *values*. Report:
> 1. **Cloud Scheduler** jobs — `gcloud scheduler jobs list` — names, schedules, target (redacted), state.
> 2. **Cloud Run services** — `gcloud run services list` — names + last-deployed only.
> 3. **Cloud Run jobs** — `gcloud run jobs list` — names only.
> 4. **Eventarc triggers** — `gcloud eventarc triggers list` — names + destination service.
> 5. **Pub/Sub** — `gcloud pubsub subscriptions list` / `topics list` — names only.
> 6. **Secret Manager** — `gcloud secrets list` — **secret names only; never `versions access`.**
> 7. **Service accounts** attached to the relevant Cloud Run services — emails/names only.
> 8. Any command, arg, or env reference in the above to: `scrape-prices`, `scraper`, `pricecheck`,
>    `takealot`, or `publish-staged-observations`.
> For each finding report: resource type, name, schedule/trigger (if any), and whether it references
> any of the five keywords. If answering a question would require a mutation or reading a secret
> value, **stop and report that instead.**

- [ ] Cloud Scheduler jobs (names/schedules): ______________
- [ ] Cloud Run services/jobs: ______________
- [ ] Eventarc / Pub/Sub: ______________
- [ ] Any keyword match (scrape-prices/scraper/pricecheck/takealot/publish-staged-observations): ______________

*(Repository evidence shows no Cloud Scheduler / cron for scrapers; this track confirms none exists
outside the repo.)*

---

## Track D — Founder / manual confirmation

1. Was the **"19C.1 first controlled retail publish"** intentionally a **one-off** manual operation,
   with no recurring runbook that re-runs `publish-staged-observations`?
   - [ ] Answer: ______________
2. Does **anyone manually run** the scraper workflows (`scrape-prices.yml` / `scrape-malls.yml`) today?
   - [ ] Answer: ______________
3. Is there **any external automation outside the repository** (a personal cron, a laptop task, a
   third-party scheduler, a serverless job) that writes MallMind retail/product data?
   - [ ] Answer: ______________
4. **Who previously configured the Supabase Dashboard schedule** referenced in the `scrape-prices`
   Edge Function header, and is it still intended to run?
   - [ ] Answer: ______________
5. Was the **fabricated branch-price behaviour** ("store premium above online") ever **knowingly
   used** to populate shopper-facing prices? (Needed to assess trust remediation of existing rows.)
   - [ ] Answer: ______________

---

## Consolidated gate result (fill in after all tracks)

- Edge Function `scrape-prices` disposition: ☐ not deployed ☐ deployed-but-unscheduled
  ☐ deployed-and-scheduled ☐ state-unknown.
- `SUPABASE_SERVICE_KEY` secret: ☐ absent ☐ present (operator to decide removal separately).
- GCP scheduled callers of scrapers: ☐ none found ☐ found: ______________
- Any active process that quarantine would break: ☐ none ☐ yes: ______________

When every box above is resolved and no active writer would be silently broken, report back to the
architecture owner so Sprint 3A.3's CONDITIONAL-GO can be lifted (see
[sprint-3a-architecture-decisions.md](../architecture/sprint-3a-architecture-decisions.md) — Final gate).
Nothing in this runbook authorizes disabling, deploying, or changing any system.
