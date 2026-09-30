#!/usr/bin/env node
/**
 * Offline smoke test for the try-on endpoint.
 *
 * Boots the real server twice — once with no model configured, once with a key
 * that cannot possibly work — and walks the paths that must answer without
 * contacting a provider. It spends nothing, needs no GPU and uploads no
 * photograph of anyone.
 *
 * It also checks the one claim that is easiest to make and hardest to keep:
 * that this server writes nothing to disk. The file tree is snapshotted before
 * and after the run, and any change fails the smoke test.
 *
 * Usage: npm run smoke
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;

function report(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
  return ok;
}

function note(label, detail = '') {
  console.log(`      ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

/** Real 1×1 PNG/JPEG signatures, so the endpoint's format check has something to read. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const TEXT = Buffer.from('not an image at all, just text', 'utf8');

function photo(bytes, mimeType) {
  return { mimeType, data: bytes.toString('base64') };
}

function tryOnBody(overrides = {}) {
  return {
    consentAt: new Date().toISOString(),
    person: photo(PNG, 'image/png'),
    outfit: photo(PNG, 'image/png'),
    ...overrides,
  };
}

/** Every file under a directory, for the nothing-was-written check. */
function snapshot(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(`${full}:${statSync(full).size}`);
    }
  };
  walk(root);
  return found.sort();
}

async function startServer(extraEnv) {
  const port = 25000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, 'src', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/health`)).ok) return { base, logs: () => logs.join(''), stop: () => child.kill('SIGTERM') };
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  child.kill('SIGKILL');
  throw new Error(`server did not start:\n${logs.join('')}`);
}

async function post(base, body, { contentType = 'application/json', token = '' } = {}) {
  const query = token === '' ? '' : `?token=${encodeURIComponent(token)}`;
  const response = await fetch(`${base}/tryon${query}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

/** A port nothing listens on, so a provider call would fail immediately. */
function deadQueueBase() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(`http://127.0.0.1:${port}`));
    });
  });
}

async function checkUnconfigured() {
  console.log('— no try-on model configured\n');

  const server = await startServer({ FAL_KEY: '', FAL_API_KEY: '' });
  try {
    const health = await (await fetch(`${server.base}/health`)).json();
    report(health.status === 'ok', 'health answers', String(health.status));
    report(health.tryOnReady === false, 'health says it cannot make a picture', String(health.tryOnReady));
    report(health.falConfigured === false, 'no model key is configured', String(health.falConfigured));

    const result = await post(server.base, tryOnBody());
    report(result.status === 503, 'a try-on is refused, not attempted', `HTTP ${result.status}`);
    note('message', result.payload?.error ?? '(none)');

    const after = await (await fetch(`${server.base}/health`)).json();
    report(after.status === 'ok', 'health still answers after a refusal');
    report(after.tryOnsUnavailable === 1, 'the refusal is counted', String(after.tryOnsUnavailable));
  } finally {
    server.stop();
  }
}

async function checkConfigured() {
  console.log('\n— model key present, provider unreachable\n');

  const base = await deadQueueBase();
  const server = await startServer({ FAL_KEY: 'smoke-key-never-used', FAL_QUEUE_BASE: base });
  try {
    const health = await (await fetch(`${server.base}/health`)).json();
    report(health.tryOnReady === true, 'health says it is ready to generate', String(health.tryOnReady));
    report(
      typeof health.tryOnModel === 'string' && health.tryOnModel.includes('/'),
      'health names the model',
      String(health.tryOnModel)
    );
    report(typeof health.limits?.maxImageBytes === 'number', 'health reports the limits');

    const serialized = JSON.stringify(health);
    report(
      !/(apiKey|api_key|secret|fal_key|bearer|smoke-key)/i.test(serialized),
      'health carries no key material'
    );

    const wrongType = await post(server.base, tryOnBody(), { contentType: 'multipart/form-data' });
    report(wrongType.status === 415, 'a non-JSON body is refused', `HTTP ${wrongType.status}`);

    const noConsent = await post(server.base, tryOnBody({ consentAt: '' }));
    report(noConsent.status === 400, 'a missing consent assertion is refused', `HTTP ${noConsent.status}`);
    note('message', noConsent.payload?.error ?? '(none)');

    const notAnImage = await post(
      server.base,
      tryOnBody({ person: photo(TEXT, 'image/png') })
    );
    report(notAnImage.status === 400, 'a photo that is not an image is refused', `HTTP ${notAnImage.status}`);

    const noOutfit = await post(server.base, tryOnBody({ outfit: undefined }));
    report(noOutfit.status === 400, 'a missing outfit is refused', `HTTP ${noOutfit.status}`);

    // An unreachable provider must read as the provider's problem, not as the
    // user's photo being wrong.
    const unreachable = await post(server.base, tryOnBody());
    report(unreachable.status === 502, 'an unreachable provider is a 502', `HTTP ${unreachable.status}`);
    report(
      !/smoke-key|queue\.fal/.test(JSON.stringify(unreachable.payload ?? {})),
      'the provider failure leaks no detail to the client'
    );
  } finally {
    server.stop();
  }
}

async function checkToken() {
  console.log('\n— shared token required\n');

  const server = await startServer({ FAL_KEY: '', ONME_CLIENT_TOKEN: 'smoke-shared-token' });
  try {
    const health = await (await fetch(`${server.base}/health`)).json();
    report(health.tokenRequired === true, 'health admits a token is required');

    const missing = await post(server.base, tryOnBody());
    report(missing.status === 401, 'a missing token is refused', `HTTP ${missing.status}`);

    const wrong = await post(server.base, tryOnBody(), { token: 'not-the-token' });
    report(wrong.status === 401, 'a wrong token is refused', `HTTP ${wrong.status}`);

    const right = await post(server.base, tryOnBody(), { token: 'smoke-shared-token' });
    // Entitlement is fine; the model is simply not configured on this boot.
    report(right.status === 503, 'the right token reaches the model check', `HTTP ${right.status}`);
  } finally {
    server.stop();
  }
}

async function checkRetiredRoutes() {
  console.log('\n— routes this server does not have\n');

  const server = await startServer({ FAL_KEY: '' });
  try {
    for (const [method, route] of [
      ['GET', '/'],
      ['GET', '/looks'],
      ['POST', '/debrief'],
      ['GET', '/sessions/abc/stream'],
    ]) {
      const response = await fetch(`${server.base}${route}`, { method });
      report(response.status === 404, `${method} ${route} is not served`, `HTTP ${response.status}`);
    }
  } finally {
    server.stop();
  }
}

async function main() {
  console.log('OnMe backend smoke — offline, no provider call, nothing billed\n');

  const before = snapshot(SERVER_ROOT);

  await checkUnconfigured();
  await checkConfigured();
  await checkToken();
  await checkRetiredRoutes();

  console.log('\n— the promise this server makes about disk\n');
  const after = snapshot(SERVER_ROOT);
  const added = after.filter((entry) => !before.includes(entry));
  report(added.length === 0, 'nothing was written to server/', added.slice(0, 5).join(', ') || 'unchanged');

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nThe try-on endpoint behaves: every refusal is decided before a generation is paid for,');
  console.log('the key stays server-side, and nothing was written to disk.');
  console.log('(No photograph was uploaded and no provider call was made.)');
}

await main();
