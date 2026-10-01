/**
 * OnMe Pro: the one thing this app sells, and the only screen that asks for money.
 *
 * It is written like the rest of OnMe — plain sentences, no countdown, no crossed
 * out price, no "limited time". The three things a person wants to know are on it:
 * what they have left, what Pro costs, and what Pro does not change (their photos
 * still do not leave the phone, and there is still no account).
 *
 * The price comes from the store, so this screen cannot invent one, and the free
 * count comes from the same place the try-on gate reads, so it cannot disagree
 * with the gate either.
 */

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { Palette, Radii, Spacing } from '@/constants/theme';
import { usePlan } from '@/hooks/use-plan';
import { FREE_TRY_ONS } from '@/services/allowance';

type Job = 'buy' | 'restore' | 'ad';

export default function PaywallScreen() {
  const router = useRouter();
  const { loading, configured, pro, remaining, offering, goPro, restore, watchAd } = usePlan();
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const price = offering?.product.priceString ?? null;

  // `goPro` presents RevenueCat's own paywall and only falls back to this app's
  // purchase when there is no paywall to present, so the button means one thing
  // whichever of the two answers came back.
  const onBuy = useCallback(() => {
    void (async () => {
      setJob('buy');
      setMessage(null);
      setFailed(false);
      try {
        const result = await goPro();
        if (result.ok && result.pro) {
          setMessage('Pro is on. Thank you — try on as many things as you like.');
        } else if (result.ok) {
          setMessage('The store finished that, but Pro is not active yet. Try "Restore" in a moment.');
        } else if (result.message) {
          setFailed(true);
          setMessage(result.message);
        }
      } finally {
        setJob(null);
      }
    })();
  }, [goPro]);

  const onRestore = useCallback(() => {
    void (async () => {
      setJob('restore');
      setMessage(null);
      setFailed(false);
      try {
        const result = await restore();
        if (result.pro) {
          setMessage('Pro restored on this phone.');
        } else if (result.ok) {
          setMessage('No purchase was found for the account this phone is signed in to.');
        } else if (result.message) {
          setFailed(true);
          setMessage(result.message);
        }
      } finally {
        setJob(null);
      }
    })();
  }, [restore]);

  const onWatchAd = useCallback(() => {
    void (async () => {
      setJob('ad');
      setMessage(null);
      setFailed(false);
      try {
        const outcome = await watchAd();
        if (outcome.earned) {
          setMessage('One more picture — the video did its job.');
        } else if (outcome.message) {
          setFailed(true);
          setMessage(outcome.message);
        }
      } finally {
        setJob(null);
      }
    })();
  }, [watchAd]);

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
        <Text style={styles.eyebrow}>ONME PRO</Text>
        <Text style={styles.title}>{pro ? 'Pro is on.' : 'No more counting.'}</Text>
        <Text style={styles.subtitle}>
          OnMe makes {FREE_TRY_ONS} pictures for nothing. Pro takes the count away — nothing else
          about the app changes.
        </Text>
      </View>

      <Section
        title="What Pro is"
        hint="Unlimited try-ons. Your photos still go to the model and nowhere else, and there is still no account to make."
        tone={pro ? 'accent' : 'plain'}>
        <Text style={styles.body}>
          {pro
            ? 'Every try-on is open to you. Thank you for paying for it.'
            : `${remaining === 1 ? 'One picture' : `${remaining} pictures`} left of your free ${FREE_TRY_ONS}.`}
        </Text>
      </Section>

      {!pro ? (
        <Section title="OnMe Pro" hint="Billed by the app store, monthly, cancel any time there.">
          <PrimaryButton
            label={price ? `Subscribe — ${price}` : loading ? 'Loading…' : 'Subscribe'}
            onPress={onBuy}
            disabled={!configured || job !== null || loading}
            loading={job === 'buy'}
            hint={configured ? undefined : 'This build has no store connected.'}
            testID="subscribe"
          />
          <PrimaryButton
            label="Restore a purchase"
            variant="secondary"
            onPress={onRestore}
            disabled={!configured || job !== null}
            loading={job === 'restore'}
            testID="restore"
          />
        </Section>
      ) : null}

      {!pro && remaining === 0 && configured ? (
        <Section
          title="Or don't pay"
          hint="A short video buys one more picture. Nothing plays unless you ask for it."
          tone="warning">
          <PrimaryButton
            label="Watch a video for one more picture"
            variant="secondary"
            onPress={onWatchAd}
            disabled={job !== null}
            loading={job === 'ad'}
            testID="watch-ad"
          />
        </Section>
      ) : null}

      {message ? (
        <View style={[styles.message, failed && styles.messageFailed]}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      ) : null}

      <Text style={styles.finePrint}>
        {configured
          ? "The receipt belongs to the store account this phone is signed in to, so a purchase can be restored on another phone. OnMe never sees a card."
          : 'OnMe Pro is not switched on in this build, so everything free is the whole app for now.'}
      </Text>
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
  message: {
    backgroundColor: Palette.backgroundElement,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.success,
    padding: Spacing.three,
  },
  messageFailed: {
    borderColor: Palette.danger,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.text,
  },
  finePrint: {
    fontSize: 12,
    lineHeight: 18,
    color: Palette.textFaint,
  },
});
