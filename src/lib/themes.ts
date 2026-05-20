/**
 * MallMind Theme Definitions
 *
 * Defines the 6 visual themes available (or planned) for the shopper-facing app.
 * Only "midnight_neon" is active in Sprint 10A. The other five are previewed
 * in the theme selector UI and listed as "Coming Soon".
 *
 * Colours are expressed as plain CSS hex strings for use in preview swatches.
 * They do NOT drive the CSS variable system — that remains index.css.
 */

export interface ThemeColors {
  /** Page background */
  background: string;
  /** Primary accent (buttons, highlights) */
  primary: string;
  /** Secondary accent (specials, XP, progress) */
  secondary: string;
  /** Card / surface */
  surface: string;
  /** Main body text */
  foreground: string;
}

export interface ThemeFonts {
  display: string;
  body: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  /** One-sentence description shown in the theme picker */
  description: string;
  /** Short label shown as a chip on the card */
  tag: "Active" | "Premium" | "Coming Soon" | "Free";
  colors: ThemeColors;
  fonts: ThemeFonts;
  /** True if the theme requires a paid subscription tier */
  premium: boolean;
  /** False while the theme is not yet implemented */
  available: boolean;
}

export const THEMES: ThemeDefinition[] = [
  // ── 1. Midnight Neon — current active theme ───────────────────────────────
  {
    id: "midnight_neon",
    name: "Midnight Neon",
    description: "Electric cyan on deep midnight — the signature MallMind experience.",
    tag: "Active",
    colors: {
      background: "#060a12",
      primary:    "#00e5ff",
      secondary:  "#39ff14",
      surface:    "#0d1420",
      foreground: "#e8f4ff",
    },
    fonts: { display: "Space Grotesk", body: "Inter" },
    premium: false,
    available: true,
  },

  // ── 2. Luxury Gold ────────────────────────────────────────────────────────
  {
    id: "luxury_gold",
    name: "Luxury Gold",
    description: "Warm amber and burnished gold on obsidian — crafted for premium retail.",
    tag: "Coming Soon",
    colors: {
      background: "#0a0803",
      primary:    "#f5c842",
      secondary:  "#ff9f1c",
      surface:    "#141006",
      foreground: "#fdf0cc",
    },
    fonts: { display: "Playfair Display", body: "Inter" },
    premium: true,
    available: false,
  },

  // ── 3. Rose Quartz ────────────────────────────────────────────────────────
  {
    id: "rose_quartz",
    name: "Rose Quartz",
    description: "Soft blush and rose on dark charcoal — elegant and modern.",
    tag: "Coming Soon",
    colors: {
      background: "#0d090a",
      primary:    "#ff6b9d",
      secondary:  "#ffb3c8",
      surface:    "#160e10",
      foreground: "#fde8ee",
    },
    fonts: { display: "Space Grotesk", body: "Inter" },
    premium: true,
    available: false,
  },

  // ── 4. Gamer Neon ─────────────────────────────────────────────────────────
  {
    id: "gamer_neon",
    name: "Gamer Neon",
    description: "Vivid purple and hot pink on void black — bold and high-energy.",
    tag: "Coming Soon",
    colors: {
      background: "#050009",
      primary:    "#bf00ff",
      secondary:  "#ff0090",
      surface:    "#0d0012",
      foreground: "#f5e8ff",
    },
    fonts: { display: "Space Grotesk", body: "Inter" },
    premium: true,
    available: false,
  },

  // ── 5. Executive Navy ─────────────────────────────────────────────────────
  {
    id: "executive_navy",
    name: "Executive Navy",
    description: "Cool steel blue on deep navy — professional, focused, and trusted.",
    tag: "Coming Soon",
    colors: {
      background: "#03060f",
      primary:    "#4f9cf9",
      secondary:  "#38bdf8",
      surface:    "#07101f",
      foreground: "#dbeafe",
    },
    fonts: { display: "Space Grotesk", body: "Inter" },
    premium: false,
    available: false,
  },

  // ── 6. Minimal Light ─────────────────────────────────────────────────────
  {
    id: "minimal_light",
    name: "Minimal Light",
    description: "Clean white and soft grey — familiar, accessible, and distraction-free.",
    tag: "Coming Soon",
    colors: {
      background: "#fafafa",
      primary:    "#0ea5e9",
      secondary:  "#22c55e",
      surface:    "#f1f5f9",
      foreground: "#0f172a",
    },
    fonts: { display: "Space Grotesk", body: "Inter" },
    premium: false,
    available: false,
  },
];

/** The ID of the currently active/rendered theme */
export const ACTIVE_THEME_ID = "midnight_neon";

/** Convenience: get a single theme by id, or the active theme as fallback */
export function getTheme(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** All themes available without a paid subscription */
export const FREE_THEMES = THEMES.filter((t) => !t.premium);

/** All themes that require a paid plan */
export const PREMIUM_THEMES = THEMES.filter((t) => t.premium);
