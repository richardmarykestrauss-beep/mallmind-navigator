import { useNavigate } from "react-router-dom";
import { Search, MapPin, Locate, Store, Tag } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";

const malls = [
  { name: "Mall of Africa", location: "Midrand, GP", stores: 300, deals: 84, hue: "from-primary/30 to-primary/5" },
  { name: "Sandton City", location: "Sandton, GP", stores: 360, deals: 112, hue: "from-secondary/30 to-secondary/5" },
  { name: "Gateway Theatre of Shopping", location: "Umhlanga, KZN", stores: 390, deals: 67, hue: "from-primary/30 to-secondary/10" },
  { name: "Canal Walk", location: "Cape Town, WC", stores: 400, deals: 95, hue: "from-secondary/30 to-primary/10" },
  { name: "Menlyn Park", location: "Pretoria, GP", stores: 500, deals: 73, hue: "from-primary/30 to-primary/5" },
  { name: "V&A Waterfront", location: "Cape Town, WC", stores: 450, deals: 58, hue: "from-secondary/20 to-primary/10" },
];

const Malls = () => {
  const navigate = useNavigate();
  return (
    <MobileShell>
      <ScreenHeader title="Find Your Mall" subtitle="Pick a mall to start shopping smart" />

      <div className="px-5 space-y-4 animate-fade-in">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Which mall are you at?"
            className="w-full h-12 pl-11 pr-4 rounded-2xl bg-surface border border-border text-sm focus:outline-none focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(190_100%_50%/0.15)] transition-all"
          />
        </div>

        {/* Detect location */}
        <Button variant="neonGreen" size="lg" className="w-full">
          <Locate className="h-5 w-5" />
          Detect My Location
        </Button>

        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Popular Malls</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Malls list */}
        <div className="space-y-3 pb-4">
          {malls.map((m, i) => (
            <button
              key={m.name}
              onClick={() => navigate("/navigate")}
              className="group w-full text-left rounded-2xl border border-border bg-surface/70 backdrop-blur overflow-hidden hover:border-primary/50 transition-all animate-slide-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className={`relative h-20 bg-gradient-to-br ${m.hue} grid-bg`}>
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-secondary/20 border border-secondary/40 px-2.5 py-1">
                  <Tag className="h-3 w-3 text-secondary" />
                  <span className="text-[11px] font-semibold text-secondary">{m.deals} deals</span>
                </div>
                <div className="absolute bottom-2 left-3 flex h-9 w-9 items-center justify-center rounded-xl bg-background/80 backdrop-blur border border-border">
                  <Store className="h-4 w-4 text-primary" />
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-display font-bold text-base">{m.name}</h3>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {m.location}
                  </span>
                  <span>{m.stores} stores</span>
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
