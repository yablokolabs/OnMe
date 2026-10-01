/**
 * The free allowance, and the two ways one more picture can be had.
 *
 * This is the arithmetic the try-on gate, the paywall and Settings all read, so it
 * is pinned here without a device, a database or a store: ten pictures for nothing,
 * an ad buys exactly one, Pro is unlimited, and counters that have gone strange can
 * never take away a picture someone never made.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FREE_TRY_ONS,
  afterReward,
  afterTryOn,
  mayMakeAnother,
  remainingFree,
} from '../../src/services/allowance.ts';
import { parseAllowance } from '../../src/services/lookRows.ts';

test('a new install has every free picture', () => {
  assert.equal(remainingFree({ used: 0, bonus: 0 }), FREE_TRY_ONS);
  assert.equal(mayMakeAnother({ used: 0, bonus: 0 }, false), true);
});

test('the last free picture is allowed and the next one is not', () => {
  const nearly = { used: FREE_TRY_ONS - 1, bonus: 0 };

  assert.equal(mayMakeAnother(nearly, false), true);
  assert.equal(remainingFree(afterTryOn(nearly)), 0);
  assert.equal(mayMakeAnother(afterTryOn(nearly), false), false);
});

test('Pro makes the count irrelevant', () => {
  assert.equal(mayMakeAnother({ used: FREE_TRY_ONS * 3, bonus: 0 }, true), true);
});

test('an ad buys exactly one more picture', () => {
  const spent = { used: FREE_TRY_ONS, bonus: 0 };

  assert.equal(mayMakeAnother(spent, false), false);

  const rewarded = afterReward(spent);
  assert.equal(remainingFree(rewarded), 1);
  assert.equal(mayMakeAnother(rewarded, false), true);

  // And it is spent like any other picture: one ad is one picture.
  assert.equal(mayMakeAnother(afterTryOn(rewarded), false), false);
});

test('counters that have gone strange cannot take pictures away', () => {
  assert.equal(remainingFree({ used: Number.NaN, bonus: Number.NaN }), FREE_TRY_ONS);
  assert.equal(remainingFree({ used: -5, bonus: -5 }), FREE_TRY_ONS);
  assert.equal(remainingFree({ used: 2.4, bonus: 0 }), FREE_TRY_ONS - 2);
});

test('counters read from storage survive a missing or broken row', () => {
  // A row that is not there is a new install; a row that is nonsense is zero,
  // because the alternative is a user with a negative number of pictures.
  assert.deepEqual(parseAllowance(undefined), { used: 0, bonus: 0 });
  assert.deepEqual(parseAllowance(null), { used: 0, bonus: 0 });
  assert.deepEqual(parseAllowance({ used: 3, bonus: 1 }), { used: 3, bonus: 1 });
  assert.deepEqual(parseAllowance({ used: -9, bonus: Number.NaN }), { used: 0, bonus: 0 });
});
