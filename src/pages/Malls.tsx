import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Locate, Store, Loader2 } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { supabase, type Mall } from "@/lib/supabaseClient";

const hues = [
  "from-primary/30 to-primary/5",
  "from-secondary/30 to-secondary/5",
  "from-primary/30 to-secondary/10",
  "from-secondary/30 to-primary/10",
];

const Malls = () => {
  const navigate = useNavigate();
  const [malls, setMalls] = useState<Mall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("malls")
        .select("id, name, city, province");
      if (error) setError(error.message);
      else setMalls((data ?? []) as Mall[]);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = malls.filter((m) =>
    m.name.toLowerCase().includes(query.toLowerCase())
  );

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

        <Button variant="neonGreen" size="lg" className="w-full">
          <Locate className="h-5 w-5" />
          Detect My Location
        </Button>

        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Popular Malls</span>
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
              onClick={() => navigate("/navigate")}
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
