/**
 * Offline test harness.
 *
 * Nothing here talks to fal. The fake speaks just enough of the documented queue
 * protocol — submit, poll, fetch result — that the production code in
 * `src/tryon/fal.js` runs unchanged. These tests cost nothing and need no GPU,
 * no key and no real photograph.
 *
 * The real `.env` is deliberately left in the environment for the child server
 * (if it exists) and then overridden by explicit values: Node's
 * `process.loadEnvFile()` never replaces a variable that is already set, so the
 * fake key and the loopback queue base always win over anything in a file.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** server/test/support/harness.js -> server/ */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The image the fake model "generates". Never a real photograph. */
const DEFAULT_RESULT = {
  images: [
    {
      url: 'https://fal.media.example/onme/generated.png',
      content_type: 'image/png',
      width: 768,
      height: 1024,
    },
  ],
};

/**
 * A fake fal queue.
 *
 * Records every request it receives — method, path, authorization header and raw
 * body — so a test can assert what the backend actually sent: which model, which
 * input keys, and that the key travelled in the header.
 *
 * @param {{
 *   submitStatus?: number,
 *   jobStatus?: string,
 *   modelError?: string,
 *   result?: object,
 *   submitPayload?: object,
 * }} [options]
 */
export async function startFakeFal(options = {}) {
  const requests = [];

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? '';
      const record = {
        method: req.method ?? '',
        url,
        path: url.split('?')[0],
        authorization: String(req.headers.authorization ?? ''),
        body,
      };
      requests.push(record);

      const base = `http://127.0.0.1:${server.address()?.port ?? 0}`;

      const submitStatus = Number(options.submitStatus ?? 200);
      if (req.method === 'POST') {
        if (submitStatus !== 200) {
          res.writeHead(submitStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ detail: 'fake fal submit failure' }));
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            options.submitPayload ?? {
              request_id: 'fake-request-1',
              status_url: `${base}/requests/fake-request-1/status`,
              response_url: `${base}/requests/fake-request-1/response`,
            }
          )
        );
        return;
      }

      if (url.includes('/status')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: options.jobStatus ?? 'COMPLETED',
            ...(options.modelError ? { error: options.modelError } : {}),
          })
        );
        return;
      }

      if (url.includes('/response') || url.includes('/requests/fake-request-1')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(options.result ?? DEFAULT_RESULT));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'fake fal: no such route' }));
    });
    req.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    requests,
    submissions: () => requests.filter((request) => request.method === 'POST'),
    lastSubmission: () => requests.filter((request) => request.method === 'POST').at(-1) ?? null,
    /** The parsed JSON body of the last submit, or null. */
    lastInput: () => {
      const submission = requests.filter((request) => request.method === 'POST').at(-1);
      if (!submission) return null;
      try {
        return JSON.parse(submission.body.toString('utf8'));
      } catch {
        return null;
      }
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * A POST with headers this process chooses, rather than the ones `fetch` decides.
 *
 * Needed to exercise the paths that depend on a *declared* length, which fetch
 * will not let a caller set independently of the body it is given.
 */
export function httpPost(url, { headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    request.on('error', reject);
    request.end(body);
  });
}

/** Picks a free-ish port so parallel test files do not collide. */
function randomPort() {
  return 15000 + Math.floor(Math.random() * 20000);
}

/** The one event a try-on needs, as the Codex backend writes it. */
function sse(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** A PNG header with the size in it, so a size read is not a guess. */
export function testPng(width = 1037, height = 1516, bytes = 512) {
  const png = Buffer.alloc(Math.max(24, bytes));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

/** A JWT-shaped token, so the expiry can be read out of it the way the real one is read. */
function fakeJwt(expiresInSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })
  ).toString('base64url');
  return `${header}.${payload}.not-a-real-signature`;
}

/**
 * A Codex login on disk, for the tests that need one.
 *
 * Written to a temp directory, never to a real `~/.codex`: a test must not read,
 * refresh or overwrite the credentials of whoever happens to run it.
 */
export function startCodexLogin({ expiresInSeconds = 3600 } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'onme-codex-login-'));
  const authPath = path.join(directory, 'auth.json');

  writeFileSync(
    authPath,
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: fakeJwt(expiresInSeconds),
        access_token: fakeJwt(expiresInSeconds),
        refresh_token: 'rt.test-never-used',
        account_id: 'account-test-123',
      },
      last_refresh: new Date().toISOString(),
    })
  );

  return { authPath, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/**
 * A fake Codex subscription backend.
 *
 * Speaks just enough of the event stream — a created response, then one
 * `image_generation_call` item — that `src/tryon/codex.js` runs unchanged. It
 * records what it was sent so a test can assert the two photos travelled in
 * order, with the account id, and with nothing stored on the provider side.
 *
 * @param {{ status?: number, refuse?: boolean, noImage?: boolean, png?: Buffer }} [options]
 */
export async function startFakeCodex(options = {}) {
  const requests = [];
  const png = options.png ?? testPng();

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: String(req.headers.authorization ?? ''),
        accountId: String(req.headers['chatgpt-account-id'] ?? ''),
        originator: String(req.headers.originator ?? ''),
        sessionId: String(req.headers.session_id ?? ''),
        body,
      });

      const status = Number(options.status ?? 200);
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'fake codex failure' }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = [sse({ type: 'response.created' })];
      if (options.refuse) {
        events.push(
          sse({ type: 'response.output_item.done', item: { type: 'image_generation_call', id: 'ig_test', status: 'failed' } })
        );
      } else if (!options.noImage) {
        events.push(
          sse({
            type: 'response.output_item.done',
            item: { type: 'image_generation_call', id: 'ig_test', result: png.toString('base64') },
          })
        );
      }
      res.end(events.join(''));
    });
    req.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    requests,
    png,
    /** The parsed body of the last request, or null. */
    lastInput: () => {
      const last = requests.at(-1);
      if (!last) return null;
      try {
        return JSON.parse(last.body.toString('utf8'));
      } catch {
        return null;
      }
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Spawns the real backend with the model pointed at a local fake.
 *
 * The Codex login is pointed at a path that does not exist unless a test says
 * otherwise, so no test depends on the machine it runs on being logged in to
 * ChatGPT — and none can read or refresh a real credential file.
 *
 * @param {Record<string, string>} [extraEnv]
 */
export async function startBackend(extraEnv = {}) {
  const port = Number(extraEnv.PORT ?? randomPort());
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      FAL_KEY: 'test-key-never-sent-anywhere-real',
      ONME_CLIENT_TOKEN: '',
      ONME_CODEX_AUTH_PATH: path.join(os.tmpdir(), 'onme-test-no-codex-login.json'),
      ONME_CODEX_REFRESH: 'off',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  let exitCode = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    if (exitCode !== null) break;
    try {
      const response = await fetch(`${base}/health`);
      healthy = response.ok;
    } catch {
      // Not up yet.
    }
    if (!healthy) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!healthy) {
    child.kill('SIGKILL');
    throw new Error(`backend did not become healthy (exit ${exitCode}):\n${logs.join('')}`);
  }

  return {
    port,
    base,
    logs: () => logs.join(''),
    exited: () => exitCode,
    health: async () => (await fetch(`${base}/health`)).json(),
    /** POSTs a try-on request with the given body. */
    tryOn: async (body, { token = '', contentType = 'application/json', raw } = {}) => {
      const params = token === '' ? '' : `?token=${encodeURIComponent(token)}`;
      return fetch(`${base}/tryon${params}`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: raw ?? JSON.stringify(body),
      });
    },
    stop: async () => {
      if (exitCode !== null) return;
      const done = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (exitCode === null) child.kill('SIGKILL');
    },
  };
}
