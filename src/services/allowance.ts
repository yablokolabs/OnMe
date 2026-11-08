/**
 * How many pictures OnMe will make on this phone.
 *
 * Plain arithmetic, away from SQLite: this is the one rule in the product that has
 * to hold every time, and stating it as a function of two counters means it can be
 * pinned in a test with no device and no database.
 *
 *   - every install makes `FREE_TRY_ONS` pictures for nothing;
 *   - watching a rewarded ad buys **one** more, and that credit is spent like any
 *     other, so an ad can never be farmed into an unlimited free tier.
 *
 * The backend has its own ceiling for the whole month (`server/src/budget.js`),
 * because the GPU is paid from a fixed monthly allowance.
 */

/** Pictures every install gets for free. */
export const FREE_TRY_ONS = 10;

export interface Allowance {
  /** Pictures OnMe has made on this phone. */
  used: number;
  /** Extra pictures bought by watching a rewarded ad. */
  bonus: number;
}

export const NO_ALLOWANCE: Allowance = { used: 0, bonus: 0 };

/** Counters come from a database and from a store: neither is trusted to be sane. */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Pictures still owed to this install. */
export function remainingFree(allowance: Allowance): number {
  return Math.max(0, FREE_TRY_ONS + whole(allowance.bonus) - whole(allowance.used));
}

/** Whether another picture may be made. */
export function mayMakeAnother(allowance: Allowance): boolean {
  return remainingFree(allowance) > 0;
}

/** The counters after one more picture has been made. */
export function afterTryOn(allowance: Allowance): Allowance {
  return { used: whole(allowance.used) + 1, bonus: whole(allowance.bonus) };
}

/** The counters after an ad has been watched to the end. */
export function afterReward(allowance: Allowance): Allowance {
  return { used: whole(allowance.used), bonus: whole(allowance.bonus) + 1 };
}
