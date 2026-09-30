/**
 * Settings: what OnMe holds, and how to get rid of it.
 *
 * There are no preferences here because there is nothing to configure — no
 * account, no prompts, no quality dial. What is left is the only thing a user
 * actually needs from this screen: a plain account of what is stored on the
 * device, and a way to delete each part of it.
 */

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { Palette, Radii, Spacing } from '@/constants/theme';
import { useLooks } from '@/hooks/use-looks';

/**
 * What actually happens to the photos, in full.
 *
 * Held as a constant rather than inline so the sentence can be read as a
 * sentence, and so there is one place to correct if the backend's behaviour ever
 * changes.
 */
const PRIVACY_NOTE =
  "When you try something on, the two photos are sent to OnMe's backend and on to the try-on " +
  'model so the picture can be made. Nothing is written to disk on the server: the photos are ' +
  'held for the length of one request and then dropped. The generated picture is downloaded to ' +
  'this phone, which is why your looks keep working with no connection.';

export default function SettingsScreen() {
  const router = useRouter();
  const { looks, person, forgetPerson, clearAll, removeEverything } = useLooks();
  const [busy, setBusy] = useState(false);

  const confirmForgetPerson = useCallback(() => {
    Alert.alert(
      'Delete the photo of you?',
      'OnMe stops keeping it, so the next try-on asks for a photo of you again. Looks you have already made keep the picture they were made from.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await forgetPerson();
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  }, [forgetPerson]);

  const confirmClearLooks = useCallback(() => {
    Alert.alert(
      'Delete every look?',
      `${looks.length === 1 ? 'One look' : `${looks.length} looks`} and the outfit photos they used are removed from this phone. Your photo is kept.`,
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await clearAll();
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  }, [clearAll, looks.length]);

  const confirmEverything = useCallback(() => {
    Alert.alert(
      'Delete everything?',
      'Your photo, every look, every outfit photo and the whole library are removed from this phone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await removeEverything();
                router.replace('/');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  }, [removeEverything, router]);

  return (
    <Screen
      scroll
      header={
        <View style={styles.header}>
          <Pressable
            onPress={() => router.replace('/')}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backLabel}>‹ Home</Text>
          </Pressable>
        </View>
      }
      contentStyle={styles.content}>
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>What OnMe holds</Text>
        <Text style={styles.subtitle}>
          Everything OnMe keeps is on this phone. There is no account and nothing in the cloud.
        </Text>
      </View>

      <Section
        title="The photo of you"
        hint={
          person
            ? 'Kept so a try-on only needs the outfit. It never leaves this phone except to make a picture.'
            : 'OnMe is not keeping a photo of you. The next try-on will ask for one.'
        }
        tone={person ? 'accent' : 'plain'}>
        {person ? (
          <PrimaryButton
            label="Delete my photo"
            variant="secondary"
            onPress={confirmForgetPerson}
            disabled={busy}
            testID="delete-person"
          />
        ) : (
          <Text style={styles.body}>
            You can add one from the try-on screen whenever you want to.
          </Text>
        )}
      </Section>

      <Section
        title="Your looks"
        hint={
          looks.length === 0
            ? 'Nothing tried on yet.'
            : `${looks.length === 1 ? 'One look' : `${looks.length} looks`} on this phone, with the outfit photo each one used.`
        }>
        {looks.length > 0 ? (
          <PrimaryButton
            label="Delete all looks"
            variant="secondary"
            onPress={confirmClearLooks}
            disabled={busy}
            testID="delete-looks"
          />
        ) : (
          <Text style={styles.body}>Try something on and it will appear here.</Text>
        )}
      </Section>

      <Section
        title="Everything"
        hint="The library, your photo, and every picture OnMe has made or stored."
        tone="warning">
        <PrimaryButton
          label="Delete everything"
          variant="destructive"
          onPress={confirmEverything}
          disabled={busy}
          testID="delete-everything"
        />
      </Section>

      <Text style={styles.privacy}>{PRIVACY_NOTE}</Text>
    </Screen>
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
  titleBlock: {
    gap: Spacing.one,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: Palette.textFaint,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: Palette.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: Palette.textSecondary,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textSecondary,
  },
  privacy: {
    fontSize: 12,
    lineHeight: 18,
    color: Palette.textFaint,
    backgroundColor: Palette.backgroundElement,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
    padding: Spacing.three,
  },
});
