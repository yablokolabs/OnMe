/**
 * OnMe Pro, through RevenueCat.
 *
 * There is one product and one entitlement — `yabloko_labs_pro` in the RevenueCat
 * project, which means unlimited try-ons. Everything a purchase needs lives in
 * this file — the free allowance and the paywall's copy do not care how the
 * purchase happens, and nothing here knows what a try-on is.
 *
 * The key is a RevenueCat **public** SDK key (an Android `goog_…` key, or a
 * `test_…` key from a Test Store). It ships inside the bundle by design: it can
 * read offerings and start a purchase, and it cannot read a customer list or
 * change a product. That is a different kind of secret from the backend's, and
 * the README's table says so.
 *
 * With no key the app is not broken and not secretly freemium: `purchasesReady`
 * is false, Pro is simply unavailable, and the free allowance is the whole
 * product — which is exactly the state this app shipped in before.
 */

import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

/**
 * The entitlement the paywall and the try-on gate both ask about.
 *
 * Spelled exactly as the RevenueCat project spells it: an identifier is a name,
 * not a guess, and `entitlements.active` is a lookup by it. Rename the
 * entitlement in the dashboard and this is the one line that follows.
 */
export const PRO_ENTITLEMENT = 'yabloko_labs_pro';

/** Public by construction — see the note above. Empty means "no store in this build". */
const API_KEY = (process.env.EXPO_PUBLIC_REVENUECAT_KEY ?? '').trim();

/** Whether this build can sell anything at all. */
export const purchasesReady = API_KEY !== '';

let started = false;

/**
 * Configures the SDK once, on the way into the app.
 *
 * `configure` is synchronous in this version and throws on a malformed key, so it
 * is the one call that gets wrapped: a bad key should leave the app free, not
 * crash it on the home screen.
 */
export function startPurchases(): boolean {
  if (started) return true;
  if (!purchasesReady) return false;

  try {
    Purchases.configure({ apiKey: API_KEY });
    started = true;
    // Nothing but warnings in a build someone else is holding; in development the
    // Test Store's whole story is worth reading.
    void Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.VERBOSE : LOG_LEVEL.WARN);
    return true;
  } catch (error) {
    console.warn(
      `OnMe could not start RevenueCat; the app stays free. ${error instanceof Error ? error.message : ''}`
    );
    return false;
  }
}

/** Whether the customer holds Pro. A missing entitlement is not an error. */
export function hasPro(info: CustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements.active[PRO_ENTITLEMENT]);
}

export interface ProResult {
  ok: boolean;
  pro: boolean;
  /** Present when something went wrong, phrased for the screen. */
  message?: string;
  /** The user backed out — not a failure to report. */
  cancelled?: boolean;
}

function describe(error: unknown): string {
  const failure = error as { userCancelled?: boolean; message?: string } | null;

  if (failure?.userCancelled) {
    return '';
  }
  // The SDK's own text is better than a guess, but it is written for a developer.
  return typeof failure?.message === 'string' && failure.message
    ? `The store could not finish that. ${failure.message}`
    : 'The store could not finish that. Try again in a moment.';
}

/** Reads Pro from the store. Used at startup and after a restore. */
export async function readPro(): Promise<boolean> {
  if (!started) return false;

  try {
    return hasPro(await Purchases.getCustomerInfo());
  } catch {
    return false;
  }
}

/**
 * The package to sell, from the current offering.
 *
 * RevenueCat decides what is on offer, so the app asks rather than naming a
 * product: a price change, a new plan or a sale is a dashboard change, and no
 * release. The monthly package is preferred only because it is the one this
 * product means to sell — it is chosen by the identifier RevenueCat gives a
 * monthly package rather than by package type, because the price is what the
 * screen shows and `$rc_monthly` is the name that decides which price that is.
 */
export async function fetchProPackage(): Promise<PurchasesPackage | null> {
  if (!started) return null;

  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    const monthly = packages.find(
      (entry) => entry.identifier === '$rc_monthly' || entry.identifier === 'monthly'
    );
    return monthly ?? packages[0] ?? null;
  } catch {
    return null;
  }
}

export async function buyPro(pkg: PurchasesPackage): Promise<ProResult> {
  if (!started) {
    return { ok: false, pro: false, message: 'This build has no store connected.' };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, pro: hasPro(customerInfo) };
  } catch (error) {
    const cancelled = Boolean((error as { userCancelled?: boolean } | null)?.userCancelled);
    return { ok: false, pro: false, cancelled, message: describe(error) };
  }
}

/**
 * Restores from the store.
 *
 * The result is reported as Pro or not Pro rather than as success or failure: a
 * restore that finds nothing is a normal answer, and telling the user their
 * "restore failed" would be wrong.
 */
export async function restorePro(): Promise<ProResult> {
  if (!started) {
    return { ok: false, pro: false, message: 'This build has no store connected.' };
  }

  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, pro: hasPro(info) };
  } catch (error) {
    return { ok: false, pro: false, message: describe(error) };
  }
}

/**
 * Fires whenever the store's view of this customer changes — a purchase here, a
 * renewal, a refund, or a restore on another device.
 *
 * Returns the way back out: the listener lives in native code, so a screen that
 * unmounts without removing it would keep updating a component that is gone.
 */
export function watchPro(listener: (pro: boolean) => void): () => void {
  if (!started) return () => {};

  const wrapped = (info: CustomerInfo) => listener(hasPro(info));
  Purchases.addCustomerInfoUpdateListener(wrapped);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(wrapped);
  };
}
