import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radii, Spacing } from '@/constants/theme';
import type { Look } from '@/types/onme';
import { formatMoment } from '@/utils/format';

export interface LookRowProps {
  look: Look;
  onPress: () => void;
}

/** One line of history: the picture, and when it was made. Nothing else. */
export function LookRow({ look, onPress }: LookRowProps) {
  const when = formatMoment(look.createdAt);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={when ? `Look from ${when}` : 'Look'}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Image
        source={{ uri: look.result.uri }}
        style={styles.thumbnail}
        contentFit="cover"
        transition={120}
      />
      <View style={styles.text}>
        <Text style={styles.when}>{when || 'An earlier look'}</Text>
        <Text style={styles.detail}>
          {look.preservePose ? 'Your pose kept' : 'Made with the pose changed'}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    paddingRight: Spacing.three,
    borderRadius: Radii.lg,
    backgroundColor: Palette.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
  },
  pressed: {
    opacity: 0.85,
  },
  thumbnail: {
    width: 54,
    height: 70,
    borderRadius: Radii.sm,
    backgroundColor: Palette.backgroundSelected,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  when: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.text,
  },
  detail: {
    fontSize: 12,
    color: Palette.textFaint,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 26,
    color: Palette.textFaint,
  },
});
