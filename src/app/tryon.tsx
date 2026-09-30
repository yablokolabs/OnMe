/**
 * The whole flow, on one screen.
 *
 * Two photo slots and one button, because the user is doing one job. There is no
 * prompt box, no body slider, no style picker and no crop step: every one of
 * those is a question the product would have to ask, and none of them is the
 * question the user actually has, which is only ever "how would this look on me".
 *
 * The photo of you is remembered after the first try-on, so from then on the
 * screen is one photo and one tap.
 */

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { PhotoSlot } from '@/components/PhotoSlot';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Palette, Radii, Spacing } from '@/constants/theme';
import { useLooks } from '@/hooks/use-looks';
import {
  pickPhoto,
  readPhotoBase64,
  storeGeneratedImage,
  storeOutfitPhoto,
  storePersonPhoto,
  type PickedPhoto,
} from '@/services/photos';
import { requestTryOn, type TryOnStage } from '@/services/tryOn';
import { describePhotoProblem } from '@/services/tryOnPayload';
import type { Look, TryOnDraft } from '@/types/onme';
import { createId } from '@/utils/ids';

/** The transport's stages, plus the local step of bringing the picture home. */
type ScreenStage = TryOnStage | { phase: 'saving' };
type Role = 'person' | 'outfit';

/**
 * The line under the button, always on screen while choosing.
 *
 * OnMe asks for no acknowledgement here, because the user is the subject of
 * these photos and a checkbox in front of someone's own picture is theatre. What
 * it does instead is say plainly where they go.
 */
const PHOTO_NOTICE =
  'Your two photos are sent to the try-on model to make the picture. OnMe keeps nothing on its server.';

export default function TryOnScreen() {
  const router = useRouter();
  const { person: savedPerson, remember, add } = useLooks();

  const [personPicked, setPersonPicked] = useState<PickedPhoto | null>(null);
  const [outfitPicked, setOutfitPicked] = useState<PickedPhoto | null>(null);
  const [picking, setPicking] = useState<Role | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stage, setStage] = useState<ScreenStage | null>(null);

  const personPreview = personPicked?.uri ?? savedPerson?.uri ?? null;
  const outfitPreview = outfitPicked?.uri ?? null;
  const busy = stage !== null;
  const ready = Boolean(outfitPicked) && Boolean(personPicked ?? savedPerson);

  const choose = useCallback(
    async (role: Role) => {
      setProblem(null);
      setFailure(null);
      setPicking(role);

      try {
        const picked = await pickPhoto();
        if (!picked) return;

        // Checked here rather than after a round trip, so an oversized photo is a
        // sentence instead of a failed request.
        const issue = describePhotoProblem(picked.input);
        if (issue) {
          setProblem(issue);
          return;
        }

        if (role === 'person') setPersonPicked(picked);
        else setOutfitPicked(picked);
      } catch (error) {
        setProblem(
          error instanceof Error && error.message
            ? error.message
            : 'OnMe could not open your photos. Try again.'
        );
      } finally {
        setPicking(null);
      }
    },
    []
  );

  const seeItOn = useCallback(async () => {
    if (busy || !outfitPicked) return;

    setProblem(null);
    setFailure(null);
    setStage({ phase: 'sending', ratio: null });

    try {
      // The photo of you may already be on the device, so it is read back rather
      // than asked for again.
      const personBase64 = personPicked
        ? personPicked.input.base64
        : savedPerson
          ? await readPhotoBase64(savedPerson)
          : '';

      if (personBase64 === '') {
        setFailure('OnMe lost the photo of you. Add it again.');
        setStage(null);
        return;
      }

      const draft: TryOnDraft = {
        person: { base64: personBase64, mimeType: 'image/jpeg' },
        outfit: { base64: outfitPicked.input.base64, mimeType: outfitPicked.input.mimeType },
        consentAt: new Date().toISOString(),
      };

      const outcome = await requestTryOn(draft, { onStage: setStage });
      if (!outcome.ok) {
        setFailure(outcome.error);
        setStage(null);
        return;
      }

      setStage({ phase: 'saving' });

      const lookId = createId('look');
      const personImage = personPicked
        ? storePersonPhoto(personPicked, lookId)
        : savedPerson;
      if (!personImage) {
        setFailure('OnMe lost the photo of you. Add it again.');
        setStage(null);
        return;
      }
      if (personPicked) await remember(personImage);

      const outfitImage = storeOutfitPhoto(lookId, outfitPicked);
      const resultImage = await storeGeneratedImage(
        lookId,
        outcome.look.imageUrl,
        outcome.look.contentType,
        outcome.look.width,
        outcome.look.height
      );

      const look: Look = {
        id: lookId,
        createdAt: new Date().toISOString(),
        person: personImage,
        outfit: outfitImage,
        result: resultImage,
        model: outcome.look.model,
        preservePose: outcome.look.preservePose,
      };

      await add(look);
      // `replace`: "back" from the result belongs at home, not at the picker.
      router.replace({ pathname: '/look', params: { id: look.id } });
    } catch (error) {
      setFailure(
        error instanceof Error && error.message
          ? error.message
          : 'OnMe could not finish that try-on. Try again.'
      );
    } finally {
      setStage(null);
    }
  }, [add, busy, outfitPicked, personPicked, remember, router, savedPerson]);

  return (
    <Screen
      scroll
      header={<Header onBack={() => router.replace('/')} />}
      contentStyle={styles.content}>
      {stage ? (
        <Working
          stage={stage}
          personPreview={personPreview}
          outfitPreview={outfitPreview}
        />
      ) : (
        <>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>TRY IT ON</Text>
            <Text style={styles.title}>Two photos.</Text>
            <Text style={styles.subtitle}>
              One of you — full body, standing, the way you would in a fitting room. And one of the
              outfit you want to try.
            </Text>
          </View>

          {problem ? (
            <View style={styles.problemCard}>
              <Text style={styles.problemText}>{problem}</Text>
            </View>
          ) : null}

          {failure ? (
            <View style={styles.problemCard}>
              <Text style={styles.problemText}>{failure}</Text>
            </View>
          ) : null}

          <View style={styles.slots}>
            <PhotoSlot
              label="You"
              hint={personPicked || savedPerson ? 'Tap to change' : 'Full body, standing'}
              uri={personPreview}
              busy={picking === 'person'}
              onPress={() => void choose('person')}
              testID="pick-person"
            />
            <PhotoSlot
              label="The outfit"
              hint={outfitPicked ? 'Tap to change' : 'A dress, a shirt, a suit…'}
              uri={outfitPreview}
              busy={picking === 'outfit'}
              onPress={() => void choose('outfit')}
              testID="pick-outfit"
            />
          </View>

          <PrimaryButton
            label="See it on you"
            onPress={() => void seeItOn()}
            disabled={!ready || picking !== null}
            hint={ready ? undefined : 'Add both photos to continue.'}
            testID="see-it-on"
          />

          <Text style={styles.notice}>{PHOTO_NOTICE}</Text>
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

function Working({
  stage,
  personPreview,
  outfitPreview,
}: {
  stage: ScreenStage;
  personPreview: string | null;
  outfitPreview: string | null;
}) {
  const copy = describeStage(stage);

  return (
    <View style={styles.working}>
      <View style={styles.workingPair}>
        {personPreview ? (
          <Image source={{ uri: personPreview }} style={styles.workingThumb} contentFit="cover" />
        ) : null}
        {outfitPreview ? (
          <Image source={{ uri: outfitPreview }} style={styles.workingThumb} contentFit="cover" />
        ) : null}
      </View>

      <Text style={styles.workingTitle}>{copy.title}</Text>
      <Text style={styles.workingBody}>{copy.body}</Text>

      {stage.phase === 'sending' ? (
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${Math.round((stage.ratio ?? 0) * 100)}%` }]}
          />
        </View>
      ) : null}

      <Text style={styles.workingHint}>
        Keep OnMe open until the picture appears. Nothing is stored on the server while you wait.
      </Text>
    </View>
  );
}

function describeStage(stage: ScreenStage): { title: string; body: string } {
  switch (stage.phase) {
    case 'sending':
      return {
        title: 'Sending your photos',
        body:
          stage.ratio === null
            ? 'Uploading…'
            : `${Math.round(Math.min(1, Math.max(0, stage.ratio)) * 100)}% sent`,
      };
    case 'making':
      return {
        title: 'Making it',
        body: 'Putting the outfit on you, keeping your face, your hair and your pose.',
      };
    case 'saving':
      return {
        title: 'Saving your look',
        body: 'Bringing the picture onto your phone so it is yours to keep.',
      };
  }
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
  slots: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.one,
  },
  problemCard: {
    backgroundColor: Palette.backgroundElement,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.danger,
    padding: Spacing.three,
  },
  problemText: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.text,
  },
  notice: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textFaint,
    textAlign: 'center',
  },
  working: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.five,
  },
  workingPair: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  workingThumb: {
    width: 92,
    height: 120,
    borderRadius: Radii.md,
    backgroundColor: Palette.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.border,
  },
  workingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Palette.text,
  },
  workingBody: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: Radii.pill,
    backgroundColor: Palette.backgroundSelected,
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  progressFill: {
    height: 6,
    backgroundColor: Palette.accent,
  },
  workingHint: {
    fontSize: 12,
    lineHeight: 17,
    color: Palette.textFaint,
    textAlign: 'center',
    paddingTop: Spacing.three,
  },
});
