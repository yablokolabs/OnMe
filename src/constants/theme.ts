/**
 * OnMe design tokens.
 *
 * OnMe is a dark, quiet surface: near-black, warm ivory text, and a single
 * champagne accent that stands for the garment rather than for "AI". The palette
 * is deliberately not a tech blue or a violet — this app is meant to read like
 * the mirror in a fitting room, not like a generator.
 *
 * Both colour schemes resolve to the same palette so the app stays on-brand on
 * every device (`app.json` pins the dark appearance).
 */

export const Palette = {
  background: '#0B0A0F',
  backgroundElevated: '#131118',
  backgroundElement: '#191720',
  backgroundSelected: '#242130',
  border: '#282433',
  borderStrong: '#3A3545',

  text: '#F4F1EC',
  textSecondary: '#A9A2B4',
  textFaint: '#6E6878',

  /** Champagne: the accent is the outfit, never the software. */
  accent: '#D8C4A2',
  accentStrong: '#C9B08A',
  accentSoft: '#EADFCB',
  accentWash: '#1F1B16',
  onAccent: '#141118',

  success: '#7FBF9A',
  warning: '#DDB36A',
  danger: '#E08A8A',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target on Android. */
export const TouchTarget = 48;

export const MaxContentWidth = 800;

/** A portrait frame, the shape a full-body photo and a try-on both arrive in. */
export const PortraitRatio = 3 / 4;
