/**
 * The result: the picture, and almost nothing else.
 *
 * The generated image is the answer to the question the user opened the app with,
 * so it gets the screen. Under it are the two photos it came from, then exactly
 * one prominent action — because the most likely next thing anyone wants to do
 * with a try-on is try another outfit on.
 */

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Palette, PortraitRatio, Radii, Spacing } from '@/constants/theme';
import { useLooks } from '@/hooks/use-looks';
import { shareImage } from '@/services/sharing';
import { formatMoment } from '@/utils/format';

export default function LookScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { find, remove, loading } = useLooks();
  const [sharing, setSharing] = useState(false);

  const id = typeof params.id === 'string' ? params.id : '';
  const look = id === '' ? undefined : find(id);

  const share = useCallback(async () => {
    if (!look) return;
    setSharing(true);
    try {
      await shareImage(look.result.uri, look.result.mimeType);
    } finally {
      setSharing(false);
    }
  }, [look]);

  const confirmDelete = useCallback(() => {
    if (!look || !id) return;
    Alert.alert(
      'Delete this look?',
      'The picture OnMe made and the outfit photo it used are removed from this phone. The photo of you stays, so you can try something else.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await remove(id);
              router.replace('/');
            })();
          },
        },
      ]
    );
  }, [id, look, remove, router]);

  return (
    <Screen scroll header={<Header onBack={() => router.replace('/')} />} contentStyle={styles.content}>
      {!look ? (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>
            {loading ? 'Opening your look…' : 'That look is gone'}
          </Text>
          {loading ? null : (
            <Text style={styles.missingBody}>
              It was deleted from this phone. The rest of your looks are still here.
            </Text>
          )}
          {loading ? null : (
            <PrimaryButton label="Back home" onPress={() => router.replace('/')} />
          )}
        </View>
      ) : (
        <>
          <Image
            source={{ uri: look.result.uri }}
            style={[
              styles.result,
              {
                aspectRatio:
                  look.result.width > 0 && look.result.height > 0
                    ? look.result.width / look.result.height
                    : PortraitRatio,
              },
            ]}
            contentFit="cover"
            transition={200}
            testID="look-image"
          />

          <View style={styles.caption}>
            <Text style={styles.captionTitle}>{"That's you wearing it."}</Text>
            <Text style={styles.captionBody}>
              {formatMoment(look.createdAt)}
              {look.preservePose ? ' · your pose kept' : ''}
            </Text>
          </View>

          <PrimaryButton
            label="Try another outfit"
            onPress={() => router.push('/tryon')}
            testID="try-another"
          />

          <View style={styles.secondaryRow}>
            <PrimaryButton
              label={sharing ? 'Opening…' : 'Share'}
              variant="secondary"
              onPress={() => void share()}
              loading={sharing}
              style={styles.secondaryButton}
              testID="share-look"
            />
            <PrimaryButton
              label="Delete"
              variant="secondary"
              onPress={confirmDelete}
              style={styles.secondaryButton}
              testID="delete-look"
            />
          </View>

          {look.person || look.outfit ? (
            <View style={styles.sources}>
              <Text style={styles.sourcesLabel}>MADE FROM</Text>
              <View style={styles.sourcesRow}>
                {look.person ? (
                  <View style={styles.source}>
                    <Image source={{ uri: look.person.uri }} style={styles.sourceImage} contentFit="cover" />
                    <Text style={styles.sourceLabel}>You</Text>
                  </View>
                ) : null}
                {look.outfit ? (
                  <View style={styles.source}>
                    <Image source={{ uri: look.outfit.uri }} style={styles.sourceImage} contentFit="cover" />
                    <Text style={styles.sourceLabel}>The outfit</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to home"
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <Text style={styles.backLabel}>‹ Home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingRight: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  backLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Palette.accentSoft,
  },
  content: {
    gap: Spacing.three,
  },
  result: {
    width: '100%',
    borderRadius: Radii.xl,
    backgroundColor: Palette.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
  },
  caption: {
    gap: Spacing.half,
  },
  captionTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: Palette.text,
    letterSpacing: -0.2,
  },
  captionBody: {
    fontSize: 13,
    color: Palette.textFaint,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  secondaryButton: {
    flex: 1,
  },
  sources: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  sourcesLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: Palette.textFaint,
  },
  sourcesRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  source: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  sourceImage: {
    width: 58,
    height: 76,
    borderRadius: Radii.sm,
    backgroundColor: Palette.backgroundSelected,
  },
  sourceLabel: {
    fontSize: 11,
    color: Palette.textFaint,
  },
  missing: {
    gap: Spacing.two,
    paddingTop: Spacing.five,
  },
  missingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Palette.text,
  },
  missingBody: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textSecondary,
  },
});
