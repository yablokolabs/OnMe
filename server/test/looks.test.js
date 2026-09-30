/**
 * The store that holds a generated picture until the phone collects it.
 *
 * The three things that matter are that an id is unguessable, that a picture does
 * not outlive its few minutes, and that a server left running cannot accumulate
 * pictures of people past its caps.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearLooks,
  describeLookStore,
  forgetExpiredLooks,
  getLook,
  rememberLook,
} from '../src/tryon/looks.js';

/** Sets env vars for one test and puts them back however the test ends. */
function withEnv(values, run) {
  const previous = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    clearLooks();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function image(size = 16) {
  return { bytes: Buffer.alloc(size, 7), contentType: 'image/png', width: 1037, height: 1516 };
}

test('a remembered picture is collectable by its id, and only by its id', () => {
  withEnv({}, () => {
    const id = rememberLook(image());
    assert.equal(id.length, 48, 'a 24-byte id, as hex');

    const entry = getLook(id);
    assert.equal(entry.contentType, 'image/png');
    assert.equal(entry.width, 1037);
    assert.equal(entry.bytes.length, 16);

    assert.equal(getLook('0'.repeat(48)), null);
    assert.equal(getLook(''), null);
    assert.equal(getLook(undefined), null);
    assert.equal(getLook(id.slice(0, -1)), null);
  });
});

test('ids are unguessable and different for every picture', () => {
  withEnv({}, () => {
    const ids = new Set();
    for (let index = 0; index < 64; index += 1) ids.add(rememberLook(image()));
    assert.equal(ids.size, 64);
    for (const id of ids) assert.match(id, /^[0-9a-f]{48}$/);
  });
});

test('a picture past its few minutes is gone', () => {
  withEnv({ ONME_LOOK_TTL_MS: '50' }, async () => {
    const id = rememberLook(image());
    assert.notEqual(getLook(id), null);

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(getLook(id), null);

    // And the store does not simply grow: the expired entry is dropped.
    forgetExpiredLooks();
    assert.equal(describeLookStore().pending, 0);
  });
});

test('reading does not consume, so a failed download can be retried', () => {
  withEnv({}, () => {
    const id = rememberLook(image());
    assert.notEqual(getLook(id), null);
    assert.notEqual(getLook(id), null);
    assert.equal(describeLookStore().pending, 1);
  });
});

test('the store stays inside its entry cap, dropping the oldest first', () => {
  withEnv({ ONME_LOOK_MAX_ENTRIES: '3' }, () => {
    const first = rememberLook(image());
    const second = rememberLook(image());
    const third = rememberLook(image());
    const fourth = rememberLook(image());

    assert.equal(getLook(first), null, 'the oldest entry is the one evicted');
    assert.notEqual(getLook(second), null);
    assert.notEqual(getLook(third), null);
    assert.notEqual(getLook(fourth), null);
    assert.equal(describeLookStore().pending, 3);
  });
});

test('the store stays inside its byte cap', () => {
  withEnv({ ONME_LOOK_MAX_BYTES: String(3 * 1024), ONME_LOOK_MAX_ENTRIES: '99' }, () => {
    const first = rememberLook(image(2 * 1024));
    const second = rememberLook(image(2 * 1024));

    assert.equal(describeLookStore().bytes, 2 * 1024, 'the first picture was dropped to make room');
    assert.equal(getLook(first), null);
    assert.notEqual(getLook(second), null);
  });
});

test('the store describes itself in numbers only', () => {
  withEnv({}, () => {
    rememberLook(image(1024));
    const described = describeLookStore();

    assert.deepEqual(Object.keys(described).sort(), ['bytes', 'pending', 'ttlSeconds']);
    assert.equal(described.pending, 1);
    assert.equal(described.bytes, 1024);
    assert.equal(described.ttlSeconds, 600);

    // Described, never exposed: numbers about the store, no id and no picture.
    for (const value of Object.values(described)) assert.equal(typeof value, 'number');
    assert.equal(/[0-9a-f]{32,}/.test(JSON.stringify(described)), false);
  });
});

test('an empty picture is refused rather than stored', () => {
  withEnv({}, () => {
    assert.throws(() => rememberLook({ bytes: Buffer.alloc(0) }), /bytes/);
    assert.throws(() => rememberLook({ bytes: 'not a buffer' }), /bytes/);
  });
});
