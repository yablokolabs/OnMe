/**
 * The Codex provider's parts: the credential file, the token refresh, the PNG
 * size read, and the event stream a picture arrives in.
 *
 * Every network call here is injected. Nothing in this file contacts OpenAI, and
 * nothing spends a subscription's quota.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTryOnPrompt,
  ensureAccessToken,
  getCodexConfig,
  isCodexConfigured,
  readCodexAuth,
  readImageFromStream,
  readJwtExpiry,
  readPngSize,
  refreshCodexAuth,
  runVirtualTryOn,
} from '../src/tryon/codex.js';

/** Sets env vars for one test and puts them back however the test ends. */
function withEnv(values, run) {
  const previous = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * A temp directory for one test's credential file, removed however it ends.
 *
 * Awaits the body before cleaning up: a body that writes the credential file
 * after an `await` would otherwise find its directory already gone.
 */
async function withTempDir(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'onme-codex-'));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A JWT-shaped token whose `exp` is `secondsFromNow` away. */
function tokenExpiringIn(secondsFromNow) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

function authDocument({ expiresInSeconds = 3600, refreshToken = 'rt.1.test' } = {}) {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: 'id.test',
      access_token: tokenExpiringIn(expiresInSeconds),
      refresh_token: refreshToken,
      account_id: 'account-123',
    },
    last_refresh: new Date().toISOString(),
  };
}

/** A real PNG signature and a real IHDR size, so the size read is not a guess. */
function pngOf(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** An async iterable of chunks, which is the shape `response.body` has. */
async function* streamOf(chunks) {
  for (const chunk of chunks) yield Buffer.from(chunk, 'utf8');
}

/** One SSE event, as the backend writes them. */
function sse(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function photo() {
  return { mimeType: 'image/png', data: pngOf(8, 8).toString('base64') };
}

test('the Codex config has a default login path and a default model', () => {
  withEnv({ ONME_CODEX_AUTH_PATH: undefined, ONME_CODEX_MODEL: undefined }, () => {
    const config = getCodexConfig();
    assert.equal(config.authPath, path.join(os.homedir(), '.codex', 'auth.json'));
    assert.equal(config.model, 'gpt-6.1-sol');
    assert.equal(config.imageModel, 'gpt-image-2-codex');
    assert.equal(config.base, 'https://chatgpt.com/backend-api/codex');
    assert.equal(config.refresh, true);
  });
});

test('a token expiry is read out of the token itself', () => {
  const inAnHour = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(readJwtExpiry(tokenExpiringIn(3600)) / 1000, inAnHour);

  // Anything unreadable is 0 rather than an exception: an opaque token is still
  // worth sending, and a crash here would be a try-on lost for a header.
  assert.equal(readJwtExpiry('not-a-jwt'), 0);
  assert.equal(readJwtExpiry('a.!!!!.c'), 0);
  assert.equal(readJwtExpiry(''), 0);
});

test('a missing or unusable login is a configuration state, not a crash', async () => {
  await withTempDir((directory) => {
    const missing = path.join(directory, 'nope.json');
    assert.equal(readCodexAuth({ authPath: missing }), null);
    withEnv({ ONME_CODEX_AUTH_PATH: missing }, () => {
      assert.equal(isCodexConfigured(), false);
    });

    const malformed = path.join(directory, 'malformed.json');
    writeFileSync(malformed, '{ this is not json');
    assert.equal(readCodexAuth({ authPath: malformed }), null);

    const noTokens = path.join(directory, 'no-tokens.json');
    writeFileSync(noTokens, JSON.stringify({ auth_mode: 'chatgpt', tokens: {} }));
    assert.equal(readCodexAuth({ authPath: noTokens }), null);
  });
});

test('a login with a token and an account is read', () => {
  withTempDir((directory) => {
    const authPath = path.join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify(authDocument()));

    withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () => {
      assert.equal(isCodexConfigured(), true);
    });

    const auth = readCodexAuth({ authPath });
    assert.match(auth.accessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(auth.accountId, 'account-123');
    assert.equal(auth.refreshToken, 'rt.1.test');
    assert.ok(auth.expiresAt > Date.now());
  });
});

test('the size of the picture is read from its own bytes', () => {
  assert.deepEqual(readPngSize(pngOf(1037, 1516)), { width: 1037, height: 1516 });
  assert.deepEqual(readPngSize(Buffer.from('not a png at all, honestly')), { width: 0, height: 0 });
  assert.deepEqual(readPngSize(Buffer.alloc(4)), { width: 0, height: 0 });
});

test('the instruction names both images and forbids changing the person', () => {
  const prompt = buildTryOnPrompt();
  assert.match(prompt, /IMAGE 1 is the person/);
  assert.match(prompt, /IMAGE 2 is the garment/);
  assert.match(prompt, /same face, same hair, same skin tone/);
});

test('a finished image call is read out of the event stream', async () => {
  const png = pngOf(1037, 1516);
  const stream = streamOf([
    sse({ type: 'response.created' }),
    sse({ type: 'response.output_item.done', item: { type: 'reasoning' } }),
    sse({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: png.toString('base64') } }),
  ]);

  const image = await readImageFromStream({ stream });
  assert.equal(image.ok, true);
  assert.deepEqual(Buffer.from(image.base64, 'base64'), png);
});

test('an event split across chunks is not lost', async () => {
  // The stream arrives in whatever sizes the network chooses; a parser that only
  // reads whole lines would drop the picture whenever a chunk boundary lands
  // inside one — which is most of the time.
  const png = pngOf(64, 64);
  const whole = sse({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: png.toString('base64') } });
  const pieces = [whole.slice(0, 20), whole.slice(20, 75), whole.slice(75)];

  const image = await readImageFromStream({ stream: streamOf(pieces) });
  assert.equal(image.ok, true);
  assert.deepEqual(Buffer.from(image.base64, 'base64'), png);
});

test('a refused image is reported as refused, not as no image', async () => {
  const stream = streamOf([
    sse({ type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'ig_1', status: 'failed' } }),
  ]);

  const image = await readImageFromStream({ stream });
  assert.equal(image.ok, false);
  assert.match(image.error, /refused/);
});

test('a stream that ends without a picture says so', async () => {
  const stream = streamOf([sse({ type: 'response.created' }), sse({ type: 'response.completed' })]);
  const image = await readImageFromStream({ stream });
  assert.equal(image.ok, false);
  assert.match(image.error, /no image/);
});

test('a failed response and a stream error both end the wait', async () => {
  const failed = await readImageFromStream({
    stream: streamOf([sse({ type: 'response.failed', response: { error: { message: 'nope' } } })]),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'nope');

  const errored = await readImageFromStream({
    stream: streamOf([sse({ type: 'error', error: { message: 'overloaded' } })]),
  });
  assert.equal(errored.ok, false);
  assert.equal(errored.error, 'overloaded');
});

test('one try-on sends both photos, in order, to the subscription endpoint', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify(authDocument()));

    const png = pngOf(1037, 1516);
    let seen = null;
    const fetchImpl = async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        status: 200,
        body: streamOf([
          sse({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: png.toString('base64') } }),
        ]),
      };
    };

    const result = await withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () =>
      runVirtualTryOn({ photos: { person: photo(), outfit: photo() }, fetchImpl })
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.image.bytes, png);
    assert.equal(result.image.width, 1037);
    assert.equal(result.image.height, 1516);
    assert.equal(result.image.contentType, 'image/png');
    assert.equal(result.model, 'gpt-image-2-codex');

    assert.equal(seen.url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.match(seen.options.headers.authorization, /^Bearer /);
    assert.equal(seen.options.headers['chatgpt-account-id'], 'account-123');
    assert.equal(seen.options.headers.originator, 'codex_cli_rs');
    assert.ok(seen.options.headers.session_id.length > 0);

    const body = JSON.parse(seen.options.body);
    assert.equal(body.tools[0].type, 'image_generation');
    assert.equal(body.store, false, 'nothing is left on the provider side');
    const parts = body.input[0].content;
    assert.equal(parts.filter((part) => part.type === 'input_image').length, 2);
    assert.match(parts[0].text, /IMAGE 1 is the person/);
  });
});

test('the app never sees a provider status, only a failure', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify(authDocument()));

    const result = await withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () =>
      runVirtualTryOn({
        photos: { person: photo(), outfit: photo() },
        fetchImpl: async () => ({ ok: false, status: 401, body: null }),
      })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'codex request failed: HTTP 401');
  });
});

test('a backend with no login says how to get one', async () => {
  await withTempDir(async (directory) => {
    const result = await withEnv({ ONME_CODEX_AUTH_PATH: path.join(directory, 'absent.json') }, () =>
      runVirtualTryOn({
        photos: { person: photo(), outfit: photo() },
        fetchImpl: async () => {
          throw new Error('the provider must not be called without a login');
        },
      })
    );

    assert.equal(result.ok, false);
    assert.match(result.error, /codex login/);
  });
});

test('a token close to expiry is refreshed and written back', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify(authDocument({ expiresInSeconds: 30 })));

    const fresh = tokenExpiringIn(3600);
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: fresh, refresh_token: 'rt.2.new' }),
      };
    };

    const token = await withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () =>
      ensureAccessToken({ fetchImpl })
    );

    assert.equal(token.ok, true);
    assert.equal(token.accessToken, fresh);
    assert.equal(token.accountId, 'account-123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://auth.openai.com/oauth/token');
    assert.equal(calls[0].body.grant_type, 'refresh_token');
    assert.equal(calls[0].body.refresh_token, 'rt.1.test');
    assert.equal(calls[0].body.client_id, 'app_EMoamEEZ73f0CkXaXp7hrann');

    // The refreshed token is persisted, and the rest of the document survives.
    const stored = JSON.parse(readFileSync(authPath, 'utf8'));
    assert.equal(stored.tokens.access_token, fresh);
    assert.equal(stored.tokens.refresh_token, 'rt.2.new');
    assert.equal(stored.tokens.account_id, 'account-123');
    assert.equal(stored.auth_mode, 'chatgpt');
  });
});

test('a refresh that fails still uses the token that is stored', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    const stored = authDocument({ expiresInSeconds: 30 });
    writeFileSync(authPath, JSON.stringify(stored));

    const token = await withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () =>
      ensureAccessToken({
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      })
    );

    // The API's own rejection is more specific than a bookkeeping failure, so the
    // call goes ahead and reports what actually happened.
    assert.equal(token.ok, true);
    assert.equal(token.accessToken, stored.tokens.access_token);
    assert.match(token.refreshError, /HTTP 500/);
  });
});

test('a fresh token is not refreshed at all', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    const stored = authDocument({ expiresInSeconds: 3600 });
    writeFileSync(authPath, JSON.stringify(stored));

    const token = await withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () =>
      ensureAccessToken({
        fetchImpl: async () => {
          throw new Error('a fresh token must not trigger a refresh');
        },
      })
    );

    assert.equal(token.accessToken, stored.tokens.access_token);
  });
});

test('the refresh can be switched off, and then the stored token is used', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify(authDocument({ expiresInSeconds: 30 })));

    const result = await withEnv(
      { ONME_CODEX_AUTH_PATH: authPath, ONME_CODEX_REFRESH: 'off' },
      () =>
        refreshCodexAuth({
          auth: readCodexAuth({ authPath }),
          fetchImpl: async () => {
            throw new Error('the refresh must not be attempted when it is off');
          },
        })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'codex-refresh-disabled');
  });
});

test('a token with no readable expiry is used as it is', async () => {
  await withTempDir(async (directory) => {
    const authPath = path.join(directory, 'auth.json');
    const document = authDocument();
    document.tokens.access_token = 'opaque-token-with-no-claims';
    writeFileSync(authPath, JSON.stringify(document));

    const token = await withEnv({ ONME_CODEX_AUTH_PATH: authPath }, () =>
      ensureAccessToken({
        fetchImpl: async () => {
          throw new Error('an opaque token must be tried rather than replaced');
        },
      })
    );

    assert.equal(token.ok, true);
    assert.equal(token.accessToken, 'opaque-token-with-no-claims');
  });
});
