export const LEVEL_NAMES: Record<number, string> = {
  1: "Newcomer",
  2: "Scout",
  3: "Bargain Hunter",
  4: "Smart Shopper",
  5: "Mall Pro",
  6: "Legend",
};

// XP required to reach each level
const XP_THRESHOLDS = [0, 0, 500, 1500, 3000, 6000, 10000];

export function xpForLevel(level: number): number {
  return XP_THRESHOLDS[Math.min(level, XP_THRESHOLDS.length - 1)] ?? 10000;
}

export function xpProgress(xp: number, level: number): { current: number; required: number; pct: number } {
  const current = xp - xpForLevel(level);
  const required = xpForLevel(level + 1) - xpForLevel(level);
  const pct = required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100;
  return { current: Math.max(0, current), required: Math.max(1, required), pct };
}
