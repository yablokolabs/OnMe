/**
 * The try-on endpoint, over the real wire, against a local fake of the OnMe
 * function deployed on Modal (FASHN VTON v1.5 on a rented GPU).
 *
 * The production path runs unchanged; only the Modal endpoint is replaced, so
 * these tests need no GPU, no Modal account and no photograph of anyone.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { getModalConfig, isModalConfigured } from '../src/tryon/modal.js';
import { startBackend, startFakeModal } from './support/harness.js';
import { jpegBytes, photo, pngBytes } from './support/fixtures.js';

const PROXY_KEY = 'wk-test-key-never-sent-anywhere-real';
const PROXY_SECRET = 'ws-test-secret-never-sent-anywhere-real';

function requestBody() {
  return {
    consentAt: new Date(2026, 10, 6, 10, 0, 0).toISOString(),
    person: photo(pngBytes(1024), 'image/png'),
    outfit: photo(jpegBytes(512), 'image/jpeg'),
  };
}

/** Sets env vars for one call and puts them back however it ends. */
function withEnv(values, run) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe('Modal configuration', () => {
  test('it is configured only with a URL and both halves of the proxy credential', () => {
    const full = { ONME_MODAL_URL: 'https://x.modal.run', MODAL_PROXY_KEY: 'k', MODAL_PROXY_SECRET: 's' };
    withEnv(full, () => assert.equal(isModalConfigured(), true));
    withEnv({ ...full, ONME_MODAL_URL: '' }, () => assert.equal(isModalConfigured(), false));
    withEnv({ ...full, MODAL_PROXY_KEY: '' }, () => assert.equal(isModalConfigured(), false));
    withEnv({ ...full, MODAL_PROXY_SECRET: '' }, () => assert.equal(isModalConfigured(), false));
  });

  test('the model is named for what actually runs', () => {
    assert.equal(getModalConfig().model, 'fashn-vton-1.5');
  });
});

describe('with Modal as the try-on provider', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal();
    backend = await startBackend({
      FAL_KEY: '',
      ONME_TRYON_PROVIDER: 'modal',
      ONME_MODAL_URL: modal.base,
      MODAL_PROXY_KEY: PROXY_KEY,
      MODAL_PROXY_SECRET: PROXY_SECRET,
      ONME_MAX_TRYONS_PER_MINUTE: '200',
    });
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('/health says Modal will make the picture, and shows no credential', async () => {
    const health = await backend.health();
    assert.equal(health.tryOnReady, true);
    assert.equal(health.tryOnProvider, 'modal');
    assert.equal(health.modalConfigured, true);
    assert.equal(health.tryOnModel, 'fashn-vton-1.5');

    const serialized = JSON.stringify(health);
    assert.equal(serialized.includes(PROXY_KEY), false);
    assert.equal(serialized.includes(PROXY_SECRET), false);
  });

  test('two photos go to Modal with the proxy credential, and its picture comes back', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 200);
    const body = await response.json();

    const sent = modal.requests.at(-1);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.modalKey, PROXY_KEY);
    assert.equal(sent.modalSecret, PROXY_SECRET);
    assert.match(sent.contentType, /^application\/json/);

    const input = modal.lastInput();
    assert.equal(input.person.mimeType, 'image/png');
    assert.equal(input.outfit.mimeType, 'image/jpeg');
    assert.equal(input.person.data, requestBody().person.data);
    assert.equal(input.outfit.data, requestBody().outfit.data);

    assert.equal(body.look.model, 'fashn-vton-1.5');
    assert.equal(body.look.contentType, 'image/png');
    assert.equal(body.look.width, 768);
    assert.equal(body.look.height, 1024);

    const look = await fetch(body.look.imageUrl);
    assert.equal(look.status, 200);
    assert.deepEqual(Buffer.from(await look.arrayBuffer()), modal.png);

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(PROXY_KEY), false);
    assert.equal(serialized.includes(PROXY_SECRET), false);
  });
});

describe('when the Modal function fails', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal({ status: 500 });
    backend = await startBackend({
      FAL_KEY: '',
      ONME_TRYON_PROVIDER: 'modal',
      ONME_MODAL_URL: modal.base,
      MODAL_PROXY_KEY: PROXY_KEY,
      MODAL_PROXY_SECRET: PROXY_SECRET,
    });
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('the app is told the picture could not be made, and nothing is faked', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.look, undefined);
    assert.match(body.error, /could not make that picture/);
  });

  test('the log says why it failed, and the app is not told', async () => {
    const response = await backend.tryOn(requestBody());
    const body = await response.text();

    assert.match(backend.logs(), /try-on failed after \d+ms: modal answered HTTP 500/);
    assert.equal(body.includes('modal answered'), false);
  });
});

describe('when Modal answers 200 with something that is not a picture', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal({ contentType: 'application/json', body: Buffer.from('{"ok":true}') });
    backend = await startBackend({
      FAL_KEY: '',
      ONME_TRYON_PROVIDER: 'modal',
      ONME_MODAL_URL: modal.base,
      MODAL_PROXY_KEY: PROXY_KEY,
      MODAL_PROXY_SECRET: PROXY_SECRET,
    });
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('it is reported as a failure, not passed on', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 502);
  });
});

describe('with Modal pinned but not configured', () => {
  let backend;

  before(async () => {
    backend = await startBackend({ FAL_KEY: '', ONME_TRYON_PROVIDER: 'modal' });
  });

  after(async () => {
    await backend?.stop();
  });

  test('the backend says honestly that it cannot make a picture', async () => {
    const health = await backend.health();
    assert.equal(health.tryOnReady, false);
    assert.equal(health.modalConfigured, false);
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 503);
  });
});
