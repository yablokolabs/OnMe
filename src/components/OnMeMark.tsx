/**
 * The OnMe mark: a frame with you in it.
 *
 * Drawn with views rather than shipped as an image, so it stays crisp at every
 * size, needs no asset in the bundle, and cannot drift out of step with the
 * palette.
 */

import { StyleSheet, Text, View } from 'react-native';

import { Palette, Spacing } from '@/constants/theme';

export type MarkSize = 'sm' | 'md' | 'lg';

const SIZES: Record<MarkSize, { box: number; border: number; dot: number }> = {
  sm: { box: 26, border: 2, dot: 9 },
  md: { box: 44, border: 2.5, dot: 16 },
  lg: { box: 76, border: 3, dot: 27 },
};

export function OnMeMark({ size = 'md' }: { size?: MarkSize }) {
  const metrics = SIZES[size];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.frame,
        {
          width: metrics.box,
          height: metrics.box,
          borderRadius: metrics.box * 0.32,
          borderWidth: metrics.border,
        },
      ]}>
      <View
        style={{
          width: metrics.dot,
          height: metrics.dot,
          borderRadius: metrics.dot / 2,
          backgroundColor: Palette.accent,
        }}
      />
    </View>
  );
}

/**
 * The wordmark. "Me" carries the accent, because that is the whole idea: the
 * outfit is shown on you, not on a model.
 */
export function OnMeLogo({ size = 'md' }: { size?: MarkSize }) {
  const fontSize = size === 'lg' ? 30 : size === 'md' ? 22 : 17;

  return (
    <View style={styles.logoRow}>
      <OnMeMark size={size === 'lg' ? 'md' : 'sm'} />
      <Text
        accessibilityRole="header"
        accessibilityLabel="OnMe"
        style={[styles.wordmark, { fontSize }]}>
        <Text style={styles.wordmarkLead}>On</Text>
        <Text style={styles.wordmarkAccent}>Me</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderColor: Palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.accentWash,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  wordmark: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  wordmarkLead: {
    color: Palette.text,
  },
  wordmarkAccent: {
    color: Palette.accent,
  },
});
