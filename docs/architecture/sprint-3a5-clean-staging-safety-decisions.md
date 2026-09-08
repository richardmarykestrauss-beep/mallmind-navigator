# Sprint 3A.5 — Clean-Staging Safety Decisions

Status: **Approved documentation-only directions** for provisioning a clean Supabase staging project.
No project was created/linked/contacted; no code or migration changed. Operator steps:
[../operations/sprint-3a5-clean-staging-provisioning-runbook.md](../operations/sprint-3a5-clean-staging-provisioning-runbook.md).
Verification: [../operations/sprint-3a5-clean-staging-verification-plan.md](../operations/sprint-3a5-clean-staging-verification-plan.md).
Grounded in the convergence blueprint (§15/§16), the Sprint-3A decisions, and the 3A.3/3A.4
implementations.

## D1 — Isolation: separate directory + explicit DB-URL targeting (never link the main repo)

**Decision.** Clean-staging work happens in a **throwaway clone** (`~/mallmind-clean-staging`) and
applies migrations by an **explicit staging database URL**, never via `supabase link` in the normal
repository. **Why safer than using the normal repo directory:** the main worktree's link
(`supabase/.temp/project-ref = iivmrlgntspbkpfqoboi`, gitignored) is never read or written, so the
dev link cannot be clobbered; there is no hidden "linked default" to mis-target; the operator sees the
explicit URL/ref before every mutation; and `.temp` state cannot leak between directories. Rejected:
running in the normal repo (one stray `db push`/`reset` would hit dev), and CLI-link-in-main.

## D2 — Migration application: psql-by-URL primary; CLI-`db push` (staging-linked, in the clone) fallback

**Decision.** Apply `000–041` in order via `psql "$STAGING_DB_URL"` (mirrors `verify-db.mjs`), so there
is **zero project-link risk**, deterministic ordering, repeatability, explicit visible target, and
Supabase-managed-Postgres compatibility. Fallback (only if psql is unavailable): `supabase db push`
from the clone after `supabase link` to the **staging** ref only — higher link-risk, hence fallback.
**Never** `migration repair`, squash, edit, or skip migrations.

## D3 — Hard blocklist gates every hosted mutation

**Decision.** A clean-staging guard (extending the existing `staging-guard.mjs`/`hostedGuard.mjs`,
which already block `iivml`/`qspsou`) must **exit non-zero** if: the staging ref/URL is empty; the
target ref/host matches either blocked ref; the target name lacks "staging"; the ack phrase
(`APPLY-000-041-TO-CLEAN-STAGING`) is absent; the migration tree HEAD is not in the `99eb9a2` lineage;
or the cwd is the normal repo. It prints only name + masked ref/host + range — never the URL/secret.
Delivered here as **non-running pseudocode**; implement + test on the disposable stack before any
hosted use.

## D4 — Least-privilege staging service actor

**Decision.** `RETAIL_STAGING_ACTOR_ID` = a **`profiles.id`** backed by an `auth.users` row (required
by the `profiles→auth.users` FK), `is_admin=false` (staging needs no admin; `publish_verified_observation`
requires admin, so the bot **cannot publish**). Seeded idempotently on staging, auditable name
(`retail_staging_service`), rotatable by re-seed + repoint, disable by unsetting the env var. The
operator generates the UUID; **no id is fabricated in this sprint**.

## D5 — Secrets never enter git or chat

**Decision.** DB passwords, service-role keys, JWTs, access tokens, and connection strings live only
in the operator's session env / Secret Manager / GitHub Actions secrets — **never** committed, pasted
into chat, logged, or written to evidence files. Migration needs only the DB URL; the service-role key
is a later verify/deploy concern. Evidence captures identity + counts + **redacted** transcripts.

## D6 — Failure defaults to abandon-and-recreate, not repair-in-place

**Decision.** Any anomaly (partial migration, differing history/objects/grants/RLS, actor-seed
failure, replay divergence, unexpected `products` change, uncertain identity) → **STOP**, capture
redacted evidence, **delete + recreate** the disposable staging project from zero. Never
`migration repair` or hand-edit the hosted schema. A repo-migration defect escalates to migration
review before retry.

## D7 — Publication boundary unchanged; synthetic data only

**Decision.** The hosted proof uses **only synthetic fixtures** (no live retailer/shopper/personal
data) and must prove **no `products` write / no publication**. Shopper-facing projection integrity
(`products` field lock-down, `published_observation_id`, revocation projection-hiding, `price_scope`
surfacing) remains **Sprint 3B** — clean staging does not advance it.

## Acceptance gates (Sprint 3A.5 documentation)

| # | Gate | Met by |
|---|------|--------|
| 1 | Existing project refs hard-blocked | D3 blocklist + runbook PARTs 4/5 |
| 2 | Normal repo link cannot be overwritten | D1 isolation (no link/push/reset/.temp write in main) |
| 3 | Clean staging created only after explicit identity confirmation | Gate A + PART 3 identity block |
| 4 | Migration method deterministic + auditable | D2 psql-by-URL + evidence transcript |
| 5 | Secrets never in git or chat | D5 + PART 7 (names only) |
| 6 | Service actor design defined | D4 + PART 8 |
| 7 | Hosted proof uses synthetic data only | D7 + verification plan |
| 8 | Failure → abandon/recreate, not repair | D6 + PART 10 |
| 9 | Products publication prohibited | D7 + checks 18–19 |
| 10 | No hosted system contacted this sprint | documentation only; nothing run |
| 11 | No code/migration modified | only docs added |
| 12 | Operator instructions exact, one step at a time | runbook PARTs 2–6 + gates A–E |

## GO / CONDITIONAL-GO / NO-GO for operator project creation

**GO for operator-run clean-staging creation.** The runbook is deterministic, the two existing refs
are hard-blocked, the main repo link is structurally protected, secrets are contained, the service
actor and verification (20 synthetic checks) are specified, and failure defaults to abandon-and-
recreate. The one build step before the *first hosted* run is to **implement + test the D3 blocklist
guard on the disposable stack** (non-running pseudocode today) — a small, local, code-side task for a
later sprint, not a blocker to the documentation being accepted. Production readiness and shopper
projection integrity remain out of scope (Sprint 3B+).
