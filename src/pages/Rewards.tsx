import { Trophy, Zap, Tag, TrendingUp, Award, Lock, Sparkles, Crown, Flame, Target, Star } from "lucide-react";
import MobileShell from "@/components/MobileShell";
import ScreenHeader from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";

const stats = [
  { label: "Total Saved", value: "R3,420", icon: TrendingUp, color: "text-secondary" },
  { label: "Deals Found", value: "47", icon: Tag, color: "text-primary" },
  { label: "Prices Submitted", value: "12", icon: Zap, color: "text-secondary" },
];

const badges = [
  { name: "First Find", Icon: Star, unlocked: true, color: "from-primary to-primary-glow" },
  { name: "Deal Hunter", Icon: Target, unlocked: true, color: "from-secondary to-secondary-glow" },
  { name: "Streak x7", Icon: Flame, unlocked: true, color: "from-primary to-secondary" },
  { name: "VIP Saver", Icon: Crown, unlocked: false, color: "" },
  { name: "Mall Master", Icon: Award, unlocked: false, color: "" },
  { name: "Legend", Icon: Sparkles, unlocked: false, color: "" },
];

const activity = [
  { text: "You saved R340 this week!", time: "2h ago", color: "text-secondary" },
  { text: "Unlocked: Deal Hunter badge", time: "Yesterday", color: "text-primary" },
  { text: "Submitted 3 prices at Sandton", time: "2d ago", color: "text-secondary" },
];

const Rewards = () => {
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
              4
            </span>
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Level 4</p>
            <p className="font-display text-xl font-bold">Smart Shopper 🏆</p>
          </div>
        </div>

        {/* XP bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-muted-foreground">2,340 / 3,000 XP</span>
            <span className="font-semibold text-primary">660 to Level 5</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary glow-primary"
              style={{ width: "78%" }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 mt-4 grid grid-cols-3 gap-2.5 animate-fade-in">
        {stats.map(({ label, value, icon: Icon, color }) => (
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
          <span className="text-xs text-muted-foreground">3 / 6 unlocked</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {badges.map((b) => (
            <div
              key={b.name}
              className={`flex flex-col items-center gap-2 rounded-2xl border p-3 ${
                b.unlocked
                  ? "border-border bg-surface/70"
                  : "border-dashed border-border bg-surface/30"
              }`}
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                  b.unlocked
                    ? `bg-gradient-to-br ${b.color} glow-primary`
                    : "bg-muted"
                }`}
              >
                {b.unlocked ? (
                  <b.Icon className="h-6 w-6 text-background" />
                ) : (
                  <Lock className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <p className={`text-[11px] font-medium text-center ${b.unlocked ? "" : "text-muted-foreground"}`}>
                {b.name}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Submit price */}
      <div className="px-5 mt-6">
        <Button variant="neon" size="lg" className="w-full">
          <Zap className="h-5 w-5" />
          Submit a Price · Earn 50 XP
        </Button>
      </div>

      {/* Activity */}
      <div className="px-5 mt-6">
        <h2 className="font-display font-bold text-base mb-3">Recent Activity</h2>
        <div className="space-y-2">
          {activity.map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-2xl border border-border bg-surface/60 backdrop-blur p-3.5"
            >
              <p className={`text-sm font-medium ${a.color}`}>{a.text}</p>
              <span className="text-[11px] text-muted-foreground">{a.time}</span>
            </div>
          ))}
        </div>
      </div>
    </MobileShell>
  );
};

export default Rewards;
