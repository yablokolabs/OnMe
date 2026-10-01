/**
 * The hosted paywall, in the browser build.
 *
 * `react-native-purchases-ui` is a native view: there is nothing to present in a
 * Chromium page. The web build matters here for one reason — the demo video's app
 * screens are captured from it (`videos/scripts/capture-app-screens.mjs`) — and a
 * capture run must not have to pull a native paywall into a browser. Metro picks
 * this file for the web platform and `paywall-ui.ts` everywhere else, so both
 * builds have the same shape and the same types.
 *
 * `unavailable` is the honest answer, and it is the same answer a phone gives when
 * a project has no paywall configured: the caller falls back to buying the package
 * directly, so the screen still works in a browser.
 */

export type PaywallOutcome = 'purchased' | 'restored' | 'cancelled' | 'unavailable';

export function presentProPaywall(): Promise<PaywallOutcome> {
  return Promise.resolve('unavailable');
}
