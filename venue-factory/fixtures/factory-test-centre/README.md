# Factory Test Centre — synthetic fixture for the Venue Pack Factory

Everything here is invented. The plan image (`raw/map.png`) is drawn by
`scripts/venue/make-synthetic-plan.mjs` (rectangles only; no third-party artwork) and the
directory (`raw/directory.json`) is made up. The fixture exists to prove that the pipeline —
not any mall-specific code — turns raw evidence into a pack the app navigates.

| File | Stage |
|---|---|
| `venue.json` | job config: venue identity, deployment, distance unit, policies (no geometry) |
| `sources.json` | source manifest (map image with its pixel coordinate system, directory, notes, field sheet) |
| `extraction-manual.json` | human/file transcription of the plan: floors, nodes, edges, instructions, destinations, anchors, amenities, facts |
| `extraction-ai.json` | what an AI worker may submit: a ghost junction and a shortcut (both `ai_inference`) plus a label read flagged for review |
| `review-1-facts.json` | human review: bulk-accept first-party visual/explicit facts, accept flagged ones with reasons, reject the AI inferences, override the cafe unit (directory beats plan), leave the hours fact unresolved |
| `review-2-approve.json` | job-level approval of the compiled draft |
| `field-import.json` | field survey: two measured legs, a confirmed entrance, a verified grocer door, step-free venue |
| `review-3-field.json` | acceptance of the field facts (field data never self-accepts) |

`npm run venue:selftest` runs the whole sequence in a temporary jobs root (v1, then a v2 revision
from the field sheet) and asserts the outcomes; `src/venue/factory/factoryTestCentre.e2e.test.ts`
does the same under vitest and then loads the generated pack into the app registry and navigates it.
