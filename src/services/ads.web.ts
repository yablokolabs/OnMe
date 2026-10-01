/**
 * The ad service, in the browser build.
 *
 * The ad SDK is native-only, and the web build matters here: the demo video's app
 * screens are captured from it (`videos/scripts/capture-app-screens.mjs`), and a
 * capture run must not have to pull a mobile ad network into a Chromium page. Metro
 * picks this file for the web platform and `ads.ts` everywhere else, so both builds
 * have the same shape and the same types.
 *
 * There is no ad to show in a browser, and saying so plainly is better than
 * pretending to have one: the rewarded option simply is not offered there.
 */

/** No unit id: nothing to request. */
export const REWARDED_AD_UNIT = '';

export interface RewardOutcome {
  earned: boolean;
  message?: string;
}

export function startAds(): Promise<void> {
  return Promise.resolve();
}

export function showRewardedForOneMorePicture(): Promise<RewardOutcome> {
  return Promise.resolve({
    earned: false,
    message: 'The browser build has no ads in it.',
  });
}
