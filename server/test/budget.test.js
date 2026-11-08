/**
 * The monthly budget: how many pictures this backend makes in one calendar month.
 *
 * The GPU is paid for from a fixed monthly allowance, so the count has a hard
 * ceiling and starts again on the first of each month (UTC). The clock is passed
 * in, so a month can pass in a test.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMonthlyBudget, firstOfNextMonth } from '../src/budget.js';

describe('the first day of the next month', () => {
  test('is in the same year until December', () => {
    assert.equal(firstOfNextMonth(new Date(Date.UTC(2026, 10, 8, 12))), '2026-12-01');
  });

  test('is in the next year after December', () => {
    assert.equal(firstOfNextMonth(new Date(Date.UTC(2026, 11, 31, 23, 59))), '2027-01-01');
  });
});

describe('a monthly budget', () => {
  test('lets the limit through and refuses the next one', () => {
    const budget = createMonthlyBudget({ limit: 2, now: () => new Date(Date.UTC(2026, 10, 8)) });
    assert.equal(budget.take(), true);
    assert.equal(budget.take(), true);
    assert.equal(budget.take(), false);
    assert.deepEqual(budget.describe(), { limit: 2, used: 2, available: false, resetsOn: '2026-12-01' });
  });

  test('starts again in a new month', () => {
    let now = new Date(Date.UTC(2026, 10, 30, 23));
    const budget = createMonthlyBudget({ limit: 1, now: () => now });
    assert.equal(budget.take(), true);
    assert.equal(budget.take(), false);

    now = new Date(Date.UTC(2026, 11, 1, 0, 1));
    assert.equal(budget.describe().available, true);
    assert.equal(budget.take(), true);
    assert.deepEqual(budget.describe(), { limit: 1, used: 1, available: false, resetsOn: '2027-01-01' });
  });
});
