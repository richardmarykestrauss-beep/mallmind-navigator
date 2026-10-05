# Operational overlay — temporary truth on top of the Venue Pack

Sprint 8. Code: `src/venue/overlay.ts` (model + application), `src/venue/operationalLog.ts`
(append-only audit model), `src/venue/overlayStore.ts` (runtime holder), `src/navigation/demoOverlays.ts`
(DEMO / SIMULATED fixtures). Tests: `src/venue/overlay.test.ts`,
`src/components/navigation/overlayExperience.test.tsx`.

## The invariant

**Base Venue Pack + operational overlay = current state.** The Venue Pack is the authoritative,
stable spatial truth and is never modified by operations. An overlay is a set of time-bounded
"unavailable" facts about things the pack already knows; applying it produces a *new* in-memory
graph for this moment, and removing it restores the base graph byte-for-byte (tested).

The overlay cannot add nodes, edges, destinations or anchors. It can only take things out of
service. It is applied **before** search, routing and anchor selection, so a closed lift is simply
not in the graph the deterministic router sees — no scoring, no weighting, no commercial input.

## Model

```
OverlayEntry {
  id, venue_id,
  target_type: connector | edge | destination | anchor | amenity,
  target_id,                 // the pack id of that thing
  state: "unavailable",
  reason,                    // plain text for visitors and the audit trail
  starts_at | null, expires_at | null,   // ISO; null = now / until removed
  actor { id, kind: operator | mallmind | demo | system, display },
  created_at,
  simulated?: true           // DEMO fixtures only
}
```

An entry is *active* when `starts_at ≤ now < expires_at` (malformed timestamps never activate).
`applyOverlay(venue, overlay, now)`:

| target_type | effect on the applied graph |
|---|---|
| `connector` | all expanded edges of that connector removed; adjacency rebuilt |
| `edge` | that edge removed; adjacency rebuilt |
| `anchor` | removed from `startAnchors` (a QR for it resolves to "choose where you are"); if no start remains, the UI says no starting point is available |
| `destination` | still searchable, badged **Temporarily unavailable**; a route is refused with reason `unavailable` |
| `amenity` | same as destination |

With no active entries the function returns the **same object** (identity), so "no overlay" and
"empty overlay" are indistinguishable by construction. `venue.overlay` carries what was applied
for the banner and badges.

## Experience

- Any applied overlay shows a banner above the finder. A simulated one reads **"DEMO / SIMULATED
  operational state — Not a real <venue> condition"** in a distinct colour; it cannot be mistaken
  for a real closure.
- If the graph changes under a live session (an entry activates or expires while walking), the
  session re-anchors if its start vanished, re-reads its destination and recalculates. A visitor
  mid-route to a destination that becomes unavailable lands on the unroutable screen, never on a
  step the graph no longer supports. A remembered session is restored against the *current*
  graph, so it cannot bring back a route the overlay removed.

## Audit model (append-only)

`operationalLog.ts` is the *record* from which an overlay is derived: every change is an entry with
`previous_state`, `new_state`, `actor`, `reason`, `expires_at` and `supersedes` (a reopening points
at the closure it ends). Entries are never edited or deleted; `overlayFromLog` folds the log into
the current overlay. This log is **separate from the evidence ledger**: evidence is about what the
venue *is*; the operational log is about what is *temporarily out of service*. One never writes
into the other.

## Authority

- Overlay authority is a **venue operator role**, expressed as `actor.kind`. It does not depend on
  `profiles.is_admin` (the MallMind superuser flag), and the data-authority guard asserts that
  nothing under `src/venue/overlay*` or `operationalLog` reads `is_admin` or writes to Supabase.
- In Sprint 8 the only way an overlay enters the runtime is the explicit `demo_overlay=<id>` query
  parameter (fixtures in `demoOverlays.ts`, cleared with `demo_overlay=none`). There is no
  operator UI, no persistence and no network source. That is deliberate: the model, application
  order and UI behaviour are proven first; who may assert a real closure, and how it is signed
  and delivered, is a product decision for a later gate.

## Fixtures (Garden Route Mall)

| id | entry | what you see |
|---|---|---|
| `grm-clicks-unavailable` | destination `grm-clicks-37` unavailable | Clicks listed with "Temporarily unavailable"; choosing it refuses a route; Woolworths / Pick n Pay unaffected |
| `grm-entrance-4-unavailable` | anchor `grm-entrance-4` unavailable | Entrance 4 is the only start, so the finder is replaced by "No MallMind starting point is available…" |

Both are labelled DEMO / SIMULATED and describe no real Garden Route Mall condition.

## What the tests prove

- Removal restores the route **byte-for-byte** (`overlay.test.ts`, Mall Reds two-level reroute:
  escalator closed → stairs; stairs too → lift; both removed → original route text identical).
- Inactive, expired and future entries do nothing (same object).
- Applying never mutates the loaded pack (deep-equal before/after).
- The experience test walks the Garden Route fixtures through the UI, including the live
  recalculation of a session in progress.
