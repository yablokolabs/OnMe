/**
 * The Modal try-on client.
 *
 * OnMe's own deployment of FASHN VTON v1.5 (`modal/onme_tryon.py`) runs on a
 * rented GPU on Modal. It is one web endpoint: JSON with the two photos as base64
 * in, the generated PNG out. The endpoint sits behind Modal proxy auth, so it
 * answers only a caller holding `MODAL_PROXY_KEY` and `MODAL_PROXY_SECRET` — this
 * server, and nothing else.
 *
 * The garment category and photo type FASHN needs are decided inside the Modal
 * function from the outfit photo itself, so the app still asks for nothing but
 * two photos.
 */

import { loadServerEnv } from '../env.js';
import { readPngSize } from './codex.js';

loadServerEnv();

const MODEL = 'fashn-vton-1.5';

/**
 * A cold GPU has to be scheduled, start a container and load about 2 GB of
 * weights before the first picture, and Modal can make a function wait minutes
 * for a free GPU. So this is far longer than a warm generation needs, and just
 * under the function's own 600-second limit.
 */
const DEFAULT_TIMEOUT_MS = 540000;

/** Configuration from the environment. Never logged, never returned to a client. */
export function getModalConfig() {
  const timeout = Number(process.env.ONME_MODAL_TIMEOUT_MS);
  return {
    url: String(process.env.ONME_MODAL_URL ?? '').trim(),
    key: String(process.env.MODAL_PROXY_KEY ?? '').trim(),
    secret: String(process.env.MODAL_PROXY_SECRET ?? '').trim(),
    model: MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Whether a URL is fit to carry two photos of a person and the proxy credential:
 * `https`, or plain `http` only to this machine.
 */
function isSafeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
}

/** Whether a try-on can be sent to Modal at all. */
export function isModalConfigured() {
  const config = getModalConfig();
  return isSafeUrl(config.url) && config.key !== '' && config.secret !== '';
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends the two photos to the Modal function and returns the picture it made.
 *
 * @returns {Promise<{ ok: true, image: { bytes: Buffer, contentType: string, width: number, height: number }, model: string } | { ok: false, error: string }>}
 */
export async function runVirtualTryOn({ photos, fetchImpl, signal }) {
  const config = getModalConfig();
  const timeout = AbortSignal.timeout(config.timeoutMs);

  let response;
  try {
    response = await (fetchImpl ?? globalThis.fetch)(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'modal-key': config.key,
        'modal-secret': config.secret,
      },
      body: JSON.stringify({
        person: { data: photos.person.data, mimeType: photos.person.mimeType },
        outfit: { data: photos.outfit.data, mimeType: photos.outfit.mimeType },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // A redirect would carry the photos and the credential to another URL.
      redirect: 'error',
    });
  } catch (error) {
    return { ok: false, error: `modal request failed: ${describe(error).slice(0, 200)}` };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, error: `modal answered HTTP ${response.status}: ${detail.slice(0, 200)}` };
  }

  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { ok: false, error: `modal picture did not arrive: ${describe(error).slice(0, 200)}` };
  }
  const { width, height } = readPngSize(bytes);
  if (width === 0) return { ok: false, error: 'modal answered 200 without a PNG' };

  return { ok: true, image: { bytes, contentType: 'image/png', width, height }, model: config.model };
}
