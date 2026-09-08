/**
 * navigationSession.ts — the smallest navigation-session model MallMind needs.
 *
 * A pure reducer (no React, no I/O) over one visitor journey:
 *
 *   destination_selection → route_ready → navigating → arrived
 *                                 ↘ unroutable
 *
 * The session knows the mall, the trusted start anchor (and where it came from), the destination,
 * the calculated route, the current step, the completed steps and its state. Progress is MANUAL
 * (Next / Previous): MallMind does not know the visitor's live position, so nothing here ever
 * infers movement. Re-anchoring replaces the trusted start, keeps the destination, recalculates
 * the route and resets step progress — it is a discrete, visitor-initiated event, not tracking.
 *
 * Routing reuses pilotBuildRoute over the registry graph; evidence (schematic / source-backed /
 * field-verified) never changes how this reducer behaves — only what the UI claims.
 */

import type { BackendNodeLike, BackendEdgeLike } from "./floorplanModel";
import { pilotBuildRoute, type PilotRouteResult } from "./pilotRoute";
import type { PilotAnchor, PilotPoi } from "./mallDatasets";
import type { RouteStep } from "@/context/ShoppingSessionContext";

export type NavigationStatus = "destination_selection" | "route_ready" | "navigating" | "arrived" | "unroutable";

export interface NavigationGraph { nodes: BackendNodeLike[]; edges: BackendEdgeLike[] }

export interface NavigationSession {
  mallId: string;
  /** The trusted start; `anchor.source` records how it was obtained (manual / qr / url …). */
  anchor: PilotAnchor;
  destination: PilotPoi | null;
  route: PilotRouteResult | null;
  /** Index into `route.steps`; the last step is the arrival step. */
  stepIndex: number;
  /** Step indices the visitor has explicitly moved past. */
  completedSteps: number[];
  status: NavigationStatus;
  /** Bumped every time the route is (re)calculated — lets the UI announce "route updated". */
  routeRevision: number;
  /** Set when the last recalculation came from a re-anchor, so the UI can say so truthfully. */
  lastReanchor: { from: PilotAnchor; to: PilotAnchor; revision: number } | null;
}

export type NavigationAction =
  | { type: "select_destination"; destination: PilotPoi }
  | { type: "clear_destination" }
  | { type: "start_navigation" }
  | { type: "next_step" }
  | { type: "previous_step" }
  | { type: "reanchor"; anchor: PilotAnchor }
  | { type: "restart" };

function routable(route: PilotRouteResult | null): route is PilotRouteResult {
  return Boolean(route && route.found && !route.fallback && route.steps.length > 0);
}

export function createNavigationSession(mallId: string, anchor: PilotAnchor): NavigationSession {
  return {
    mallId, anchor, destination: null, route: null, stepIndex: 0, completedSteps: [],
    status: "destination_selection", routeRevision: 0, lastReanchor: null,
  };
}

function withRoute(graph: NavigationGraph, s: NavigationSession, resume: boolean): NavigationSession {
  if (!s.destination) return { ...s, route: null, stepIndex: 0, completedSteps: [], status: "destination_selection" };
  const route = pilotBuildRoute(graph.nodes, graph.edges, s.anchor.nodeId, s.destination.id);
  const ok = routable(route);
  return {
    ...s,
    route,
    stepIndex: 0,
    completedSteps: [],
    status: ok ? (resume ? "navigating" : "route_ready") : "unroutable",
    routeRevision: s.routeRevision + 1,
  };
}

export function navigationReducer(graph: NavigationGraph, s: NavigationSession, a: NavigationAction): NavigationSession {
  switch (a.type) {
    case "select_destination":
      return withRoute(graph, { ...s, destination: a.destination, lastReanchor: null }, false);

    case "clear_destination":
      return { ...s, destination: null, route: null, stepIndex: 0, completedSteps: [], status: "destination_selection", lastReanchor: null };

    case "start_navigation":
      if (s.status !== "route_ready" || !routable(s.route)) return s;
      return { ...s, status: s.route.steps.length === 1 ? "arrived" : "navigating", stepIndex: 0, completedSteps: [] };

    case "next_step": {
      if (s.status !== "navigating" || !routable(s.route)) return s;
      const last = s.route.steps.length - 1;
      const next = Math.min(last, s.stepIndex + 1);
      const completed = s.completedSteps.includes(s.stepIndex) ? s.completedSteps : [...s.completedSteps, s.stepIndex];
      return { ...s, stepIndex: next, completedSteps: completed, status: next === last ? "arrived" : "navigating" };
    }

    case "previous_step": {
      if ((s.status !== "navigating" && s.status !== "arrived") || !routable(s.route)) return s;
      if (s.stepIndex === 0 && s.status === "navigating") return s;
      const prev = Math.max(0, s.stepIndex - 1);
      return { ...s, stepIndex: prev, completedSteps: s.completedSteps.filter((i) => i < prev), status: "navigating" };
    }

    case "reanchor": {
      // A new trusted start: keep the destination, recalculate, reset progress. If the visitor was
      // already walking, they stay in navigation mode on the fresh route (step 1), never mid-route.
      const resume = s.status === "navigating" || s.status === "arrived";
      const next = withRoute(graph, { ...s, anchor: a.anchor }, resume);
      return {
        ...next,
        lastReanchor: s.destination ? { from: s.anchor, to: a.anchor, revision: next.routeRevision } : null,
      };
    }

    case "restart":
      if (!routable(s.route)) return s;
      return { ...s, stepIndex: 0, completedSteps: [], status: "route_ready", lastReanchor: null };

    default:
      return s;
  }
}

// ── Selectors ────────────────────────────────────────────────────────────────

export function sessionSteps(s: NavigationSession): RouteStep[] {
  return routable(s.route) ? s.route.steps : [];
}
export function currentStep(s: NavigationSession): RouteStep | null {
  return sessionSteps(s)[s.stepIndex] ?? null;
}
/** The step after the current one (the "then …" hint); null on the arrival step. */
export function upcomingStep(s: NavigationSession): RouteStep | null {
  return sessionSteps(s)[s.stepIndex + 1] ?? null;
}
export function isRoutable(s: NavigationSession): boolean {
  return routable(s.route);
}
