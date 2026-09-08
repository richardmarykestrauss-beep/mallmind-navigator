# Sprint 2M-B — Manual Logical Backup Procedure (Free plan)

The target `qspsouemjtcdcfnivpnt` is on the **Free** plan: no scheduled/managed backups, no PITR.
Before any future migration-039 window, capture a **manual logical backup** yourself. The
assistant cannot do this — a dump requires the production DB password, which the assistant is
prohibited from handling. Run these from the **separate operator directory** linked to the target
(operator-runbook Step 2), with `SUPABASE_DB_PASSWORD` exported into the shell.

> A dump necessarily contains real data. **Store it OUTSIDE the repository, never commit it, and
> never print row contents.** Verify by structure/size/checksum only.

## 1. Choose an out-of-repo location

```bash
mkdir -p ~/mallmind-backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=~/mallmind-backups/prod-$STAMP
mkdir -p "$DEST"
```

## 2. Capture three logical dumps (roles, schema, data)

```bash
# roles (no passwords are emitted by pg_dumpall --roles-only via the CLI wrapper)
supabase db dump --linked --role-only  -f "$DEST/roles.sql"
# full public schema (DDL only — no rows)
supabase db dump --linked              -f "$DEST/schema.sql"
# data (rows) — contains real data; keep private
supabase db dump --linked --data-only  -f "$DEST/data.sql"
```

Alternative (direct `pg_dump`, if you prefer a single compressed custom-format file):

```bash
# connection string from Project Settings → Database (do not paste it into chat)
pg_dump "$SUPABASE_DB_URL" -Fc -f "$DEST/full.dump"
```

## 3. Verify the backup WITHOUT exposing data

Structure + integrity only — no `cat` of data rows:

```bash
# files exist and are non-empty
ls -l "$DEST"
for f in roles.sql schema.sql data.sql; do
  test -s "$DEST/$f" && echo "OK non-empty: $f" || echo "MISSING/EMPTY: $f"
done

# schema contains the expected core tables (names only, not data)
grep -cE 'CREATE TABLE (public\.)?(retail_price_observations|retail_source_listings|retail_data_sources|malls|shops)' "$DEST/schema.sql"

# data file is plausibly populated (COUNT of COPY blocks / lines — NOT contents)
grep -c '^COPY ' "$DEST/data.sql"

# tamper-evident checksums (record these in the results template)
sha256sum "$DEST"/*.sql | tee "$DEST/SHA256SUMS.txt"

# custom-format dump (if used) — integrity + table list, no data
# pg_restore -l "$DEST/full.dump" | grep -E 'TABLE DATA (public )?retail_' | wc -l
```

Record in [readiness-results-template.md](readiness-results-template.md): destination path, UTC
timestamp, file sizes, the three checksums, and the schema/table match counts. **Do not** paste
any dump content.

## 4. Protect the backup

- Keep it under `~/mallmind-backups/` (outside the git repo). If you ever place a dump inside a
  repo tree, add it to `.gitignore` immediately and never stage it.
- Treat `data.sql` / `full.dump` as sensitive (contains shopper/user rows). Restrict file perms:
  `chmod 600 "$DEST"/*`.
- Retain at least until after a successful, separately-approved 039 window + post-verify.

## 5. What this backup is (and is not)

- It **is** a point-in-time logical snapshot you can restore into a new project if a future
  migration goes wrong (`supabase db reset` on a *new* project + `psql < schema.sql < data.sql`).
- It is **not** a managed/automated backup and **not** PITR — those are unavailable on Free.
- Creating it performs **no mutation** on the target (it is a read/`COPY TO`).
