import { useNavigate } from "react-router-dom";
import {
  Trophy, Zap, Tag, TrendingUp, Award, Lock,
  Sparkles, Crown, Flame, Target, Star, LogIn, Loader2
} from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { LEVEL_NAMES, xpProgress } from "@/lib/levels";

// Badge definitions — unlocked based on XP milestones
const BADGES = [
  { name: "First Find", Icon: Star, xpRequired: 0, color: "from-primary to-primary-glow" },
  { name: "Deal Hunter", Icon: Target, xpRequired: 100, color: "from-secondary to-secondary-glow" },
  { name: "Streak x7", Icon: Flame, xpRequired: 300, color: "from-primary to-secondary" },
  { name: "VIP Saver", Icon: Crown, xpRequired: 1000, color: "from-secondary to-primary-glow" },
  { name: "Mall Master", Icon: Award, xpRequired: 3000, color: "from-primary to-secondary" },
  { name: "Legend", Icon: Sparkles, xpRequired: 6000, color: "from-secondary to-primary" },
];

const Rewards = () => {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <MobileShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </MobileShell>
    );
  }

  // Guest prompt
  if (!user || !profile) {
    return (
      <MobileShell>
        <ScreenHeader title="MallMind Rewards" subtitle="Level up by shopping smart" />
        <div className="flex flex-col items-center gap-4 px-6 pt-12 text-center animate-fade-in">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 glow-primary">
            <Trophy className="h-9 w-9 text-primary" />
          </div>
          <div>
            <p className="font-display text-lg font-bold">Earn XP as you shop</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-[260px] leading-relaxed">
              Sign in to track your level, collect badges, and earn rewards every time you use MallMind.
            </p>
          </div>
          <Button variant="neon" size="lg" className="w-full mt-2" onClick={() => navigate("/auth")}>
            <LogIn className="h-5 w-5" />
            Sign In to Start Earning
          </Button>
        </div>
      </MobileShell>
    );
  }

  const level = profile.level ?? 1;
  const xp = profile.xp ?? 0;
  const levelName = LEVEL_NAMES[level] ?? "Newcomer";
  const { current, required, pct } = xpProgress(xp, level);
  const unlockedCount = BADGES.filter((b) => xp >= b.xpRequired).length;

  return (
    <MobileShell>
      <ScreenHeader title="MallMind Rewards" subtitle="Level up by shopping smart" />

      {/* Level card */}
      <div className="mx-5 rounded-3xl border border-border bg-gradient-surface p-5 relative overflow-hidden animate-fade-in">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary glow-primary">
            <Trophy className="h-8 w-8 text-primary-foreground" />
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground border-2 border-background">
              {level}
            </span>
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Level {level}</p>
            <p className="font-display text-xl font-bold">{levelName} 🏆</p>
          </div>
        </div>

        {/* XP bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-muted-foreground">{xp.toLocaleString()} / {(xp - current + required).toLocaleString()} XP</span>
            {level < 6 && (
              <span className="font-semibold text-primary">{(required - current).toLocaleString()} to Level {level + 1}</span>
            )}
            {level >= 6 && (
              <span className="font-semibold text-secondary">Max Level!</span>
            )}
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary glow-primary transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 mt-4 grid grid-cols-3 gap-2.5 animate-fade-in">
        {[
          { label: "XP Earned", value: xp.toLocaleString(), icon: TrendingUp, color: "text-secondary" },
          { label: "Level", value: String(level), icon: Tag, color: "text-primary" },
          { label: "Badges", value: `${unlockedCount}/${BADGES.length}`, icon: Zap, color: "text-secondary" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl border border-border bg-surface/70 backdrop-blur p-3 text-center">
            <Icon className={`mx-auto h-5 w-5 ${color} mb-1.5`} />
            <p className="font-display font-bold text-base leading-none">{value}</p>
            <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{label}</p>
          </div>
        ))}
      </div>

      {/* Badges */}
      <div className="px-5 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-base">Achievements</h2>
          <span className="text-xs text-muted-foreground">{unlockedCount} / {BADGES.length} unlocked</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {BADGES.map((b) => {
            const unlocked = xp >= b.xpRequired;
            return (
              <div
                key={b.name}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-3 ${
                  unlocked ? "border-border bg-surface/70" : "border-dashed border-border bg-surface/30"
                }`}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                    unlocked ? `bg-gradient-to-br ${b.color} glow-primary` : "bg-muted"
                  }`}
                >
                  {unlocked
                    ? <b.Icon className="h-6 w-6 text-background" />
                    : <Lock className="h-5 w-5 text-muted-foreground" />
                  }
                </div>
                <p className={`text-[11px] font-medium text-center ${unlocked ? "" : "text-muted-foreground"}`}>
                  {b.name}
                </p>
                {!unlocked && (
                  <p className="text-[9px] text-muted-foreground/60">{b.xpRequired.toLocaleString()} XP</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Submit price CTA */}
      <div className="px-5 mt-6 mb-2">
        <Button variant="neon" size="lg" className="w-full" onClick={() => navigate("/search")}>
          <Zap className="h-5 w-5" />
          Submit a Price · Earn 50 XP
        </Button>
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          Find a product, then tap "I saw a different price" to earn XP
        </p>
      </div>
    </MobileShell>
  );
};

export default Rewards;
