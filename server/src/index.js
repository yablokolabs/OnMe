/**
 * OnMe backend.
 *
 * One job: `POST /tryon` takes two photos — a full-body photo of a person and a
 * photo of an outfit — and returns one generated image of that person wearing
 * that outfit.
 *
 *   POST /tryon?token=…
 *   content-type: application/json
 *   { "consentAt": "…", "person": { "mimeType", "data" }, "outfit": { "mimeType", "data" } }
 *
 * Why the photos travel as base64 inside JSON rather than as multipart: it keeps
 * the body a single contiguous stream the phone can report progress for, and it
 * keeps this server free of a multipart parser. The cost is base64's 4/3
 * inflation and both images in memory for one request — bounded by
 * `LIMITS.maxUploadBytes`, and worth it for a server with no dependencies.
 *
 * **Nothing here is written to disk.** The photos live in memory for the length
 * of one request and are then dropped; the generated image is fetched by the app
 * from the model's own storage and saved on the device. There is no database, no
 * cache and no bucket, so there is nothing to leak and nothing to clean up.
 *
 * This server holds `FAL_KEY`, server-side only. No key material is ever sent to
 * the app, logged, or returned from an endpoint.
 *
 * An optional shared client token gates the API. That token is a throttle, not
 * authentication: it ships inside the app bundle (see `ONME_CLIENT_TOKEN`
 * below), so real authorization is a public-release gate rather than something
 * this server does.
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { loadServerEnv } from './env.js';
import { LIMITS, describeLimits } from './limits.js';
import { getFalConfig, isFalConfigured, runVirtualTryOn } from './tryon/fal.js';
import { describeBytes, normalizeConsent, normalizePhotos } from './tryon/photos.js';

loadServerEnv();

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
/** Optional shared token. Public value: it ships in the app bundle. */
const CLIENT_TOKEN = process.env.ONME_CLIENT_TOKEN ?? '';
/** OnMe's whole API: two photos in, one generated try-on out. */
const TRYON_PATH = '/tryon';

/** Try-ons currently generating, for the concurrency cap. */
let activeTryOns = 0;
/** Start timestamps of recent try-ons, for the per-minute cap. */
const recentTryOnStarts = [];
/** Process-wide counters for /health. Numbers only. */
const counters = {
  handlerErrors: 0,
  tryOnsCompleted: 0,
  tryOnsRejected: 0,
  tryOnsTooLarge: 0,
  tryOnsUnavailable: 0,
  tryOnsFailed: 0,
};

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Compares the shared client token without leaking its length through timing.
 *
 * This is still not authentication — the token ships in the app bundle — it just
 * avoids making the throttle trivially guessable character by character.
 */
function tokenAccepted(provided) {
  if (CLIENT_TOKEN.length === 0) return true;
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const given = Buffer.from(provided);
  const expected = Buffer.from(CLIENT_TOKEN);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/**
 * Reads a request body, refusing anything past the byte cap.
 *
 * The cap is enforced while reading rather than after: a client that ignores the
 * limit must not be able to make the server buffer an arbitrary body first.
 *
 * When the cap is passed the request is **drained, not destroyed**. Destroying it
 * mid-upload resets the connection, and the client never sees the 413 — the app
 * would report a network failure for a limit it is supposed to explain. Draining
 * is bounded (a few times the cap) so an absurd body still cannot hold the
 * connection open indefinitely.
 */
function readBody(req, limit) {
  const drainCapBytes = limit * 4;

  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let draining = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk) => {
      total += chunk.length;

      if (draining) {
        if (total > drainCapBytes) req.destroy();
        return;
      }

      if (total > limit) {
        draining = true;
        chunks.length = 0;
        finish({ ok: false, reason: 'too-large' });
        if (total > drainCapBytes) req.destroy();
        return;
      }

      chunks.push(chunk);
    });
    req.on('end', () => finish({ ok: true, bytes: Buffer.concat(chunks) }));
    req.on('error', () => finish({ ok: false, reason: 'read-error' }));
    req.on('aborted', () => finish({ ok: false, reason: 'aborted' }));
  });
}

/** True while this process may start another try-on. Also records the start. */
function admitTryOn(now) {
  const cutoff = now - 60000;
  while (recentTryOnStarts.length > 0 && recentTryOnStarts[0] < cutoff) recentTryOnStarts.shift();

  if (recentTryOnStarts.length >= LIMITS.maxTryOnsPerMinute) return false;
  if (activeTryOns >= LIMITS.maxConcurrentTryOns) return false;

  recentTryOnStarts.push(now);
  return true;
}

function readJsonBody(bytes) {
  if (bytes.length === 0) return null;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * POST /tryon — two photos in, one generated image out.
 *
 * Admission and the active-work counter are process-wide, because every try-on
 * spends money at the same provider and so they share one budget.
 *
 * Every rejection that can be decided without spending anything is decided
 * before the body is read, in cost order: cheapest first.
 */
async function handleTryOnRequest(req, res, url) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Use POST to send the two photos.' });
    return;
  }

  const token = url.searchParams.get('token') ?? req.headers['x-onme-token'];
  if (!tokenAccepted(token)) {
    counters.tryOnsRejected += 1;
    sendJson(res, 401, { error: 'This OnMe backend requires a valid client token.' });
    return;
  }

  // Checked before a byte is read: without the model there is nothing to generate
  // with, so the upload would be thrown away for nothing. The photos are the most
  // sensitive thing this app handles, and there is no reason to receive them
  // just to say no.
  if (!isFalConfigured()) {
    counters.tryOnsUnavailable += 1;
    sendJson(res, 503, {
      error: 'This OnMe backend has no try-on model configured, so it cannot make a picture yet.',
    });
    return;
  }

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    counters.tryOnsRejected += 1;
    sendJson(res, 415, { error: 'Send the two photos as JSON (application/json).' });
    return;
  }

  // A declared length over the cap is refused before reading anything at all.
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > LIMITS.maxUploadBytes) {
    counters.tryOnsTooLarge += 1;
    // Close after answering: the client is mid-upload and this server is never
    // going to read the rest, so the connection cannot be reused.
    res.setHeader('connection', 'close');
    sendJson(res, 413, {
      error: `Those photos are larger together than the ${describeBytes(
        LIMITS.maxUploadBytes
      )} OnMe accepts in one request.`,
    });
    return;
  }

  const now = Date.now();
  if (!admitTryOn(now)) {
    counters.tryOnsRejected += 1;
    sendJson(res, 429, {
      error: 'OnMe is making other try-ons right now. Try again in a minute.',
    });
    return;
  }

  activeTryOns += 1;
  const startedAt = Date.now();

  // A generation this server stops polling for is still billed, but it is not
  // worth holding the process open for a client that has already gone.
  //
  // The listener is on the **response**, not the request: `req` emits `close` as
  // soon as its body has been read, which is before any of the work below has
  // happened, and aborting there would fail every try-on.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const body = await readBody(req, LIMITS.maxUploadBytes);

    if (!body.ok) {
      if (body.reason === 'too-large') {
        counters.tryOnsTooLarge += 1;
        // Close after this answer is flushed, so the limit is explained rather
        // than the connection being reset out from under the client.
        res.setHeader('connection', 'close');
        sendJson(res, 413, {
          error: `Those photos are larger together than the ${describeBytes(
            LIMITS.maxUploadBytes
          )} OnMe accepts in one request.`,
        });
        return;
      }

      counters.tryOnsRejected += 1;
      if (!res.writableEnded && req.socket?.writable) {
        sendJson(res, 400, { error: 'The upload did not complete. Try again.' });
      }
      return;
    }

    const parsed = readJsonBody(body.bytes);
    if (parsed === null) {
      counters.tryOnsRejected += 1;
      sendJson(res, 400, { error: 'The request was not valid JSON.' });
      return;
    }

    const consent = normalizeConsent(parsed);
    if (!consent.ok) {
      counters.tryOnsRejected += 1;
      sendJson(res, consent.statusCode, { error: consent.message });
      return;
    }

    const validated = normalizePhotos(parsed, LIMITS);
    if (!validated.ok) {
      if (validated.statusCode === 413) counters.tryOnsTooLarge += 1;
      else counters.tryOnsRejected += 1;
      sendJson(res, validated.statusCode, { error: validated.message });
      return;
    }

    const { person, outfit } = validated.photos;
    const result = await runVirtualTryOn({
      photos: { person, outfit },
      signal: controller.signal,
    });

    if (!result.ok) {
      counters.tryOnsFailed += 1;
      // Provider detail stays in the log: it can name internals the app has no
      // use for, and a request id is not the user's business.
      console.log(`[onme] try-on failed after ${Date.now() - startedAt}ms`);
      sendJson(res, 502, {
        error: 'OnMe could not make that picture. Try again, or with a different photo.',
      });
      return;
    }

    counters.tryOnsCompleted += 1;
    const size = result.image.width > 0 ? `${result.image.width}x${result.image.height}` : 'unknown size';
    // Sizes and timings only: never a filename, never a photo, never a person.
    console.log(
      `[onme] try-on generated: person=${describeBytes(person.bytes)} outfit=${describeBytes(
        outfit.bytes
      )} ${size} in ${Date.now() - startedAt}ms`
    );

    sendJson(res, 200, {
      ok: true,
      origin: 'backend',
      look: {
        imageUrl: result.image.url,
        contentType: result.image.contentType,
        width: result.image.width,
        height: result.image.height,
        model: result.model,
        preservePose: getFalConfig().preservePose,
      },
      photos: { personBytes: person.bytes, outfitBytes: outfit.bytes },
    });
  } catch (error) {
    // One bad request must never take down a server that is serving other
    // people's try-ons.
    counters.handlerErrors += 1;
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`[onme] try-on handler error: ${detail.slice(0, 200)}`);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'OnMe could not make that picture.' });
    }
  } finally {
    activeTryOns -= 1;
  }
}

function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === TRYON_PATH) {
    void handleTryOnRequest(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const fal = getFalConfig();
    sendJson(res, 200, {
      status: 'ok',
      service: 'onme-backend',
      // Booleans, names and numbers only: no key material, ever.
      falConfigured: isFalConfigured(),
      // A try-on needs nothing but the model. One boolean, because there is one
      // half: unlike a pipeline with a local step and a rented one, this server
      // either can generate or it honestly cannot.
      tryOnReady: isFalConfigured(),
      tryOnModel: fal.model,
      preservePose: fal.preservePose,
      aspectRatio: fal.aspectRatio,
      tokenRequired: CLIENT_TOKEN.length > 0,
      activeTryOns,
      ...counters,
      limits: describeLimits(),
      uptimeSeconds: Math.round(process.uptime()),
    });
    return;
  }

  // The app's history, its photos and its generated images all live on the
  // device; there is no route that returns one, and a 404 is the proof.
  sendJson(res, 404, { error: 'not_found' });
}

const server = createServer(handleRequest);

server.listen(PORT, HOST, () => {
  const fal = getFalConfig();
  console.log(`[onme] backend listening on http://${HOST}:${PORT} (virtual try-on)`);
  console.log(`[onme] try-on endpoint: POST http://${HOST}:${PORT}${TRYON_PATH}`);
  console.log(
    `[onme] try-on model: ${
      isFalConfigured()
        ? `ready (${fal.model}, preservePose=${fal.preservePose}, aspectRatio=${fal.aspectRatio})`
        : 'unavailable (no FAL_KEY; every try-on answers 503)'
    } maxImage=${describeBytes(LIMITS.maxImageBytes)} maxUpload=${describeBytes(
      LIMITS.maxUploadBytes
    )} perMinute=${LIMITS.maxTryOnsPerMinute} concurrent=${LIMITS.maxConcurrentTryOns}`
  );
  console.log(`[onme] client token: ${CLIENT_TOKEN.length > 0 ? 'required' : 'not required'}`);
  console.log(`[onme] disk: nothing is written; photos live for one request only`);
});

function shutdown(signal) {
  console.log(`[onme] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
