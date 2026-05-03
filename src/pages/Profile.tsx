import { useNavigate } from "react-router-dom";
import {
  Bell, Heart, Shield, HelpCircle, ChevronRight,
  Crown, Trophy, User as UserIcon, LogOut, LogIn, Loader2
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { LEVEL_NAMES, xpForLevel, xpProgress } from "@/lib/levels";

const SETTINGS = [
  { label: "Notifications", icon: Bell, hint: "Deals & price alerts" },
  { label: "Favourite Malls", icon: Heart, hint: "Coming soon" },
  { label: "Privacy", icon: Shield, hint: "Location & data" },
  { label: "Help & Support", icon: HelpCircle, hint: "FAQs, contact" },
];

const Profile = () => {
  const navigate = useNavigate();
  const { user, profile, loading, signOut } = useAuth();

  if (loading) {
    return (
      <MobileShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </MobileShell>
    );
  }

  // Guest view
  if (!user || !profile) {
    return (
      <MobileShell>
        <ScreenHeader title="Profile" back={false} />
        <div className="flex flex-col items-center gap-4 px-6 pt-16 text-center animate-fade-in">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted border border-border">
            <UserIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-display text-lg font-bold">You're not signed in</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[240px] leading-relaxed">
              Sign in to track your rewards, save routes, and get price drop alerts.
            </p>
          </div>
          <Button variant="neon" size="lg" className="w-full mt-2" onClick={() => navigate("/auth")}>
            <LogIn className="h-5 w-5" />
            Sign In / Create Account
          </Button>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em] mt-8">
            MallMind v1.0 · Made in 🇿🇦
          </p>
        </div>
      </MobileShell>
    );
  }

  const level = profile.level ?? 1;
  const xp = profile.xp ?? 0;
  const levelName = LEVEL_NAMES[level] ?? "Newcomer";
  const { current, required, pct } = xpProgress(xp, level);
  const displayName = profile.full_name ?? profile.username ?? user.email?.split("@")[0] ?? "Shopper";

  return (
    <MobileShell>
      <ScreenHeader title="Profile" back={false} />

      {/* Avatar + name */}
      <div className="px-5 flex flex-col items-center text-center animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-primary glow-primary border-4 border-background">
            <UserIcon className="h-10 w-10 text-primary-foreground" />
          </div>
          <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-secondary border-2 border-background">
            <Trophy className="h-3.5 w-3.5 text-secondary-foreground" />
          </span>
        </div>
        <h2 className="mt-4 font-display text-xl font-bold">{displayName}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-3 py-1 text-[11px] font-bold text-primary-foreground glow-primary">
          <Crown className="h-3 w-3" />
          {profile.subscription_status === "free" ? "Free Plan" : `MallMind Pro · R49/month`}
        </span>
      </div>

      {/* Subscription / upgrade card */}
      <div className="mx-5 mt-6 rounded-3xl border border-secondary/30 bg-gradient-surface p-5 relative overflow-hidden animate-slide-up">
        <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-secondary/15 blur-3xl" />
        <div className="relative">
          {profile.subscription_status === "free" ? (
            <>
              <p className="text-xs uppercase tracking-wider text-secondary font-bold">Free Plan</p>
              <h3 className="font-display text-lg font-bold mt-1">Upgrade to unlock everything</h3>
              <p className="text-xs text-muted-foreground mt-1">Price alerts · Budget mode · Unlimited AI · All 8 malls</p>
              <div className="mt-4">
                <Button variant="neonGreen" size="sm">Upgrade — R49/mo</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wider text-secondary font-bold">Active Subscription</p>
              <h3 className="font-display text-lg font-bold mt-1">MallMind Pro</h3>
              <p className="text-xs text-muted-foreground mt-1">Unlimited deal alerts · Priority routing · No ads</p>
              <div className="mt-4">
                <Button variant="glass" size="sm">Manage</Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rewards quick link */}
      <div className="px-5 mt-4">
        <button
          onClick={() => navigate("/rewards")}
          className="w-full flex items-center justify-between rounded-2xl border border-border bg-surface/70 backdrop-blur p-4 hover:border-primary/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Trophy className="h-5 w-5" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-sm">Level {level} · {levelName}</p>
              <p className="text-xs text-muted-foreground">
                {xp.toLocaleString()} XP · {pct}% to Level {level + 1}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Settings */}
      <div className="px-5 mt-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3 px-1">Settings</p>
        <div className="rounded-2xl border border-border bg-surface/70 backdrop-blur divide-y divide-border overflow-hidden">
          {SETTINGS.map(({ label, icon: Icon, hint }) => (
            <button
              key={label}
              className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-[11px] text-muted-foreground">{hint}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      {/* Sign out */}
      <div className="px-5 mt-4 mb-2">
        <button
          onClick={() => signOut()}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface/60 p-4 text-sm text-muted-foreground hover:text-foreground hover:border-destructive/40 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>

      <div className="px-5 mt-2 text-center pb-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">MallMind v1.0 · Made in 🇿🇦</p>
      </div>
    </MobileShell>
  );
};

export default Profile;
