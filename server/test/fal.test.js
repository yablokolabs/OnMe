/**
 * The fal client's pure parts: config resolution, the data URI, and reading an
 * image out of a model result that may not match the documented shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getFalConfig, pickImage, toDataUri } from '../src/tryon/fal.js';

/** Sets an env var for one test and puts it back however the test ends. */
function withEnv(name, value, run) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('the try-on model and the fashion framing are the defaults', () => {
  withEnv('ONME_TRY_ON_MODEL', undefined, () => {
    assert.equal(getFalConfig().model, 'fal-ai/image-apps-v2/virtual-try-on');
  });

  withEnv('ONME_ASPECT_RATIO', undefined, () => {
    assert.equal(getFalConfig().aspectRatio, '3:4');
  });
});

test('the pose is preserved unless it is switched off explicitly', () => {
  for (const value of [undefined, '', 'true', '1', 'yes', 'anything']) {
    withEnv('ONME_PRESERVE_POSE', value, () => {
      assert.equal(getFalConfig().preservePose, true, `${JSON.stringify(value)} must keep the pose`);
    });
  }

  for (const value of ['0', 'false', 'no', 'off', 'FALSE']) {
    withEnv('ONME_PRESERVE_POSE', value, () => {
      assert.equal(getFalConfig().preservePose, false, `${JSON.stringify(value)} must drop the pose`);
    });
  }
});

test('an aspect ratio the model does not offer falls back instead of being sent', () => {
  // A bad value reaching the model would be a failed generation the user paid for.
  withEnv('ONME_ASPECT_RATIO', '7:5', () => {
    assert.equal(getFalConfig().aspectRatio, '3:4');
  });

  for (const ratio of ['1:1', '16:9', '9:16', '4:3', '3:4']) {
    withEnv('ONME_ASPECT_RATIO', ratio, () => {
      assert.equal(getFalConfig().aspectRatio, ratio);
    });
  }
});

test('a photo becomes a data URI of the type it really is', () => {
  assert.equal(toDataUri('AAAA', 'image/png'), 'data:image/png;base64,AAAA');
  assert.equal(toDataUri('BBBB', 'image/jpeg'), 'data:image/jpeg;base64,BBBB');
});

test('the documented result shape is read', () => {
  const image = pickImage({
    images: [{ url: 'https://fal.media.example/a.png', content_type: 'image/png', width: 768, height: 1024 }],
  });
  assert.deepEqual(image, {
    url: 'https://fal.media.example/a.png',
    contentType: 'image/png',
    width: 768,
    height: 1024,
  });
});

test('a drifted result shape is still read rather than reported as no image', () => {
  // Model output schemas move between versions; a generation that succeeded must
  // not be thrown away because a key was renamed.
  const nested = pickImage({ data: { output: { image: { url: 'https://fal.media.example/b.png' } } } });
  assert.equal(nested.url, 'https://fal.media.example/b.png');

  const flat = pickImage({ images: ['https://fal.media.example/c.png'] });
  assert.equal(flat.url, 'https://fal.media.example/c.png');
});

test('a result with no image in it is reported as no image', () => {
  assert.equal(pickImage(null), null);
  assert.equal(pickImage({}), null);
  assert.equal(pickImage({ images: [] }), null);
  assert.equal(pickImage({ images: [{ url: 'not-a-url' }] }), null);
  assert.equal(pickImage({ detail: 'something went wrong' }), null);
});
