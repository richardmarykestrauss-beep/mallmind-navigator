import { NavLink, useLocation } from "react-router-dom";
import { Home, Navigation, Sparkles, ListChecks, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/navigate", label: "Navigate", icon: Navigation },
  { to: "/assistant", label: "AI", icon: Sparkles, highlight: true },
  { to: "/list", label: "My List", icon: ListChecks },
  { to: "/profile", label: "Profile", icon: User },
];

const BottomNav = () => {
  const location = useLocation();
  return (
    <nav className="absolute bottom-0 left-0 right-0 z-30 px-3 pb-3 pt-2">
      <div className="flex items-center justify-around rounded-2xl border border-border bg-surface/80 backdrop-blur-xl px-2 py-2 shadow-[var(--shadow-card)]">
        {items.map(({ to, label, icon: Icon, highlight }) => {
          const active = location.pathname === to;
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
                    ? highlight
                      ? "bg-secondary/20 text-secondary glow-secondary"
                      : "bg-primary/15 text-primary glow-primary"
                    : highlight
                      ? "bg-secondary/10 text-secondary border border-secondary/20"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium tracking-wide transition-colors",
                  active
                    ? highlight ? "text-secondary" : "text-primary"
                    : highlight ? "text-secondary/80" : "text-muted-foreground"
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
