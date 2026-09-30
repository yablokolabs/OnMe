#!/usr/bin/env node
/**
 * Generates every image asset the app config points at, from the brand palette.
 *
 * Checked in and reproducible rather than drawn by hand, for the same reason the
 * mark is drawn with views on screen: the icon, the splash and the favicon should
 * never be able to drift away from the colours the app actually uses.
 *
 *   npm run icons
 *
 * The PNG encoder is written out below — roughly sixty lines of it — because the
 * alternative is a build dependency for four flat-colour images. Node's `zlib`
 * does the only hard part.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(REPO_ROOT, 'assets', 'images');
const BRAND = path.join(REPO_ROOT, 'assets', 'brand');

/** Kept in step with `src/constants/theme.ts` by hand — there are two colours. */
const BACKGROUND = [0x0b, 0x0a, 0x0f];
const ACCENT = [0xd8, 0xc4, 0xa2];
const WHITE = [0xff, 0xff, 0xff];

/* ── PNG encoding ─────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit RGBA pixels. One filter (none) per scanline: flat art compresses well. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── The mark ─────────────────────────────────────────────────────────────── */

/** Signed distance to a rounded square centred on the origin. Negative is inside. */
function distanceToRoundedSquare(x, y, half, radius) {
  const qx = Math.abs(x) - half + radius;
  const qy = Math.abs(y) - half + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside;
}

/**
 * Whether a point is inside the mark, in coordinates from -1 to 1.
 *
 * The mark is a frame with a dot in it: you, seen in the mirror.
 */
function inMark(x, y) {
  const FRAME_HALF = 0.74;
  const FRAME_RADIUS = 0.3;
  const FRAME_STROKE = 0.085;
  const DOT_RADIUS = 0.3;

  if (Math.hypot(x, y) <= DOT_RADIUS) return true;
  return Math.abs(distanceToRoundedSquare(x, y, FRAME_HALF, FRAME_RADIUS)) <= FRAME_STROKE / 2;
}

const SUPERSAMPLE = 4;

/**
 * Draws the mark over a background.
 *
 * @param {number} size Output edge in pixels.
 * @param {{ background?: number[], mark?: number[], scale?: number }} options
 *   `scale` shrinks the mark inside the canvas, for the Android safe zone.
 */
function drawMark(size, { background = null, mark = ACCENT, scale = 1 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const unit = (size / 2) * scale;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE - centre) / unit;
          const y = (py + (sy + 0.5) / SUPERSAMPLE - centre) / unit;
          if (inMark(x, y)) covered += 1;
        }
      }

      const alpha = covered / samples;
      const offset = (py * size + px) * 4;

      // The mark is composited over the background, then the whole pixel is
      // given that background's alpha: a transparent canvas stays transparent
      // where nothing was drawn, which is what Android's adaptive layers need.
      const base = background ?? [0, 0, 0];
      const baseAlpha = background ? 255 : 0;

      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          base[channel] + (mark[channel] - base[channel]) * alpha
        );
      }
      pixels[offset + 3] = Math.round(baseAlpha + (255 - baseAlpha) * alpha);
    }
  }

  return encodePng(size, size, pixels);
}

/* ── Outputs ──────────────────────────────────────────────────────────────── */

const OUTPUTS = [
  // The launcher icon, and the same image iOS uses.
  ['icon.png', 1024, { background: BACKGROUND, mark: ACCENT }],
  // Adaptive icons: the system crops the outer third, so the mark is drawn small.
  ['android-icon-foreground.png', 1024, { mark: ACCENT, scale: 0.62 }],
  ['android-icon-background.png', 1024, { background: BACKGROUND }],
  ['android-icon-monochrome.png', 1024, { mark: WHITE, scale: 0.62 }],
  // The splash mark, centred by the plugin over the configured background.
  ['splash-icon.png', 1024, { mark: ACCENT, scale: 0.86 }],
  ['favicon.png', 48, { background: BACKGROUND, mark: ACCENT }],
];

function main() {
  mkdirSync(IMAGES, { recursive: true });
  mkdirSync(BRAND, { recursive: true });

  for (const [name, size, options] of OUTPUTS) {
    const file = path.join(IMAGES, name);
    writeFileSync(file, drawMark(size, options));
    console.log(`wrote assets/images/${name} (${size}×${size})`);
  }

  // The same mark as vectors, for anything that is not a phone.
  writeFileSync(
    path.join(BRAND, 'onme-mark.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2" width="96" height="96">
  <rect x="-0.74" y="-0.74" width="1.48" height="1.48" rx="0.3" ry="0.3"
        fill="none" stroke="#d8c4a2" stroke-width="0.085" />
  <circle cx="0" cy="0" r="0.3" fill="#d8c4a2" />
</svg>
`
  );
  console.log('wrote assets/brand/onme-mark.svg');
}

main();
