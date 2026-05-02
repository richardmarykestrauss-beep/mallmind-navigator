import { useState, useEffect } from "react";
import { MapPin, Car, Navigation2, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { supabase, type ParkingSpot } from "@/lib/supabaseClient";
import { useGeoLocation } from "@/context/LocationContext";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { getAnonymousUserId } from "@/lib/anonymousUser";
import { toast } from "@/hooks/use-toast";

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const Parking = () => {
  const { position, error: geoError, requesting, requestLocation } = useGeoLocation();
  const { selectedMall } = useShoppingSession();

  const [spot, setSpot] = useState<ParkingSpot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const userId = getAnonymousUserId();

  // Load existing spot for this user (most recent today)
  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("parking_spots")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", `${today}T00:00:00`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setSpot(data as ParkingSpot);
      setLoading(false);
    };
    load();
  }, [userId]);

  async function saveSpot() {
    if (!position) {
      requestLocation();
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("parking_spots")
      .insert({
        user_id: userId,
        mall_id: selectedMall?.id ?? null,
        latitude: position.lat,
        longitude: position.lng,
        zone: null,
        floor: null,
        notes: null,
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Could not save spot", description: error.message, variant: "destructive" });
    } else {
      setSpot(data as ParkingSpot);
      toast({ title: "Parking spot saved!", description: "We'll guide you back when you're done." });
    }
    setSaving(false);
  }

  async function resetSpot() {
    if (!spot?.id) return;
    await supabase.from("parking_spots").delete().eq("id", spot.id);
    setSpot(null);
  }

  function openGoogleMaps() {
    if (!spot) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${spot.latitude},${spot.longitude}&travelmode=walking`;
    window.open(url, "_blank");
  }

  const distanceMeters = spot && position
    ? Math.round(haversineMeters(position.lat, position.lng, spot.latitude, spot.longitude))
    : null;

  const walkMinutes = distanceMeters ? Math.ceil(distanceMeters / 72) : null;

  if (loading) {
    return (
      <MobileShell>
        <ScreenHeader title="Where's My Car?" subtitle="Loading..." />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      <ScreenHeader
        title="Where's My Car?"
        subtitle={spot ? "Parking spot saved" : "Tap to save your spot"}
      />

      {!spot ? (
        <div className="px-5 mt-6 flex flex-col items-center text-center animate-fade-in">
          {/* GPS error */}
          {geoError && (
            <div className="mb-4 w-full flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive text-left">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{geoError}</span>
            </div>
          )}

          {/* Big save button */}
          <button
            onClick={position ? saveSpot : requestLocation}
            disabled={saving || requesting}
            className="group relative mt-4 flex h-64 w-64 items-center justify-center rounded-full"
          >
            <div className="absolute inset-0 rounded-full bg-primary/15 blur-2xl animate-pulse-glow" />
            <div className="absolute inset-4 rounded-full border border-primary/30 animate-pulse-glow" />
            <div className="relative flex h-48 w-48 flex-col items-center justify-center rounded-full bg-gradient-primary glow-primary group-active:scale-95 transition-transform">
              {saving || requesting ? (
                <Loader2 className="h-10 w-10 text-primary-foreground animate-spin" />
              ) : (
                <MapPin className="h-14 w-14 text-primary-foreground" strokeWidth={2.5} />
              )}
              <span className="mt-2 font-display font-bold text-primary-foreground text-base">
                {requesting ? "Getting GPS…" : saving ? "Saving…" : position ? "Save Spot" : "Enable GPS"}
              </span>
            </div>
          </button>

          <p className="mt-8 max-w-xs text-sm text-muted-foreground leading-relaxed">
            {position
              ? "Your location is ready. Tap to save your parking spot."
              : "Tap to enable location access so we can save exactly where you parked."}
          </p>

          {position && (
            <p className="mt-2 text-xs text-muted-foreground">
              GPS: {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </p>
          )}

          <div className="mt-6 grid grid-cols-3 gap-3 w-full">
            {["GPS Accuracy", "Auto-detect", "Saved Securely"].map((f) => (
              <div key={f} className="rounded-2xl border border-border bg-surface/60 backdrop-blur p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{f}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 animate-fade-in">
          {/* Map area */}
          <div className="relative mt-2 h-72 rounded-3xl border border-border bg-surface overflow-hidden">
            <div className="absolute inset-0 grid-bg opacity-80" />
            <div className="absolute inset-0 p-5 grid grid-cols-5 grid-rows-4 gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="rounded bg-muted/40 border border-border" />
              ))}
            </div>

            {/* Route line */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path
                d="M 25 85 Q 50 70 75 35"
                stroke="hsl(var(--secondary))"
                strokeWidth="0.8"
                strokeDasharray="2 2"
                fill="none"
                style={{ filter: "drop-shadow(0 0 4px hsl(var(--secondary)))" }}
              />
            </svg>

            {/* You */}
            <div className="absolute" style={{ left: "22%", top: "80%" }}>
              <div className="relative">
                <div className="absolute inset-0 h-4 w-4 rounded-full bg-primary animate-ping opacity-70" />
                <div className="relative h-4 w-4 rounded-full bg-primary glow-primary border-2 border-background" />
              </div>
            </div>

            {/* Car pin */}
            <div className="absolute" style={{ left: "72%", top: "30%" }}>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary glow-secondary border-2 border-background animate-float">
                <Car className="h-5 w-5 text-secondary-foreground" />
              </div>
            </div>

            {/* Coordinates badge */}
            <div className="absolute bottom-3 left-3 rounded-xl border border-border bg-background/80 backdrop-blur px-2.5 py-1.5">
              <p className="text-[10px] text-muted-foreground font-mono">
                {spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}
              </p>
            </div>
          </div>

          {/* Info card */}
          <div className="mt-4 rounded-3xl border border-border bg-gradient-surface p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Saved At</p>
                <p className="font-display font-bold text-xl mt-0.5">
                  {spot.created_at
                    ? new Date(spot.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })
                    : "Just now"}
                </p>
                {selectedMall && (
                  <p className="text-xs text-muted-foreground">{selectedMall.name}</p>
                )}
              </div>
              {distanceMeters != null && (
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Distance</p>
                  <p className="font-display font-bold text-xl text-secondary text-glow-secondary mt-0.5">
                    {distanceMeters}m
                  </p>
                  <p className="text-xs text-muted-foreground">~ {walkMinutes} min walk</p>
                </div>
              )}
            </div>

            <Button
              variant="neonGreen"
              size="lg"
              className="w-full mt-5 animate-pulse-glow-green"
              onClick={openGoogleMaps}
            >
              <Navigation2 className="h-5 w-5" />
              Take Me To My Car
            </Button>

            <button
              onClick={resetSpot}
              className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset parking spot
            </button>
          </div>
        </div>
      )}
    </MobileShell>
  );
};

export default Parking;
