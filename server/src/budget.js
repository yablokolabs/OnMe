/**
 * How many pictures this backend makes in one calendar month (UTC).
 *
 * The GPU is paid from a fixed monthly allowance, so the count has a hard ceiling,
 * and it starts again on the first of the month. Every picture that reaches the
 * model counts, a failed one too: the GPU time was spent either way.
 *
 * Memory only, like everything else here: a restart starts the count from zero.
 * That is the price of writing nothing to disk, and the model's own billing limit
 * is the hard stop behind it.
 */

/** Today's month, as `YYYY-MM`. */
function monthOf(date) {
  return date.toISOString().slice(0, 7);
}

/** The first day of the month after `date`, as `YYYY-MM-DD`. */
export function firstOfNextMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export function createMonthlyBudget({ limit, now = () => new Date() }) {
  let month = monthOf(now());
  let used = 0;

  function roll() {
    const current = monthOf(now());
    if (current !== month) {
      month = current;
      used = 0;
    }
  }

  return {
    /** Counts one picture, or returns false when the month's pictures are spent. */
    take() {
      roll();
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    /** Numbers and a date only: safe to serve from /health. */
    describe() {
      roll();
      return { limit, used, available: used < limit, resetsOn: firstOfNextMonth(now()) };
    },
  };
}
