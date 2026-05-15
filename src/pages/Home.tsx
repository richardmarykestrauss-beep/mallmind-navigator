import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, MapPin, ListChecks, Car, Trophy,
  Search, Route as RouteIcon, Zap, Navigation, Loader2,
  Tag, Bot, ShieldCheck,
} from "lucide-react";
// RouteIcon used in session banner; ShieldCheck/Navigation/Sparkles in trust strip; others in action grid
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

const ACTION_CARDS = [
  {
    label: "Find Best Deal",
    desc: "AI compares every store",
    Icon: Bot,
    iconClass: "text-primary",
    iconBg: "bg-primary/10 border-primary/20",
    hover: "hover:border-primary/40 hover:bg-primary/8",
    to: "/assistant",
  },
  {
    label: "Explore Malls",
    desc: "8 SA malls, verified data",
    Icon: MapPin,
    iconClass: "text-secondary",
    iconBg: "bg-secondary/10 border-secondary/20",
    hover: "hover:border-secondary/40 hover:bg-secondary/8",
    to: "/malls",
  },
  {
    label: "Today's Deals",
    desc: "Specials and verified picks",
    Icon: Tag,
    iconClass: "text-primary",
    iconBg: "bg-primary/10 border-primary/20",
    hover: "hover:border-primary/40 hover:bg-primary/8",
    to: "/deals",
  },
  {
    label: "Save Parking",
    desc: "GPS spot · return to car",
    Icon: Car,
    iconClass: "text-secondary",
    iconBg: "bg-secondary/10 border-secondary/20",
    hover: "hover:border-secondary/40 hover:bg-secondary/8",
    to: "/parking",
  },
] as const;

const Home = () => {
  const navigate = useNavigate();
  const { selectedMall, routeStops, setSelectedMall, startOrUpdateSession } = useShoppingSession();
  const { user, profile, refreshProfile } = useAuth();
  const { position, requesting, nearestMall, nearestMallDistance, error: geoError, requestLocation } = useGeoLocation();

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
      startOrUpdateSession(user?.id ?? null, nearestMall.id, {
        lat: position?.lat,
        lng: position?.lng,
      });
      navigate("/search");
    }
  }

  return (
    <MobileShell>
      {/* ── HERO GLASS CARD ─────────────────────────────────────── */}
      <div className="px-5 pt-7 animate-fade-in">
        <div className="relative rounded-3xl border border-primary/20 bg-surface/50 backdrop-blur-xl overflow-hidden p-5 shadow-[0_0_40px_hsl(190_100%_50%/0.06)]">
          {/* Glow orb behind card */}
          <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-primary/12 blur-3xl" />

          {/* Brand row */}
          <div className="relative flex items-center justify-between">
            <Logo />
            <button
              onClick={() => navigate("/assistant")}
              className="flex items-center gap-1.5 rounded-xl border border-secondary/30 bg-secondary/10 px-3 py-1.5 text-[11px] font-semibold text-secondary hover:bg-secondary/20 transition-all"
            >
              <div className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" />
              AI Active
            </button>
          </div>

          {/* Tagline */}
          <div className="relative mt-5">
            <p className="text-[10px] uppercase tracking-[0.25em] text-primary/80 font-semibold mb-2">
              AI Shopping Concierge
            </p>
            <h1 className="font-display text-[26px] font-bold leading-[1.1] tracking-tight">
              Shop{" "}
              <span className="text-primary text-glow-primary">Smarter.</span>
              <br />
              Navigate{" "}
              <span className="text-secondary text-glow-secondary">Faster.</span>
            </h1>
            {/* Trust strip */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-primary/70" />
                Verified prices
              </span>
              <span className="flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] text-muted-foreground">
                <Navigation className="h-3 w-3 text-primary/70" />
                Smart routes
              </span>
              <span className="flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-primary/70" />
                AI powered
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── MALL DETECTOR CARD ──────────────────────────────────── */}
      <div className="mx-5 mt-3 animate-slide-up">
        {!nearestMall && !requesting && (
          <button
            onClick={requestLocation}
            className="w-full flex items-center gap-3 rounded-2xl border border-border/80 bg-surface/50 backdrop-blur px-4 py-3.5 hover:border-primary/40 hover:bg-surface/70 transition-all text-left group"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/25 group-hover:bg-primary/20 transition-colors">
              <Navigation className="h-4.5 w-4.5 h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Detect nearest mall</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Uses GPS · no data stored</p>
            </div>
            <div className="text-[10px] text-primary/60 border border-primary/20 rounded-lg px-2 py-1">Tap</div>
          </button>
        )}

        {requesting && (
          <div className="w-full flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/8 backdrop-blur px-4 py-3.5">
            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            <p className="text-sm text-primary font-medium">Finding nearest mall…</p>
          </div>
        )}

        {nearestMall && (
          <div className="w-full flex items-center gap-3 rounded-2xl border border-primary/35 bg-primary/8 backdrop-blur px-4 py-3.5 animate-fade-in shadow-[0_0_20px_hsl(190_100%_50%/0.08)]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 border border-primary/35">
              <Navigation className="h-4.5 w-4.5 h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-primary font-bold">Nearest mall</p>
              <p className="font-display font-bold text-sm truncate mt-0.5">{nearestMall.name}</p>
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
              {selectedMall?.id === nearestMall.id ? "Active" : "Shop here"}
            </Button>
          </div>
        )}

        {geoError && !nearestMall && (
          <p className="text-xs text-muted-foreground text-center px-4 py-2">
            Location denied — choose a mall manually below.
          </p>
        )}
      </div>

      {/* ── XP PROGRESS STRIP (logged-in only) ─────────────────── */}
      {user && profile && (() => {
        const prog = xpProgress(profile.xp, profile.level);
        return (
          <button
            onClick={() => navigate("/rewards")}
            className="mx-5 mt-3 w-[calc(100%-2.5rem)] flex items-center gap-3 rounded-2xl border border-secondary/20 bg-secondary/6 px-3 py-2.5 hover:bg-secondary/12 transition-all animate-fade-in"
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
              <div className="h-1.5 w-full rounded-full bg-secondary/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-secondary to-secondary-glow transition-all duration-700"
                  style={{ width: `${prog.pct}%` }}
                />
              </div>
            </div>
            <Trophy className="h-4 w-4 text-secondary/60 shrink-0" />
          </button>
        );
      })()}

      {/* ── ACTION GRID ─────────────────────────────────────────── */}
      <div className="px-5 mt-5 animate-slide-up">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3 px-1">
          Quick actions
        </p>
        <div className="grid grid-cols-2 gap-3">
          {ACTION_CARDS.map(({ label, desc, Icon, iconClass, iconBg, hover, to }) => (
            <button
              key={label}
              onClick={() => navigate(to)}
              className={cn(
                "group flex flex-col gap-3 rounded-2xl border border-border/60 bg-surface/50 backdrop-blur p-4 text-left transition-all",
                hover
              )}
            >
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl border transition-all",
                iconBg
              )}>
                <Icon className={cn("h-5 w-5", iconClass)} />
              </div>
              <div>
                <p className="font-display font-bold text-sm leading-tight">{label}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── ACTIVE SESSION BANNER ───────────────────────────────── */}
      {(selectedMall || routeStops.length > 0) && (
        <div className="mx-5 mt-4 rounded-2xl border border-primary/30 bg-primary/8 backdrop-blur p-4 animate-slide-up shadow-[0_0_20px_hsl(190_100%_50%/0.06)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 border border-primary/30 shrink-0">
                <RouteIcon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-primary font-bold">Active session</p>
                <p className="font-display font-bold text-sm mt-0.5">
                  {selectedMall?.name ?? "Shopping session"}
                </p>
                {routeStops.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">{routeStops.length} stops planned</p>
                )}
              </div>
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

      {/* ── SECONDARY LINKS ─────────────────────────────────────── */}
      <div className="px-5 mt-4 mb-3 flex gap-2.5">
        <button
          onClick={() => navigate("/list")}
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-surface/40 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
        >
          <ListChecks className="h-4 w-4" />
          Shopping List
        </button>
        <button
          onClick={() => navigate("/rewards")}
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-surface/40 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-secondary/30 transition-all"
        >
          <Zap className="h-4 w-4" />
          Rewards
        </button>
      </div>
    </MobileShell>
  );
};

export default Home;
