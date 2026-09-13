# Venue Pack Factory — evidence ingestion pipeline

The factory is the controlled, auditable path from raw evidence to a publishable **Venue Pack**
(the one data contract MallMind Core navigates — see `docs/venue-packs/README.md`). It produces
the same pack the app validates; there is no second data model.

```
RAW EVIDENCE ──► SOURCE MANIFEST ──► CANDIDATE EXTRACTION ──► EVIDENCE LEDGER ──► HUMAN REVIEW
 (map image,      (what, whose,        (human, file or AI:      (facts, proposed)    (accept / reject /
  directory,       rights, checksum,    floors, nodes, edges,                          override / unresolved)
  notes, field     pixel coordinate     instructions, …)                                     │
  sheet)           system)                                                                   ▼
                                                                          DETERMINISTIC COMPILER ──► DRAFT PACK
                                                                          (accepted facts only)         │
                                                                                                        ▼
                                                                   HUMAN APPROVAL ──► PUBLISH GATE ──► published/<id>.v<N>.venue.json
                                                                                                        (optional --bundle → src/venue/packs)
```

Every stage is a plain JSON artifact on disk under `venue-factory/jobs/<job_id>/`, written only by
the CLI, inspectable by anyone, and reproducible: the compiler has no clock, no randomness and no
model inside it.

## Truth rules (what the code enforces)

| Rule | Where |
|---|---|
| A fact enters the ledger as `proposed`. Only a human review moves it to `accepted`, `rejected` or `superseded`. | `ledger.ts` `appendFacts` / `applyReview` |
| AI or manual **inference** is never bulk-accepted and never accepted without a written reason. An AI worker may submit first-party classes only with `manual_review_required: true`. | `validateInputs.ts` `checkReview`, `checkExtraction` |
| Nothing is erased: an override marks the old fact `superseded` and appends the replacement with a `supersedes` link; rejected facts stay. | `applyReview` |
| The compiler reads **accepted** facts only and fails (never guesses) on an unknown, unaccepted or rejected reference, an unknown floor, or an unsupported distance state. | `compile.ts` |
| Evidence tiers are derived from evidence classes: `field_verified` → field-verified · first-party / operator / secondary → source-backed · inference → schematic (geometry) / unverified (identity). | `compile.ts` `geometryTierOf` / `identityTierOf` |
| Metres come only from an accepted `field_verified` measurement; a `"m"` pack needs one on every edge; a verified door needs an accepted `field_verified` arrival fact. | `compile.ts`, `publish.ts` |
| Pixel lengths are shortest-path weights, never distances; a missing `length_px` is derived from plane coordinates and flagged in the edge notes. | `compile.ts` |
| Publishing requires: app validator passes, references resolve, no unresolved blocking fact, metric truth, unique venue id (or an explicit revision / `--replace`), `pack_version` continuity, routability from every start, and a human approval bound to the exact draft bytes (sha256). | `publish.ts` |
| A pack is registered into the app bundle only by an explicit `venue:publish -- --bundle`. | `cli.ts` |

## Canonical workflow

```bash
# 1. open a job (venue identity + policies; NO geometry). For a revision, start from the current pack:
npm run venue:new -- --job grm-survey-2026-10 --venue venue.json --from-pack src/venue/packs/garden-route-mall.venue.json --revision-note "Field survey 2026-10-05"

# 2. register sources (files go under venue-factory/jobs/<job>/raw/, or point --raw at a folder to copy them)
npm run venue:sources -- --job grm-survey-2026-10 --manifest sources.json --raw ./evidence

# 3. submit candidate extractions (human, file or AI). Shape is validated; truth is not claimed.
npm run venue:extract -- --job grm-survey-2026-10 --input extraction.json

# 3b. field observations go through the same ledger
npm run venue:field-import -- --job grm-survey-2026-10 --input field-sheet.json

# 4. human review (accept / reject / override-with-reason / unresolved)
npm run venue:review -- --job grm-survey-2026-10 --review review.json

# 5. deterministic compile → validated draft (fails loudly on unresolved truth)
npm run venue:compile -- --job grm-survey-2026-10
npm run venue:diff -- --job grm-survey-2026-10          # what changed vs the base pack

# 6. approve (a second review carrying decision.action = approve), then publish
npm run venue:review -- --job grm-survey-2026-10 --review approve.json
npm run venue:publish -- --job grm-survey-2026-10         # → jobs/<job>/published/<id>.v<N>.venue.json (+ .diff.json)
npm run venue:publish -- --job grm-survey-2026-10 --bundle --replace   # ALSO copy into src/venue/packs + bundle.json
npm run validate:venues

npm run venue:status -- --job grm-survey-2026-10          # state, ledger counts, history
npm run venue:validate -- --job grm-survey-2026-10        # publish checks without needing approval
```

Environment: `VENUE_FACTORY_ROOT` (jobs root; default `venue-factory/jobs`), `VENUE_FACTORY_NOW`
(fixed ISO clock for job history — reproducible runs; the compiler never reads a clock).

## Job model (`job.json`)

`job_id`, `venue_id`, `created_at`, `status`, `venue` (identity, deployment, `distance_unit`,
`field_verification_intent`, policies, notes), `pack_version` (next version to publish),
`revision_note`, `sources`, `extraction_outputs[]`, `evidence_ledger`, `reviews[]`, `draft_pack`,
`validation_result`, `approval_state` (`decision`, `reviewer`, `at`, `reason`, `draft_sha256`),
`published_pack_version`, `published_pack`, `base_pack`, `history[]`.

Status flow: `created → sources_registered → extracting → (draft_ready →) awaiting_review | validation_failed → approved | rejected → published`.
Any ledger change (extraction, field import, review decisions) invalidates the draft, its
validation and its approval, and returns the job to `extracting`.

Layout of a job directory:

```
venue-factory/jobs/<job_id>/
  job.json  sources.json  ledger.json
  raw/                       stored artifacts (checksummed; PNG headers verified)
  base/<id>.v<N>.venue.json  the pack this job revises (copy)
  extractions/NN-<name>.json every submitted extraction / field import (verbatim, job_id stamped)
  reviews/NN-<name>.json     every review (verbatim)
  draft/<id>.draft.venue.json
  published/<id>.v<N>.venue.json + <id>.v<N>.diff.json
```

`venue-factory/jobs/` is transient (git-ignored except `.gitkeep`). Reproducible inputs live in
`venue-factory/fixtures/` and `venue-factory/dry-runs/`.

## Source manifest (`sources.json`)

`sources[] { source_id, type, title, origin, acquired_at, party, rights { status, note }, checksum?, file?, image?, notes? }`
with `type ∈ official_webpage | official_directory | official_map_image | official_pdf | operator_provided_plan | field_photo | field_measurement | secondary_reference | manual_note`,
`party ∈ first_party | secondary | operator | field | derived`, `rights.status ∈ permitted | public_no_reuse | unknown | restricted`.
`origin` is stored as text — the factory never fetches, opens or renders it. A stored file must sit
under `raw/` and carry its sha256; a PNG's declared `image { width_px, height_px, origin, x_axis, y_axis, fit }`
is checked against the PNG header (only the header is read; nothing is decoded — no OCR, no CV).
**Public availability is not reuse permission**: rights `unknown` / `public_no_reuse` / `restricted`
sources contribute facts only; their artwork is never bundled.

## Candidate extraction (`extraction.json`) and the worker seam

`{ schema_version, worker { kind: manual | file | ai, name, version?, model? }, source_ids[], floors[], nodes[], unit_polygons[], store_labels[], corridor_centerlines[], edges[], instructions[], destinations[], anchors[], amenities[], facts[] }`.
Every candidate carries `id, source_id, evidence_class, confidence (0..1), manual_review_required, notes?`
and its own fields (a node: `name, kind, floor, at`). A point is either `{ x_percent, y_percent }`
on the 1000:620 plane or `{ image: <source_id>, px_x, px_y }` on a registered image, normalised on
ingest (`fit: "stretch"` — each axis 0..1; `fit: "pad-to-plane"` — letterboxed, aspect preserved,
which is how the Garden Route and Menlyn packs were prepared) with the pixels kept as provenance.

Evidence classes: `explicit_first_party · visual_first_party · operator_supplied · field_verified · secondary_corroboration · ai_inference · manual_inference`.

`VenueExtractionWorker` is a file-based contract: whoever (person, script, model) writes a valid
extraction JSON may submit it. No model provider is wired, imported or required. An AI worker is
free to submit; it has no authority — its candidates are proposed facts a human must decide.

## Evidence ledger (`ledger.json`)

`facts[] { fact_id, subject, predicate, value, source_id, evidence_class, confidence, status, proposed_by, manual_review_required, notes?, decision?, supersedes?, superseded_by? }`,
`status ∈ proposed | accepted | rejected | superseded`. Candidate facts are addressed as
`<kind>:<id>` (`node:grm-entrance-4`, `edge:…`, `instruction:…`, `destination:…`, `anchor:…`,
`floor:…`, `amenity:…`, `label:…`, `unit:…`, `centerline:…`; field facts `measurement:`,
`confirmation:`, `door:`, `accessibility:`); free facts keep their own ids (`G01`).

## Review (`review.json`)

`{ reviewer, reviewed_at, accept[] { fact_id, reason? }, reject[] { fact_id, reason }, override[] { fact_id, value, reason, evidence_class?, source_id? }, unresolved[] { fact_id, reason? }, accept_all_of_class?[], decision? { action: approve | reject, reason } }`.
`accept_all_of_class` never applies to inference classes and skips facts flagged
`manual_review_required`. A job-level `decision` may not accompany fact changes (the draft they
produce has not been compiled yet). Approval records the draft's sha256.

## Compiler → draft pack

Accepted facts → floors (ordered), nodes (evidence tier from class; an accepted field confirmation
upgrades to field-verified and may re-place the node), edges (weakest tier of edge + endpoints;
metres only from a field measurement; directional instructions from accepted instruction facts,
never derived), destinations (identity tier from class; `corridor_arrival` unless a field arrival
fact says `verified_public_door`), anchors, amenities, venue headline evidence (derived: weakest
geometry, measured only if every edge is, field verification not-started/pending → partial →
verified, accessibility verified only from a field fact), sources from the manifest, policies from
the job. Ids are sorted, so output is byte-identical for any ledger order. The app's own validator
runs last: a draft the app would reject is not a draft.

## Versioning and diff

`venue.pack_version` (1, 2, …) is independent of `schema_version`. A revision job opened with
`--from-pack` publishes base + 1; the gate enforces continuity. `venue:diff` reports nodes
added / removed / moved / renamed / re-tiered, edges added / removed / measured / re-worded /
re-wired, destinations added / removed and arrival / identity upgrades, anchors, amenities,
floors, venue evidence and unit changes. Notes and citations are provenance and are not diffed.

## Field verification seam

`venue:field-import` takes `{ observer, observed_at, source_id (a field_measurement / field_photo source), measurements[] { edge, distance_m, method }, node_confirmations[] { node, at? }, door_confirmations[] { destination }, accessibility[] { subject, step_free } }`
and turns it into **proposed** `field_verified` facts. They are accepted like any other, compiled
into a new revision, and the diff shows exactly which legs gained metres and which doors were
verified. One measured leg never calibrates the rest of a pixel pack.

## Security

All artifacts are untrusted. Objects are closed (unknown keys rejected, `__proto__`-style keys
included); strings are plain text (no markup, control characters or template braces); JSON is
parsed with `JSON.parse` only under a size cap; nothing is evaluated, rendered or fetched; `origin`
URLs are text; every job path goes through `safeJoin` (no absolute paths, no `..`, no backslashes,
never outside the job directory); `--bundle` writes only inside `src/venue/packs`. PNG files are
header-checked, never decoded.

## Rights

No copyrighted artwork is committed. The Garden Route and Menlyn dry runs reference their official
map images by URL/description only (rights `unknown`), and the packs carry `plan_image: null`. The
Factory Test Centre plan is procedural artwork drawn by `scripts/venue/make-synthetic-plan.mjs`.

## Proofs

- `npm run venue:selftest` (part of `verify:all`): the synthetic Factory Test Centre through v1 and
  a field-measured v2 (≈ 55 ms end to end).
- `src/venue/factory/factoryTestCentre.e2e.test.tsx`: the same pipeline under vitest, then the
  published pack loaded through the registry, routed by the router, walked on the shared screen
  with every network call failing, revision 2 with metres and a verified door, and a grep proof
  that no application source names the venue.
- `npm run venue:dryrun -- garden-route-mall` / `-- menlyn-park`: research evidence replayed
  through the factory; both diffs against the production packs report **no changes**
  (`venue-factory/dry-runs/*/output/diff-vs-production.json`).
- Browser (production build, backend blocked, 320 and 390 wide): the factory-made pack bundled
  as data only (`venue:publish --bundle` changed `bundle.json` + one pack file, no code) navigates
  QR link → destination → 5 steps → arrival; 20/20 checks.

## Timings (this container)

| Operation | Time |
|---|---|
| compile (10 nodes / 9 edges, or Garden Route's 10 / 9) | 1–4 ms |
| whole selftest (2 jobs, 20 CLI commands, esbuild bundling excluded) | ≈ 55 ms |
| CLI start (esbuild bundling of the app's venue code) | ≈ 0.5 s |

No heap Dijkstra was needed: the routability smoke in the gate routes every start→destination
pair with the app's O(V²) router in well under a millisecond per pair at these sizes.

## Known limitations

- No `plan_image` is emitted by the compiler (rights decisions are made outside the factory).
- Multi-floor packs compile (edges marked `floor_change`) but the visitor UX for floor changes is
  a later sprint.
- `unit_polygons`, `store_labels` and `corridor_centerlines` are recorded in the ledger as
  provenance; the Venue Pack contract has no polygon layer yet.
- The hosted backend map factory (`google-cloud-backend/src/services/mapFactory/*`, `/indoor-map-model`)
  is no longer consumed by the frontend; see `docs/venue-packs/AUDIT.md` for the retirement note.
