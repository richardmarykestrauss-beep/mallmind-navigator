import { useState } from "react";
import { Clock, Footprints, MapPin, Route as RouteIcon } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { cn } from "@/lib/utils";

const floors = ["G", "L1", "L2", "L3"];

const NavigateScreen = () => {
  const [floor, setFloor] = useState("L1");

  return (
    <MobileShell>
      <ScreenHeader title="Mall Map" subtitle="Mall of Africa · Optimised route" />

      {/* Map area */}
      <div className="relative mx-5 h-[420px] rounded-3xl border border-border bg-surface overflow-hidden">
        {/* Grid floor plan */}
        <div className="absolute inset-0 grid-bg opacity-80" />

        {/* Faux building blocks */}
        <div className="absolute inset-0 p-6">
          <div className="grid grid-cols-4 grid-rows-6 gap-2 h-full">
            <div className="col-span-2 row-span-2 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-2 row-span-1 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-1 row-span-2 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-1 row-span-1 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-2 row-span-2 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-1 row-span-1 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-3 row-span-1 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-2 row-span-2 rounded-lg bg-muted/40 border border-border" />
            <div className="col-span-2 row-span-2 rounded-lg bg-muted/40 border border-border" />
          </div>
        </div>

        {/* Route line (SVG dashed) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path
            d="M 20 80 Q 30 60 50 55 T 78 22"
            stroke="hsl(var(--primary))"
            strokeWidth="0.8"
            strokeDasharray="2 2"
            fill="none"
            style={{ filter: "drop-shadow(0 0 4px hsl(var(--primary)))" }}
          />
        </svg>

        {/* Current location pulse */}
        <div className="absolute" style={{ left: "18%", top: "76%" }}>
          <div className="relative">
            <div className="absolute inset-0 h-4 w-4 rounded-full bg-primary animate-ping opacity-70" />
            <div className="relative h-4 w-4 rounded-full bg-primary glow-primary border-2 border-background" />
          </div>
        </div>

        {/* Destination pin */}
        <div className="absolute" style={{ left: "76%", top: "18%" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary glow-secondary border-2 border-background">
            <MapPin className="h-4 w-4 text-secondary-foreground" fill="currentColor" />
          </div>
        </div>

        {/* Floor selector */}
        <div className="absolute right-3 top-3 flex flex-col gap-1.5 rounded-2xl border border-border bg-background/80 backdrop-blur p-1.5">
          {floors.map((f) => (
            <button
              key={f}
              onClick={() => setFloor(f)}
              className={cn(
                "h-9 w-9 rounded-xl text-xs font-bold transition-all",
                floor === f
                  ? "bg-primary text-primary-foreground glow-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom sheet */}
      <div className="mx-5 mt-4 rounded-3xl border border-border bg-gradient-surface p-5 animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <RouteIcon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Next Step</p>
            <p className="font-display text-lg font-bold leading-tight">Turn left at Woolworths</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-border bg-surface p-3">
          <div className="text-center">
            <Clock className="mx-auto h-4 w-4 text-primary mb-1" />
            <p className="font-display font-bold text-base">4 min</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Walk</p>
          </div>
          <div className="text-center border-x border-border">
            <Footprints className="mx-auto h-4 w-4 text-secondary mb-1" />
            <p className="font-display font-bold text-base">320m</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Distance</p>
          </div>
          <div className="text-center">
            <MapPin className="mx-auto h-4 w-4 text-primary mb-1" />
            <p className="font-display font-bold text-base">2 / 3</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stops</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary/10 border border-secondary/30 px-3 py-2">
          <div className="h-2 w-2 rounded-full bg-secondary animate-pulse" />
          <p className="text-xs font-medium text-secondary">Optimised Route: 3 stops in order</p>
        </div>
      </div>
    </MobileShell>
  );
};

export default NavigateScreen;
