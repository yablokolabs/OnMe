/**
 * A try-on as a job: the app sends the photos, gets an answer at once, and asks
 * again until the picture is made.
 *
 * This is what lets a try-on outlive a slow start on the model's side: the
 * request that carries the photos ends in well under a second, so no proxy in
 * front of this server ever times it out, however long the GPU takes.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startBackend, startFakeModal } from './support/harness.js';
import { jpegBytes, notImageBytes, photo, pngBytes } from './support/fixtures.js';

const ASYNC = { prefer: 'respond-async' };

function requestBody(overrides = {}) {
  return {
    consentAt: new Date(2026, 10, 6, 10, 0, 0).toISOString(),
    person: photo(pngBytes(1024), 'image/png'),
    outfit: photo(jpegBytes(512), 'image/jpeg'),
    ...overrides,
  };
}

async function submit(backend, body = requestBody()) {
  return fetch(`${backend.base}/tryon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...ASYNC },
    body: JSON.stringify(body),
  });
}

async function poll(backend, statusPath) {
  const response = await fetch(`${backend.base}${statusPath}`);
  return { status: response.status, body: await response.json() };
}

/** Polls until the job is no longer pending, or gives up. */
async function waitForJob(backend, statusPath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const answer = await poll(backend, statusPath);
    if (answer.body.status !== 'pending') return answer;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('job stayed pending');
}

function modalEnv(modal) {
  return {
    FAL_KEY: '',
    ONME_TRYON_PROVIDER: 'modal',
    ONME_MODAL_URL: modal.base,
    MODAL_PROXY_KEY: 'k',
    MODAL_PROXY_SECRET: 's',
    ONME_MAX_TRYONS_PER_MINUTE: '200',
  };
}

describe('a try-on sent as a job', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal({ delayMs: 400 });
    backend = await startBackend(modalEnv(modal));
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('is accepted before the model answers, and its picture arrives by polling', async () => {
    const response = await submit(backend);
    assert.equal(response.status, 202);
    const { job } = await response.json();
    assert.equal(typeof job.statusPath, 'string');

    const first = await poll(backend, job.statusPath);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'pending');

    const done = await waitForJob(backend, job.statusPath);
    assert.equal(done.body.status, 'done');
    assert.equal(done.body.look.model, 'fashn-vton-1.5');

    const look = await fetch(done.body.look.imageUrl);
    assert.equal(look.status, 200);
    assert.deepEqual(Buffer.from(await look.arrayBuffer()), modal.png);
  });

  test('a job nobody made is not found', async () => {
    const answer = await poll(backend, '/tryon/jobs/0123456789abcdef0123456789abcdef0123456789abcdef');
    assert.equal(answer.status, 404);
  });

  test('a request without consent is refused at once, not turned into a job', async () => {
    const response = await submit(backend, requestBody({ consentAt: undefined }));
    assert.equal(response.status, 400);
  });

  test('a photo that is not an image is refused at once, not turned into a job', async () => {
    const response = await submit(backend, requestBody({ person: photo(notImageBytes(), 'image/png') }));
    assert.equal(response.status, 400);
  });
});

describe('a job whose model fails', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal({ status: 500, delayMs: 100 });
    backend = await startBackend(modalEnv(modal));
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('ends as failed, with the reason in the log and not in the answer', async () => {
    const response = await submit(backend);
    assert.equal(response.status, 202);
    const { job } = await response.json();

    const failed = await waitForJob(backend, job.statusPath);
    assert.equal(failed.body.status, 'failed');
    assert.match(failed.body.error, /could not make that picture/);
    assert.equal(JSON.stringify(failed.body).includes('modal answered'), false);
    assert.match(backend.logs(), /try-on failed after \d+ms: modal answered HTTP 500/);
  });
});

describe('a job whose connection to the model breaks partway through the picture', () => {
  let modal;
  let backend;

  before(async () => {
    modal = await startFakeModal({ dropMidBody: true });
    backend = await startBackend(modalEnv(modal));
  });

  after(async () => {
    await backend?.stop();
    await modal?.close();
  });

  test('ends as failed instead of staying pending', async () => {
    const response = await submit(backend);
    const { job } = await response.json();

    const failed = await waitForJob(backend, job.statusPath);
    assert.equal(failed.body.status, 'failed');
    assert.match(failed.body.error, /could not make that picture/);
  });
});
