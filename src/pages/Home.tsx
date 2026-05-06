import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, MapPin, ListChecks, Car, Trophy,
  Search, Route as RouteIcon, Zap, Navigation, Loader2
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useShoppingSession } from "@/context/ShoppingSessionContext";
import { useAuth } from "@/context/AuthContext";
import { useGeoLocation } from "@/context/LocationContext";
import { awardXP, XP_REWARDS } from "@/lib/xp";
import { LEVEL_NAMES, xpProgress } from "@/lib/levels";
import { cn } from "@/lib/utils";

const SESSION_XP_KEY = "mm_session_xp_awarded";

const quickActions = [
  { label: "Parking", icon: Car, to: "/parking", color: "text-primary" },
  { label: "Rewards", icon: Trophy, to: "/rewards", color: "text-secondary" },
  { label: "Deals", icon: Sparkles, to: "/deals", color: "text-primary" },
];

const Home = () => {
  const navigate = useNavigate();
  const { selectedMall, routeStops, setSelectedMall } = useShoppingSession();
  const { user, profile, refreshProfile } = useAuth();
  const { requesting, nearestMall, nearestMallDistance, error: geoError, requestLocation } = useGeoLocation();

  // Award session-start XP once per browser session
  useEffect(() => {
    if (!user || !profile) return;
    if (sessionStorage.getItem(SESSION_XP_KEY)) return;
    sessionStorage.setItem(SESSION_XP_KEY, "1");
    awardXP(user.id, XP_REWARDS.SESSION_START, profile.xp, profile.level).then((result) => {
      refreshProfile();
      if (result.newAchievements.length) {
        sessionStorage.setItem("mm_new_badges", JSON.stringify(result.newAchievements));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function handleShopHere() {
    if (nearestMall) {
      setSelectedMall(nearestMall);
      navigate("/search");
    }
  }

  return (
    <MobileShell>
      <div className="px-5 pt-8 animate-fade-in">
        <div className="flex items-center justify-between">
          <Logo />
          <button
            onClick={() => navigate("/assistant")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-secondary/30 bg-secondary/10 backdrop-blur hover:bg-secondary/20 transition-all"
          >
            <Sparkles className="h-4 w-4 text-secondary" />
          </button>
        </div>

        {/* XP progress strip — only for logged-in users */}
        {user && profile && (() => {
          const prog = xpProgress(profile.xp, profile.level);
          return (
            <button
              onClick={() => navigate("/rewards")}
              className="mt-4 w-full flex items-center gap-3 rounded-2xl border border-secondary/20 bg-secondary/8 px-3 py-2.5 hover:bg-secondary/15 transition-all"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary/20 border border-secondary/30">
                <Zap className="h-4 w-4 text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-secondary">
                    Lv {profile.level} · {LEVEL_NAMES[profile.level]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{profile.xp} XP</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-secondary transition-all duration-700"
                    style={{ width: `${prog.pct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })()}
      </div>

      {/* Hero */}
      <div className="relative mt-8 px-5 text-center animate-slide-up">
        <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center">
          <div className="absolute h-32 w-32 rounded-full bg-primary/10 blur-2xl animate-float" />
          <div className="relative flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-primary glow-primary animate-float">
            <MapPin className="h-12 w-12 text-primary-foreground" strokeWidth={2.5} />
            <span className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-secondary glow-secondary">
              <ListChecks className="h-5 w-5 text-secondary-foreground" strokeWidth={2.8} />
            </span>
          </div>
        </div>

        <h1 className="font-display text-[34px] font-bold leading-[1.05]">
          Shop <span className="text-primary text-glow-primary">Smarter.</span>
          <br />
          Navigate <span className="text-secondary text-glow-secondary">Faster.</span>
          <br />
          Save <span className="text-primary text-glow-primary">More.</span>
        </h1>
        <p className="mt-4 text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
          Your AI-powered companion for every South African mall.
        </p>
      </div>

      {/* Nearest mall detector */}
      <div className="mx-5 mt-5 animate-slide-up">
        {!nearestMall && !requesting && (
          <button
            onClick={requestLocation}
            className="w-full flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3 hover:border-primary/40 hover:bg-surface transition-all text-left"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/30">
              <Navigation className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Detect nearest mall</p>
              <p className="text-[11px] text-muted-foreground">Uses your GPS — no data stored</p>
            </div>
          </button>
        )}

        {requesting && (
          <div className="w-full flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            <p className="text-sm text-primary font-medium">Finding nearest mall…</p>
          </div>
        )}

        {nearestMall && (
          <div className="w-full flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 animate-fade-in">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 border border-primary/40">
              <Navigation className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider text-primary">Nearest mall</p>
              <p className="font-display font-bold text-sm truncate">{nearestMall.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {nearestMall.city}{nearestMallDistance != null ? ` · ${nearestMallDistance} km away` : ""}
              </p>
            </div>
            <Button
              variant="neon"
              size="sm"
              onClick={handleShopHere}
              className={cn(selectedMall?.id === nearestMall.id && "opacity-60 pointer-events-none")}
            >
              {selectedMall?.id === nearestMall.id ? "Selected" : "Shop here"}
            </Button>
          </div>
        )}

        {geoError && !nearestMall && (
          <p className="text-xs text-muted-foreground text-center px-4">
            Location denied — choose a mall manually below.
          </p>
        )}
      </div>

      {/* Active session banner */}
      {(selectedMall || routeStops.length > 0) && (
        <div className="mx-5 mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-primary">Active session</p>
              <p className="font-display font-bold text-sm mt-0.5">
                {selectedMall?.name ?? "Shopping session"}
              </p>
              {routeStops.length > 0 && (
                <p className="text-xs text-muted-foreground">{routeStops.length} stops planned</p>
              )}
            </div>
            <Button
              variant="glass"
              size="sm"
              onClick={() => navigate(routeStops.length > 0 ? "/navigate" : "/search")}
            >
              {routeStops.length > 0 ? (
                <><RouteIcon className="h-4 w-4" /> Route</>
              ) : (
                <><Search className="h-4 w-4" /> Search</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* CTAs */}
      <div className="mt-5 px-5 space-y-3 animate-slide-up">
        <Button
          variant="neon"
          size="lg"
          className="w-full"
          onClick={() => navigate("/malls")}
        >
          <Search className="h-5 w-5" />
          Browse All Malls
        </Button>
        <Button
          variant="glass"
          size="lg"
          className="w-full"
          onClick={() => navigate("/list")}
        >
          <ListChecks className="h-5 w-5" />
          Shopping List
        </Button>
      </div>

      {/* Quick actions */}
      <div className="mt-8 px-5 pb-4 animate-fade-in">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3 px-1">
          Quick Access
        </p>
        <div className="grid grid-cols-3 gap-3">
          {quickActions.map(({ label, icon: Icon, to, color }) => (
            <button
              key={label}
              onClick={() => navigate(to)}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface/60 backdrop-blur p-4 hover:border-primary/40 hover:bg-surface transition-all"
            >
              <Icon className={`h-6 w-6 ${color} group-hover:scale-110 transition-transform`} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </MobileShell>
  );
};

export default Home;
