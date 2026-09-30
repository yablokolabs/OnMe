/**
 * The request itself: what it sends, and what it does with each answer.
 *
 * `XMLHttpRequest` is stubbed because it is the browser/React Native API, not our
 * code — the module under test is the real one that ships. The stub exists to
 * drive `upload.onprogress`, `upload.onload` and `onload` from a test, which is
 * the only way to pin the phase boundary the screen depends on: everything before
 * `onload` on the upload is the network, everything after is the model.
 *
 * The backend URL is set before the app module is imported, because the module
 * reads `EXPO_PUBLIC_ONME_BACKEND_URL` once, at load.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.EXPO_PUBLIC_ONME_BACKEND_URL = 'https://onme.example.com';
process.env.EXPO_PUBLIC_ONME_BACKEND_TOKEN = 'shared-token';

/** A minimal XMLHttpRequest the tests can steer. */
class FakeXhr {
  static instances = [];
  static respond = null;

  constructor() {
    this.upload = {};
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    FakeXhr.instances.push(this);
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  send(body) {
    this.body = body;
    FakeXhr.respond?.(this);
  }
}

globalThis.XMLHttpRequest = FakeXhr;

const { requestTryOn } = await import('../../src/services/tryOn.ts');

const draft = {
  person: { base64: 'PERSON', mimeType: 'image/jpeg' },
  outfit: { base64: 'OUTFIT', mimeType: 'image/jpeg' },
  consentAt: '2026-09-30T10:00:00.000Z',
};

/** Runs one request with `respond` steering the fake. */
async function send(response, { observe } = {}) {
  FakeXhr.instances.length = 0;
  FakeXhr.respond = (xhr) => response(xhr);

  const stages = [];
  const result = await requestTryOn(draft, { onStage: (stage) => stages.push(stage) });

  return { result, stages, xhr: FakeXhr.instances.at(-1), observe };
}

test('the request goes to the configured backend, as JSON, with the token', async () => {
  const { result, xhr } = await send((fake) => {
    fake.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    fake.upload.onload?.();
    fake.status = 200;
    fake.responseText = JSON.stringify({
      ok: true,
      look: { imageUrl: 'https://fal.media.example/look.png', preservePose: true, width: 768, height: 1024 },
    });
    fake.onload?.();
  });

  assert.equal(result.ok, true);
  assert.equal(result.look.imageUrl, 'https://fal.media.example/look.png');
  assert.equal(result.look.preservePose, true);

  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://onme.example.com/tryon?token=shared-token');
  assert.equal(xhr.headers['content-type'], 'application/json');

  // The body is the two photos and the consent assertion, and nothing else.
  const body = JSON.parse(xhr.body);
  assert.deepEqual(body, {
    consentAt: '2026-09-30T10:00:00.000Z',
    person: { mimeType: 'image/jpeg', data: 'PERSON' },
    outfit: { mimeType: 'image/jpeg', data: 'OUTFIT' },
  });
});

test('the phases are upload, then model — with no phase invented in between', async () => {
  const { stages } = await send((fake) => {
    fake.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    fake.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    fake.upload.onload?.();
    fake.status = 200;
    fake.responseText = JSON.stringify({ ok: true, look: { imageUrl: 'https://fal.media.example/a.png' } });
    fake.onload?.();
  });

  assert.deepEqual(stages, [
    { phase: 'sending', ratio: null },
    { phase: 'sending', ratio: 0.5 },
    { phase: 'sending', ratio: 1 },
    { phase: 'making' },
  ]);
});

test('a progress event that cannot be measured is reported as unmeasurable', async () => {
  // A chunked upload has no total, and a bar drawn from a guessed total would be
  // a lie about how much is left.
  const { stages } = await send((fake) => {
    fake.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });
    fake.status = 200;
    fake.responseText = JSON.stringify({ ok: true, look: { imageUrl: 'https://fal.media.example/a.png' } });
    fake.onload?.();
  });

  assert.deepEqual(stages[1], { phase: 'sending', ratio: null });
});

test('a 200 with no picture in it is a failure, never an empty screen', async () => {
  const { result } = await send((fake) => {
    fake.status = 200;
    fake.responseText = JSON.stringify({ ok: true, look: {} });
    fake.onload?.();
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /could not read the picture/);
});

test('a 200 that is not JSON at all is a failure, not a crash', async () => {
  const { result } = await send((fake) => {
    fake.status = 200;
    fake.responseText = '<html>gateway</html>';
    fake.onload?.();
  });

  assert.equal(result.ok, false);
});

test("the backend's own words are used when it sends any", async () => {
  const { result } = await send((fake) => {
    fake.status = 429;
    fake.responseText = JSON.stringify({ error: 'OnMe is making other try-ons right now. Try again in a minute.' });
    fake.onload?.();
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'OnMe is making other try-ons right now. Try again in a minute.');
});

test('a failure with no explanation gets one the user can act on', async () => {
  const cases = [
    { status: 502, pattern: /could not make that picture/ },
    { status: 503, pattern: /could not make that picture/ },
    { status: 413, pattern: /too large|smaller photo/ },
    { status: 500, pattern: /could not make that picture/ },
  ];

  for (const { status, pattern } of cases) {
    const { result } = await send((fake) => {
      fake.status = status;
      fake.responseText = '';
      fake.onload?.();
    });
    assert.equal(result.ok, false, `HTTP ${status} must fail`);
    assert.match(result.error, pattern, `HTTP ${status} needs a usable message`);
  }
});

test('a network failure and a timeout are told apart from a refusal', async () => {
  const offline = await send((fake) => fake.onerror?.());
  assert.match(offline.result.error, /could not reach its backend/);

  const slow = await send((fake) => fake.ontimeout?.());
  assert.match(slow.result.error, /took too long/);

  const cancelled = await send((fake) => fake.onabort?.());
  assert.match(cancelled.result.error, /cancelled/);
});

test('the request only settles once, whatever the transport reports afterwards', async () => {
  // A late `onerror` after a delivered response must not overwrite the answer.
  const { result } = await send((fake) => {
    fake.status = 200;
    fake.responseText = JSON.stringify({ ok: true, look: { imageUrl: 'https://fal.media.example/a.png' } });
    fake.onload?.();
    fake.onerror?.();
  });

  assert.equal(result.ok, true);
});
