/**
 * The one ad in OnMe: a rewarded video that buys one more picture.
 *
 * It is placed where it can be wanted instead of endured. The only moment an ad
 * exists in this app is the moment the free pictures have run out and the user has
 * chosen to watch one: nothing plays on its own, nothing covers the picture they
 * just made, and the reward is one more try-on.
 *
 * Consent comes first. In the UK, the EU and Switzerland the law asks for it before
 * an ad is requested, so Google's User Messaging Platform shows the consent message
 * configured in AdMob (Privacy & messaging) before the SDK starts, and the user can
 * change the choice later from Settings.
 *
 * The unit id is `EXPO_PUBLIC_ADMOB_REWARDED_UNIT`. A build without one uses
 * Google's own test unit: test ads are really served, they earn nothing.
 */

import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

const CONFIGURED_UNIT = (process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT ?? '').trim();

/** The AdMob rewarded unit, or Google's test unit in a build that names none. */
export const REWARDED_AD_UNIT = CONFIGURED_UNIT !== '' ? CONFIGURED_UNIT : TestIds.REWARDED;

let initialised: Promise<boolean> | null = null;

/**
 * Asks for consent where the law needs it, then brings the ad SDK up, once.
 * Resolves true when ads may be requested.
 *
 * Never rejects: an ad network that cannot be reached must not be a reason the app
 * fails to start, and the only thing that depends on it is the optional extra
 * picture.
 */
export function startAds(): Promise<boolean> {
  if (!initialised) {
    initialised = (async () => {
      let canRequest = false;
      try {
        canRequest = (await AdsConsent.gatherConsent()).canRequestAds;
      } catch {
        // A failed consent update still leaves the consent from an earlier start.
        canRequest = (await AdsConsent.getConsentInfo().catch(() => null))?.canRequestAds ?? false;
      }
      if (!canRequest) return false;
      await mobileAds().initialize();
      return true;
    })().catch(() => false);
  }
  return initialised;
}

/** Whether Settings has to offer a way to change the consent choice. */
export async function privacyChoicesRequired(): Promise<boolean> {
  try {
    const info = await AdsConsent.getConsentInfo();
    return info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
  } catch {
    return false;
  }
}

/** Shows Google's form to change the consent choice. */
export async function showPrivacyChoices(): Promise<void> {
  try {
    await AdsConsent.showPrivacyOptionsForm();
  } catch {
    // Nothing to tell the user: the form closes and the choice stays as it was.
  }
}

export interface RewardOutcome {
  /** True only when the video was watched to the point of earning its reward. */
  earned: boolean;
  /** Phrased for the screen; absent when the reward was earned. */
  message?: string;
}

/**
 * Shows a rewarded video and reports whether the user earned it.
 *
 * Resolves on the ad's own events rather than on a timer: closing the video early
 * is a normal outcome with `earned: false`.
 */
export async function showRewardedForOneMorePicture(): Promise<RewardOutcome> {
  if (!(await startAds())) {
    return {
      earned: false,
      message: 'Ads are off because of your privacy choice. You can change it in Settings.',
    };
  }

  const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT);

  return new Promise<RewardOutcome>((resolve) => {
    let earned = false;
    let settled = false;
    const unsubscribe: (() => void)[] = [];

    const finish = (outcome: RewardOutcome) => {
      if (settled) return;
      settled = true;
      for (const off of unsubscribe) off();
      resolve(outcome);
    };

    unsubscribe.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        ad.show().catch(() => finish({ earned: false, message: 'The video could not start. Try again.' }));
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        finish(
          earned
            ? { earned: true }
            : { earned: false, message: 'The video has to play to the end to earn a picture.' }
        );
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(AdEventType.ERROR, () => {
        finish({ earned: false, message: 'No video was available just now. Try again in a moment.' });
      })
    );

    ad.load();
  });
}
