import { useNavigate } from "react-router-dom";
import { Bell, Heart, Shield, HelpCircle, ChevronRight, Crown, Trophy, User as UserIcon } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";

const settings = [
  { label: "Notifications", icon: Bell, hint: "Deals & price alerts" },
  { label: "Favourite Malls", icon: Heart, hint: "3 saved" },
  { label: "Privacy", icon: Shield, hint: "Location & data" },
  { label: "Help & Support", icon: HelpCircle, hint: "FAQs, contact" },
];

const Profile = () => {
  const navigate = useNavigate();

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
        <h2 className="mt-4 font-display text-xl font-bold">Thabo Mokoena</h2>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-3 py-1 text-[11px] font-bold text-primary-foreground glow-primary">
          <Crown className="h-3 w-3" />
          MallMind Pro · R50/month
        </span>
      </div>

      {/* Subscription card */}
      <div className="mx-5 mt-6 rounded-3xl border border-secondary/30 bg-gradient-surface p-5 relative overflow-hidden animate-slide-up">
        <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-secondary/15 blur-3xl" />
        <div className="relative">
          <p className="text-xs uppercase tracking-wider text-secondary font-bold">Active Subscription</p>
          <h3 className="font-display text-lg font-bold mt-1">You're saving R420/mo on average</h3>
          <p className="text-xs text-muted-foreground mt-1">Unlimited deal alerts · Priority routing · No ads</p>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Renews</p>
              <p className="text-sm font-semibold">15 May 2026</p>
            </div>
            <Button variant="neonGreen" size="sm">
              Manage
            </Button>
          </div>
        </div>
      </div>

      {/* Quick link */}
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
              <p className="font-semibold text-sm">Level 4 · Smart Shopper</p>
              <p className="text-xs text-muted-foreground">2,340 XP · 78% to next</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Settings */}
      <div className="px-5 mt-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3 px-1">Settings</p>
        <div className="rounded-2xl border border-border bg-surface/70 backdrop-blur divide-y divide-border overflow-hidden">
          {settings.map(({ label, icon: Icon, hint }) => (
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

      <div className="px-5 mt-6 text-center">
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em]">MallMind v1.0 · Made in 🇿🇦</p>
      </div>
    </MobileShell>
  );
};

export default Profile;
