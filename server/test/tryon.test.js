/**
 * The try-on endpoint, over the real wire, against a local fake fal.
 *
 * The production code path runs unchanged: the same routing, the same admission
 * and the same queue client. Only fal is replaced, so these tests cost nothing
 * and need no GPU, no key and no photograph of anyone.
 *
 * What they are for, beyond "it returns an image": that every refusal happens
 * **before** a generation is paid for, that a photo is never received only to be
 * thrown away, and that nothing key-shaped ever reaches the client.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { httpPost, startBackend, startFakeFal } from './support/harness.js';
import { heicBytes, jpegBytes, notImageBytes, pngBytes, photo } from './support/fixtures.js';

const MODEL = 'fal-ai/image-apps-v2/virtual-try-on';
const FAKE_KEY = 'test-key-never-sent-anywhere-real';
const GENERATED_URL = 'https://fal.media.example/onme/generated.png';

/** A well-formed request body. */
function requestBody(overrides = {}) {
  return {
    consentAt: new Date(2026, 8, 30, 10, 0, 0).toISOString(),
    person: photo(pngBytes(1024), 'image/png'),
    outfit: photo(jpegBytes(512), 'image/jpeg'),
    ...overrides,
  };
}

describe('with the try-on model configured', () => {
  let fal;
  let backend;

  before(async () => {
    fal = await startFakeFal();
    backend = await startBackend({
      FAL_QUEUE_BASE: fal.base,
      ONME_MAX_TRYONS_PER_MINUTE: '200',
      ONME_CLIENT_TOKEN: '',
    });
  });

  after(async () => {
    await backend?.stop();
    await fal?.close();
  });

  test('two photos come back as one generated look', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.origin, 'backend');
    assert.equal(payload.look.imageUrl, GENERATED_URL);
    assert.equal(payload.look.contentType, 'image/png');
    assert.equal(payload.look.width, 768);
    assert.equal(payload.look.height, 1024);
    assert.equal(payload.look.model, MODEL);
    // The product promise, echoed back so the screen can state it.
    assert.equal(payload.look.preservePose, true);
    // Sizes are the server's own measurement of what it received.
    assert.equal(payload.photos.personBytes, pngBytes(1024).length);
    assert.equal(payload.photos.outfitBytes, jpegBytes(512).length);
  });

  test('the model is asked for a try-on with both photos inline and the pose kept', async () => {
    await backend.tryOn(requestBody());

    const submission = fal.lastSubmission();
    assert.equal(submission.path, `/${MODEL}`);
    assert.equal(submission.authorization, `Key ${FAKE_KEY}`);

    const input = fal.lastInput();
    assert.equal(input.preserve_pose, true);
    assert.equal(input.aspect_ratio, '3:4');
    assert.match(input.person_image_url, /^data:image\/png;base64,/);
    assert.match(input.clothing_image_url, /^data:image\/jpeg;base64,/);
    // Byte for byte: the photo the model receives is the photo that was sent.
    assert.equal(input.person_image_url.split(',')[1], pngBytes(1024).toString('base64'));
    assert.equal(input.clothing_image_url.split(',')[1], jpegBytes(512).toString('base64'));
  });

  test('the photo the bytes describe is the one that gets sent', async () => {
    // A PNG labelled as a JPEG: the model must receive a PNG data URI, because
    // passing the label along would describe a file that is not there.
    await backend.tryOn(requestBody({ person: photo(pngBytes(256), 'image/jpeg') }));
    assert.match(fal.lastInput().person_image_url, /^data:image\/png;base64,/);
  });

  test('nothing key-shaped and no photo path travels back to the client', async () => {
    const response = await backend.tryOn(requestBody());
    const serialized = JSON.stringify(await response.json());

    assert.equal(/(apiKey|api_key|secret|fal_key|authorization|Key test-)/i.test(serialized), false);
    // No local path is ever named: this server has no storage to name.
    assert.equal(/\/tmp\/|\/home\/|file:\/\//.test(serialized), false);
  });

  test('a request without the consent assertion is refused before the model is called', async () => {
    const before = fal.submissions().length;
    const response = await backend.tryOn(requestBody({ consentAt: undefined }));
    assert.equal(response.status, 400);

    const payload = await response.json();
    assert.match(payload.error, /will not send a photo of a person/);
    // Nothing was billed: the request never reached the model.
    assert.equal(fal.submissions().length, before);
  });

  test('a missing outfit is refused by the name the user would recognise', async () => {
    const response = await backend.tryOn(requestBody({ outfit: undefined }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /outfit photo/);
  });

  test('a photo that is not an image is refused, and the format is named', async () => {
    const response = await backend.tryOn(requestBody({ person: photo(notImageBytes(), 'image/png') }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /not a JPEG, PNG or WebP image/);
  });

  test('a HEIC photo is refused with the fix, not just the problem', async () => {
    const response = await backend.tryOn(requestBody({ person: photo(heicBytes(), 'image/heic') }));
    assert.equal(response.status, 415);

    const payload = await response.json();
    assert.match(payload.error, /JPEG or PNG/);
    assert.match(payload.error, /Most Compatible/);
  });

  test('a photo over the per-image ceiling is refused with the size in the message', async () => {
    const response = await backend.tryOn(
      requestBody({ person: photo(pngBytes(12 * 1024 * 1024 + 1024), 'image/png') })
    );
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /larger than the 12 MB/);
  });

  test('a body that is not JSON is refused before it is parsed as a body', async () => {
    const response = await backend.tryOn(null, { contentType: 'multipart/form-data; boundary=x' });
    assert.equal(response.status, 415);
    assert.match((await response.json()).error, /application\/json/);
  });

  test('a body that claims to be JSON and is not is refused', async () => {
    const response = await backend.tryOn(null, { raw: '{"person":' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /not valid JSON/);
  });

  test('a GET is refused: the photos only travel one way', async () => {
    const response = await fetch(`${backend.base}/tryon`);
    assert.equal(response.status, 405);
    assert.match((await response.json()).error, /Use POST/);
  });

  test('/health reports a ready model, the effective limits, and no key material', async () => {
    const health = await backend.health();

    assert.equal(health.status, 'ok');
    assert.equal(health.service, 'onme-backend');
    assert.equal(health.tryOnReady, true);
    assert.equal(health.falConfigured, true);
    assert.equal(health.tryOnModel, MODEL);
    assert.equal(health.preservePose, true);
    assert.equal(health.aspectRatio, '3:4');
    assert.equal(health.tokenRequired, false);
    assert.equal(typeof health.uptimeSeconds, 'number');
    assert.equal(typeof health.activeTryOns, 'number');

    // Counters, so an operator can tell a broken pipeline from a quiet one.
    for (const counter of [
      'tryOnsCompleted',
      'tryOnsRejected',
      'tryOnsTooLarge',
      'tryOnsUnavailable',
      'tryOnsFailed',
      'handlerErrors',
    ]) {
      assert.equal(typeof health[counter], 'number', `${counter} must be reported`);
    }
    assert.ok(health.tryOnsCompleted > 0, 'a completed try-on must be counted');

    // Numbers only.
    assert.equal(typeof health.limits.maxImageBytes, 'number');
    assert.equal(typeof health.limits.maxUploadBytes, 'number');
    assert.equal(typeof health.limits.maxTryOnsPerMinute, 'number');
    assert.equal(typeof health.limits.maxConcurrentTryOns, 'number');

    const serialized = JSON.stringify(health);
    assert.equal(/(apiKey|api_key|secret|fal_key|xi-api|bearer|test-key)/i.test(serialized), false);
  });

  test('the routes this server does not have answer 404, including the old ones', async () => {
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/looks'],
      ['POST', '/debrief'],
      ['GET', '/sessions/abc/stream'],
    ]) {
      const response = await fetch(`${backend.base}${path}`, { method });
      assert.equal(response.status, 404, `${method} ${path} must not exist`);
    }
  });
});

describe('with no model configured', () => {
  let fal;
  let backend;

  before(async () => {
    fal = await startFakeFal();
    // An empty FAL_KEY wins over anything in a .env file, so this server really
    // is unconfigured.
    backend = await startBackend({ FAL_QUEUE_BASE: fal.base, FAL_KEY: '' });
  });

  after(async () => {
    await backend?.stop();
    await fal?.close();
  });

  test('the photos are refused up front rather than received and thrown away', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /no try-on model configured/);

    // Not a single request was made, and no photo was read.
    assert.equal(fal.submissions().length, 0);
  });

  test('/health says plainly that it cannot make a picture', async () => {
    const health = await backend.health();
    assert.equal(health.status, 'ok');
    assert.equal(health.tryOnReady, false);
    assert.equal(health.falConfigured, false);
    assert.equal(health.tryOnsUnavailable, 1);
  });
});

describe('when the model fails', () => {
  test('a rejected submission is a 502, and the photos are not the problem', async () => {
    const fal = await startFakeFal({ submitStatus: 500 });
    const backend = await startBackend({ FAL_QUEUE_BASE: fal.base });
    try {
      const response = await backend.tryOn(requestBody());
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /could not make that picture/);

      const health = await backend.health();
      assert.equal(health.tryOnsFailed, 1);
      assert.equal(health.tryOnsCompleted, 0);
      // The provider's own words stay in the log, never in the answer.
      assert.equal(/fake fal submit failure/.test(JSON.stringify(health)), false);
    } finally {
      await backend.stop();
      await fal.close();
    }
  });

  test('a completed job that carries an error is a failure, not a result', async () => {
    const fal = await startFakeFal({ modelError: 'runner exploded' });
    const backend = await startBackend({ FAL_QUEUE_BASE: fal.base });
    try {
      const response = await backend.tryOn(requestBody());
      assert.equal(response.status, 502);
      assert.equal((await backend.health()).tryOnsFailed, 1);
    } finally {
      await backend.stop();
      await fal.close();
    }
  });

  test('a completed job with no image in it is a failure, never an empty picture', async () => {
    const fal = await startFakeFal({ result: { detail: 'no images here' } });
    const backend = await startBackend({ FAL_QUEUE_BASE: fal.base });
    try {
      const response = await backend.tryOn(requestBody());
      assert.equal(response.status, 502);
    } finally {
      await backend.stop();
      await fal.close();
    }
  });
});

describe('with a shared token and a low rate limit', () => {
  let fal;
  let backend;

  before(async () => {
    fal = await startFakeFal();
    backend = await startBackend({
      FAL_QUEUE_BASE: fal.base,
      ONME_CLIENT_TOKEN: 'shared-throttle-token',
      ONME_MAX_TRYONS_PER_MINUTE: '2',
    });
  });

  after(async () => {
    await backend?.stop();
    await fal?.close();
  });

  test('a wrong token is refused, and no photo is read', async () => {
    const before = fal.submissions().length;
    const response = await backend.tryOn(requestBody(), { token: 'not-the-token' });
    assert.equal(response.status, 401);
    assert.equal(fal.submissions().length, before);
  });

  test('a missing token is refused when the backend requires one', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 401);
  });

  test('the right token gets through, and /health admits a token is required', async () => {
    const response = await backend.tryOn(requestBody(), { token: 'shared-throttle-token' });
    assert.equal(response.status, 200);
    assert.equal((await backend.health()).tokenRequired, true);
  });

  test('the try-on past the minute\'s allowance is refused rather than billed', async () => {
    // One was admitted by the test above, so this is the second of the two the
    // limit allows.
    const allowed = await backend.tryOn(requestBody(), { token: 'shared-throttle-token' });
    assert.equal(allowed.status, 200);

    const refused = await backend.tryOn(requestBody(), { token: 'shared-throttle-token' });
    assert.equal(refused.status, 429);
    assert.match((await refused.json()).error, /Try again in a minute/);

    const health = await backend.health();
    // A 429 is counted as rejected, not as a failure at the provider.
    assert.equal(health.tryOnsFailed, 0);
    assert.ok(health.tryOnsRejected >= 3);
  });
});

describe('with a small upload ceiling', () => {
  let fal;
  let backend;

  before(async () => {
    fal = await startFakeFal();
    backend = await startBackend({ FAL_QUEUE_BASE: fal.base, ONME_MAX_UPLOAD_BYTES: '4096' });
  });

  after(async () => {
    await backend?.stop();
    await fal?.close();
  });

  test('a body over the ceiling is refused while reading, with the limit explained', async () => {
    // One photo big enough to push the JSON body past the 4 KB ceiling.
    const response = await backend.tryOn(requestBody({ person: photo(pngBytes(4096), 'image/png') }));
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /larger together than the/);
    assert.equal(fal.submissions().length, 0);
  });

  test('a declared length over the ceiling is refused before a byte is read', async () => {
    const result = await httpPost(`${backend.base}/tryon`, {
      headers: { 'content-type': 'application/json', 'content-length': '99999999' },
      body: '',
    });
    assert.equal(result.status, 413);
  });

  test('an abandoned upload does not take the server down with it', async () => {
    // A half-sent body: the client says it is sending far more than it does.
    try {
      await httpPost(`${backend.base}/tryon`, {
        headers: { 'content-type': 'application/json', 'content-length': '99999999' },
        body: '',
      });
    } catch {
      // The connection being dropped is an acceptable outcome for this client.
    }

    const health = await backend.health();
    assert.equal(health.status, 'ok');
    assert.equal(health.activeTryOns, 0);
  });
});
