/**
 * The one ad in OnMe: a rewarded video that buys one more picture.
 *
 * It is placed where it can be wanted instead of endured. The only moment an ad
 * exists in this app is the moment the free pictures have run out and the user has
 * chosen to watch one rather than pay — nothing plays on its own, nothing covers
 * the picture they just made, and the reward is the product's own currency (one
 * more try-on) rather than coins in an invented economy.
 *
 * Every event the ad network reports is reported on to RevenueCat's ad tracker as
 * well, so ad revenue and purchase revenue are accounted for in the same place.
 * That is the whole of "RevenueCat Ads": not a different way to serve an ad, a
 * careful way to count one. This is the manual integration from its docs, which is
 * the supported path for any network without an adapter module.
 *
 * The unit id is Google's own test unit until a real AdMob unit id replaces it:
 * test ads are really served and really reported, they simply earn nothing.
 */

import mobileAds, {
  AdEventType,
  RevenuePrecisions,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';
import Purchases, { AdFormat, AdMediatorName, AdRevenuePrecision } from 'react-native-purchases';

import { purchasesReady } from '@/services/purchases';
import { createId } from '@/utils/ids';

/** Google's test rewarded unit. Swap in the AdMob unit id when there is one. */
export const REWARDED_AD_UNIT = TestIds.REWARDED;

/** Where the ad appears. RevenueCat groups its charts by this name. */
const PLACEMENT = 'tryon_extra_picture';

/** Google numbers its revenue precisions; RevenueCat names them. */
const PRECISION: Record<number, AdRevenuePrecision> = {
  [RevenuePrecisions.UNKNOWN]: AdRevenuePrecision.unknown,
  [RevenuePrecisions.ESTIMATED]: AdRevenuePrecision.estimated,
  [RevenuePrecisions.PUBLISHER_PROVIDED]: AdRevenuePrecision.publisherDefined,
  [RevenuePrecisions.PRECISE]: AdRevenuePrecision.exact,
};

let initialised: Promise<void> | null = null;

/**
 * Brings the ad SDK up, once.
 *
 * Never rejects: an ad network that cannot be reached must not be a reason the app
 * fails to start, and the only thing that depends on it is the optional extra
 * picture.
 */
export function startAds(): Promise<void> {
  if (!initialised) {
    initialised = mobileAds()
      .initialize()
      .then(() => undefined)
      .catch(() => undefined);
  }
  return initialised;
}

export interface RewardOutcome {
  /** True only when the video was watched to the point of earning its reward. */
  earned: boolean;
  /** Phrased for the screen; absent when the reward was earned. */
  message?: string;
}

/**
 * Quietly reports one ad event to RevenueCat.
 *
 * Bookkeeping never gets in the way of the reward: a report that fails still
 * leaves a user who watched the video with their extra picture, and there is
 * nothing useful to say to them about the failure.
 */
function track(run: () => Promise<void>): void {
  if (!purchasesReady) return;
  void run().catch(() => {});
}

function describeError(error: unknown): number | null {
  const code = Number((error as { code?: unknown } | null)?.code);
  return Number.isFinite(code) ? code : null;
}

/**
 * Shows a rewarded video and reports whether the user earned it.
 *
 * Resolves on the ad's own events rather than on a timer: closing the video early
 * is a normal outcome with `earned: false`, and no message is worth showing for
 * it, since the user knows what they did.
 */
export async function showRewardedForOneMorePicture(): Promise<RewardOutcome> {
  await startAds();

  // One id for the whole ad, so the load, the impression, the click and the money
  // join up into a single story in RevenueCat. The network's own impression id
  // would be better still, and is what RevenueCat's adapter modules pass on.
  const impressionId = createId('ad');
  const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT);
  const common = {
    mediatorName: AdMediatorName.adMob,
    adFormat: AdFormat.rewarded,
    adUnitId: REWARDED_AD_UNIT,
    placement: PLACEMENT,
  };

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
        track(() => Purchases.adTracker.trackAdLoaded({ ...common, impressionId }));
        ad.show().catch(() =>
          finish({ earned: false, message: 'The video could not start. Try again.' })
        );
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(AdEventType.IMPRESSION, () => {
        track(() => Purchases.adTracker.trackAdDisplayed({ ...common, impressionId }));
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(AdEventType.CLICKED, () => {
        track(() => Purchases.adTracker.trackAdOpened({ ...common, impressionId }));
      })
    );

    unsubscribe.push(
      ad.addAdEventListener(AdEventType.PAID, (paid) => {
        const micros = paid.valueMicros
          ? Number(paid.valueMicros)
          : Math.round(paid.value * 1_000_000);
        track(() =>
          Purchases.adTracker.trackAdRevenue({
            ...common,
            impressionId,
            revenueMicros: Number.isFinite(micros) ? micros : 0,
            currency: paid.currency,
            precision: PRECISION[paid.precision] ?? AdRevenuePrecision.unknown,
          })
        );
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
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        track(() =>
          Purchases.adTracker.trackAdFailedToLoad({
            ...common,
            mediatorErrorCode: describeError(error),
          })
        );
        finish({ earned: false, message: 'No video was available just now. Try again in a moment.' });
      })
    );

    ad.load();
  });
}
