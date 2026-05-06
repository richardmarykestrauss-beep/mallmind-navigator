import { createContext, useContext, useState, ReactNode } from "react";
import type { Mall, Shop } from "@/lib/supabaseClient";
import { supabase } from "@/lib/supabaseClient";

// ── Route step (from build-route Edge Function) ───────────────────────────────
export interface RouteStep {
  step: number;
  instruction: string;
  node_id: string;
  node_name: string;
  floor: string | null;
  distance_meters: number;
  floor_change: boolean;
  cumulative_meters: number;
}

// ── sessionStorage helpers ────────────────────────────────────────────────────
const KEYS = {
  mall:      "mm_mall",
  stops:     "mm_stops",
  stopIdx:   "mm_stop_idx",
  sessionId: "mm_session_id",
  routeId:   "mm_route_id",
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

  // Real step-by-step route (from build-route Edge Function)
  activeRouteId: string | null;
  activeRouteSteps: RouteStep[];
  loadRoute: (routeId: string) => Promise<void>;
  setActiveRoute: (routeId: string, steps: RouteStep[]) => void;
  clearRoute: () => void;
}

const ShoppingSessionContext = createContext<ShoppingSession | null>(null);

export function ShoppingSessionProvider({ children }: { children: ReactNode }) {
  const [selectedMall, setSelectedMallState]   = useState<Mall | null>(() => load<Mall | null>(KEYS.mall, null));
  const [routeStops, setRouteStopsState]        = useState<Shop[]>(() => load<Shop[]>(KEYS.stops, []));
  const [currentStopIndex, setCurrentStopIndexState] = useState<number>(() => load<number>(KEYS.stopIdx, 0));
  const [dbSessionId, setDbSessionId]           = useState<string | null>(() => load<string | null>(KEYS.sessionId, null));
  const [shoppingIntent, setShoppingIntentState] = useState<string | null>(null);
  const [activeRouteId, setActiveRouteId]       = useState<string | null>(() => load<string | null>(KEYS.routeId, null));
  const [activeRouteSteps, setActiveRouteSteps] = useState<RouteStep[]>([]);

  // ── Local state setters ───────────────────────────────────────────────────
  function setSelectedMall(mall: Mall | null) { save(KEYS.mall, mall); setSelectedMallState(mall); }
  function setRouteStops(stops: Shop[])       { save(KEYS.stops, stops); setRouteStopsState(stops); }
  function setCurrentStopIndex(i: number)     { save(KEYS.stopIdx, i); setCurrentStopIndexState(i); }
  function advanceStop() { setCurrentStopIndex(Math.min(currentStopIndex + 1, routeStops.length - 1)); }
  function setShoppingIntent(intent: string)  { setShoppingIntentState(intent); }

  function resetSession() {
    setRouteStops([]);
    setCurrentStopIndex(0);
    clearRoute();
  }

  // ── Real route helpers ────────────────────────────────────────────────────
  function setActiveRoute(routeId: string, steps: RouteStep[]) {
    save(KEYS.routeId, routeId);
    setActiveRouteId(routeId);
    setActiveRouteSteps(steps);
  }

  function clearRoute() {
    save(KEYS.routeId, null);
    setActiveRouteId(null);
    setActiveRouteSteps([]);
  }

  async function loadRoute(routeId: string) {
    try {
      const { data } = await supabase
        .from("shopping_routes")
        .select("id, route_steps")
        .eq("id", routeId)
        .single();
      if (data?.route_steps) {
        const steps = typeof data.route_steps === "string"
          ? (JSON.parse(data.route_steps) as RouteStep[])
          : (data.route_steps as RouteStep[]);
        setActiveRoute(routeId, steps);
      }
    } catch (err) {
      console.warn("loadRoute failed:", err);
    }
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
        .select("id, shopping_intent, active_route_id")
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

        // Resume active route if one exists
        if (existing.active_route_id && !activeRouteId) {
          loadRoute(existing.active_route_id);
        }
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
      activeRouteId, activeRouteSteps,
      loadRoute, setActiveRoute, clearRoute,
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
