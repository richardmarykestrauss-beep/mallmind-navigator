/**
 * Typed internal event model.
 *
 * A tiny, dependency-free event helper. Events are plain data designed to map
 * cleanly onto a future Pub/Sub message body, Eventarc trigger, or Cloud Run
 * worker input. NOTHING here integrates any Google Cloud service in this sprint.
 */

import type { FabricEvent, FabricEventType } from "./types";

let counter = 0;

/** Deterministic-per-process id; the caller supplies the timestamp. */
function eventId(seed: string): string {
  counter += 1;
  return `evt_${seed}_${counter}`;
}

export interface EventInput {
  type: FabricEventType;
  sourceId?: string | null;
  adapterId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt: string;
}

export function makeEvent(input: EventInput): FabricEvent {
  return {
    id: eventId(input.type.replace(/[^a-z]/gi, "").slice(0, 8)),
    type: input.type,
    sourceId: input.sourceId ?? null,
    adapterId: input.adapterId ?? null,
    payload: input.payload ?? {},
    occurredAt: input.occurredAt,
  };
}

/** Small accumulating emitter used within a single adapter run. */
export class EventCollector {
  private events: FabricEvent[] = [];
  constructor(private occurredAt: string) {}

  emit(type: FabricEventType, opts: { sourceId?: string | null; adapterId?: string | null; payload?: Record<string, unknown> } = {}): FabricEvent {
    const e = makeEvent({ type, occurredAt: this.occurredAt, ...opts });
    this.events.push(e);
    return e;
  }

  all(): FabricEvent[] {
    return [...this.events];
  }
}
