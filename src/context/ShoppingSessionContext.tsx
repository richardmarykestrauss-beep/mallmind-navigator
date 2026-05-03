import { createContext, useContext, useState, ReactNode } from "react";
import type { Mall, Shop } from "@/lib/supabaseClient";

const SESSION_KEYS = {
  mall: "mm_mall",
  stops: "mm_stops",
  stopIdx: "mm_stop_idx",
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, JSON.stringify(value));
    }
  } catch { /* quota exceeded — ignore */ }
}

interface ShoppingSession {
  selectedMall: Mall | null;
  setSelectedMall: (mall: Mall | null) => void;
  routeStops: Shop[];
  setRouteStops: (stops: Shop[]) => void;
  currentStopIndex: number;
  setCurrentStopIndex: (i: number) => void;
  advanceStop: () => void;
  resetSession: () => void;
}

const ShoppingSessionContext = createContext<ShoppingSession | null>(null);

export function ShoppingSessionProvider({ children }: { children: ReactNode }) {
  const [selectedMall, setSelectedMallState] = useState<Mall | null>(() =>
    load<Mall | null>(SESSION_KEYS.mall, null)
  );
  const [routeStops, setRouteStopsState] = useState<Shop[]>(() =>
    load<Shop[]>(SESSION_KEYS.stops, [])
  );
  const [currentStopIndex, setCurrentStopIndexState] = useState<number>(() =>
    load<number>(SESSION_KEYS.stopIdx, 0)
  );

  function setSelectedMall(mall: Mall | null) {
    save(SESSION_KEYS.mall, mall);
    setSelectedMallState(mall);
  }

  function setRouteStops(stops: Shop[]) {
    save(SESSION_KEYS.stops, stops);
    setRouteStopsState(stops);
  }

  function setCurrentStopIndex(i: number) {
    save(SESSION_KEYS.stopIdx, i);
    setCurrentStopIndexState(i);
  }

  function advanceStop() {
    setCurrentStopIndex(Math.min(currentStopIndex + 1, routeStops.length - 1));
  }

  function resetSession() {
    setRouteStops([]);
    setCurrentStopIndex(0);
  }

  return (
    <ShoppingSessionContext.Provider
      value={{
        selectedMall,
        setSelectedMall,
        routeStops,
        setRouteStops,
        currentStopIndex,
        setCurrentStopIndex,
        advanceStop,
        resetSession,
      }}
    >
      {children}
    </ShoppingSessionContext.Provider>
  );
}

export function useShoppingSession() {
  const ctx = useContext(ShoppingSessionContext);
  if (!ctx) throw new Error("useShoppingSession must be used inside ShoppingSessionProvider");
  return ctx;
}
