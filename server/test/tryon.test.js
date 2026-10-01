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

import {
  httpPost,
  startBackend,
  startCodexLogin,
  startFakeCodex,
  startFakeFal,
} from './support/harness.js';
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
    // Not `/`: the bare origin is the one route that answers a browser, and it has
    // its own block below.
    for (const [method, path] of [
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

describe('with a Codex subscription as the try-on provider', () => {
  let codex;
  let login;
  let backend;

  before(async () => {
    codex = await startFakeCodex();
    login = startCodexLogin({ expiresInSeconds: 3600 });
    backend = await startBackend({
      // No rented model at all: this is the subscription-only case.
      FAL_KEY: '',
      FAL_API_KEY: '',
      ONME_CODEX_AUTH_PATH: login.authPath,
      ONME_CODEX_BASE: codex.base,
      ONME_MAX_TRYONS_PER_MINUTE: '200',
    });
  });

  after(async () => {
    await backend?.stop();
    await codex?.close();
    login?.cleanup();
  });

  test('/health names the subscription as what makes the picture', async () => {
    const health = await backend.health();

    assert.equal(health.tryOnReady, true);
    assert.equal(health.tryOnProvider, 'codex');
    assert.equal(health.tryOnModel, 'gpt-image-2-codex');
    assert.equal(health.codexConfigured, true);
    assert.equal(health.falConfigured, false);

    // Still nothing key-shaped: no token, no account id, no credential file path.
    const serialized = JSON.stringify(health);
    assert.equal(
      /(apiKey|api_key|secret|bearer|refresh_token|access_token|account-test-123|auth\.json)/i.test(serialized),
      false
    );
  });

  test('two photos come back as a look this backend can serve itself', async () => {
    const response = await backend.tryOn(requestBody());
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.look.model, 'gpt-image-2-codex');
    assert.equal(payload.look.contentType, 'image/png');
    // The size is measured from the picture itself, not taken on trust.
    assert.equal(payload.look.width, 1037);
    assert.equal(payload.look.height, 1516);
    assert.equal(payload.look.preservePose, true);
    assert.match(payload.look.imageUrl, /^http:\/\/127\.0\.0\.1:\d+\/look\/[0-9a-f]{48}$/);
  });

  test('the picture is collectable from the URL the app was given', async () => {
    const payload = await (await backend.tryOn(requestBody())).json();

    const image = await fetch(payload.look.imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), codex.png);

    // Collecting it twice works: a download that fails halfway is retried, and the
    // user has already paid a generation for that picture.
    assert.equal((await fetch(payload.look.imageUrl)).status, 200);
  });

  test('an id that was never handed out is a 404, and the plural route stays gone', async () => {
    assert.equal((await fetch(`${backend.base}/look/${'0'.repeat(48)}`)).status, 404);
    assert.equal((await fetch(`${backend.base}/looks`)).status, 404);
  });

  test('both photos travel to the subscription, in order, and nothing is stored there', async () => {
    await backend.tryOn(requestBody());
    const last = codex.requests.at(-1);

    assert.equal(last.method, 'POST');
    assert.equal(last.url, '/responses');
    assert.match(last.authorization, /^Bearer ey/);
    assert.equal(last.accountId, 'account-test-123');
    assert.equal(last.originator, 'codex_cli_rs');
    assert.ok(last.sessionId.length > 0, 'every try-on gets its own session id');

    const body = codex.lastInput();
    assert.equal(body.store, false, 'nothing is left behind to clean up');
    assert.equal(body.tools[0].type, 'image_generation');

    const content = body.input[0].content;
    assert.match(content[0].text, /IMAGE 1 is the person/);
    const images = content.filter((part) => part.type === 'input_image');
    assert.equal(images.length, 2);
    // Person first, garment second: the instruction names them by position.
    assert.match(images[0].image_url, /^data:image\/png;base64,/);
    assert.match(images[1].image_url, /^data:image\/jpeg;base64,/);
    assert.equal(images[0].image_url.split(',')[1], pngBytes(1024).toString('base64'));
    assert.equal(images[1].image_url.split(',')[1], jpegBytes(512).toString('base64'));
  });

  test('/health reports the pictures waiting to be collected, in numbers only', async () => {
    const before = (await backend.health()).looks.pending;
    await backend.tryOn(requestBody());
    const after = (await backend.health()).looks;

    assert.equal(after.pending, before + 1);
    assert.equal(typeof after.bytes, 'number');
    assert.equal(typeof after.ttlSeconds, 'number');
  });
});

describe('a visitor who opens this hostname in a browser', () => {
  test('the bare root hops to the page that hands out the build', async () => {
    const backend = await startBackend();
    try {
      const response = await fetch(`${backend.base}/`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), 'https://onme-dl.yablokolabs.com/');
      // A hop nobody should keep: the page it names is the living answer.
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), '');
    } finally {
      await backend?.stop();
    }
  });

  test('a HEAD request is answered the same way, so `curl -I` shows the hop', async () => {
    const backend = await startBackend();
    try {
      const response = await fetch(`${backend.base}/`, { method: 'HEAD', redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), 'https://onme-dl.yablokolabs.com/');
    } finally {
      await backend?.stop();
    }
  });

  test('another deployment points the hop somewhere else', async () => {
    const backend = await startBackend({ ONME_DOWNLOAD_URL: 'https://downloads.example.test/onme/' });
    try {
      const response = await fetch(`${backend.base}/`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), 'https://downloads.example.test/onme/');
    } finally {
      await backend?.stop();
    }
  });

  test('with nowhere to send them the answer is not_found, not an invented page', async () => {
    const backend = await startBackend({ ONME_DOWNLOAD_URL: '' });
    try {
      const response = await fetch(`${backend.base}/`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'not_found' });
      // The hop is the only thing that changed: the API answers as it always did.
      assert.equal((await fetch(`${backend.base}/health`)).status, 200);
    } finally {
      await backend?.stop();
    }
  });
});

describe('when the subscription will not make the picture', () => {
  /** A backend whose only provider is a fake subscription, with the given behaviour. */
  async function withCodex(options, run) {
    const codex = await startFakeCodex(options);
    const login = startCodexLogin();
    const backend = await startBackend({
      FAL_KEY: '',
      FAL_API_KEY: '',
      ONME_CODEX_AUTH_PATH: login.authPath,
      ONME_CODEX_BASE: codex.base,
    });
    try {
      await run({ backend, codex });
    } finally {
      await backend.stop();
      await codex.close();
      login.cleanup();
    }
  }

  test('a refused image is a 502, and no picture id is handed out', async () => {
    await withCodex({ refuse: true }, async ({ backend }) => {
      const response = await backend.tryOn(requestBody());
      assert.equal(response.status, 502);

      const payload = await response.json();
      assert.match(payload.error, /could not make that picture/);
      assert.equal(/\/look\//.test(JSON.stringify(payload)), false);

      const health = await backend.health();
      assert.equal(health.tryOnsFailed, 1);
      assert.equal(health.looks.pending, 0, 'a refusal leaves nothing to collect');
      // Why the tool refused stays in the log, never in the answer.
      assert.equal(/refused|image tool/.test(JSON.stringify(health)), false);
    });
  });

  test('a stream that ends without a picture is a 502', async () => {
    await withCodex({ noImage: true }, async ({ backend }) => {
      assert.equal((await backend.tryOn(requestBody())).status, 502);
      assert.equal((await backend.health()).looks.pending, 0);
    });
  });

  test('a rejected token is a 502, and the account is not named in the answer', async () => {
    await withCodex({ status: 401 }, async ({ backend }) => {
      const response = await backend.tryOn(requestBody());
      assert.equal(response.status, 502);
      assert.equal(/401|account-test-123/.test(JSON.stringify(await response.clone().json())), false);
    });
  });
});
