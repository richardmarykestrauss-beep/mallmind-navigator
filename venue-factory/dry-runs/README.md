# Dry runs — real research evidence replayed through the factory

`npm run venue:dryrun -- <name>` replays `<name>/dryrun.json` (venue config, source manifest,
extraction(s), review(s), approval) in a throw-away jobs root and writes `output/` next to it:
`published.venue.json`, `ledger.json`, `job.json`, `run.log` and `diff-vs-production.json`.
Nothing is written to `src/venue/packs`. A fixed clock makes the output byte-identical run to run.

| Dry run | Evidence | Result |
|---|---|---|
| `garden-route-mall` | `research/garden-route-mall-field-pilot/` (README forensics table, evidence ledger G01–G20, source manifest) | diff vs `src/venue/packs/garden-route-mall.venue.json`: **no changes** (10 nodes, 9 edges, 9 instructions, 3 destinations, 1 anchor, floor L1, evidence identical) |
| `menlyn-park` | `research/menlyn-spatial-poc/` on branch `research/menlyn-spatial-poc` (route candidate, ledger F01–F17, manifest) | diff vs `src/venue/packs/menlyn-park.venue.json`: **no changes** (3 nodes, 2 edges, 2 instructions, 1 destination, 1 anchor, floor LF) |

Provenance notes recorded in the dry runs:
- Node positions are re-derived from the source pixels in the research tables through the
  factory's `pad-to-plane` normalisation (417×888 and 1280×853 renderings) and land on the
  production coordinates exactly.
- The route wording exists only in the legacy datasets (git `7d638f9`), not in any research
  artifact; it is registered as a `manual_note` source and accepted fact by fact with that reason.
- Research `UNKNOWN` facts (Garden Route G12, G19; Menlyn F13, F14, F17) are carried as
  `manual_inference` facts with confidence 0 and left **unresolved** — non-blocking, visible in
  the ledger, never in the pack.
- The official map images are referenced (rights `unknown`), not stored.
