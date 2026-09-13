# venue-factory/

| Path | What |
|---|---|
| `jobs/` | transient job working directories (git-ignored); one per `venue:new` |
| `fixtures/factory-test-centre/` | the synthetic end-to-end fixture (plan PNG, directory, manifest, extractions, reviews, field sheet) |
| `dry-runs/<name>/` | recorded replays of real research evidence (`npm run venue:dryrun -- <name>`) with reproducible `output/` |

Published packs never live here: `venue:publish` writes into the job, and `--bundle` copies into
`src/venue/packs/` (the app's registry). Documentation: `docs/venue-factory/README.md`.
