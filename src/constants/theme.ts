/**
 * OnMe design tokens.
 *
 * OnMe is a dark, quiet surface: the logo's deep indigo taken down to near-black,
 * light lilac text, and a single magenta accent that stands for the outfit rather
 * than for "AI". Every colour here is sampled from `assets/brand/onme-logo.png`,
 * so the app is the logo's palette rather than a guess at it:
 *
 *   accent      the logo's magenta, measured at #D04198 and lifted to #E860B0 so
 *               it reads as a button on a near-black surface
 *   background  the logo's deepest indigo (#160F38), taken further down so the
 *               surface stays quiet and only the garment has colour
 *
 * The palette is deliberately not a tech blue and not a neutral grey — this app is
 * meant to read like the mirror in a fitting room.
 *
 * Both colour schemes resolve to the same palette so the app stays on-brand on
 * every device (`app.json` pins the dark appearance).
 */

export const Palette = {
  background: '#0B0620',
  backgroundElevated: '#160D3A',
  backgroundElement: '#1D1149',
  backgroundSelected: '#2A1A66',
  border: '#2E1E60',
  borderStrong: '#4A3391',

  text: '#F6F1FF',
  textSecondary: '#B3A4DC',
  textFaint: '#8E7CC4',

  /** Magenta: the accent is the outfit, never the software. */
  accent: '#E860B0',
  accentStrong: '#F584C6',
  accentSoft: '#F7BBDD',
  accentWash: '#251247',
  onAccent: '#190C2E',

  success: '#7FE0B4',
  warning: '#EDBE72',
  danger: '#F08395',
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
