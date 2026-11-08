/**
 * What a public release on Google Play needs from the backend, over the real wire:
 *
 *   - a monthly ceiling on pictures, because the GPU is paid from a fixed monthly
 *     allowance, and an honest answer when it is spent;
 *   - a way to report a picture (Google Play's rule for apps that generate images);
 *   - the privacy policy the store listing links to.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startBackend, startFakeModal } from './support/harness.js';
import { jpegBytes, photo, pngBytes } from './support/fixtures.js';

function requestBody() {
  return {
    consentAt: new Date(2026, 10, 6, 10, 0, 0).toISOString(),
    person: photo(pngBytes(1024), 'image/png'),
    outfit: photo(jpegBytes(512), 'image/jpeg'),
  };
}

function modalEnv(modal, extra = {}) {
  return {
    FAL_KEY: '',
    ONME_TRYON_PROVIDER: 'modal',
    ONME_MODAL_URL: modal.base,
    MODAL_PROXY_KEY: 'k',
    MODAL_PROXY_SECRET: 's',
    ONME_MAX_TRYONS_PER_MINUTE: '200',
    ...extra,
  };
}

const NEXT_MONTH = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
})();

describe('the monthly limit', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal();
    backend = await startBackend(modalEnv(modal, { ONME_MONTHLY_TRYON_LIMIT: '2' }));
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('the app can ask whether there are pictures left this month', async () => {
    const response = await fetch(`${backend.base}/tryon/budget`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      available: true,
      resetsOn: NEXT_MONTH.toISOString().slice(0, 10),
    });
  });

  test('when it is spent, a try-on is refused before the photos go anywhere', async () => {
    assert.equal((await backend.tryOn(requestBody())).status, 200);
    assert.equal((await backend.tryOn(requestBody())).status, 200);
    assert.equal(modal.requests.length, 2);

    const refused = await backend.tryOn(requestBody());
    assert.equal(refused.status, 503);
    const body = await refused.json();
    const month = NEXT_MONTH.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
    assert.equal(body.error, `OnMe has made all its free pictures for this month. Try again on 1 ${month}.`);
    assert.equal(modal.requests.length, 2);

    const budget = await (await fetch(`${backend.base}/tryon/budget`)).json();
    assert.equal(budget.available, false);

    const health = await backend.health();
    assert.deepEqual(health.monthlyTryOns, {
      limit: 2,
      used: 2,
      available: false,
      resetsOn: NEXT_MONTH.toISOString().slice(0, 10),
    });
  });
});

describe('the monthly limit, when the model fails', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal({ status: 500 });
    backend = await startBackend(modalEnv(modal, { ONME_MONTHLY_TRYON_LIMIT: '1' }));
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('counts the failed picture, because the GPU time was spent on it', async () => {
    assert.equal((await backend.tryOn(requestBody())).status, 502);
    assert.equal((await backend.tryOn(requestBody())).status, 503);
  });
});

describe('the monthly limit, when a photo is refused', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal();
    backend = await startBackend(modalEnv(modal, { ONME_MONTHLY_TRYON_LIMIT: '1' }));
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('does not count a request that never reached the model', async () => {
    assert.equal((await backend.tryOn({ ...requestBody(), consentAt: undefined })).status, 400);
    assert.equal((await backend.tryOn(requestBody())).status, 200);
  });
});

describe('the monthly limit, by default', () => {
  let backend;

  before(async () => {
    backend = await startBackend({ ONME_MONTHLY_TRYON_LIMIT: undefined });
  });

  after(async () => {
    await backend?.stop();
  });

  test('is 600 pictures', async () => {
    const health = await backend.health();
    assert.equal(health.monthlyTryOns.limit, 600);
    assert.equal(health.monthlyTryOns.used, 0);
  });
});

describe('reporting a picture', () => {
  let backend;

  before(async () => {
    backend = await startBackend();
  });

  after(async () => {
    await backend?.stop();
  });

  async function report(body, raw) {
    return fetch(`${backend.base}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    });
  }

  test('is accepted, and the log says why, with no picture in it', async () => {
    const response = await report({ reason: 'offensive', model: 'fashn-vton-1.5', note: 'line one\nline two' });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true });

    const expected = /\[onme\] report: reason=offensive model=fashn-vton-1\.5 note="line one line two"/;
    assert.match(await backend.waitForLog(expected), expected);
    assert.equal((await backend.health()).reports, 1);
  });

  test('a long note is cut short in the log', async () => {
    await report({ reason: 'other', note: 'x'.repeat(2000) });
    const line = (await backend.waitForLog(/reason=other/)).split('\n').find((entry) => entry.includes('reason=other'));
    assert.ok(line.length < 400, `log line is ${line.length} characters`);
  });

  test('a reason that is not on the list is refused', async () => {
    assert.equal((await report({ reason: 'whatever' })).status, 400);
    assert.equal((await report(undefined, 'not json')).status, 400);
  });

  test('a large body is refused', async () => {
    assert.equal((await report({ reason: 'other', note: 'x'.repeat(20_000) })).status, 413);
  });

  test('only POST is accepted', async () => {
    assert.equal((await fetch(`${backend.base}/report`)).status, 405);
  });
});

describe('the privacy policy', () => {
  let backend;

  before(async () => {
    backend = await startBackend();
  });

  after(async () => {
    await backend?.stop();
  });

  test('is a web page that names the company, the processors and a contact', async () => {
    const response = await fetch(`${backend.base}/privacy`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const page = await response.text();
    for (const words of ['Yabloko Labs Ltd', '16660148', 'support@yablokolabs.com', 'AdMob', 'Modal', '18']) {
      assert.ok(page.includes(words), `the policy does not mention ${words}`);
    }
  });
});
