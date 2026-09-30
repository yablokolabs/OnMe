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
import { createServer, request as httpRequest } from 'node:http';
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

/**
 * Spawns the real backend with the model pointed at a local fake.
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
