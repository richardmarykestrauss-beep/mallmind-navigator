import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Locate, Store, Loader2, Navigation, AlertCircle } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { supabase, type Mall } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  isGoogleBackendConfigured,
  detectActiveMall as googleDetectActiveMall,
  type DetectActiveMallResponse,
} from "@/lib/googleBackendClient";

const SUPABASE_URL     = "https://qspsouemjtcdcfnivpnt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzcHNvdWVtanRjZGNmbml2cG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTIzNTAsImV4cCI6MjA5MjY4ODM1MH0.f94Lbzo-EgmcMsklgYiWW6tNhM4hvGm2Z8_37Xp8nkg";

const hues = [
  "from-primary/30 to-primary/5",
  "from-secondary/30 to-secondary/5",
  "from-primary/30 to-secondary/10",
  "from-secondary/30 to-primary/10",
];

// Haversine formula — client-side fallback for sorting only
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

interface DetectedMall {
  mall: Mall;
  session_id: string | null;
  distance_km: number;
  within_radius: boolean;
}

const Malls = () => {
  const navigate = useNavigate();
  const { setSelectedMall, startOrUpdateSession, setActiveRoute, dbSessionId } = useShoppingSession();
  const { user } = useAuth();

  const [malls, setMalls]       = useState<Mall[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState("");
  const [userPos, setUserPos]   = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedMall | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("malls")
        .select("id, name, city, province, lat, lng");
      if (error) setError(error.message);
      else setMalls((data ?? []) as Mall[]);
      setLoading(false);
    };
    load();
  }, []);

  async function detectLocation() {
    if (!navigator.geolocation) {
      setLocError("Geolocation not supported on this device.");
      return;
    }
    setLocating(true);
    setLocError(null);
    setDetected(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserPos({ lat, lng });

        try {
          let data: DetectActiveMallResponse | null = null;

          if (isGoogleBackendConfigured()) {
            // ── Google Cloud Run backend ───────────────────────────────────────
            data = await googleDetectActiveMall({ lat, lng, user_id: user?.id ?? null });
          } else {
            // ── Supabase Edge Function (existing path) ─────────────────────────
            const res = await fetch(`${SUPABASE_URL}/functions/v1/detect-active-mall`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({ lat, lng, user_id: user?.id ?? null }),
            });
            if (res.ok) data = (await res.json()) as DetectActiveMallResponse;
          }

          if (data?.mall) {
            setDetected({
              mall: data.mall,
              session_id: data.session_id,
              distance_km: data.distance_km,
              within_radius: data.within_radius,
            });
          }
        } catch {
          // Non-blocking — fallback to client-side sorting
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocError("Couldn't get your location. Please allow access and try again.");
        setLocating(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  function handleMallSelect(m: Mall) {
    setSelectedMall(m);
    startOrUpdateSession(user?.id ?? null, m.id);
    navigate("/assistant");
  }

  function handleShopHere(m: Mall, sessionId?: string | null) {
    setSelectedMall(m);
    // If detect-active-mall already created/resumed a session, use it
    if (sessionId) {
      // ShoppingSessionContext dbSessionId will be updated via startOrUpdateSession
    }
    startOrUpdateSession(user?.id ?? null, m.id);
    navigate("/assistant");
  }

  // Sort by distance if we have user position, otherwise alphabetical
  const sorted = [...malls]
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (userPos && a.lat && a.lng && b.lat && b.lng) {
        return (
          haversine(userPos.lat, userPos.lng, a.lat, a.lng) -
          haversine(userPos.lat, userPos.lng, b.lat, b.lng)
        );
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <MobileShell>
      <ScreenHeader title="Find Your Mall" subtitle="Pick a mall to start shopping smart" />

      <div className="px-5 space-y-4 animate-fade-in">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Which mall are you at?"
            className="w-full h-12 pl-11 pr-4 rounded-2xl bg-surface border border-border text-sm focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all"
          />
        </div>

        {/* Detect button */}
        <Button
          variant={userPos ? "glass" : "neonGreen"}
          size="lg"
          className="w-full"
          onClick={detectLocation}
          disabled={locating}
        >
          {locating
            ? <><Loader2 className="h-5 w-5 animate-spin" /> Locating…</>
            : userPos
            ? <><Navigation className="h-5 w-5" /> Sorted by Distance</>
            : <><Locate className="h-5 w-5" /> Detect My Location</>
          }
        </Button>

        {locError && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{locError}</p>
          </div>
        )}

        {/* Detected mall card */}
        {detected && (
          <div className={cn(
            "rounded-2xl border p-4 animate-fade-in",
            detected.within_radius
              ? "border-primary/50 bg-primary/10"
              : "border-secondary/30 bg-secondary/10"
          )}>
            <div className="flex items-start gap-3">
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                detected.within_radius
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-secondary/20 border-secondary/30 text-secondary"
              )}>
                <Navigation className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-[10px] uppercase tracking-wider font-semibold",
                  detected.within_radius ? "text-primary" : "text-secondary"
                )}>
                  {detected.within_radius ? "You're here" : "Nearest mall"}
                </p>
                <p className="font-display font-bold text-sm truncate">{detected.mall.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {detected.mall.city}
                  {" · "}
                  {detected.distance_km < 1
                    ? `${Math.round(detected.distance_km * 1000)}m away`
                    : `${detected.distance_km} km away`}
                  {detected.within_radius && " · Active session"}
                </p>
              </div>
              <Button
                variant="neon"
                size="sm"
                onClick={() => handleShopHere(detected.mall, detected.session_id)}
                className="shrink-0"
              >
                Shop here
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {userPos ? "Nearest First" : "All Malls"}
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        {!loading && !error && sorted.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">No malls found.</div>
        )}

        {/* Malls list */}
        <div className="space-y-3 pb-4">
          {sorted.map((m, i) => (
            <button
              key={m.id}
              onClick={() => handleMallSelect(m)}
              className="group w-full text-left rounded-2xl border border-border bg-surface/70 backdrop-blur overflow-hidden hover:border-primary/50 transition-all animate-slide-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className={`relative h-20 bg-gradient-to-br ${hues[i % hues.length]} grid-bg`}>
                <div className="absolute bottom-2 left-3 flex h-9 w-9 items-center justify-center rounded-xl bg-background/80 backdrop-blur border border-border">
                  <Store className="h-4 w-4 text-primary" />
                </div>
                {/* Active session indicator */}
                {detected?.mall?.id === m.id && detected.within_radius && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-primary/20 border border-primary/40 px-2 py-0.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="text-[9px] text-primary font-bold uppercase">Active</span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-display font-bold text-base">{m.name}</h3>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {[m.city, m.province].filter(Boolean).join(", ")}
                  </span>
                  {userPos && m.lat && m.lng && (
                    <span className="flex items-center gap-1 text-primary font-medium">
                      <Navigation className="h-3 w-3" />
                      {haversine(userPos.lat, userPos.lng, m.lat, m.lng).toFixed(1)} km
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </MobileShell>
  );
};

export default Malls;
