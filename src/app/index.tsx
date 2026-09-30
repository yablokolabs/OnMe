/**
 * Home: one way in, and the looks you have made.
 *
 * OnMe is a one-job app — two photos in, see the outfit on you — so the screen
 * leads with that job and keeps the history underneath it. There is exactly one
 * prominent control on this screen on purpose: everything else is the library.
 */

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LookRow } from '@/components/LookRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import { OnMeLogo, OnMeMark } from '@/components/OnMeMark';
import { Screen } from '@/components/Screen';
import { Palette, Radii, Spacing } from '@/constants/theme';
import { useLooks } from '@/hooks/use-looks';

export default function HomeScreen() {
  const router = useRouter();
  const { looks, person, loading, error } = useLooks();

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.topBar}>
        <OnMeLogo size="sm" />
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          testID="open-settings"
          style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
          <Text style={styles.topBarButtonLabel}>Settings</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <OnMeMark size="lg" />
        <Text style={styles.tagline}>See it on you.</Text>
        <Text style={styles.subtitle}>
          A full-body photo of you, and any outfit you love. OnMe shows you wearing it in seconds —
          still looking like you.
        </Text>
      </View>

      <PrimaryButton
        label="Try something on"
        onPress={() => router.push('/tryon')}
        testID="start-tryon"
      />

      <Text style={styles.promise}>
        {person
          ? 'Your photo is ready. Now you only need the outfit.'
          : 'You add your photo once. After that, just the outfit.'}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>YOUR LOOKS</Text>

        {error ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Storage problem</Text>
            <Text style={styles.cardBody}>{error}</Text>
          </View>
        ) : null}

        {!error && loading ? (
          <View style={styles.card}>
            <Text style={styles.cardBody}>Opening your looks…</Text>
          </View>
        ) : null}

        {!error && !loading && looks.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nothing tried on yet</Text>
            <Text style={styles.cardBody}>
              Pick a photo of yourself standing, and a photo of the outfit. OnMe puts the two
              together and keeps the picture here.
            </Text>
          </View>
        ) : null}

        {looks.length > 0 ? (
          <View style={styles.list}>
            {looks.map((look) => (
              <LookRow
                key={look.id}
                look={look}
                onPress={() => router.push({ pathname: '/look', params: { id: look.id } })}
              />
            ))}
          </View>
        ) : null}
      </View>

      <Text style={styles.privacy}>
        Your two photos are sent to the try-on model to make the picture, and OnMe keeps nothing on
        its server. Your photo and your looks stay on this phone until you delete them.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingTop: Spacing.two,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    backgroundColor: Palette.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
  },
  topBarButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.textSecondary,
  },
  pressed: {
    opacity: 0.8,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.four,
  },
  tagline: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: Palette.text,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  promise: {
    fontSize: 13,
    lineHeight: 18,
    color: Palette.textFaint,
    textAlign: 'center',
    marginTop: -Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.textFaint,
  },
  list: {
    gap: Spacing.two,
  },
  card: {
    backgroundColor: Palette.backgroundElement,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Palette.text,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textSecondary,
  },
  privacy: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textFaint,
    textAlign: 'center',
  },
});
