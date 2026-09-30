#!/usr/bin/env node
/**
 * Derives every image the app config points at from the brand logo.
 *
 * `assets/brand/onme-logo.png` is the source of truth. Nothing here draws a mark
 * of its own — the launcher icon, the splash, the adaptive layers and the favicon
 * are all crops and scalings of that one file, so the app's icon can never drift
 * away from the brand the way a hand-drawn placeholder eventually would.
 *
 *   npm run icons
 *
 * This shells out to the system `ffmpeg`, because the logo is a real PNG with a
 * gradient and rounded corners: decoding it in JavaScript would mean writing a
 * codec, and this is a step on a developer's machine rather than something the app
 * ever runs. The two facts about the logo that this script needs — where the tile
 * sits inside its white margin, and how round its corners are — are *measured*
 * from the file rather than hard-coded, so replacing the logo still works.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(REPO_ROOT, 'assets', 'images');
const BRAND = path.join(REPO_ROOT, 'assets', 'brand');
const SOURCE = path.join(BRAND, 'onme-logo.png');

/** The app's own deep indigo, kept in step with `src/constants/theme.ts` and `app.json`. */
const DARK = '0x0B0620';
/** Everything is built on a 1024 canvas, which is what the stores ask for. */
const CANVAS = 1024;
/** The mark inside a splash or adaptive icon, leaving the platform's clear space. */
const MARK = 636;
/** Corner radius of the tile, as a fraction of its side. Measured, then rounded. */
const CORNER_RATIO = 0.115;

const work = mkdtempSync(path.join(tmpdir(), 'onme-icons-'));

function ffmpeg(args) {
  try {
    return execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 30 });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('ffmpeg is required to build the icons from the logo: install it and re-run `npm run icons`.');
    }
    throw error;
  }
}

/** Raw RGB pixels of the source, for measuring the tile. */
function sourcePixels() {
  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', SOURCE],
    { encoding: 'utf8' }
  ).trim();
  const [width, height] = probe.split(',').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`could not read the logo's size (ffprobe said "${probe}")`);
  }
  const raw = ffmpeg(['-i', SOURCE, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return { width, height, data: raw };
}

/** True for a pixel with real colour in it — the tile is a magenta-to-indigo gradient. */
function isTilePixel(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return Math.max(r, g, b) - Math.min(r, g, b) > 25 || (r < 200 && g < 200);
}

/**
 * The square the logo's tile occupies inside its white margin.
 *
 * Scans inward on a coarse grid rather than pixel by pixel: the answer is a crop
 * box, and a few pixels of slop there is invisible once the tile is scaled up.
 */
function measureTile({ width, height, data }) {
  const rowIsTile = (y) => {
    let hits = 0;
    for (let x = 0; x < width; x += 8) if (isTilePixel(data, (y * width + x) * 3)) hits += 1;
    return hits > width / 8 / 3;
  };
  const columnIsTile = (x) => {
    let hits = 0;
    for (let y = 0; y < height; y += 8) if (isTilePixel(data, (y * width + x) * 3)) hits += 1;
    return hits > height / 8 / 3;
  };

  const rows = [];
  for (let y = 0; y < height; y += 4) if (rowIsTile(y)) rows.push(y);
  const columns = [];
  for (let x = 0; x < width; x += 4) if (columnIsTile(x)) columns.push(x);
  if (rows.length === 0 || columns.length === 0) {
    throw new Error('the logo does not contain a coloured tile to crop');
  }

  const side = Math.max(columns[columns.length - 1] - columns[0], rows[rows.length - 1] - rows[0]);
  return { side, x: columns[0], y: rows[0] };
}

/** A rounded-rectangle alpha mask, so the tile's white canvas corners go transparent. */
function roundedMask(radius) {
  const limit = CANVAS - radius;
  const outside = (dx, dy) => `pow(max(${dx},0),2)+pow(max(${dy},0),2)`;
  const corner = (x, y) => `if(gt(${outside(x, y)},pow(${radius},2)),0,`;
  const expression =
    corner(`(${radius})-X`, `(${radius})-Y`) +
    corner(`X-(${limit})`, `(${radius})-Y`) +
    corner(`(${radius})-X`, `Y-(${limit})`) +
    corner(`X-(${limit})`, `Y-(${limit})`) +
    '255))))';

  const out = path.join(work, 'mask.png');
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=white:s=${CANVAS}x${CANVAS}`,
    '-vf', `format=gray,geq=lum='${expression}',format=gray`,
    '-frames:v', '1', out,
  ]);
  return out;
}

/** Lays `input` over a flat colour, centred, at `size` — or over nothing at all. */
function compose({ input, size, out, background }) {
  const overlay = `[1:v]scale=${size}:${size}:flags=lanczos[mark];[0:v][mark]overlay=(W-w)/2:(H-h)/2:format=auto`;
  if (background === null) {
    ffmpeg([
      '-f', 'lavfi', '-i', `color=c=black@0.0:s=${CANVAS}x${CANVAS},format=rgba`,
      '-i', input,
      '-filter_complex', `${overlay},format=rgba`,
      '-frames:v', '1', out,
    ]);
    return;
  }
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${background}:s=${CANVAS}x${CANVAS}`,
    '-i', input,
    '-filter_complex', `${overlay},format=rgb24`,
    '-frames:v', '1', out,
  ]);
}

function main() {
  mkdirSync(IMAGES, { recursive: true });
  const measured = measureTile(sourcePixels());
  const radius = Math.round(measured.side * CORNER_RATIO);

  // The tile on its own, square and with transparent corners: the shape everything
  // else is built from, and the one the app itself shows on screen.
  const square = path.join(work, 'tile-square.png');
  ffmpeg([
    '-i', SOURCE,
    '-vf', `crop=${measured.side}:${measured.side}:${measured.x}:${measured.y},scale=${CANVAS}:${CANVAS}:flags=lanczos`,
    '-frames:v', '1', square,
  ]);

  const mask = roundedMask(radius);
  const tile = path.join(BRAND, 'onme-logo-tile.png');
  ffmpeg(['-i', square, '-i', mask, '-filter_complex', '[0:v]format=rgba[bg];[bg][1:v]alphamerge,format=rgba', '-frames:v', '1', tile]);
  ffmpeg(['-i', tile, '-vf', 'scale=384:384:flags=lanczos', '-frames:v', '1', path.join(BRAND, 'onme-logo-tile-384.png')]);

  // The launcher icon is the square tile full bleed: the launcher masks it, and a
  // pre-rounded icon inside a round mask looks like a bug.
  ffmpeg(['-i', square, '-frames:v', '1', path.join(IMAGES, 'icon.png')]);
  compose({ input: tile, size: MARK, out: path.join(IMAGES, 'splash-icon.png'), background: DARK });
  compose({ input: tile, size: MARK, out: path.join(IMAGES, 'android-icon-foreground.png'), background: null });
  ffmpeg(['-f', 'lavfi', '-i', `color=c=${DARK}:s=${CANVAS}x${CANVAS}`, '-frames:v', '1', path.join(IMAGES, 'android-icon-background.png')]);

  // The themed icon is the same silhouette in white: Android tints it, so only the
  // shape may survive.
  compose({ input: tile, size: MARK, out: path.join(work, 'white.png'), background: null });
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=black@0.0:s=${CANVAS}x${CANVAS},format=rgba`,
    '-i', path.join(work, 'white.png'),
    '-filter_complex', "[1:v]format=gray,format=rgba,geq=r=255:g=255:b=255:a='p(X,Y)',format=rgba[mark];[0:v][mark]overlay=(W-w)/2:(H-h)/2:format=auto",
    '-frames:v', '1', path.join(IMAGES, 'android-icon-monochrome.png'),
  ]);

  ffmpeg(['-i', tile, '-vf', 'scale=48:48:flags=lanczos', '-frames:v', '1', path.join(IMAGES, 'favicon.png')]);

  // Independently derived from the logo every run: if this drifts, the icon is wrong.
  console.log(`OnMe icons rebuilt from assets/brand/onme-logo.png`);
  console.log(`  tile ${measured.side}px at (${measured.x}, ${measured.y}), corner radius ${radius}px`);
  console.log('  assets/images/{icon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome,favicon}.png');
  console.log('  assets/brand/onme-logo-tile{,-384}.png');
}

try {
  main();
} finally {
  rmSync(work, { recursive: true, force: true });
}
