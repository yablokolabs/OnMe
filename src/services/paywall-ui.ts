/**
 * RevenueCat's own paywall — the one built in their dashboard, not one drawn here.
 *
 * A paywall is a product decision before it is a screen: what it says about the
 * price, what Pro includes, whether there is a trial, which audience sees which
 * version. In RevenueCat that decision lives in the project, where it can be
 * changed — including per audience, and A/B tested — without a store release. A
 * paywall drawn in this app could only ever say what was compiled into it, so this
 * screen is presented from the dashboard instead, and `Purchases` still owns the
 * purchase and the entitlement underneath it.
 *
 * The catch is that a hosted paywall has to exist before one can be shown, and that
 * is a dashboard fact this app cannot see from here. So the outcome is words rather
 * than a boolean, and `unavailable` is not a failure: it means nothing was shown,
 * and the caller should sell the package itself. A build pointed at a project with
 * no paywall configured still sells.
 *
 * The browser build has no such paywall — see `paywall-ui.web.ts`, which Metro picks
 * there so the web export (the demo video's screenshots) keeps working.
 */

import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

import { PRO_ENTITLEMENT, purchasesReady } from '@/services/purchases';

export type PaywallOutcome =
  /** The paywall completed a purchase. */
  | 'purchased'
  /** The paywall restored an existing one. */
  | 'restored'
  /** The paywall was closed without buying. */
  | 'cancelled'
  /** Nothing was presented — already Pro, or no paywall configured. Not an error. */
  | 'unavailable';

/**
 * Presents the dashboard paywall, unless the customer already holds the entitlement.
 *
 * `presentPaywallIfNeeded` is the right one of the two entry points for a button
 * that means "make me Pro": a customer who is already Pro should not be shown a
 * paywall, and they will not be — that case comes back as `NOT_PRESENTED`, which
 * lands in `unavailable` and is resolved by the caller re-reading the entitlement.
 */
export async function presentProPaywall(): Promise<PaywallOutcome> {
  if (!purchasesReady) return 'unavailable';

  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: PRO_ENTITLEMENT,
    });

    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
        return 'purchased';
      case PAYWALL_RESULT.RESTORED:
        return 'restored';
      case PAYWALL_RESULT.CANCELLED:
        return 'cancelled';
      default:
        // NOT_PRESENTED and ERROR both land here on purpose: the two are told
        // apart by asking the store, not by trusting a result code, and the
        // caller does exactly that.
        return 'unavailable';
    }
  } catch (error) {
    console.warn(
      `OnMe could not present the RevenueCat paywall. ${error instanceof Error ? error.message : ''}`
    );
    return 'unavailable';
  }
}
