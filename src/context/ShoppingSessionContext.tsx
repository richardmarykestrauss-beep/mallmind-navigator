import { createContext, useContext, useState, ReactNode } from "react";
import type { Mall, Shop } from "@/lib/supabaseClient";

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
  const [selectedMall, setSelectedMall] = useState<Mall | null>(null);
  const [routeStops, setRouteStops] = useState<Shop[]>([]);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);

  function advanceStop() {
    setCurrentStopIndex((i) => Math.min(i + 1, routeStops.length - 1));
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
