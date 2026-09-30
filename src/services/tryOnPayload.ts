/**
 * The payload of a try-on, and the answer coming back.
 *
 * Kept free of React Native and of the network so both directions can be tested
 * in plain Node, where there is no device, no picker and no backend. Everything
 * here is a pure function of its arguments.
 */

import type { GeneratedLook, TryOnDraft } from '@/types/onme';

/**
 * Largest single photo OnMe will send. Mirrors `ONME_MAX_IMAGE_BYTES` on the
 * backend: a client that offers more than the server accepts turns a clear rule
 * into a failed upload, so this is the server's number copied deliberately rather
 * than chosen here.
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** One photo on its way to the backend. */
export interface PhotoInput {
  /** Base64 image data, no data-URI prefix. */
  base64: string;
  /** The type the picker produced. Always JPEG in practice — see `photos.ts`. */
  mimeType: string;
  /** Decoded size, when the picker reported one. */
  bytes?: number;
}

/** How big base64 data is once decoded. */
export function estimatePhotoBytes(base64: string): number {
  const trimmed = base64.replace(/\s+/g, '');
  if (trimmed === '') return 0;

  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Whether a picked photo is usable, phrased for the user.
 *
 * Returns null when the photo is fine. This runs on the device **before** an
 * upload, so an oversized photo is a sentence rather than a failed request.
 */
export function describePhotoProblem(photo: PhotoInput | null | undefined): string | null {
  if (!photo || typeof photo.base64 !== 'string' || photo.base64 === '') {
    return 'That photo could not be read. Try picking it again.';
  }

  const mimeType = (photo.mimeType ?? '').toLowerCase();
  if (mimeType !== '' && !mimeType.startsWith('image/')) {
    return 'That file is not an image. Pick a photo instead.';
  }

  const bytes = photo.bytes ?? estimatePhotoBytes(photo.base64);
  if (bytes > MAX_IMAGE_BYTES) {
    return `That photo is larger than the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB OnMe can send. Pick a smaller one.`;
  }

  return null;
}

/**
 * Builds the request body.
 *
 * The photos travel base64-encoded inside JSON rather than as multipart, which
 * keeps the body a single contiguous stream the phone can report progress for and
 * keeps the backend free of a multipart parser.
 */
export function buildTryOnBody(draft: TryOnDraft): {
  consentAt: string;
  person: { mimeType: string; data: string };
  outfit: { mimeType: string; data: string };
} {
  return {
    consentAt: draft.consentAt,
    person: { mimeType: draft.person.mimeType, data: draft.person.base64 },
    outfit: { mimeType: draft.outfit.mimeType, data: draft.outfit.base64 },
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the backend's answer.
 *
 * Returns null rather than throwing, and a payload with no image URL is null
 * rather than a look with an empty picture: a result screen showing nothing would
 * look like the try-on succeeded.
 *
 * `imageUrl` is required to be http(s) because the app downloads it next.
 */
export function normalizeGeneratedLook(value: unknown): GeneratedLook | null {
  if (!isRecord(value)) return null;

  const imageUrl = asString(value.imageUrl);
  if (!/^https?:\/\//i.test(imageUrl)) return null;

  const preservePose = value.preservePose === true;

  return {
    imageUrl,
    contentType: asString(value.contentType),
    width: Math.max(0, Math.round(asNumber(value.width))),
    height: Math.max(0, Math.round(asNumber(value.height))),
    model: asString(value.model),
    // Absent means the model was not asked to keep the pose, so the screen must
    // not claim that it was.
    preservePose,
  };
}

/** The whole `POST /tryon` 200 body, validated. */
export function parseTryOnResponse(value: unknown): GeneratedLook | null {
  if (!isRecord(value)) return null;
  if (value.ok !== true) return null;
  return normalizeGeneratedLook(value.look);
}

/** The error message out of a non-2xx answer, when there is one worth showing. */
export function readBackendError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const error = asString(value.error);
  return error === '' ? null : error;
}
