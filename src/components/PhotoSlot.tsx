import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, PortraitRatio, Radii, Spacing } from '@/constants/theme';

export interface PhotoSlotProps {
  /** Small caps label, e.g. "YOU". */
  label: string;
  /** One line explaining what to pick. */
  hint: string;
  /** The chosen photo, if there is one. */
  uri: string | null;
  onPress: () => void;
  busy?: boolean;
  testID?: string;
}

/**
 * One of the two photos a try-on needs.
 *
 * The whole tile is the target: there is no separate "add" button, because the
 * empty slot *is* the invitation and a second control would only be a second
 * thing to read. Filled, the same tap replaces the photo.
 */
export function PhotoSlot({ label, hint, uri, onPress, busy = false, testID }: PhotoSlotProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={uri ? `${label}: change photo` : `${label}: ${hint}`}
      style={({ pressed }) => [styles.slot, pressed && !busy && styles.pressed]}>
      {uri ? (
        <>
          <Image source={{ uri }} style={styles.image} contentFit="cover" transition={180} />
          <View style={styles.changeChip}>
            <Text style={styles.changeLabel}>Change</Text>
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          {busy ? (
            <ActivityIndicator color={Palette.accent} />
          ) : (
            <View style={styles.plus}>
              <Text style={styles.plusGlyph}>+</Text>
            </View>
          )}
          <Text style={styles.label}>{label.toUpperCase()}</Text>
          <Text style={styles.hint}>{hint}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
    aspectRatio: PortraitRatio,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    backgroundColor: Palette.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
  },
  pressed: {
    opacity: 0.85,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  empty: {
    flex: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Palette.borderStrong,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  plus: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.accentWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.borderStrong,
    marginBottom: Spacing.one,
  },
  plusGlyph: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '500',
    color: Palette.accent,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.textFaint,
  },
  hint: {
    fontSize: 12,
    lineHeight: 16,
    color: Palette.textFaint,
    textAlign: 'center',
  },
  changeChip: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    // The screen background at 72%, so the chip reads over any photo. Kept in
    // step with `Palette.background` by hand: React Native cannot mix a token.
    backgroundColor: 'rgba(11,6,32,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.borderStrong,
  },
  changeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.accentSoft,
  },
});
