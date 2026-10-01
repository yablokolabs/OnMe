/**
 * What this install has left for nothing, and what Pro would change.
 *
 * One provider holds the whole answer, so the try-on gate, the paywall and
 * Settings cannot disagree about how many pictures remain: the counters come from
 * SQLite, Pro comes from the store, and the arithmetic between them is
 * `services/allowance`, which is pure and tested.
 *
 * The rule underneath, in this order: Pro first, then the free allowance, then the
 * option to buy one more picture with a rewarded video. Nothing here decides what
 * a picture *is* — the try-on screen tells this provider that one was made, after
 * the file is safely on the phone.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { mayMakeAnother, remainingFree, type Allowance } from '@/services/allowance';
import { showRewardedForOneMorePicture, type RewardOutcome } from '@/services/ads';
import { grantRewardedTryOn, readAllowance, recordTryOn } from '@/services/looksDb';
import { presentProPaywall } from '@/services/paywall-ui';
import {
  buyPro,
  fetchProPackage,
  purchasesReady,
  readPro,
  restorePro,
  startPurchases,
  watchPro,
  type ProResult,
} from '@/services/purchases';
import type { PurchasesPackage } from 'react-native-purchases';

export interface PlanValue {
  /** True until the allowance has been read from the database. */
  loading: boolean;
  /** Whether this build has a store connected. False in a build with no key. */
  configured: boolean;
  pro: boolean;
  /** Pictures owed before Pro is needed. Not meaningful while Pro is active. */
  remaining: number;
  /** Whether another picture may be made right now. */
  allowed: boolean;
  /** The package to sell, as the store describes it. Null while unknown. */
  offering: PurchasesPackage | null;
  /**
   * The way to buy, for a button. Presents RevenueCat's own paywall and falls back
   * to purchasing the package directly when there is no paywall to present, so the
   * screen never has to know which of the two happened.
   */
  goPro: () => Promise<ProResult>;
  buy: () => Promise<ProResult>;
  restore: () => Promise<ProResult>;
  /** The extra picture, or a sentence saying why there is not one. */
  watchAd: () => Promise<RewardOutcome>;
  /** Tells the plan a picture was made. Called once the picture exists. */
  noteTryOn: () => Promise<void>;
}

const PlanContext = createContext<PlanValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [pro, setPro] = useState(false);
  const [offering, setOffering] = useState<PurchasesPackage | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    void (async () => {
      // The counters first: they are local, they always exist, and they are the
      // only thing that decides whether the app can be used before the store has
      // answered — which, on a phone with no connection, may be never.
      setAllowance(await readAllowance());

      if (!startPurchases() || !purchasesReady) return;
      const stopWatching = watchPro((next) => {
        if (mounted.current) setPro(next);
      });

      const [entitled, proPackage] = await Promise.all([readPro(), fetchProPackage()]);
      if (mounted.current) {
        setPro(entitled);
        setOffering(proPackage);
      }

      return stopWatching;
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  const noteTryOn = useCallback(async () => {
    setAllowance(await recordTryOn());
  }, []);

  const watchAd = useCallback(async () => {
    const outcome = await showRewardedForOneMorePicture();
    // The credit is written down only when the reward was really earned, so a
    // video closed at the halfway mark costs the user nothing and buys nothing.
    if (outcome.earned) setAllowance(await grantRewardedTryOn());
    return outcome;
  }, []);

  const buy = useCallback(async (): Promise<ProResult> => {
    if (!offering) {
      // Worth one more ask: an offering can be missing simply because the network
      // was down when the app started.
      const proPackage = await fetchProPackage();
      setOffering(proPackage);
      if (!proPackage) {
        return { ok: false, pro: false, message: 'Nothing is on offer right now. Try again shortly.' };
      }
      return buyPro(proPackage);
    }
    return buyPro(offering);
  }, [offering]);

  const goPro = useCallback(async (): Promise<ProResult> => {
    const outcome = await presentProPaywall();

    if (outcome === 'cancelled') {
      return { ok: false, pro: false, cancelled: true };
    }

    if (outcome !== 'unavailable') {
      // The paywall bought or restored something. The SDK already has the new
      // customer info by now, so the entitlement is read rather than assumed —
      // `purchased` is a statement about the paywall, not about this customer.
      const entitled = await readPro();
      if (entitled) setPro(true);
      return { ok: true, pro: entitled };
    }

    // Nothing was presented, for one of two innocent reasons: this customer is
    // already Pro (so there was nothing to sell them), or the project has no
    // paywall configured yet. The store answers which, and if it is the second
    // then buying the package directly is still a way to pay.
    if (await readPro()) {
      setPro(true);
      return { ok: true, pro: true };
    }
    return buy();
  }, [buy]);

  const restore = useCallback(async (): Promise<ProResult> => {
    const result = await restorePro();
    if (result.pro) setPro(true);
    return result;
  }, []);

  const value = useMemo<PlanValue>(
    () => ({
      loading: allowance === null,
      configured: purchasesReady,
      pro,
      remaining: remainingFree(allowance ?? { used: 0, bonus: 0 }),
      allowed: mayMakeAnother(allowance ?? { used: 0, bonus: 0 }, pro),
      offering,
      goPro,
      buy,
      restore,
      watchAd,
      noteTryOn,
    }),
    [allowance, pro, offering, goPro, buy, restore, watchAd, noteTryOn]
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanValue {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error('usePlan must be used inside a PlanProvider');
  }
  return context;
}
