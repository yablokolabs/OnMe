/**
 * The fal.ai queue client, and the one model OnMe runs on it.
 *
 * A try-on is a generated image, and this box has no GPU, so every generation is
 * a rented one. `FAL_KEY` is read in exactly one place — here — and every
 * function returns `{ ok: false }` with a reason when it is unset, which is why
 * a deployment without a key reports `tryOnReady: false` rather than failing in
 * some less honest way.
 *
 * The client is hand-rolled `fetch` rather than `@fal-ai/client`: the surface
 * used here is three endpoints, and the backend's rule is no dependencies at all.
 *
 * Transport (https://fal.ai/docs/documentation/model-apis/inference/queue):
 *   POST {base}/{model}                  -> { request_id, status_url, response_url }
 *   GET  {status_url}?logs=1             -> { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
 *   GET  {response_url}                  -> model-specific result
 *   header: Authorization: Key <FAL_KEY>
 *
 * The queue is used explicitly rather than a blocking subscribe call, because a
 * generation is tens of seconds: polling is what a webhook-less server can do,
 * and `submit` returns the URLs a webhook-based deployment would need instead.
 */

import { loadServerEnv } from '../env.js';

loadServerEnv();

const DEFAULT_BASE = 'https://queue.fal.run';
/** One generation, from queue to result. */
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_POLL_MS = 2500;
/** Backoff ceiling: a busy model can sit in the queue for a while. */
const DEFAULT_MAX_POLL_MS = 12000;

/** Virtual try-on: person photo in, that person wearing the garment out. */
const DEFAULT_TRY_ON_MODEL = 'fal-ai/image-apps-v2/virtual-try-on';
/** Fashion framing. Portrait, because a full-body photo is portrait. */
const DEFAULT_ASPECT_RATIO = '3:4';
const ALLOWED_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export function getFalApiKey() {
  return process.env.FAL_KEY ?? process.env.FAL_API_KEY ?? '';
}

/** Boolean only: never the key, never its length. */
export function isFalConfigured() {
  return getFalApiKey().length > 0;
}

function readPositiveInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

/** Anything but an explicit `false` keeps the pose, which is the product promise. */
function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

export function getFalConfig() {
  const configured = process.env.ONME_ASPECT_RATIO ?? DEFAULT_ASPECT_RATIO;
  return {
    base: process.env.FAL_QUEUE_BASE ?? DEFAULT_BASE,
    timeoutMs: readPositiveInt('FAL_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    pollMs: readPositiveInt('FAL_POLL_MS', DEFAULT_POLL_MS),
    maxPollMs: readPositiveInt('FAL_MAX_POLL_MS', DEFAULT_MAX_POLL_MS),
    model: process.env.ONME_TRY_ON_MODEL ?? DEFAULT_TRY_ON_MODEL,
    aspectRatio: ALLOWED_ASPECT_RATIOS.includes(configured) ? configured : DEFAULT_ASPECT_RATIO,
    preservePose: readBoolean('ONME_PRESERVE_POSE', true),
  };
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps one photo as a data URI.
 *
 * fal accepts public URLs or data URIs. A URL would be better for a real
 * deployment — our own storage, cleaned up on a schedule — but a data URI means
 * the photo is never written to disk anywhere OnMe controls, which is the
 * promise this app makes about a photo of someone's body. It does mean the
 * decoded image is in memory twice for the length of one request.
 */
export function toDataUri(base64, mimeType) {
  return `data:${mimeType};base64,${base64}`;
}

/** Submits to the queue and returns immediately with the tracking URLs. */
async function submit({ model, input, fetchImpl }) {
  const apiKey = getFalApiKey();
  if (apiKey === '') return { ok: false, error: 'fal-not-configured' };

  const config = getFalConfig();
  let response;
  try {
    response = await (fetchImpl ?? globalThis.fetch)(`${config.base}/${model}`, {
      method: 'POST',
      headers: {
        authorization: `Key ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    return { ok: false, error: `fal submit failed: ${describe(error).slice(0, 200)}` };
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      detail = '';
    }
    return {
      ok: false,
      error: `fal submit failed: HTTP ${response.status}${detail ? ` (${detail})` : ''}`,
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: 'fal submit returned a non-JSON response' };
  }

  if (typeof payload?.request_id !== 'string') {
    return { ok: false, error: 'fal submit returned no request_id' };
  }

  return {
    ok: true,
    requestId: payload.request_id,
    statusUrl: payload.status_url,
    responseUrl: payload.response_url,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches a completed result.
 *
 * The submit response returns `.../requests/{id}/response` while the documented
 * result curl uses `.../requests/{id}`. Both are accepted, because a 404 from the
 * first is a routing detail rather than a failed job.
 */
async function fetchResult({ model, requestId, responseUrl, fetchImpl }) {
  const config = getFalConfig();
  const candidates = [responseUrl, `${config.base}/${model}/requests/${requestId}`].filter(
    (url) => typeof url === 'string' && url !== ''
  );

  let lastError = 'fal returned no result URL';
  for (const url of candidates) {
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(url, {
        headers: { authorization: `Key ${getFalApiKey()}` },
        signal: AbortSignal.timeout(120000),
      });
      if (response.ok) return { ok: true, data: await response.json() };
      lastError = `fal result failed: HTTP ${response.status}`;
    } catch (error) {
      lastError = `fal result failed: ${describe(error).slice(0, 200)}`;
    }
  }

  return { ok: false, error: lastError };
}

/**
 * Polls one queued request to completion and returns its result.
 *
 * A completed request can still carry an error in its body, and fal retries a
 * failed runner automatically, so `status === COMPLETED` is not the same as
 * success — both are checked.
 */
async function waitForResult({ model, requestId, statusUrl, responseUrl, fetchImpl, signal, onProgress }) {
  const config = getFalConfig();
  const deadline = Date.now() + config.timeoutMs;
  let delay = config.pollMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return { ok: false, error: 'fal request aborted' };

    let status;
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(
        statusUrl ?? `${config.base}/${model}/requests/${requestId}/status?logs=1`,
        { headers: { authorization: `Key ${getFalApiKey()}` }, signal: AbortSignal.timeout(30000) }
      );
      if (!response.ok) return { ok: false, error: `fal status failed: HTTP ${response.status}` };
      status = await response.json();
    } catch (error) {
      return { ok: false, error: `fal status failed: ${describe(error).slice(0, 200)}` };
    }

    if (status?.status === 'COMPLETED') {
      if (typeof status.error === 'string' && status.error !== '') {
        return { ok: false, error: `fal model error: ${status.error.slice(0, 300)}` };
      }
      return fetchResult({ model, requestId, responseUrl, fetchImpl });
    }

    onProgress?.(status?.status === 'IN_QUEUE' ? `queued ${status.queue_position ?? ''}`.trim() : status?.status);

    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.4), config.maxPollMs);
  }

  return { ok: false, error: `fal request timed out after ${Math.round(config.timeoutMs / 1000)}s` };
}

/**
 * The first generated image, whatever the model chose to call it.
 *
 * The documented output is `{ images: [{ url, content_type, width, height }] }`,
 * but model output schemas drift between versions, so the alternatives are a
 * brittle hard-coded shape or a tolerant search. The search stays shallow and
 * prefers the documented key.
 */
export function pickImage(result) {
  if (!result || typeof result !== 'object') return null;

  const images = Array.isArray(result.images) ? result.images : [];
  for (const entry of images) {
    const url = typeof entry === 'string' ? entry : entry?.url;
    if (typeof url === 'string' && url.startsWith('http')) {
      return {
        url,
        contentType: typeof entry?.content_type === 'string' ? entry.content_type : '',
        width: Number.isFinite(entry?.width) ? entry.width : 0,
        height: Number.isFinite(entry?.height) ? entry.height : 0,
      };
    }
  }

  return findUrlByKeys(result, ['image_url', 'image'], 0);
}

/** Depth-limited search for a URL under one of `matchers`, for a drifted schema. */
function findUrlByKeys(value, matchers, depth) {
  if (depth > 4 || value === null || typeof value !== 'object') return null;

  for (const [key, child] of Object.entries(value)) {
    if (matchers.some((matcher) => key.toLowerCase().includes(matcher))) {
      if (typeof child === 'string' && child.startsWith('http')) {
        return { url: child, contentType: '', width: 0, height: 0 };
      }
      if (child && typeof child === 'object' && typeof child.url === 'string') {
        return { url: child.url, contentType: '', width: 0, height: 0 };
      }
    }
  }

  for (const child of Object.values(value)) {
    const found = findUrlByKeys(child, matchers, depth + 1);
    if (found) return found;
  }

  return null;
}

/**
 * One try-on: a person and a garment in, that person wearing it out.
 *
 * `preserve_pose` is on by default and is the product promise — OnMe shows the
 * outfit on *you*, in your pose, rather than producing a different person who
 * looks good in the clothes.
 *
 * @param {{ person: { mimeType: string, data: string }, outfit: { mimeType: string, data: string } }} photos
 */
export async function runVirtualTryOn({ photos, fetchImpl, signal, onProgress }) {
  const config = getFalConfig();

  const submitted = await submit({
    model: config.model,
    input: {
      person_image_url: toDataUri(photos.person.data, photos.person.mimeType),
      clothing_image_url: toDataUri(photos.outfit.data, photos.outfit.mimeType),
      preserve_pose: config.preservePose,
      aspect_ratio: config.aspectRatio,
    },
    fetchImpl,
  });
  if (!submitted.ok) return submitted;

  onProgress?.(`submitted ${config.model} as ${submitted.requestId}`);

  const result = await waitForResult({ ...submitted, model: config.model, fetchImpl, signal, onProgress });
  if (!result.ok) return result;

  const image = pickImage(result.data);
  if (!image) return { ok: false, error: 'the try-on model returned no image' };

  return { ok: true, requestId: submitted.requestId, image, model: config.model };
}
