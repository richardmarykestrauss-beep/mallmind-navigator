# MallMind — Token Rotation Report

**Status: ✅ REVOKED AND CLEANED — one residual class (dead-token session logs) noted below.**
No token value appears in this document. Prose references to the `sbp_` prefix are the
literal prefix only, never a token value.

## What was exposed

A Supabase **personal access token** (prefix `sbp_`) was found in plaintext in:

```
.claude/worktrees/epic-moore-2f721a/.claude/settings.local.json
```

It appeared **14 times**, embedded inside pre-approved `curl` / CLI command strings in a
Claude Code permission allowlist.

### Blast radius (now neutralised by revocation)

The token was a Supabase **Management API** credential. The commands it was embedded in
showed its scope: deploy edge functions, `PATCH …/functions/ai-assistant {verify_jwt:false}`
(disable JWT verification on a live function), `GET …/secrets` (read project secrets), and
read project logs.

## Revocation — DONE ✅

Richard revoked **all** personal access tokens shown in the Supabase dashboard, including:

- `MallMindPowerShell`
- `Redeploy`
- `cli_sovereign_systems_sa` token(s)
- `cli_RICHARD` token(s)

Because Supabase never displays a token's value after creation, the exposed value could not
be matched by value — so revoking the full set is the correct, conservative outcome. Every
`sbp_` credential that previously existed is now dead.

## Plaintext cleanup — DONE ✅

| Location | Action | Result |
|---|---|---|
| `.claude/worktrees/epic-moore-2f721a/.claude/settings.local.json` | Removed the 14 allowlist entries containing the token; preserved the 94 unrelated entries | **0** `sbp_` occurrences; file re-validated as JSON (94 entries) |
| Session task-output temp file (`…/tasks/br6bvq9vq.output`, from the 2F-B background scan) | Deleted | Gone; temp dir re-scanned clean |

The settings file was left functional (it is a Claude Code permission allowlist for an active
worktree) rather than deleted, because only 14 of its 108 entries were token-bearing and the
rest are legitimate unrelated permissions.

## Post-cleanup scan

Scope: main repository, **all 16 sibling `mallmind-*` worktrees**, `.claude` metadata
(project-local and global `~/.claude`), scratchpad/task temp files, and untracked files.
Pattern: a **real token value** = `sbp_` followed by ≥20 alphanumerics.

| Surface | Real token values found |
|---|---|
| All `mallmind-*` worktrees (main repo included) | **0** |
| `~/.claude` active settings / config / env files | **0** |
| Session scratchpad + task-output temp files | **0** |
| Tracked git files (any branch) | **0** (was already 0 — never committed) |

**Confirmed: zero operational/usable plaintext copies of any personal access token remain.**

## Residual: dead-token session transcripts (noted, not auto-deleted)

Two Claude Code **session transcript logs** still contain the token as historical text:

```
~/.claude/projects/…-mallmind-navigator/72ae7c8c-….jsonl                 (this live session)
~/.claude/projects/…-epic-moore-2f721a/8bd09785-….jsonl                   (an older worktree session)
```

These are append-only session records maintained by the Claude Code harness, outside the git
repository. The token they contain is **revoked and non-functional**, so they are inert text,
not an exploitable credential. They were **not** auto-deleted because:

- deleting the **live** session's own transcript while it is running can corrupt session state;
- these are harness-managed history files, not project artifacts.

**Optional belt-and-suspenders for Richard:** after this session ends, the two `.jsonl` files
above may be deleted manually to purge even the dead-token text. Not required for security —
revocation already closed the risk.

## Replacement token

**Not created.** Per instruction, no replacement was generated or requested. When one is
later needed, Richard creates it manually and exports it **for the current shell only**:

```powershell
$env:SUPABASE_ACCESS_TOKEN="<paste locally — never into chat>"
```

It must never be written to `settings.local.json`, `.env.example`, tracked files, command
allowlists, documentation, or shell history.

## Related hardening already landed on this branch

- `supabase/.temp/linked-project.json` untracked and `supabase/.temp/` git-ignored — it had
  pinned the repo's CLI to the **live** project.
- Real project ref replaced with `YOUR_PROJECT_REF` in tracked examples/docs.
- `scripts/supabase/guard-target.mjs` — fail-closed project targeting (prod requires an
  explicit `MALLMIND_ALLOW_PROD=1`).
