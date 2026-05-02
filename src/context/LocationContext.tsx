import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
}

interface LocationState {
  position: GeoPosition | null;
  error: string | null;
  requesting: boolean;
  requestLocation: () => void;
}

const LocationContext = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

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
    <LocationContext.Provider value={{ position, error, requesting, requestLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useGeoLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useGeoLocation must be used inside LocationProvider");
  return ctx;
}
