import { useState } from "react";
import { MapPin, Car, Navigation2, RotateCcw } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";

const Parking = () => {
  const [saved, setSaved] = useState(false);

  return (
    <MobileShell>
      <ScreenHeader
        title="Where's My Car?"
        subtitle={saved ? "Parking spot saved" : "Tap to save your spot"}
      />

      {!saved ? (
        <div className="px-5 mt-6 flex flex-col items-center text-center animate-fade-in">
          <button
            onClick={() => setSaved(true)}
            className="group relative mt-6 flex h-64 w-64 items-center justify-center rounded-full"
          >
            <div className="absolute inset-0 rounded-full bg-primary/15 blur-2xl animate-pulse-glow" />
            <div className="absolute inset-4 rounded-full border border-primary/30 animate-pulse-glow" />
            <div className="relative flex h-48 w-48 flex-col items-center justify-center rounded-full bg-gradient-primary glow-primary group-active:scale-95 transition-transform">
              <MapPin className="h-14 w-14 text-primary-foreground" strokeWidth={2.5} />
              <span className="mt-2 font-display font-bold text-primary-foreground text-base">Save Spot</span>
            </div>
          </button>

          <p className="mt-10 max-w-xs text-sm text-muted-foreground leading-relaxed">
            Tap when you park to save your location. We'll guide you back when you're done shopping.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3 w-full">
            {["Auto-detect", "Photo note", "Voice memo"].map((f) => (
              <div key={f} className="rounded-2xl border border-border bg-surface/60 backdrop-blur p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{f}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 animate-fade-in">
          {/* Map */}
          <div className="relative mt-2 h-72 rounded-3xl border border-border bg-surface overflow-hidden">
            <div className="absolute inset-0 grid-bg opacity-80" />
            <div className="absolute inset-0 p-5 grid grid-cols-5 grid-rows-4 gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="rounded bg-muted/40 border border-border" />
              ))}
            </div>

            {/* Route */}
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
          </div>

          {/* Info card */}
          <div className="mt-4 rounded-3xl border border-border bg-gradient-surface p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Parking Zone</p>
                <p className="font-display font-bold text-xl mt-0.5">Zone B3</p>
                <p className="text-xs text-muted-foreground">North Entrance</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Distance</p>
                <p className="font-display font-bold text-xl text-secondary text-glow-secondary mt-0.5">320m</p>
                <p className="text-xs text-muted-foreground">~ 4 min walk</p>
              </div>
            </div>

            <Button variant="neonGreen" size="lg" className="w-full mt-5 animate-pulse-glow-green">
              <Navigation2 className="h-5 w-5" />
              Take Me To My Car
            </Button>

            <button
              onClick={() => setSaved(false)}
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
