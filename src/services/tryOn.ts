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

export type TryOnStage =
  | { phase: 'sending'; ratio: number | null }
  | { phase: 'making' };

export type TryOnResult =
  | { ok: true; look: GeneratedLook }
  | { ok: false; error: string };

export interface TryOnOptions {
  onStage?: (stage: TryOnStage) => void;
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
    request.timeout = TRY_ON_TIMEOUT_MS;

    options.onStage?.({ phase: 'sending', ratio: null });

    request.upload.onprogress = (event) => {
      options.onStage?.({
        phase: 'sending',
        ratio: event.lengthComputable && event.total > 0 ? event.loaded / event.total : null,
      });
    };

    // Bytes are up. Everything from here is the model's time, not the network's.
    request.upload.onload = () => options.onStage?.({ phase: 'making' });

    request.onload = () => {
      const payload = parseJson(request.responseText);

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

function parseJson(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
