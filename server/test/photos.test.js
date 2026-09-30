/**
 * Photo validation, offline and deterministic.
 *
 * Every rule that decides whether a photo is accepted lives in one pure module,
 * so it can be pinned here without a server, a request or a provider call.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeBytes,
  normalizeConsent,
  normalizePhoto,
  normalizePhotos,
  sniffImageFormat,
} from '../src/tryon/photos.js';
import { heicBytes, jpegBytes, notImageBytes, pngBytes, photo, webpBytes } from './support/fixtures.js';

/** A one-megabyte ceiling, so an "oversized" fixture stays tiny. */
const LIMITS = { maxImageBytes: 1024 * 1024 };

const person = (value) => normalizePhoto(value, { role: 'person', maxBytes: LIMITS.maxImageBytes });

test('the format is read from the file signature, not the label', () => {
  assert.equal(sniffImageFormat(pngBytes()), 'png');
  assert.equal(sniffImageFormat(jpegBytes()), 'jpeg');
  assert.equal(sniffImageFormat(webpBytes()), 'webp');
  assert.equal(sniffImageFormat(heicBytes()), 'heic');
  assert.equal(sniffImageFormat(notImageBytes()), null);
  // A truncated file is not an image this server will vouch for.
  assert.equal(sniffImageFormat(Buffer.from([0x89, 0x50])), null);
  assert.equal(sniffImageFormat(null), null);
});

test('a valid photo is accepted and reported as its real type', () => {
  const result = person(photo(pngBytes(), 'image/png'));
  assert.equal(result.ok, true);
  assert.equal(result.photo.mimeType, 'image/png');
  assert.equal(result.photo.bytes, pngBytes().length);
  assert.equal(result.photo.role, 'person');
});

test('the bytes win when the declared type disagrees with them', () => {
  // A PNG the client labelled as a JPEG is sent on as a PNG: that is what the
  // model will actually decode, and passing the label along would be a lie.
  const result = person(photo(pngBytes(), 'image/jpeg'));
  assert.equal(result.ok, true);
  assert.equal(result.photo.mimeType, 'image/png');
  assert.equal(result.photo.declaredType, 'image/jpeg');
});

test('base64 with line breaks in it is still base64', () => {
  const bytes = pngBytes();
  const wrapped = bytes
    .toString('base64')
    .replace(/(.{8})/g, '$1\n')
    .trim();
  const result = person({ mimeType: 'image/png', data: wrapped });
  assert.equal(result.ok, true);
  assert.equal(result.photo.bytes, bytes.length);
});

test('HEIC is refused with something the user can act on', () => {
  const result = person(photo(heicBytes(), 'image/heic'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported-format');
  assert.equal(result.statusCode, 415);
  // The message has to name the fix, not just the problem: this is what an
  // iPhone produces by default.
  assert.match(result.message, /JPEG or PNG/);
  assert.match(result.message, /Most Compatible/);
});

test('a file that is not an image is refused', () => {
  const result = person(photo(notImageBytes(), 'image/png'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-an-image');
  assert.equal(result.statusCode, 400);
});

test('data that is not base64 is refused before it is decoded', () => {
  const result = person({ mimeType: 'image/png', data: 'not base64 at all!!' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-base64');
  assert.equal(result.statusCode, 400);
});

test('an empty photo is refused', () => {
  for (const value of [
    { mimeType: 'image/png', data: '' },
    { mimeType: 'image/png' },
    { mimeType: 'image/png', data: '   ' },
  ]) {
    const result = person(value);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty');
  }
});

test('an oversized photo is refused and the message names the limit', () => {
  const result = person(photo(pngBytes(1024 * 1024 + 64), 'image/png'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-large');
  assert.equal(result.statusCode, 413);
  assert.match(result.message, /larger than the 1 MB/);
});

test('a missing photo is refused by the name the user would recognise', () => {
  const missing = person(undefined);
  assert.equal(missing.ok, false);
  assert.equal(missing.statusCode, 400);
  assert.match(missing.message, /photo of you/);

  const noOutfit = normalizePhoto(undefined, { role: 'outfit', maxBytes: LIMITS.maxImageBytes });
  assert.match(noOutfit.message, /outfit photo/);
});

test('both photos are required, and the bad one is the one named', () => {
  const valid = { person: photo(pngBytes(), 'image/png'), outfit: photo(jpegBytes(), 'image/jpeg') };
  assert.equal(normalizePhotos(valid, LIMITS).ok, true);

  const badOutfit = normalizePhotos({ ...valid, outfit: photo(notImageBytes()) }, LIMITS);
  assert.equal(badOutfit.ok, false);
  assert.equal(badOutfit.role, 'outfit');

  const badBody = normalizePhotos('nope', LIMITS);
  assert.equal(badBody.ok, false);
  assert.equal(badBody.reason, 'bad-body');
});

test('the consent assertion is required, and it is not treated as a rights claim', () => {
  assert.equal(normalizeConsent({ consentAt: '2026-09-30T00:00:00.000Z' }).ok, true);

  for (const body of [{}, { consentAt: '' }, { consentAt: '   ' }, null, 'nope']) {
    const result = normalizeConsent(body);
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.message, /will not send a photo of a person/);
  }
});

test('describeBytes rounds to whole megabytes', () => {
  assert.equal(describeBytes(1024 * 1024), '1 MB');
  assert.equal(describeBytes(40 * 1024 * 1024), '40 MB');
});
