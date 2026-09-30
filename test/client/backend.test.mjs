/**
 * Transport security regression tests for the try-on endpoint.
 *
 * A photograph of a person is the most private thing this app handles, and the
 * backend holds the provider key, so a release build must refuse to POST the
 * photos in the clear. These tests pin that: an `https` backend becomes an
 * `https` upload, a plain `http` one is refused rather than silently downgraded,
 * and the shared token travels as a query parameter alongside it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTryOnEndpoint } from '../../src/services/backend.ts';

const build = (options) => buildTryOnEndpoint({ baseUrl: 'https://onme.example.com', ...options });

test('an https backend becomes an https upload to /tryon', () => {
  const result = build({});
  assert.ok('url' in result);

  const url = new URL(result.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/tryon');
  // No metadata is invented: the whole request is the body.
  assert.equal(url.searchParams.toString(), '');
});

test('a backend behind a path or port keeps its path and port', () => {
  const withPath = build({ baseUrl: 'https://onme.example.com/team' });
  assert.ok('url' in withPath);
  assert.equal(new URL(withPath.url).pathname, '/team/tryon');

  const withPort = build({ baseUrl: 'https://onme.example.com:8443/' });
  assert.ok('url' in withPort);
  assert.equal(new URL(withPort.url).port, '8443');
});

test('an insecure backend is refused in a release build', () => {
  for (const baseUrl of ['http://onme.example.com', 'ws://onme.example.com', 'http://10.0.2.2:8787']) {
    const result = build({ baseUrl });
    assert.ok('error' in result, `${baseUrl} must be refused`);
    assert.match(result.error, /insecure connection|https:\/\//);
  }
});

test('an insecure backend is allowed only in a development build', () => {
  const development = build({ baseUrl: 'http://192.168.1.20:8787', development: true });
  assert.ok('url' in development);
  assert.equal(new URL(development.url).protocol, 'http:');

  // `development: undefined` is a release build, not a development one.
  assert.ok('error' in build({ baseUrl: 'http://192.168.1.20:8787' }));
});

test('the shared token is appended when one is configured', () => {
  const withToken = build({ token: 'shared-token' });
  assert.ok('url' in withToken);
  assert.equal(new URL(withToken.url).searchParams.get('token'), 'shared-token');

  const withoutToken = build({ token: '' });
  assert.ok('url' in withoutToken);
  assert.equal(new URL(withoutToken.url).searchParams.has('token'), false);
});

test('an empty or unusable base URL is rejected with an actionable message', () => {
  for (const baseUrl of [
    '',
    '   ',
    'onme.example.com',
    'ftp://onme.example.com',
    'https://h?x=1',
    'javascript:alert(1)',
  ]) {
    const result = build({ baseUrl });
    assert.ok('error' in result, `${JSON.stringify(baseUrl)} must be rejected`);
    assert.ok(result.error.length > 0);
  }
});

test('an unconfigured app explains itself instead of failing a request', () => {
  const result = build({ baseUrl: '' });
  assert.ok('error' in result);
  assert.match(result.error, /EXPO_PUBLIC_ONME_BACKEND_URL/);
});
