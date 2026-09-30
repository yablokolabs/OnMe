#!/usr/bin/env node
/**
 * Device-run preflight.
 *
 * Answers one question before you pick up the phone: *will the app's exact
 * endpoint make a picture right now?* It checks the same URL, over the same
 * transport, that the build bakes in.
 *
 * It is deliberately cheap and safe. `GET /health` reports booleans, names and
 * numbers only, and every POST below is rejected **before** any photo is read —
 * one has a non-JSON content type, one omits the consent assertion, one sends
 * bytes that are not an image. No photograph is uploaded, no generation is paid
 * for, and no provider call is made.
 *
 * Usage:
 *   npm run preflight                                    # EXPO_PUBLIC_ONME_BACKEND_URL
 *   npm run preflight -- --url https://onme.example.com
 *   npm run preflight -- --url http://127.0.0.1:8787     # local backend only
 *
 * The URL handling mirrors `src/services/backend.ts`: `https` stays secure. A
 * **release** build (the `preview`/`production` profiles) refuses a non-TLS
 * backend, so `http` is only useful for a development build or a local check.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** scripts/preflight.mjs -> repository root. */
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Loads the app's own `.env`, because only the Expo CLI does that automatically:
 * a plain `npm run` script would otherwise see no `EXPO_PUBLIC_*` values at all.
 * Real environment variables still win (`process.loadEnvFile` never replaces an
 * existing variable), so an explicit export or `--url` always takes precedence.
 */
function loadLocalEnv() {
  const file = path.join(REPO_ROOT, '.env');
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // A malformed .env is not fatal here: the checks below report what is missing.
  }
}

const HEALTH_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 10000;

/** Mirrors the base-URL handling in `src/services/backend.ts`. */
const BACKEND_URL_PATTERN = /^(https?|wss?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i;

function readArgs(argv) {
  const args = {
    url: process.env.EXPO_PUBLIC_ONME_BACKEND_URL ?? '',
    token: process.env.EXPO_PUBLIC_ONME_BACKEND_TOKEN ?? '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--url') args.url = argv[index + 1] ?? '';
    else if (value === '--token') args.token = argv[index + 1] ?? '';
  }
  return args;
}

function report(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

function note(label, detail = '') {
  console.log(`      ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

/** A problem worth knowing about that does not, on its own, block the run. */
function warn(label, detail = '') {
  console.log(`WARN  ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

/** Loopback or private address: reachable only from this machine or its LAN. */
function isPrivateHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '127.0.0.1' ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function parseBackendUrl(baseUrl) {
  const match = BACKEND_URL_PATTERN.exec((baseUrl ?? '').trim().replace(/\/+$/, ''));
  if (!match) return null;

  const scheme = match[1].toLowerCase();
  const secure = scheme === 'https' || scheme === 'wss';
  return { secure, base: `${secure ? 'https' : 'http'}://${match[2]}${match[3] ?? ''}` };
}

async function checkHealth(baseUrl) {
  let response;
  try {
    response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
  } catch (error) {
    return {
      ok: false,
      detail: `GET /health failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) return { ok: false, detail: `GET /health returned HTTP ${response.status}` };

  try {
    return { ok: true, health: await response.json() };
  } catch {
    return { ok: false, detail: 'GET /health returned non-JSON' };
  }
}

/** A body that decodes to bytes which are deliberately not an image. */
function notAnImageBody() {
  return {
    consentAt: new Date().toISOString(),
    person: { mimeType: 'image/png', data: Buffer.from('preflight-probe').toString('base64') },
    outfit: { mimeType: 'image/png', data: Buffer.from('preflight-probe').toString('base64') },
  };
}

/** One rejection the backend must produce without making a picture. */
async function postTryOn(baseUrl, { contentType, body, token = '' }) {
  const query = token === '' ? '' : `?token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(`${baseUrl}/tryon${query}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    let message = '';
    try {
      message = String((await response.json())?.error ?? '');
    } catch {
      message = '';
    }
    return { ok: true, status: response.status, message };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function statusOf(url, method = 'GET') {
  try {
    return (await fetch(url, { method, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })).status;
  } catch {
    return 0;
  }
}

async function main() {
  loadLocalEnv();
  const args = readArgs(process.argv.slice(2));
  const rawBase = args.url.trim() || 'http://127.0.0.1:8787';
  const parsed = parseBackendUrl(rawBase);

  console.log('OnMe preflight — the try-on path\n');

  if (!parsed) {
    report(false, 'backend URL', `"${rawBase}" is not a valid URL. Use https://your-backend.example.com`);
    return;
  }

  const baseUrl = parsed.base;
  const host = new URL(baseUrl).hostname;
  const privateHost = isPrivateHost(host);

  if (parsed.secure) {
    report(true, 'TLS transport', 'https, accepted by release builds');
  } else if (privateHost) {
    warn('TLS transport', `${baseUrl} is http — a release (preview/production) build will refuse to send photos to it`);
  } else {
    report(false, 'TLS transport', `${baseUrl} is http — a release build refuses to send a photo over it`);
    note('use an https URL for the phone', 'a Cloudflare tunnel or the named tunnel gives you one');
  }

  const health = await checkHealth(baseUrl);
  if (!health.ok) {
    report(false, 'backend reachable', health.detail);
    return;
  }
  report(true, 'backend reachable', `${baseUrl}/health`);

  const { health: data } = health;
  const limits = data.limits ?? {};

  report(data.status === 'ok', 'health status', String(data.status));
  report(data.service === 'onme-backend', 'this is the OnMe backend', String(data.service));
  note('model', String(data.tryOnModel ?? '?'));
  note('keeps your pose', String(data.preservePose ?? '?'));
  note('framing', String(data.aspectRatio ?? '?'));
  note(
    'photo ceilings',
    `one photo ${limits.maxImageBytes ?? '?'} B, whole request ${limits.maxUploadBytes ?? '?'} B`
  );
  note('throughput', `${limits.maxTryOnsPerMinute ?? '?'}/min, ${limits.maxConcurrentTryOns ?? '?'} at once`);
  note('in flight now', String(data.activeTryOns ?? '?'));
  note('token required', String(data.tokenRequired ?? '?'));
  note('try-ons made', String(data.tryOnsCompleted ?? '?'));

  // The one thing a device run needs: a backend that can actually generate.
  if (data.tryOnReady === true) {
    report(true, 'ready to make a picture', String(data.tryOnModel));
  } else {
    warn('not ready to make a picture', 'no try-on model configured — the app will say so on screen');
  }

  const serialized = JSON.stringify(data);
  report(
    !/(apiKey|api_key|secret|fal_key|bearer|xi-api)/i.test(serialized),
    'no credential fields in /health',
    'the key stays server-side'
  );

  // The three probes below are decided *after* the model check on purpose: the
  // endpoint answers 503 before it looks at the request when it has no model, so
  // that a photograph is never received for nothing. Only ask for the further
  // refusals when there is a model to generate with and a token to get in with.
  const tryOnReady = data.tryOnReady === true;
  const entitled = data.tokenRequired !== true || args.token !== '';

  if (tryOnReady && entitled) {
    const wrongType = await postTryOn(baseUrl, { contentType: 'multipart/form-data', body: 'probe' });
    report(
      wrongType.ok && wrongType.status === 415,
      'a non-JSON body is refused',
      wrongType.ok ? `HTTP ${wrongType.status}` : wrongType.detail
    );

    const noConsent = await postTryOn(baseUrl, {
      contentType: 'application/json',
      body: { person: {}, outfit: {} },
      token: args.token,
    });
    report(
      noConsent.ok && noConsent.status === 400,
      'a request with no consent assertion is refused',
      noConsent.ok ? `HTTP ${noConsent.status}${noConsent.message ? ` — ${noConsent.message}` : ''}` : noConsent.detail
    );

    const notAnImage = await postTryOn(baseUrl, {
      contentType: 'application/json',
      body: notAnImageBody(),
      token: args.token,
    });
    report(
      notAnImage.ok && notAnImage.status === 400,
      'photos that are not images are refused',
      notAnImage.ok ? `HTTP ${notAnImage.status}${notAnImage.message ? ` — ${notAnImage.message}` : ''}` : notAnImage.detail
    );
  } else if (entitled) {
    const unconfigured = await postTryOn(baseUrl, {
      contentType: 'application/json',
      body: notAnImageBody(),
      token: args.token,
    });
    report(
      unconfigured.ok && unconfigured.status === 503,
      'an unconfigured backend refuses before it reads a photo',
      unconfigured.ok ? `HTTP ${unconfigured.status}` : unconfigured.detail
    );
    note(
      'the 415/400 refusals were not probed',
      'they sit behind the model check, so they need a configured FAL_KEY to be reachable'
    );
  } else {
    note(
      'the request-level refusals were not probed',
      'this backend requires a token and none was supplied, so only the 401 path is reachable'
    );
  }

  // The routes OnMe does not have. A 200 here would mean the phone is talking to
  // something that is not this backend.
  const retired = await statusOf(`${baseUrl}/looks`);
  report(retired === 404, 'the history route is not on the server', `HTTP ${retired}`);

  if (data.tokenRequired === true) {
    const noToken = await postTryOn(baseUrl, {
      contentType: 'application/json',
      body: notAnImageBody(),
    });
    report(
      noToken.ok && noToken.status === 401,
      'the try-on route requires the token this build sends',
      noToken.ok ? `HTTP ${noToken.status}` : noToken.detail
    );

    if (args.token === '') {
      warn('no client token in this shell', 'EXPO_PUBLIC_ONME_BACKEND_TOKEN is empty, so a real try-on would be refused');
    }
  }

  if (process.exitCode === 1) {
    console.log('\nFix the FAIL lines above before starting a phone run.');
    return;
  }

  if (tryOnReady) {
    console.log('\nThe try-on path is reachable from this URL.');
  } else {
    console.log('\nThe backend is reachable, but it cannot make a picture yet: it has no try-on model configured.');
    console.log('A phone run will load, then say so on screen. Set FAL_KEY in the backend .env and restart it first.');
  }

  if (privateHost || !parsed.secure) {
    console.log('NOTE: that was a local check. A phone cannot reach a private address — start with a public https URL.');
  }
  console.log(`Bake this into the build:  EXPO_PUBLIC_ONME_BACKEND_URL=${baseUrl}`);
  console.log('\n(No photo was uploaded, no generation was paid for and no provider call was made.)');
}

await main();
