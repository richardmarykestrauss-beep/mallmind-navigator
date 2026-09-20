import { createContext, useContext, useState, ReactNode } from "react";
import type { Mall, Shop } from "@/lib/supabaseClient";
import { supabase } from "@/lib/supabaseClient";

// ── Route step (produced ONLY by the Venue Pack router, src/venue/route.ts) ──────────────
export interface RouteStep {
  step: number;
  instruction: string;
  node_id: string;
  node_name: string;
  floor: string | null;
  /** Measured metres for this step; null when the route's source is unscaled (never fabricated). */
  distance_meters: number | null;
  floor_change: boolean;
  /** Running metres; null when the route is unscaled. */
  cumulative_meters: number | null;
  /** Percent-style map coordinate from backend mall_nodes.x_coordinate. */
  x_coordinate?: number | null;
  /** Percent-style map coordinate from backend mall_nodes.y_coordinate. */
  y_coordinate?: number | null;
  /** Set on a floor-change step: which connector carries the visitor and between which floors. */
  via?: RouteStepVia | null;
}

/** Connector context of a floor-change step (Venue Pack floor ids; the UI maps them to labels). */
export interface RouteStepVia {
  connector_id: string;
  kind: "lift" | "escalator" | "stairs" | "ramp";
  from_floor: string;
  to_floor: string;
  /** Measured ride/climb time when the pack has it; null otherwise (never estimated). */
  traversal_seconds: number | null;
}

// ── sessionStorage helpers ────────────────────────────────────────────────────
const KEYS = {
  mall:      "mm_mall",
  stops:     "mm_stops",
  stopIdx:   "mm_stop_idx",
  sessionId: "mm_session_id",
};

function load<T>(key: string, fallback: T): T {
  try { const r = sessionStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; }
  catch { return fallback; }
}

function save(key: string, value: unknown) {
  try {
    if (value === null || (Array.isArray(value) && value.length === 0))
      sessionStorage.removeItem(key);
    else
      sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded */ }
}

// ── Context interface ─────────────────────────────────────────────────────────
interface ShoppingSession {
  // Mall + stops (local convenience)
  selectedMall: Mall | null;
  setSelectedMall: (mall: Mall | null) => void;
  routeStops: Shop[];
  setRouteStops: (stops: Shop[]) => void;
  currentStopIndex: number;
  setCurrentStopIndex: (i: number) => void;
  advanceStop: () => void;
  resetSession: () => void;

  // Supabase-persisted session
  dbSessionId: string | null;
  shoppingIntent: string | null;
  setShoppingIntent: (intent: string) => void;
  startOrUpdateSession: (
    userId: string | null,
    mallId: string | number,
    opts?: { lat?: number; lng?: number }
  ) => Promise<void>;
  updateSessionRoute: (stopIds: (string | number)[]) => Promise<void>;
}

const ShoppingSessionContext = createContext<ShoppingSession | null>(null);

export function ShoppingSessionProvider({ children }: { children: ReactNode }) {
  const [selectedMall, setSelectedMallState]   = useState<Mall | null>(() => load<Mall | null>(KEYS.mall, null));
  const [routeStops, setRouteStopsState]        = useState<Shop[]>(() => load<Shop[]>(KEYS.stops, []));
  const [currentStopIndex, setCurrentStopIndexState] = useState<number>(() => load<number>(KEYS.stopIdx, 0));
  const [dbSessionId, setDbSessionId]           = useState<string | null>(() => load<string | null>(KEYS.sessionId, null));
  const [shoppingIntent, setShoppingIntentState] = useState<string | null>(null);

  // ── Local state setters ───────────────────────────────────────────────────
  function setSelectedMall(mall: Mall | null) { save(KEYS.mall, mall); setSelectedMallState(mall); }
  function setRouteStops(stops: Shop[])       { save(KEYS.stops, stops); setRouteStopsState(stops); }
  function setCurrentStopIndex(i: number)     { save(KEYS.stopIdx, i); setCurrentStopIndexState(i); }
  function advanceStop() { setCurrentStopIndex(Math.min(currentStopIndex + 1, routeStops.length - 1)); }
  function setShoppingIntent(intent: string)  { setShoppingIntentState(intent); }

  function resetSession() {
    setRouteStops([]);
    setCurrentStopIndex(0);
  }


  // ── Supabase session persistence ──────────────────────────────────────────
  async function startOrUpdateSession(
    userId: string | null,
    mallId: string | number,
    opts?: { lat?: number; lng?: number }
  ) {
    if (!userId) return;
    try {
      const { data: existing } = await supabase
        .from("shopping_sessions")
        .select("id, shopping_intent")
        .eq("user_id", userId)
        .eq("mall_id", String(mallId))
        .eq("status", "active")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        await supabase.from("shopping_sessions").update({
          last_seen_at: new Date().toISOString(),
          ...(opts?.lat != null ? { current_lat: opts.lat } : {}),
          ...(opts?.lng != null ? { current_lng: opts.lng } : {}),
        }).eq("id", existing.id);

        save(KEYS.sessionId, existing.id);
        setDbSessionId(existing.id);
        if (existing.shopping_intent) setShoppingIntentState(existing.shopping_intent);
        // Spatial routes are no longer stored here: the Venue Pack NavigationSession (Navigation
        // Experience V2) owns the walk, so `active_route_id` on the row is ignored.
      } else {
        const { data: created } = await supabase.from("shopping_sessions").insert({
          user_id:     userId,
          mall_id:     String(mallId),
          status:      "active",
          current_lat: opts?.lat ?? null,
          current_lng: opts?.lng ?? null,
        }).select("id").single();

        if (created) { save(KEYS.sessionId, created.id); setDbSessionId(created.id); }
      }
    } catch (err) {
      console.warn("Session persistence failed (non-blocking):", err);
    }
  }

  async function updateSessionRoute(stopIds: (string | number)[]) {
    if (!dbSessionId) return;
    try {
      await supabase.from("shopping_sessions").update({
        route_stop_ids: JSON.stringify(stopIds.map(String)),
        last_seen_at:   new Date().toISOString(),
      }).eq("id", dbSessionId);
    } catch (err) {
      console.warn("Session route update failed (non-blocking):", err);
    }
  }

  return (
    <ShoppingSessionContext.Provider value={{
      selectedMall, setSelectedMall,
      routeStops, setRouteStops,
      currentStopIndex, setCurrentStopIndex,
      advanceStop, resetSession,
      dbSessionId, shoppingIntent, setShoppingIntent,
      startOrUpdateSession, updateSessionRoute,
    }}>
      {children}
    </ShoppingSessionContext.Provider>
  );
}

export function useShoppingSession() {
  const ctx = useContext(ShoppingSessionContext);
  if (!ctx) throw new Error("useShoppingSession must be used inside ShoppingSessionProvider");
  return ctx;
}
