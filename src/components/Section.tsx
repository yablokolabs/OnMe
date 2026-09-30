import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette, Radii, Spacing } from '@/constants/theme';

export interface SectionProps {
  /** Small caps label above the content. */
  title: string;
  /** Optional line under the title, for what the section is showing. */
  hint?: string;
  /** Highlights the card when it is the point of the screen. */
  tone?: 'plain' | 'accent' | 'warning';
  children: ReactNode;
}

/** A titled card. Every screen's sections are built from this one shape. */
export function Section({ title, hint, tone = 'plain', children }: SectionProps) {
  return (
    <View
      style={[
        styles.card,
        tone === 'accent' && styles.accentCard,
        tone === 'warning' && styles.warningCard,
      ]}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Palette.backgroundElement,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  accentCard: {
    backgroundColor: Palette.accentWash,
    borderColor: Palette.borderStrong,
  },
  warningCard: {
    borderColor: Palette.warning,
  },
  title: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.textFaint,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textFaint,
  },
});
