/**
 * The two photos a try-on is made of, validated before the model is billed.
 *
 * This module is pure: it takes the parsed request body and the limits and
 * returns either two usable photos or one reason to refuse. Nothing here reads a
 * request, touches the network or writes anything, which is why every rule below
 * is unit tested without a server.
 *
 * Two things are checked that a `content-type` header cannot tell you:
 *
 *   1. **That the bytes really are an image**, from the file signature rather
 *      than from what the client called it.
 *   2. **That the declared type and the actual bytes agree.** Where they do not,
 *      the bytes win: a client that labels a PNG as `image/jpeg` gets it sent as
 *      a PNG, because that is what the model will actually read.
 *
 * The photos are held as base64 strings in memory for the length of one request
 * and then dropped. Nothing here writes to disk, and nothing logs image data.
 */

/** The two roles a try-on needs. Named so error copy can say which one is wrong. */
export const PHOTO_ROLES = ['person', 'outfit'];

/** What each role is called when talking to the user. */
const ROLE_LABELS = {
  person: 'photo of you',
  outfit: 'outfit photo',
};

/** Image types the try-on model accepts. */
const FORMAT_MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Standard base64, as every image encoder produces it. Whitespace is stripped first. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Identifies an image from its first bytes.
 *
 * Returns `null` for anything unrecognised, including a truncated file. `heic`
 * is recognised on purpose even though it is not supported: it is what an iPhone
 * produces by default, so it needs its own explanation rather than a generic
 * "that is not an image".
 */
export function sniffImageFormat(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }

  // ISO base media file format: 4-byte size, then `ftyp`, then the brand.
  if (bytes.toString('latin1', 4, 8) === 'ftyp') {
    const brand = bytes.toString('latin1', 8, 12).toLowerCase();
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }

  return null;
}

/** Human-readable size for a limit message. */
export function describeBytes(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function refuse(role, reason, statusCode, message) {
  return { ok: false, role, reason, statusCode, message };
}

/**
 * Validates one photo.
 *
 * @param {unknown} value The `{ mimeType, data }` object the client sent.
 * @param {{ role: 'person' | 'outfit', maxBytes: number }} options
 */
export function normalizePhoto(value, { role, maxBytes }) {
  const label = ROLE_LABELS[role] ?? role;

  if (!isRecord(value)) {
    return refuse(role, 'missing', 400, `Send the ${label} as { mimeType, data }.`);
  }

  const declared = String(value.mimeType ?? '')
    .trim()
    .toLowerCase();
  const data = String(value.data ?? '').replace(/\s+/g, '');

  if (data === '') {
    return refuse(role, 'empty', 400, `The ${label} was empty.`);
  }
  if (!BASE64_PATTERN.test(data)) {
    return refuse(role, 'not-base64', 400, `The ${label} was not valid base64 image data.`);
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    return refuse(role, 'empty', 400, `The ${label} was empty.`);
  }
  if (bytes.length > maxBytes) {
    return refuse(
      role,
      'too-large',
      413,
      `The ${label} is larger than the ${describeBytes(maxBytes)} OnMe accepts.`
    );
  }

  const sniffed = sniffImageFormat(bytes);
  if (sniffed === 'heic') {
    return refuse(
      role,
      'unsupported-format',
      415,
      `The ${label} is HEIC, which the try-on model cannot read. Pick a JPEG or PNG, or set the camera to Most Compatible.`
    );
  }
  if (sniffed === null) {
    return refuse(
      role,
      'not-an-image',
      400,
      `The ${label} is not a JPEG, PNG or WebP image.`
    );
  }

  // The bytes decide the type, not the label. `declared` is only read to tell the
  // caller which of the two disagreed, which the log line records as a number.
  return {
    ok: true,
    photo: {
      role,
      mimeType: FORMAT_MIME[sniffed],
      bytes: bytes.length,
      data,
      declaredType: declared,
    },
  };
}

/**
 * Validates both photos of one request.
 *
 * @param {unknown} body The parsed JSON body.
 * @param {{ maxImageBytes: number }} limits
 */
export function normalizePhotos(body, limits) {
  if (!isRecord(body)) {
    return refuse('both', 'bad-body', 400, 'Send a JSON body with a person and an outfit photo.');
  }

  const person = normalizePhoto(body.person, { role: 'person', maxBytes: limits.maxImageBytes });
  if (!person.ok) return person;

  const outfit = normalizePhoto(body.outfit, { role: 'outfit', maxBytes: limits.maxImageBytes });
  if (!outfit.ok) return outfit;

  return { ok: true, photos: { person: person.photo, outfit: outfit.photo } };
}

/**
 * Reads the consent assertion the client sends.
 *
 * This is **an assertion, not a control**: it records that the screen telling the
 * user where their photo goes was on screen when they pressed the button. It is
 * not authentication and it is not a rights claim — the user is the subject of
 * these photos, and the honest thing the server can do is refuse to accept them
 * from a client that does not send it.
 */
export function normalizeConsent(body) {
  const consentAt = isRecord(body) ? String(body.consentAt ?? '').trim() : '';
  if (consentAt === '') {
    return {
      ok: false,
      reason: 'no-consent',
      statusCode: 400,
      message:
        'OnMe will not send a photo of a person to the try-on model without the client asserting the user was told where it goes.',
    };
  }
  return { ok: true, consentAt };
}
