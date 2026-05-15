import { NavLink, useLocation } from "react-router-dom";
import { Home, Navigation, Sparkles, ListChecks, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/",          label: "Home",     icon: Home,       highlight: false },
  { to: "/navigate",  label: "Navigate", icon: Navigation, highlight: false },
  { to: "/assistant", label: "AI",       icon: Sparkles,   highlight: true  },
  { to: "/list",      label: "My List",  icon: ListChecks, highlight: false },
  { to: "/profile",   label: "Profile",  icon: User,       highlight: false },
];

const BottomNav = () => {
  const location = useLocation();
  return (
    <nav className="absolute bottom-0 left-0 right-0 z-30 px-3 pb-3 pt-0">
      {/* items-end so the protruding AI button rises above the bar naturally */}
      <div className="flex items-end justify-around rounded-2xl border border-border bg-surface/80 backdrop-blur-xl px-2 py-2 shadow-[var(--shadow-card)]">
        {items.map(({ to, label, icon: Icon, highlight }) => {
          const active = location.pathname === to;

          // ── Centre AI button — elevated glowing pill ──────────────────────
          if (highlight) {
            return (
              <NavLink
                key={to}
                to={to}
                className="relative flex flex-1 flex-col items-center gap-1 pb-0.5"
              >
                {/* Protruding button — -mt-5 lifts it above the nav bar */}
                <div
                  className={cn(
                    "relative flex h-12 w-12 items-center justify-center rounded-2xl border-2 -mt-5 transition-all duration-300",
                    active
                      ? [
                          "bg-gradient-to-br from-primary to-violet-500",
                          "border-primary/60",
                          "shadow-[0_0_28px_hsl(190_100%_50%/0.5),0_0_48px_hsl(270_80%_60%/0.25)]",
                        ]
                      : [
                          "bg-gradient-to-br from-primary/80 to-violet-500/80",
                          "border-primary/40",
                          "shadow-[0_0_16px_hsl(190_100%_50%/0.3),0_0_32px_hsl(270_80%_60%/0.15)]",
                          "hover:shadow-[0_0_20px_hsl(190_100%_50%/0.45)]",
                        ]
                  )}
                >
                  {/* Active pulse ring */}
                  {active && (
                    <span className="absolute inset-0 rounded-2xl animate-ping bg-primary/20 pointer-events-none" />
                  )}
                  <Icon className="relative h-5 w-5 text-background" strokeWidth={2.5} />
                </div>
                <span
                  className={cn(
                    "text-[10px] font-semibold tracking-wide transition-colors",
                    active ? "text-primary" : "text-primary/70"
                  )}
                >
                  {label}
                </span>
              </NavLink>
            );
          }

          // ── Regular nav item ───────────────────────────────────────────────
          return (
            <NavLink
              key={to}
              to={to}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5"
            >
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-300",
                  active
                    ? "bg-primary/15 text-primary glow-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium tracking-wide transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
