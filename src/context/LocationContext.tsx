import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { supabase, type Mall } from "@/lib/supabaseClient";

export interface GeoPosition {
  lat: number;
  lng: number;
}

interface LocationState {
  position: GeoPosition | null;
  error: string | null;
  requesting: boolean;
  nearestMall: Mall | null;
  nearestMallDistance: number | null; // km
  requestLocation: () => void;
}

const LocationContext = createContext<LocationState | null>(null);

// Haversine formula — returns distance in km between two lat/lng points
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [nearestMall, setNearestMall] = useState<Mall | null>(null);
  const [nearestMallDistance, setNearestMallDistance] = useState<number | null>(null);

  // When position changes, query malls and find nearest
  useEffect(() => {
    if (!position) return;

    supabase
      .from("malls")
      .select("id, name, city, province, lat, lng")
      .not("lat", "is", null)
      .not("lng", "is", null)
      .then(({ data }) => {
        if (!data?.length) return;

        let closest: Mall | null = null;
        let closestDist = Infinity;

        for (const mall of data) {
          if (mall.lat == null || mall.lng == null) continue;
          const dist = haversineKm(position.lat, position.lng, mall.lat as number, mall.lng as number);
          if (dist < closestDist) {
            closestDist = dist;
            closest = mall as Mall;
          }
        }

        setNearestMall(closest);
        setNearestMallDistance(closest ? Math.round(closestDist * 10) / 10 : null);
      });
  }, [position]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported on this device.");
      return;
    }
    setRequesting(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setRequesting(false);
      },
      (err) => {
        setError(err.message);
        setRequesting(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  return (
    <LocationContext.Provider
      value={{ position, error, requesting, nearestMall, nearestMallDistance, requestLocation }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useGeoLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useGeoLocation must be used inside LocationProvider");
  return ctx;
}
