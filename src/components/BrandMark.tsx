/**
 * The OnMe logo, straight from the brand file.
 *
 * Nothing in the app draws its own mark any more. `onme-logo-tile-384.png` is the
 * real logo with its white margin cropped away and its corners made transparent,
 * so it can sit on the app's dark indigo background without a white box around it.
 * `npm run icons` derives that tile — and the launcher icon, the splash and the
 * favicon — from `assets/brand/onme-logo.png`, so the header and the home-screen
 * icon can never be two different pictures.
 */

import { Image } from 'expo-image';

export type MarkSize = 'sm' | 'md' | 'lg';

/** `lg` is the home-screen hero; `sm` is the header. */
const SIZES: Record<MarkSize, number> = { sm: 32, md: 44, lg: 148 };

export function BrandMark({ size = 'md' }: { size?: MarkSize }) {
  return (
    <Image
      source={require('../../assets/brand/onme-logo-tile-384.png')}
      style={{ width: SIZES[size], height: SIZES[size] }}
      contentFit="contain"
      accessibilityRole="image"
      accessibilityLabel="OnMe"
    />
  );
}
