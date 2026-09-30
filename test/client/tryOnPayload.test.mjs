/**
 * The payload of a try-on, and the answer coming back.
 *
 * These are the rules that decide whether a photo is sent and whether a reply is
 * believed. Both directions of the wire are pure functions, so both can be pinned
 * here without a device, a picker or a backend.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_IMAGE_BYTES,
  buildTryOnBody,
  describePhotoProblem,
  estimatePhotoBytes,
  formatBytes,
  normalizeGeneratedLook,
  parseTryOnResponse,
  readBackendError,
} from '../../src/services/tryOnPayload.ts';

/** Base64 whose decoded size is exactly `bytes` (three bytes per four chars). */
function base64OfSize(bytes) {
  return 'A'.repeat(Math.ceil(bytes / 3) * 4);
}

test('a body carries exactly the two photos and the consent assertion', () => {
  const body = buildTryOnBody({
    person: { base64: 'PERSON', mimeType: 'image/jpeg' },
    outfit: { base64: 'OUTFIT', mimeType: 'image/jpeg' },
    consentAt: '2026-09-30T10:00:00.000Z',
  });

  assert.deepEqual(body, {
    consentAt: '2026-09-30T10:00:00.000Z',
    person: { mimeType: 'image/jpeg', data: 'PERSON' },
    outfit: { mimeType: 'image/jpeg', data: 'OUTFIT' },
  });
  // The keys the backend reads are `mimeType`/`data`, and nothing else rides along.
  assert.deepEqual(Object.keys(body).sort(), ['consentAt', 'outfit', 'person']);
});

test('the decoded size of base64 is measured, not guessed', () => {
  // "AAAA" decodes to three bytes; padding is not part of the count.
  assert.equal(estimatePhotoBytes('AAAA'), 3);
  assert.equal(estimatePhotoBytes('AAA='), 2);
  assert.equal(estimatePhotoBytes('AA=='), 1);
  assert.equal(estimatePhotoBytes(''), 0);
  assert.equal(estimatePhotoBytes('  AA BB \n'), 3);
});

test('a photo of the right size passes, and an oversized one is a sentence', () => {
  assert.match(describePhotoProblem(null), /could not be read/);
  assert.equal(
    describePhotoProblem({ base64: base64OfSize(1024), mimeType: 'image/jpeg' }),
    null,
    'an ordinary photo must be accepted'
  );

  const tooBig = describePhotoProblem({ base64: base64OfSize(MAX_IMAGE_BYTES + 1024), mimeType: 'image/jpeg' });
  assert.ok(tooBig);
  assert.match(tooBig, /larger than the 12 MB/);
});

test('a photo with no data, or not an image, is refused before an upload', () => {
  assert.match(describePhotoProblem({ base64: '', mimeType: 'image/jpeg' }), /could not be read/);
  assert.match(describePhotoProblem({ base64: 'AAAA', mimeType: 'application/pdf' }), /not an image/);

  // The picker always produces a JPEG, so an absent type must not be treated as a
  // reason to refuse a perfectly good photo.
  assert.equal(describePhotoProblem({ base64: 'AAAA' }), null);
});

test('the documented answer is read', () => {
  const look = normalizeGeneratedLook({
    imageUrl: 'https://fal.media.example/look.png',
    contentType: 'image/png',
    width: 768,
    height: 1024,
    model: 'fal-ai/image-apps-v2/virtual-try-on',
    preservePose: true,
  });

  assert.equal(look.imageUrl, 'https://fal.media.example/look.png');
  assert.equal(look.width, 768);
  assert.equal(look.height, 1024);
  assert.equal(look.model, 'fal-ai/image-apps-v2/virtual-try-on');
  assert.equal(look.preservePose, true);
});

test('an answer with no picture in it is no look at all', () => {
  // A result screen showing nothing would look like the try-on succeeded.
  assert.equal(normalizeGeneratedLook({}), null);
  assert.equal(normalizeGeneratedLook({ imageUrl: '' }), null);
  assert.equal(normalizeGeneratedLook({ imageUrl: 'not-a-url' }), null);
  assert.equal(normalizeGeneratedLook({ imageUrl: 'data:image/png;base64,AAAA' }), null);
  assert.equal(normalizeGeneratedLook(null), null);
});

test('the pose is only claimed when the backend says it was kept', () => {
  const url = 'https://fal.media.example/look.png';
  // Absent, false and any other value all mean "not kept": the screen must never
  // promise that the user's pose survived when the model was not asked.
  for (const preservePose of [undefined, false, 'true', 1, null]) {
    assert.equal(normalizeGeneratedLook({ imageUrl: url, preservePose }).preservePose, false);
  }
  assert.equal(normalizeGeneratedLook({ imageUrl: url, preservePose: true }).preservePose, true);
});

test('the whole 200 body is required to say ok', () => {
  const look = { imageUrl: 'https://fal.media.example/look.png', preservePose: true };

  assert.ok(parseTryOnResponse({ ok: true, look }));
  assert.equal(parseTryOnResponse({ look }), null);
  assert.equal(parseTryOnResponse({ ok: false, look }), null);
  assert.equal(parseTryOnResponse({ ok: true }), null);
  assert.equal(parseTryOnResponse(null), null);
});

test('a backend error is surfaced in its own words when it has any', () => {
  assert.equal(
    readBackendError({ error: 'OnMe is making other try-ons right now. Try again in a minute.' }),
    'OnMe is making other try-ons right now. Try again in a minute.'
  );
  assert.equal(readBackendError({ error: '   ' }), null);
  assert.equal(readBackendError({}), null);
  assert.equal(readBackendError('not json'), null);
});

test('sizes read the way a person writes them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});
