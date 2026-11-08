/**
 * The two small calls the app makes besides a try-on, against the real backend
 * on loopback: "are there pictures left this month?" before an ad is offered, and
 * "report this picture" from the look screen.
 *
 * The backend URL is set before the app module is imported, because the module
 * reads `EXPO_PUBLIC_ONME_BACKEND_URL` once, at load. `__DEV__` is set because a
 * loopback backend is plain http, which only a development build may use.
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { startBackend } from '../../server/test/support/harness.js';

const backend = await startBackend({ ONME_MONTHLY_TRYON_LIMIT: '1' });
process.env.EXPO_PUBLIC_ONME_BACKEND_URL = backend.base;
globalThis.__DEV__ = true;

const { describeMonthSpent, readMonthlyBudget, reportPicture } = await import('../../src/services/backendCalls.ts');

after(async () => {
  await backend.stop();
});

test('the app reads whether there are pictures left this month', async () => {
  const budget = await readMonthlyBudget();
  assert.equal(budget?.available, true);
  assert.match(budget?.resetsOn ?? '', /^\d{4}-\d{2}-01$/);
});

test('the sentence for a spent month names the day it starts again', () => {
  assert.equal(
    describeMonthSpent('2026-12-01'),
    'OnMe has made all its free pictures for this month. Try again on 1 December.'
  );
});

test('a report reaches the backend with its reason, its model and its note', async () => {
  const outcome = await reportPicture({ reason: 'offensive', model: 'fashn-vton-1.5', note: 'not ok' });
  assert.deepEqual(outcome, { ok: true });
  const expected = /report: reason=offensive model=fashn-vton-1\.5 note="not ok"/;
  assert.match(await backend.waitForLog(expected), expected);
});

test('a report the backend refuses is said so', async () => {
  const outcome = await reportPicture({ reason: 'whatever', model: 'x' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /could not send that report/);
});
