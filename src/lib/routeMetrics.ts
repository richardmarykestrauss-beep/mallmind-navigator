/**
 * routeMetrics.ts — DISTANCE TRUTH for any route shown on the Navigate screen.
 *
 * Metres and minutes are reported ONLY when the route carries measured spatial steps: the final
 * step's `cumulative_meters` must be a positive number and every step must carry `distance_meters`.
 * An assistant stop list (no spatial steps), an unscaled route (nulls), or a partially measured
 * route yields `null` — never an estimate. The old "50 m + 80 m per stop" heuristic is gone.
 */

import type { RouteStep } from "@/context/ShoppingSessionContext";
import { WALK_METERS_PER_MINUTE } from "@/venue/route";

export interface RouteMetrics {
  /** Total measured metres, or null when the route is not fully measured. */
  meters: number | null;
  /** Walking minutes derived ONLY from measured metres, else null. */
  minutes: number | null;
}

export function routeMetrics(steps: ReadonlyArray<Pick<RouteStep, "distance_meters" | "cumulative_meters">>): RouteMetrics {
  if (!steps.length) return { meters: null, minutes: null };
  const measured = steps.every((s) => typeof s.distance_meters === "number" && s.distance_meters >= 0);
  const total = steps[steps.length - 1]?.cumulative_meters;
  if (!measured || typeof total !== "number" || !Number.isFinite(total) || total <= 0) return { meters: null, minutes: null };
  return { meters: total, minutes: Math.max(1, Math.round(total / WALK_METERS_PER_MINUTE)) };
}
