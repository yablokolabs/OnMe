/**
 * The hand-off between "the model made a picture" and "the phone has it".
 *
 * The rented provider returns a URL and the app downloads from there, so nothing
 * of OnMe's is in the path. The subscription provider returns the picture itself,
 * as bytes, which leaves one question: how do the bytes reach the app without
 * giving it a second API to speak? The answer is this — the backend holds the
 * picture in memory for a few minutes under an unguessable id, and the app
 * downloads it from `GET /look/<id>` exactly as it would download any URL.
 *
 * That is a deliberate trade, and this is what it costs:
 *
 *   - **It is memory, never disk.** The same promise the photos get. A restart
 *     loses every entry, which is a fine outcome for a picture the phone is about
 *     to save anyway.
 *   - **The id is the only key.** 24 random bytes in a URL the app already holds.
 *     It is not authentication; it is a capability, and it expires. The image is
 *     of the user's own body and is reachable only by whoever has that URL.
 *   - **Entries are dropped on expiry, and evicted oldest-first past the cap**, so
 *     a server left running cannot accumulate pictures of people.
 *
 * Reading does not delete. A download that fails halfway is worth retrying, and
 * expiring the entry on first read would turn a flaky connection into a lost
 * try-on the user paid a generation for.
 */

import { randomBytes } from 'node:crypto';

/** How long a generated picture waits to be collected. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;
/** Ceiling on entries, and on the bytes they hold, so memory stays bounded. */
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;

/** @type {Map<string, { bytes: Buffer, contentType: string, width: number, height: number, expiresAt: number }>} */
const entries = new Map();

function positiveInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

export function getLookStoreConfig() {
  return {
    ttlMs: positiveInt('ONME_LOOK_TTL_MS', DEFAULT_TTL_MS),
    maxEntries: positiveInt('ONME_LOOK_MAX_ENTRIES', DEFAULT_MAX_ENTRIES),
    maxBytes: positiveInt('ONME_LOOK_MAX_BYTES', DEFAULT_MAX_BYTES),
  };
}

function totalBytes() {
  let total = 0;
  for (const entry of entries.values()) total += entry.bytes.length;
  return total;
}

/** Drops everything past its expiry. Cheap: there are never many entries. */
export function forgetExpiredLooks(now = Date.now()) {
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id);
  }
}

/** Oldest first, until the store is inside both ceilings. */
function enforceCaps(config) {
  while (entries.size > config.maxEntries || totalBytes() > config.maxBytes) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
  }
}

/**
 * Holds one generated picture and returns the id it can be collected with.
 *
 * @param {{ bytes: Buffer, contentType?: string, width?: number, height?: number }} image
 */
export function rememberLook({ bytes, contentType = 'image/png', width = 0, height = 0 }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error('rememberLook needs the image bytes');
  }

  const config = getLookStoreConfig();
  forgetExpiredLooks();

  const id = randomBytes(24).toString('hex');
  entries.set(id, { bytes, contentType, width, height, expiresAt: Date.now() + config.ttlMs });
  enforceCaps(config);
  return id;
}

/** The picture for one id, or null when it never existed or has expired. */
export function getLook(id) {
  if (typeof id !== 'string' || id === '') return null;

  forgetExpiredLooks();
  const entry = entries.get(id);
  return entry ?? null;
}

/** Numbers only, for /health. Never a picture and never an id. */
export function describeLookStore() {
  forgetExpiredLooks();
  return { pending: entries.size, bytes: totalBytes(), ttlSeconds: Math.round(getLookStoreConfig().ttlMs / 1000) };
}

/** For tests: forget everything. */
export function clearLooks() {
  entries.clear();
}
