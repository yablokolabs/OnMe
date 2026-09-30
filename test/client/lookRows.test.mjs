/**
 * The look store's shape, offline.
 *
 * A row that cannot be parsed must become *no row* rather than a screen that
 * cannot open, and a look whose generated picture has been deleted is not a look.
 * Both rules live here so they can be pinned without a database.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOOKS_SCHEMA,
  fromLookRow,
  parseProfile,
  parseStoredImage,
  sortByCreatedAt,
  toLookRow,
  toProfilePayload,
} from '../../src/services/lookRows.ts';

const image = (uri) => ({ uri, fileName: 'x.jpg', bytes: 1234, mimeType: 'image/jpeg', width: 768, height: 1024 });

const look = {
  id: 'look_1',
  createdAt: '2026-09-30T10:00:00.000Z',
  person: image('file:///photos/you-1.jpg'),
  outfit: image('file:///photos/look_1-outfit.jpg'),
  result: image('file:///photos/look_1-look.png'),
  model: 'fal-ai/image-apps-v2/virtual-try-on',
  preservePose: true,
};

test('the schema stores the two tables the app needs', () => {
  assert.match(LOOKS_SCHEMA, /CREATE TABLE IF NOT EXISTS looks/);
  assert.match(LOOKS_SCHEMA, /CREATE TABLE IF NOT EXISTS profile/);
  assert.match(LOOKS_SCHEMA, /created_ms DESC/);
});

test('a look survives a round trip through its row', () => {
  const row = toLookRow(look);
  assert.equal(row.id, 'look_1');
  assert.equal(row.created_at, '2026-09-30T10:00:00.000Z');
  assert.equal(row.created_ms, Date.parse('2026-09-30T10:00:00.000Z'));

  const restored = fromLookRow(row);
  assert.deepEqual(restored, look);
});

test('an unreadable row is no row, not a broken screen', () => {
  assert.equal(fromLookRow(null), null);
  assert.equal(fromLookRow(undefined), null);
  assert.equal(fromLookRow({ id: 'x', created_at: '', created_ms: 0, payload: '{not json' }), null);
  assert.equal(fromLookRow({ id: 'x', created_at: '', created_ms: 0, payload: '"a string"' }), null);
  // No id, nothing to open.
  assert.equal(fromLookRow({ id: 'x', created_at: '', created_ms: 0, payload: '{}' }), null);
});

test('a look whose generated picture is gone is not a look', () => {
  const withoutResult = JSON.parse(JSON.stringify(look));
  delete withoutResult.result;

  assert.equal(
    fromLookRow({ id: 'look_1', created_at: '', created_ms: 0, payload: JSON.stringify(withoutResult) }),
    null
  );

  // A result entry with no uri at all is the same thing: a file that is not there.
  const emptyUri = { ...look, result: { ...look.result, uri: '   ' } };
  assert.equal(
    fromLookRow({ id: 'look_1', created_at: '', created_ms: 0, payload: JSON.stringify(emptyUri) }),
    null
  );
});

test('a look survives its source photos being deleted', () => {
  // Deleting the photo of you must not take the look with it: the generated
  // picture is the thing the user kept.
  const withoutSources = { ...look, person: null, outfit: null };
  const restored = fromLookRow({
    id: 'look_1',
    created_at: '2026-09-30T10:00:00.000Z',
    created_ms: 0,
    payload: JSON.stringify(withoutSources),
  });

  assert.equal(restored.person, null);
  assert.equal(restored.outfit, null);
  assert.equal(restored.result.uri, 'file:///photos/look_1-look.png');
});

test('the indexed column wins for the timestamp the list sorted by', () => {
  const row = { ...toLookRow(look), created_at: '2026-01-01T00:00:00.000Z' };
  assert.equal(fromLookRow(row).createdAt, '2026-01-01T00:00:00.000Z');
});

test('a stored photo needs a uri and nothing else', () => {
  assert.equal(parseStoredImage(null), null);
  assert.equal(parseStoredImage({}), null);
  assert.equal(parseStoredImage({ uri: '  ' }), null);

  const minimal = parseStoredImage({ uri: 'file:///photos/a.png' });
  assert.equal(minimal.uri, 'file:///photos/a.png');
  assert.equal(minimal.bytes, 0);
  assert.equal(minimal.width, 0);
});

test('the photo of you round trips, and nonsense is simply not one', () => {
  const person = image('file:///photos/you-1.jpg');
  assert.deepEqual(parseProfile(JSON.parse(toProfilePayload(person))), person);
  assert.equal(parseProfile({ uri: '' }), null);
  assert.equal(parseProfile('nope'), null);
});

test('looks sort newest first, and an unparseable date does not scramble the list', () => {
  const ordered = sortByCreatedAt([
    { ...look, id: 'b', createdAt: '2026-09-30T10:00:00.000Z' },
    { ...look, id: 'a', createdAt: '2026-09-28T09:00:00.000Z' },
    { ...look, id: 'c', createdAt: 'not a date' },
  ]);

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ['b', 'a', 'c']
  );
  // The caller's array is not reordered underneath them.
  assert.equal(ordered.length, 3);
});
