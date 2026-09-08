# Sprint 18C.4 — Sandton/NMS Asset Import Plan

## Purpose

Define the approval-gated path for importing the Sandton/NMS proprietary asset pack into MallMind data tables.

This plan intentionally does not execute database writes.

## Asset Pack

- map-assets/sandton-nms-lower/sandton-nms-lower.svg
- map-assets/sandton-nms-lower/sandton-nms-lower.layout.json
- map-assets/sandton-nms-lower/sandton-nms-lower.nodes.json
- map-assets/sandton-nms-lower/sandton-nms-lower.edges.json
- map-assets/sandton-nms-lower/generated/sandton-nms-import-preview.json
- map-assets/sandton-nms-lower/generated/sandton-nms-import-preview.sql

## Import Targets

| Table | Purpose | Import Mode |
|---|---|---|
| map_factory_generated_floorplans | Store the proprietary SVG + layout JSON as draft floorplan asset | insert draft only |
| mall_nodes | Add or stage nodes for 69 Belmont, NMS entrance, corridor spine, public square, Sandton connection | approval-gated upsert later |
| mall_edges | Add route graph edges between imported/staged nodes | approval-gated upsert later |
| shops / stores | Link 69 Belmont node to existing shop record if available | manual verification first |

## Approval Gates

No live database import may run until all gates pass.

1. Asset pack validates locally.
2. Import preview JSON and SQL are reviewed.
3. SVG contains MallMind proprietary marker.
4. No third-party map artwork is embedded.
5. Nodes have x_percent/y_percent within 0-100.
6. Edges reference valid node names.
7. 69 Belmont / L41 target node is present.
8. Import is marked draft/stub, not production verified.
9. Existing live route data is backed up before modification.
10. Human approval is given in chat before any write script runs.

## Reality Labels

Initial import must use one of these labels:

- reference-led-proprietary-stub
- approximate-coordinate-draft
- field-verification-required

Do not label this data as live, verified, production, or field-accurate yet.

## First Import Strategy

Phase 1: Import only the floorplan SVG/layout as a draft generated floorplan.
Phase 2: Stage nodes/edges into preview output, but do not replace existing mall_nodes yet.
Phase 3: Add a controlled dev-only importer script that can write to Supabase only when APPROVE_IMPORT=YES is set.
Phase 4: Test route rendering against draft asset.
Phase 5: Send trusted tester to verify coordinates.

## Non-Negotiables

- No direct writes without explicit approval.
- No third-party copied map artwork.
- No frontend secrets.
- No service-role keys in app code.
- No overwriting existing Sandton route graph without backup.
- No production reality label until field-tested.

## Next Sprint

Sprint 18C.5 — Dev-Only Supabase Importer With Approval Gate.
