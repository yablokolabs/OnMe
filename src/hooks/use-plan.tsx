/**
 * What this install has left for nothing.
 *
 * One provider holds the whole answer, so the try-on gate and Settings cannot
 * disagree about how many pictures remain: the counters come from SQLite, and the
 * arithmetic is `services/allowance`, which is pure and tested.
 *
 * The rule, in this order: the free allowance, then the option to buy one more
 * picture with a rewarded video, but only while the backend has pictures left this
 * month. Nothing here decides what a picture *is* — the try-on screen tells this
 * provider that one was made, after the file is safely on the phone.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { mayMakeAnother, NO_ALLOWANCE, remainingFree, type Allowance } from '@/services/allowance';
import { showRewardedForOneMorePicture, type RewardOutcome } from '@/services/ads';
import { describeMonthSpent, readMonthlyBudget } from '@/services/backendCalls';
import { grantRewardedTryOn, readAllowance, recordTryOn } from '@/services/looksDb';

export interface PlanValue {
  /** True until the allowance has been read from the database. */
  loading: boolean;
  /** Pictures left on this phone. */
  remaining: number;
  /** Whether another picture may be made right now. */
  allowed: boolean;
  /** The extra picture, or a sentence saying why there is not one. */
  watchAd: () => Promise<RewardOutcome>;
  /** Tells the plan a picture was made. Called once the picture exists. */
  noteTryOn: () => Promise<void>;
}

const PlanContext = createContext<PlanValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [allowance, setAllowance] = useState<Allowance | null>(null);

  useEffect(() => {
    let mounted = true;
    void readAllowance().then((next) => {
      if (mounted) setAllowance(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const noteTryOn = useCallback(async () => {
    setAllowance(await recordTryOn());
  }, []);

  const watchAd = useCallback(async (): Promise<RewardOutcome> => {
    // An ad for a picture the backend will refuse is an ad watched for nothing.
    const budget = await readMonthlyBudget();
    if (budget === null) {
      return { earned: false, message: 'OnMe could not reach its backend. Check your connection and try again.' };
    }
    if (!budget.available) return { earned: false, message: describeMonthSpent(budget.resetsOn) };

    const outcome = await showRewardedForOneMorePicture();
    // The credit is written down only when the reward was really earned, so a
    // video closed at the halfway mark costs the user nothing and buys nothing.
    if (outcome.earned) setAllowance(await grantRewardedTryOn());
    return outcome;
  }, []);

  const value = useMemo<PlanValue>(
    () => ({
      loading: allowance === null,
      remaining: remainingFree(allowance ?? NO_ALLOWANCE),
      allowed: mayMakeAnother(allowance ?? NO_ALLOWANCE),
      watchAd,
      noteTryOn,
    }),
    [allowance, watchAd, noteTryOn]
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
