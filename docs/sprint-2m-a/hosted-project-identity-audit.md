# Hosted Project Identity Audit — Sprint 2M-A

**Mode:** STRICTLY READ-ONLY HOSTED AUDIT. **Result of this gate: FAILED → remote inspection aborted.**

## Required gate

Before any remote query, the linked Supabase project must be proven to be **exactly** the audit
target `qspsouemjtcdcfnivpnt` (production). Abort if it differs, if more than one identity
appears, or if it belongs to a different project/organization. **Do not relink automatically.**

## Evidence (local link metadata only — no secrets read or printed)

Source: `supabase/.temp/project-ref`, `supabase/.temp/linked-project.json` (keys inspected;
no password/token/JWT/service-role value was read or printed).

| Field | Value |
|-------|-------|
| Linked project ref | `iivmrlgntspbkpfqoboi` |
| Linked project name | `mallmind-dev` |
| Linked organization | `rsjezhniyrfbavoukcli` |
| Safe pooler host | `aws-0-eu-north-1.pooler.supabase.com:5432` |
| `SUPABASE_ACCESS_TOKEN` in env | **not set** |
| `SUPABASE_DB_PASSWORD` in env | **not set** |
| `MALLMIND_ALLOW_PROD` | unset (empty) |

## Determination

- **Audit target:** `qspsouemjtcdcfnivpnt` (production).
- **Actually linked:** `iivmrlgntspbkpfqoboi` (**mallmind-dev**) — a *different* project.
- A single identity is present, and it is **not** the target.

**The linked-project identity gate FAILS: linked ref ≠ target ref.**

Reaching the target read-only from this machine would require `supabase link` to a different
project — which is on this sprint's **absolute prohibition** list (“project linking to a
different Supabase project”) and is explicitly “do not relink automatically.” There are also
no target credentials present (no access token, no DB password), and handling such secrets is
itself prohibited.

## Action taken

Per the sprint's stop conditions (“linked project reference is not `qspsouemjtcdcfnivpnt`” →
`NO-GO`) and “If any required inspection cannot be performed read-only, stop and report the
limitation”:

- **No remote command was run** (no `supabase migration list`, no `db push --dry-run`, no
  catalog query) — running any of them would have targeted the *dev* project, not the audit
  target, and still would not satisfy the gate.
- **No relink** was performed.
- **No hosted mutation of any kind** occurred (see the mutation-proof section of the readiness
  report).

## Consequence

Hosted-dependent audit sections (remote migration history, remote schema inventory, drift diff,
dry-run, remote role/grant/RLS state, backups) **could not be performed** and are marked
`HUMAN VERIFICATION REQUIRED` / `NOT PERFORMED — BLOCKED AT IDENTITY GATE`. The repository-side
static analysis (collision review, dependency lineage, rollback review, boundary review) was
completed and is reported separately.

**This environment is deliberately linked to dev, not production — that is the safe state.**
The hosted audit must be re-run by an operator whose Supabase CLI is authenticated and linked
to `qspsouemjtcdcfnivpnt`, following the operator runbook in the readiness report.
