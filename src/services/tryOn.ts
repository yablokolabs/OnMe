/**
 * Sending the two photos and waiting for the picture.
 *
 * This is the only module that talks to the OnMe backend. It uses
 * `XMLHttpRequest` rather than `fetch` for one reason: `upload.onprogress` is
 * what lets the screen say how much of the photos has actually gone up. A
 * generation takes seconds, and a spinner that cannot distinguish "still
 * uploading" from "the model is working" is the difference between waiting and
 * wondering.
 *
 * The phase boundary is real, not a timer: the upload completing is a fact the
 * browser reports, and everything after it is genuinely the model.
 */

import { resolveTryOnEndpoint } from '@/services/backend';
import {
  buildTryOnBody,
  parseTryOnResponse,
  readBackendError,
} from '@/services/tryOnPayload';
import type { GeneratedLook, TryOnDraft } from '@/types/onme';

/** A generation is seconds; a phone on a bad connection needs more than that. */
const TRY_ON_TIMEOUT_MS = 180_000;

/**
 * How long the app waits for a job. A cold start that has to wait for a free GPU
 * can take minutes; the backend gives up on the model a little before this.
 */
const JOB_DEADLINE_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 3_000;

const JOB_GONE = 'That picture is no longer on the server. Try again.';
const COULD_NOT_MAKE = 'OnMe could not make that picture. Try again.';

export type TryOnStage =
  | { phase: 'sending'; ratio: number | null }
  | { phase: 'making' };

export type TryOnResult =
  | { ok: true; look: GeneratedLook }
  | { ok: false; error: string };

export interface TryOnOptions {
  onStage?: (stage: TryOnStage) => void;
  /** How long to wait between two questions about a job. */
  pollIntervalMs?: number;
}

/**
 * Sends one try-on.
 *
 * Resolves with a result rather than throwing: every outcome here is something
 * the screen has to say to the user, and an exception would only turn a sentence
 * into a stack trace.
 */
export function requestTryOn(draft: TryOnDraft, options: TryOnOptions = {}): Promise<TryOnResult> {
  const endpoint = resolveTryOnEndpoint();
  if ('error' in endpoint) {
    return Promise.resolve({ ok: false, error: endpoint.error });
  }

  const body = JSON.stringify(buildTryOnBody(draft));

  return new Promise<TryOnResult>((resolve) => {
    const request = new XMLHttpRequest();
    let settled = false;

    const finish = (result: TryOnResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    request.open('POST', endpoint.url);
    request.setRequestHeader('content-type', 'application/json');
    // Ask for a job: the backend answers as soon as the photos are up, and the
    // picture is collected by polling. A backend that does not know jobs answers
    // with the picture, as before.
    request.setRequestHeader('prefer', 'respond-async');
    request.timeout = TRY_ON_TIMEOUT_MS;

    options.onStage?.({ phase: 'sending', ratio: null });

    // Bytes are up. Everything from here is the model's time, not the network's.
    let making = false;
    const startMaking = () => {
      if (making) return;
      making = true;
      options.onStage?.({ phase: 'making' });
    };

    request.upload.onprogress = (event) => {
      const measurable = event.lengthComputable && event.total > 0;
      options.onStage?.({ phase: 'sending', ratio: measurable ? event.loaded / event.total : null });
      // React Native never dispatches `load` on `upload`, so the last byte is
      // the only signal a phone gets that the upload is done.
      if (measurable && event.loaded >= event.total) startMaking();
    };

    request.upload.onload = startMaking;

    request.onload = () => {
      const payload = parseJson(request.responseText);

      if (request.status === 202) {
        const statusPath = readStatusPath(payload);
        if (statusPath === null) {
          finish({ ok: false, error: COULD_NOT_MAKE });
          return;
        }
        startMaking();
        void pollJob(jobUrl(endpoint.url, statusPath), options.pollIntervalMs ?? POLL_INTERVAL_MS).then(finish);
        return;
      }

      if (request.status >= 200 && request.status < 300) {
        const look = parseTryOnResponse(payload);
        if (!look) {
          // A 200 with no picture in it is a failure, never an empty frame.
          finish({ ok: false, error: 'OnMe could not read the picture it made. Try again.' });
          return;
        }
        finish({ ok: true, look });
        return;
      }

      if (request.status === 413) {
        finish({
          ok: false,
          error:
            readBackendError(payload) ??
            'Those photos are too large to send together. Try a smaller photo of yourself.',
        });
        return;
      }

      if (request.status === 429) {
        finish({
          ok: false,
          error:
            readBackendError(payload) ?? 'OnMe is making other try-ons right now. Try again in a minute.',
        });
        return;
      }

      finish({
        ok: false,
        error: readBackendError(payload) ?? 'OnMe could not make that picture. Try again.',
      });
    };

    request.onerror = () =>
      finish({
        ok: false,
        error: 'OnMe could not reach its backend. Check your connection and try again.',
      });

    request.ontimeout = () =>
      finish({
        ok: false,
        error: 'That try-on took too long. Try again, or with a smaller photo of yourself.',
      });

    request.onabort = () => finish({ ok: false, error: 'That try-on was cancelled.' });

    request.send(body);
  });
}

function readStatusPath(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const job = (payload as { job?: { statusPath?: unknown } }).job;
  const path = job?.statusPath;
  return typeof path === 'string' && path.startsWith('/') ? path : null;
}

/** The job's URL: same backend and same query (the token) as the try-on itself. */
function jobUrl(tryOnUrl: string, statusPath: string): string {
  const [base, query] = tryOnUrl.split('?', 2);
  const root = base.replace(/\/tryon$/, '');
  return `${root}${statusPath}${query ? `?${query}` : ''}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asks about a job until it has an answer. A dropped poll is not a failed
 * try-on: the picture is still being made, so the next poll simply asks again.
 */
async function pollJob(url: string, intervalMs: number): Promise<TryOnResult> {
  const deadline = Date.now() + JOB_DEADLINE_MS;

  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      await wait(intervalMs);
      continue;
    }

    if (response.status === 404) return { ok: false, error: JOB_GONE };

    const payload = response.ok ? parseJson(await response.text().catch(() => '')) : null;
    const status = (payload as { status?: unknown } | null)?.status;

    if (status === 'done') {
      const look = parseTryOnResponse({ ok: true, look: (payload as { look?: unknown }).look });
      return look ? { ok: true, look } : { ok: false, error: 'OnMe could not read the picture it made. Try again.' };
    }
    if (status === 'failed') return { ok: false, error: readBackendError(payload) ?? COULD_NOT_MAKE };

    await wait(intervalMs);
  }

  return { ok: false, error: 'That try-on took too long. Try again in a few minutes.' };
}

function parseJson(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
