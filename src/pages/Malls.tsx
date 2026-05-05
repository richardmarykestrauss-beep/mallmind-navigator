import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Locate, Store, Loader2, Navigation } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { supabase, type Mall } from "@/lib/supabaseClient";
import { useShoppingSession } from "@/context/ShoppingSessionContext";

const hues = [
  "from-primary/30 to-primary/5",
  "from-secondary/30 to-secondary/5",
  "from-primary/30 to-secondary/10",
  "from-secondary/30 to-primary/10",
];

// Haversine formula — returns distance in km
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

const Malls = () => {
  const navigate = useNavigate();
  const { setSelectedMall } = useShoppingSession();
  const [malls, setMalls] = useState<Mall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

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

  function detectLocation() {
    if (!navigator.geolocation) {
      setLocError("Geolocation not supported on this device.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocError("Couldn't get your location. Please allow access and try again.");
        setLocating(false);
      },
      { timeout: 8000 }
    );
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

  const filtered = sorted;

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
          <p className="text-xs text-destructive text-center -mt-2">{locError}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {userPos ? "Nearest First" : "Popular Malls"}
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

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            No malls found.
          </div>
        )}

        {/* Malls list */}
        <div className="space-y-3 pb-4">
          {filtered.map((m, i) => (
            <button
              key={m.id}
              onClick={() => { setSelectedMall(m); navigate("/search"); }}
              className="group w-full text-left rounded-2xl border border-border bg-surface/70 backdrop-blur overflow-hidden hover:border-primary/50 transition-all animate-slide-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className={`relative h-20 bg-gradient-to-br ${hues[i % hues.length]} grid-bg`}>
                <div className="absolute bottom-2 left-3 flex h-9 w-9 items-center justify-center rounded-xl bg-background/80 backdrop-blur border border-border">
                  <Store className="h-4 w-4 text-primary" />
                </div>
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
                      {haversine(userPos.lat, userPos.lng, m.lat, m.lng).toFixed(0)} km
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
