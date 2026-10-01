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
 * sits inside its white margin, and where its outline begins on each row and each
 * column — are *measured* from the file rather than hard-coded, so replacing the
 * logo still works.
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
/**
 * The tile inside a splash or adaptive icon.
 *
 * Android guarantees only the middle 66/108ths of an adaptive icon is never clipped, and
 * everything the tile draws lives well inside that, so the tile itself is drawn larger
 * than that clear space: at 636/1024 the launcher's own mask reached past it and the
 * background layer showed around it as a border, which is the one thing the icon must not
 * have. At 696 the tile covers every mask up to the sizes launchers actually use, and the
 * mark inside it still lands between the 48dp and 66dp the platform asks for.
 */
const MARK = 696;
/**
 * How much of the tile's border is cut away before anything is built from it.
 *
 * The tile sits on the logo's white canvas, and its edge is antialiased against it, so
 * the outermost pixels of the tile are a blend towards white rather than the tile's own
 * colour. Left in, that blend is a pale hairline around every derived image — on a phone
 * it reads as a border drawn around the launcher icon — and a crop taken to the tile's
 * outer edge picks it up along with any canvas the two axes disagree about. The tile is
 * measured on a coarse grid, so a trim this size also covers that error.
 */
const TRIM_RATIO = 0.008;

const work = mkdtempSync(path.join(tmpdir(), 'onme-icons-'));

function ffmpeg(args, input) {
  try {
    return execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 30, input });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('ffmpeg is required to build the icons from the logo: install it and re-run `npm run icons`.');
    }
    throw error;
  }
}

/** Raw pixels of an image, for measuring. */
function pixelsOf(file, format = 'rgb24') {
  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }
  ).trim();
  const [width, height] = probe.split(',').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`could not read the size of ${file} (ffprobe said "${probe}")`);
  }
  return { width, height, data: ffmpeg(['-i', file, '-f', 'rawvideo', '-pix_fmt', format, '-']) };
}

/** Raw RGB pixels of the source, for measuring the tile. */
function sourcePixels() {
  return pixelsOf(SOURCE);
}

/** True for a pixel with real colour in it — the tile is a magenta-to-indigo gradient. */
function isTilePixel(data, index) {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  return Math.max(r, g, b) - Math.min(r, g, b) > 25 || (r < 200 && g < 200);
}

/**
 * The box the logo's tile occupies inside its white margin.
 *
 * Scans inward on a coarse grid rather than pixel by pixel: the answer is a crop
 * box, and a few pixels of slop there is invisible once the tile is scaled up. The
 * two axes are measured separately, because the tile is not exactly square — taking
 * one side for both would pull blank canvas into the crop on the shorter axis.
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

  return {
    width: columns[columns.length - 1] - columns[0],
    height: rows[rows.length - 1] - rows[0],
    x: columns[0],
    y: rows[0],
  };
}

/**
 * An alpha mask cut from the tile's own outline, so the logo's canvas corners go.
 *
 * A crop taken to the tile's bounding box still holds the canvas in the four corners,
 * out to where the tile's outline turns away. That outline is not a circle, and not any
 * other curve worth naming — it is whatever the logo drew — so it is measured here in the
 * only way that is exact: each row and each column is scanned for where the artwork
 * begins, and a pixel is kept when it is inside all four of those answers. Nothing is
 * modelled, so nothing can be approximated wrongly.
 *
 * A few pixels are taken from the artwork's side of the outline as well, because the
 * edge itself is a blend towards the canvas the tile was cut from, and that blend is
 * canvas as far as the eye is concerned: left in place it draws the pale border this is
 * all here to prevent.
 */
function outlineMask(file, inset = 3) {
  const { width, height, data } = pixelsOf(file);
  const isArtwork = (x, y) => {
    const i = (y * width + x) * 3;
    return !(data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244);
  };

  const left = new Int32Array(height).fill(-1);
  const right = new Int32Array(height).fill(-1);
  const top = new Int32Array(width).fill(-1);
  const bottom = new Int32Array(width).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isArtwork(x, y)) { left[y] = x; break; }
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      if (isArtwork(x, y)) { right[y] = x; break; }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (isArtwork(x, y)) { top[x] = y; break; }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      if (isArtwork(x, y)) { bottom[x] = y; break; }
    }
  }

  const mask = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside =
        left[y] >= 0 && x >= left[y] + inset &&
        right[y] >= 0 && x <= right[y] - inset &&
        top[x] >= 0 && y >= top[x] + inset &&
        bottom[x] >= 0 && y <= bottom[x] - inset;
      mask[y * width + x] = inside ? 255 : 0;
    }
  }

  const out = path.join(work, 'mask.png');
  ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-i', '-', '-frames:v', '1', out], mask);
  // How far the corners reach into the tile, for the callers that need to keep clear of
  // them rather than cut them.
  const corner = Math.max(left[0], width - 1 - right[0], top[0], height - 1 - bottom[0]);
  return { mask: out, corner };
}

/** Opaque, near-white pixels left in the tile's corners — canvas that survived the cut. */
function cornerCanvas(file) {
  const { width, height, data } = pixelsOf(file, 'rgba');
  const side = Math.floor(width * 0.12);
  let hits = 0;
  for (const [cx, cy] of [
    [0, 0],
    [width - side, 0],
    [0, height - side],
    [width - side, height - side],
  ]) {
    for (let y = cy; y < cy + side; y += 1) {
      for (let x = cx; x < cx + side; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 250 && Math.min(data[i], data[i + 1], data[i + 2]) > 244) hits += 1;
      }
    }
  }
  return hits;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The adaptive icon's background layer: the artwork's own colours, carried past its edge.
 *
 * Android draws an adaptive icon as a background layer and a foreground layer on one
 * 108dp canvas, and the launcher masks the pair to a shape of its choosing. The
 * foreground here is the artwork at MARK, so on any launcher whose mask reaches past the
 * artwork — most do, by a hair or by a lot — whatever the background holds shows as a
 * ring around the logo. A flat colour reads as a border drawn around the icon wherever
 * it differs from the artwork beside it, which is exactly what a customer sees on a home
 * screen: a dark edge on the left and the top, where the artwork is light, and nothing
 * at all on the indigo side.
 *
 * So the background is built from the artwork itself: every pixel takes the colour of one
 * of the artwork's four edges — the position along it it would have had, had the edge
 * continued — and the sides are blended by how far the pixel is from each of them. That
 * is exact just outside a side, and inside the artwork it is what paints the wedges left
 * by the artwork's rounded corners and the fringe under its antialiased edge: both take
 * the colours of the corner they sit in, rather than a blend of all four sides that would
 * show up as a patch of some other colour at each corner of the launcher icon.
 */
function adaptiveBackground(file, { x, y, size }) {
  const art = pixelsOf(file, 'rgba');
  const colourAt = (px, py) => {
    const i = (py * art.width + px) * 4;
    return [art.data[i], art.data[i + 1], art.data[i + 2]];
  };
  const alphaAt = (px, py) => art.data[(py * art.width + px) * 4 + 3];

  // An edge sample is the artwork's colour where the artwork actually begins on that
  // line, found by walking in from the bounding box until it is opaque. The straight
  // sides are opaque from their first pixel, but the rounded corners mean the lines
  // through them start in the clear — and reading those pixels gives black, which is
  // what the wedges behind the artwork's corners are painted from. A few pixels further
  // in is where the sample is taken: the very first opaque pixel around a corner is the
  // antialiased tip of the arc, a blend towards the canvas it was cut from, and a wedge
  // painted in that colour reads as a pale patch at each corner of the icon.
  const edgeColour = (px, py, stepX, stepY) => {
    const settle = Math.max(4, Math.round(size * 0.01));
    for (let step = 0; step < 200; step += 1) {
      if (alphaAt(px + stepX * step, py + stepY * step) > 250) {
        return colourAt(px + stepX * (step + settle), py + stepY * (step + settle));
      }
    }
    return colourAt(px, py);
  };

  const span = size;
  const sides = {
    left: Array.from({ length: span }, (_, i) => edgeColour(x, y + i, 1, 0)),
    right: Array.from({ length: span }, (_, i) => edgeColour(x + size - 1, y + i, -1, 0)),
    top: Array.from({ length: span }, (_, i) => edgeColour(x + i, y, 0, 1)),
    bottom: Array.from({ length: span }, (_, i) => edgeColour(x + i, y + size - 1, 0, -1)),
  };
  const along = (side, at) => {
    const vertical = side === 'left' || side === 'right';
    return sides[side][clamp(at - (vertical ? y : x), 0, span - 1)];
  };

  const pixels = Buffer.alloc(CANVAS * CANVAS * 3);
  for (let py = 0; py < CANVAS; py += 1) {
    for (let px = 0; px < CANVAS; px += 1) {
      // Outside a side the distance to it is the weight, so the pixel takes that side's
      // colour outright. Inside the artwork the weights are inverted — a side is as
      // influential as it is close — so the wedges take the colours of the corner they
      // sit in and the blend stays continuous across the artwork's edge.
      const weight = (outward, inward) => (outward > 0 ? outward : 1 / (1 + inward));
      const weighted = [
        [weight(Math.max(0, x - px), Math.abs(px - x)), along('left', py)],
        [weight(Math.max(0, px - (x + size - 1)), Math.abs(px - (x + size - 1))), along('right', py)],
        [weight(Math.max(0, y - py), Math.abs(py - y)), along('top', px)],
        [weight(Math.max(0, py - (y + size - 1)), Math.abs(py - (y + size - 1))), along('bottom', px)],
      ];
      const total = weighted.reduce((sum, [sideWeight]) => sum + sideWeight, 0);
      const out = (py * CANVAS + px) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[out + channel] = Math.round(
          weighted.reduce((sum, [sideWeight, colour]) => sum + sideWeight * colour[channel], 0) / total
        );
      }
    }
  }

  ffmpeg(
    ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${CANVAS}x${CANVAS}`, '-i', '-', '-frames:v', '1', path.join(IMAGES, 'android-icon-background.png')],
    pixels
  );
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
  // Cut the tile out of its canvas and then step inside its antialiased edge, so no
  // trace of the white canvas survives in anything built from it.
  const trim = Math.max(2, Math.round(Math.min(measured.width, measured.height) * TRIM_RATIO));
  const cropWidth = measured.width - trim * 2;
  const cropHeight = measured.height - trim * 2;

  // The tile on its own, square and with transparent corners: the shape everything
  // else is built from, and the one the app itself shows on screen.
  const square = path.join(work, 'tile-square.png');
  ffmpeg([
    '-i', SOURCE,
    '-vf', `crop=${cropWidth}:${cropHeight}:${measured.x + trim}:${measured.y + trim},scale=${CANVAS}:${CANVAS}:flags=lanczos`,
    '-frames:v', '1', square,
  ]);

  // The mask comes off the artwork rather than a constant — see `outlineMask`.
  const { mask, corner } = outlineMask(square);
  const tile = path.join(BRAND, 'onme-logo-tile.png');
  ffmpeg(['-i', square, '-i', mask, '-filter_complex', '[0:v]format=rgba[bg];[bg][1:v]alphamerge,format=rgba', '-frames:v', '1', tile]);
  ffmpeg(['-i', tile, '-vf', 'scale=384:384:flags=lanczos', '-frames:v', '1', path.join(BRAND, 'onme-logo-tile-384.png')]);

  // The launcher icon is the artwork full bleed, corner to corner.
  //
  // The tile's rounded corners mean its square has empty wedges in it, and a
  // launcher on a round mask shows exactly those wedges. They are filled with the
  // tile's own colours — the inner square, scaled up and blurred — and the tile is
  // laid over that at its own size, so the gradient reaches every edge while the
  // mark keeps the proportions the logo gives it.
  const inner = CANVAS - corner * 2;
  const cornerFill = path.join(work, 'corner-fill.png');
  // Sampled clear of the corner arcs — a strip taken from the tile's own edge would
  // carry the empty wedge with it.
  const inset = corner + 10;
  const vertical = path.join(work, 'edge-vertical.png');
  const horizontal = path.join(work, 'edge-horizontal.png');
  // A column and a row from inside the tile, each stretched across the canvas and
  // averaged: the background is a soft gradient, so where the two agree the fill is
  // the tile's colour and where they differ it is between them.
  ffmpeg(['-i', square, '-vf', `crop=1:${CANVAS}:${inset}:0,scale=${CANVAS}:${CANVAS}:flags=bilinear`, '-frames:v', '1', vertical]);
  ffmpeg(['-i', square, '-vf', `crop=${CANVAS}:1:0:${inset},scale=${CANVAS}:${CANVAS}:flags=bilinear`, '-frames:v', '1', horizontal]);
  ffmpeg([
    '-i', vertical,
    '-i', horizontal,
    '-filter_complex', '[0:v][1:v]blend=all_mode=average,format=rgb24',
    '-frames:v', '1', cornerFill,
  ]);
  ffmpeg([
    '-i', cornerFill,
    '-i', tile,
    '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,format=rgb24',
    '-frames:v', '1', path.join(IMAGES, 'icon.png'),
  ]);
  compose({ input: tile, size: MARK, out: path.join(IMAGES, 'splash-icon.png'), background: DARK });
  const foreground = path.join(IMAGES, 'android-icon-foreground.png');
  compose({ input: tile, size: MARK, out: foreground, background: null });
  adaptiveBackground(foreground, { x: (CANVAS - MARK) / 2, y: (CANVAS - MARK) / 2, size: MARK });

  // The themed icon is the artwork's shape in white: Android tints it, so only the
  // silhouette may survive, and that silhouette is the artwork's own alpha channel.
  // (Read from luminance instead, as this once was, the layer comes out as an opaque
  // white square and Android tints a blank tile.)
  compose({ input: tile, size: MARK, out: path.join(work, 'white.png'), background: null });
  ffmpeg([
    '-i', path.join(work, 'white.png'),
    '-filter_complex',
    '[0:v]format=rgba,alphaextract[shape];color=c=white:s=1024x1024,format=rgba[white];[white][shape]alphamerge,format=rgba',
    '-frames:v', '1', path.join(IMAGES, 'android-icon-monochrome.png'),
  ]);

  ffmpeg(['-i', tile, '-vf', 'scale=48:48:flags=lanczos', '-frames:v', '1', path.join(IMAGES, 'favicon.png')]);

  // Independently derived from the logo every run: if this drifts, the icon is wrong.
  console.log(`OnMe icons rebuilt from assets/brand/onme-logo.png`);
  console.log(`  tile ${measured.width}x${measured.height}px at (${measured.x}, ${measured.y}), trimmed ${trim}px a side`);
  console.log(`  mask cut from the tile's own outline; canvas left in the corners: ${cornerCanvas(tile)}px`);
  console.log(`  icon made full bleed from a ${inner}px corner fill`);
  console.log('  adaptive background continues the artwork past its edge, so no ring shows');
  console.log('  assets/images/{icon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome,favicon}.png');
  console.log('  assets/brand/onme-logo-tile{,-384}.png');
}

try {
  main();
} finally {
  rmSync(work, { recursive: true, force: true });
}
