# MallMind — Token Rotation Report

**Status: ⛔ INCOMPLETE — awaiting Richard's manual revocation.**
No token value appears in this document or in any command output.

## What was exposed

A Supabase **personal access token** (prefix `sbp_`) was found in plaintext in:

```
.claude/worktrees/epic-moore-2f721a/.claude/settings.local.json
```

It appears **14 times**, embedded inside pre-approved `curl` / CLI command strings in a
Claude Code permission allowlist.

### Blast radius

The token is a Supabase **Management API** credential. The commands it was embedded in
demonstrate its scope:

- `supabase functions deploy …` — deploy edge functions to the live project
- `PATCH /v1/projects/<ref>/functions/ai-assistant` with `verify_jwt:false` — **disable JWT
  verification on a live edge function**
- `GET /v1/projects/<ref>/secrets` — **read project secrets**
- `POST /v1/projects/<ref>/analytics/endpoints/logs.all` — read project logs

Treat it as capable of modifying and reading secrets on the live project.

## Containment status

| Check | Result |
|---|---|
| Token committed to git? | **No** — zero `sbp_` occurrences in any tracked file |
| File tracked? | **No** — untracked |
| Path ignored? | **Yes** — `.gitignore:30` ignores `.claude/` |
| Other plaintext copies in worktree? | **None** — exactly one file, repo-wide scan |
| Token printed to chat/logs by this process? | **No** |
| Replacement token created automatically? | **No** — deliberately not; Phase 5 requires manual creation |

**Mitigating:** it was never committed, so it is not in git history or on the remote.
**Aggravating:** it sat in a file whose entire purpose is to *pre-authorise* command
execution, and it remains valid until revoked.

## Required manual action (PENDING)

Supabase never displays a token's value after creation, so the exposed value **cannot be
matched against the dashboard list**. The dashboard shows only *name*, *created*, and
*last used*.

1. Supabase Dashboard → avatar (top-right) → **Account settings**
2. Open **Access Tokens**
3. Revoke the token used for MallMind / Claude / local automation
4. **Recommended:** revoke every personal access token not positively recognised as still
   needed. A replacement takes seconds to create, and any unaccounted-for token should be
   treated as compromised.

## Steps deliberately NOT taken (blocked on the gate above)

- ❌ Deleting the plaintext copies — intentionally deferred until revocation is confirmed,
  so the token remains identifiable if it needs to be traced first.
- ❌ Creating a replacement token — must be created manually by Richard.
- ❌ Authenticating the Supabase CLI — will not authenticate with a credential pending
  revocation.

## After revocation is confirmed — planned sequence

1. Delete the plaintext token from `settings.local.json`; if the remaining entries are only
   obsolete allowlists tied to the revoked token, remove them or delete the stale
   `epic-moore-2f721a` worktree metadata entirely.
2. Re-scan the full worktree for `sbp_` and for Supabase access-token environment variables.
3. Confirm: no tracked file contains a token; no plaintext copy remains; no value printed.
4. If a replacement is needed, Richard creates it manually and exports it **for the current
   shell only**:
   ```powershell
   $env:SUPABASE_ACCESS_TOKEN="<paste locally — never into chat>"
   ```
   It must never be written to `settings.local.json`, `.env.example`, tracked files,
   command allowlists, documentation, or shell history.

## Hardening applied in this branch (independent of the token)

- `supabase/.temp/linked-project.json` **untracked** and `supabase/.temp/` git-ignored — it
  had pinned the repo's CLI to the **live** project.
- Real project ref replaced with `YOUR_PROJECT_REF` in `scripts/scraper/README.md`,
  `scripts/scraper/.env.example`, `google-dev-agent/.env.example`.
- `scripts/supabase/guard-target.mjs` added — fail-closed project targeting.
