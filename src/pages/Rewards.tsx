import { useEffect, useState } from "react";
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
import { getUserAchievements, type UserAchievement } from "@/lib/achievements";

// Must stay in sync with ACHIEVEMENT_DEFS in achievements.ts
const BADGES = [
  { id: "first-find",  name: "First Find",  Icon: Star,     xpRequired: 0,    color: "from-primary to-primary-glow",      desc: "Start your MallMind journey" },
  { id: "deal-hunter", name: "Deal Hunter", Icon: Target,   xpRequired: 100,  color: "from-secondary to-secondary-glow",  desc: "Reach 100 XP" },
  { id: "streak-x7",   name: "Streak x7",   Icon: Flame,    xpRequired: 300,  color: "from-primary to-secondary",         desc: "Reach 300 XP" },
  { id: "vip-saver",   name: "VIP Saver",   Icon: Crown,    xpRequired: 1000, color: "from-secondary to-primary-glow",    desc: "Reach 1,000 XP" },
  { id: "mall-master", name: "Mall Master", Icon: Award,    xpRequired: 3000, color: "from-primary to-secondary",         desc: "Reach 3,000 XP" },
  { id: "legend",      name: "Legend",      Icon: Sparkles, xpRequired: 6000, color: "from-secondary to-primary",         desc: "Top 1% of SA shoppers" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

const Rewards = () => {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [earnedMap, setEarnedMap] = useState<Record<string, string>>({}); // achievement_id → earned_at
  const [achLoading, setAchLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setAchLoading(true);
    getUserAchievements(user.id)
      .then((rows: UserAchievement[]) => {
        const map: Record<string, string> = {};
        rows.forEach((r) => { map[r.achievement_id] = r.earned_at; });
        setEarnedMap(map);
      })
      .finally(() => setAchLoading(false));
  }, [user]);

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
  const unlockedCount = BADGES.filter((b) => earnedMap[b.id]).length;

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
          { label: "XP Earned",  value: xp.toLocaleString(),             icon: TrendingUp, color: "text-secondary" },
          { label: "Level",      value: String(level),                    icon: Tag,        color: "text-primary"   },
          { label: "Badges",     value: `${unlockedCount}/${BADGES.length}`, icon: Zap,    color: "text-secondary" },
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
          <span className="text-xs text-muted-foreground">
            {achLoading ? "…" : `${unlockedCount} / ${BADGES.length} unlocked`}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {BADGES.map((b) => {
            const earnedAt = earnedMap[b.id];
            // Fallback: also unlock visually if XP threshold is met (handles migration period)
            const unlocked = !!earnedAt || xp >= b.xpRequired;
            const isRecent = earnedAt
              ? Date.now() - new Date(earnedAt).getTime() < 24 * 60 * 60 * 1000
              : false;

            return (
              <div
                key={b.id}
                className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all ${
                  unlocked
                    ? isRecent
                      ? "border-secondary/60 bg-secondary/10 animate-pulse"
                      : "border-border bg-surface/70"
                    : "border-dashed border-border bg-surface/30"
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

                <p className={`text-[11px] font-medium text-center leading-tight ${unlocked ? "" : "text-muted-foreground"}`}>
                  {b.name}
                </p>

                {unlocked && earnedAt ? (
                  <p className="text-[9px] text-muted-foreground/70 text-center">
                    {formatDate(earnedAt)}
                  </p>
                ) : !unlocked ? (
                  <p className="text-[9px] text-muted-foreground/60">{b.xpRequired.toLocaleString()} XP</p>
                ) : (
                  <p className="text-[9px] text-secondary/70">{b.desc}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* How to earn XP */}
      <div className="px-5 mt-6">
        <h2 className="font-display font-bold text-base mb-3">How to Earn XP</h2>
        <div className="space-y-2">
          {[
            { action: "Submit a price correction",  xp: 50, icon: Zap,     color: "text-secondary" },
            { action: "Complete a shopping route",  xp: 30, icon: Trophy,  color: "text-primary"   },
            { action: "Start a new session",        xp: 20, icon: Sparkles, color: "text-secondary" },
          ].map(({ action, xp: pts, icon: Icon, color }) => (
            <div key={action} className="flex items-center justify-between rounded-xl border border-border bg-surface/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="text-sm">{action}</span>
              </div>
              <span className={`text-sm font-bold ${color}`}>+{pts} XP</span>
            </div>
          ))}
        </div>
      </div>

      {/* Submit price CTA */}
      <div className="px-5 mt-6 mb-6">
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
