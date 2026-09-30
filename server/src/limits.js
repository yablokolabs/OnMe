/**
 * Server-side limits.
 *
 * A public endpoint accepts two images from a device OnMe does not control, and
 * every one it accepts costs money at the try-on model. So every dimension a
 * hostile or merely broken client could grow without bound has an explicit
 * ceiling: the size of one photo, the size of the whole request, how many
 * try-ons may start per minute, and how many may run at once.
 *
 * Everything is overridable by environment variable so a deployment can tune it
 * without a code change, and the values are reported (as numbers) by /health.
 */

import { loadServerEnv } from './env.js';

loadServerEnv();

/** Reads a positive integer override, falling back when unset or nonsense. */
function readLimit(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

export const LIMITS = {
  /** One photo, decoded. A phone photo is 2–6 MB; 12 MB leaves room for a scan. */
  maxImageBytes: readLimit('ONME_MAX_IMAGE_BYTES', 12 * 1024 * 1024),
  /**
   * The whole request body, measured while reading.
   *
   * Two photos travel base64-encoded inside one JSON body, so this has to cover
   * both at 4/3 their decoded size plus the envelope: 2 × 12 MB × 4/3 is 32 MB,
   * and 40 MB leaves room without letting an unbounded body near the process.
   */
  maxUploadBytes: readLimit('ONME_MAX_UPLOAD_BYTES', 40 * 1024 * 1024),
  /** Try-ons started per minute, process-wide. One generation costs money. */
  maxTryOnsPerMinute: readLimit('ONME_MAX_TRYONS_PER_MINUTE', 6),
  /** Generations in flight at once. */
  maxConcurrentTryOns: readLimit('ONME_MAX_CONCURRENT_TRYONS', 2),
};

/** Numbers only: safe to log and to serve from /health. */
export function describeLimits() {
  return { ...LIMITS };
}
